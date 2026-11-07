import {NextRequest} from 'next/server';import {getDb} from '@/lib/db/schema';
import {requireSession,requirePerm,readJson,ok,fail,HttpError,validate} from '@/lib/api';import {activeBranch,BRANCH_COOKIE} from '@/lib/branch';
import {ledgerScope} from '@/lib/accounting';import {readSnapshot} from '@/lib/db/transaction';import {durableJsonResponse} from '@/lib/idempotency';
import {proposeServiceCredit,decideServiceCredit,postServiceCredit,reverseServiceCredit} from '@/lib/service-credits';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){try{
 const session=requireSession(req);requirePerm(session,'finance.view');requirePerm(session,'invoices.view');const db=getDb(),q=req.nextUrl.searchParams,cookie=req.cookies.get(BRANCH_COOKIE)?.value,scope=activeBranch(session,cookie),page=Number(q.get('page')??1);
 if(!Number.isSafeInteger(page)||page<1||page>100000)throw new HttpError(400,'صفحه معتبر نیست.');
 const response=readSnapshot(db,()=>{
  if(!q.has('invoice_id')){const search=(q.get('q')??'').trim();if(search.length>100)throw new HttpError(400,'جست‌وجو طولانی است.');
   const invoices=db.prepare(`SELECT i.id,i.number,c.first_name,c.last_name FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.type!='purchase' AND i.status NOT IN ('draft','cancelled')
    AND NOT EXISTS(SELECT 1 FROM invoice_items l WHERE l.invoice_id=i.id AND l.kind NOT IN ('service','labor','fee')) ${scope.all?'':'AND i.branch_id=?'} AND (i.number LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ?) ORDER BY i.id DESC LIMIT 21 OFFSET ?`).all(...(scope.all?[]:[scope.branchId]),...Array(3).fill(`%${search}%`),(page-1)*20);
   return ok({invoices:invoices.slice(0,20),hasMore:invoices.length>20});}
  const invoice=db.prepare('SELECT * FROM effective_invoices WHERE id=?').get(validate.id(q.get('invoice_id')));if(!invoice)throw new HttpError(404,'فاکتور یافت نشد.');ledgerScope(session,Number(invoice.branch_id),cookie,'finance.view');
  const items=db.prepare(`SELECT i.id,i.name,i.total,COALESCE((SELECT SUM(l.net_amount) FROM service_credit_lines l JOIN credit_notes n ON n.id=l.note_id WHERE l.invoice_item_id=i.id AND n.status IN ('approved','posted')),0) credited
   FROM invoice_items i WHERE i.invoice_id=? AND i.kind IN ('service','labor','fee') ORDER BY i.id LIMIT 51 OFFSET ?`).all(invoice.id,(page-1)*50);
  const historyPage=Number(q.get('history_page')??1);if(!Number.isSafeInteger(historyPage)||historyPage<1||historyPage>100000)throw new HttpError(400,'صفحهٔ سوابق معتبر نیست.');
  const notes=db.prepare('SELECT n.* FROM credit_notes n JOIN service_credit_documents d ON d.return_id=n.return_id WHERE n.invoice_id=? ORDER BY n.id DESC LIMIT 21 OFFSET ?').all(invoice.id,(historyPage-1)*20);
  return ok({invoice,items:items.slice(0,50),hasMore:items.length>50,notes:notes.slice(0,20),historyMore:notes.length>20,actor_id:session.user.id});
 });response.headers.set('Cache-Control','no-store');return response;
}catch(error){return fail(error);}}
export async function POST(req:NextRequest){try{
 const session=requireSession(req);requirePerm(session,'finance.manage');const body=await readJson(req),db=getDb(),cookie=req.cookies.get(BRANCH_COOKIE)?.value;
 const source=body.action==='propose'?db.prepare('SELECT branch_id FROM invoices WHERE id=?').get(validate.id(body.invoice_id)):db.prepare('SELECT n.branch_id FROM credit_notes n JOIN service_credit_documents d ON d.return_id=n.return_id WHERE n.id=?').get(validate.id(body.id));
 if(!source)throw new HttpError(404,'سند یافت نشد.');ledgerScope(session,Number(source.branch_id),cookie,'finance.manage');
 return durableJsonResponse(db,{actorId:session.user.id,branchId:Number(source.branch_id),operation:'service_credit',key:req.headers.get('idempotency-key'),payload:body},()=>{
  if(body.action==='propose')return ok(proposeServiceCredit(db,session,body,cookie));if(body.action==='approve'||body.action==='reject')return ok(decideServiceCredit(db,session,validate.id(body.id),body.action==='approve',cookie));
  if(body.action==='post')return ok(postServiceCredit(db,session,validate.id(body.id),body.date,cookie));if(body.action==='reverse')return ok(reverseServiceCredit(db,session,validate.id(body.id),body.date,body.reason,cookie));
  throw new HttpError(400,'عملیات معتبر نیست.');
 });
}catch(error){return fail(error);}}
