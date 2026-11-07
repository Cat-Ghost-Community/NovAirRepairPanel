import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/schema';
import { requireSession,requirePerm,readJson,ok,fail,HttpError,validate } from '@/lib/api';
import { activeBranch,BRANCH_COOKIE } from '@/lib/branch';
import { ledgerScope } from '@/lib/accounting';
import { durableJsonResponse } from '@/lib/idempotency';
import { readSnapshot } from '@/lib/db/transaction';
import { SETTLED_PAYMENT } from '@/lib/payment-state';
import { invoiceObligation } from '@/lib/invoice-obligation';
import { partyStatement } from '@/lib/party-statements';
import { returnRefundCapacity } from '@/lib/return-state';
import { returnSelector } from '@/lib/return-selectors';
import { requestReturn,authorizeReturn,receiveReturn,inspectReturn,disposeReturn,releaseRejectedReturn,proposeCreditNote,approveCreditNote,approveZeroReturnCredit,refundReturn,reverseReturnCredit } from '@/lib/returns';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){
 try{const session=requireSession(req);requirePerm(session,'invoices.view');const cookie=req.cookies.get(BRANCH_COOKIE)?.value,scope=activeBranch(session,cookie),db=getDb(),q=req.nextUrl.searchParams;
  const response=readSnapshot(db,()=>{
   if(q.get('view')==='selector')return ok(returnSelector(db,session,scope.branchId,cookie,q));
   if(q.get('view')==='statement'){requirePerm(session,'finance.view');const type=q.get('type');if(type!=='customer'&&type!=='supplier')throw new HttpError(400,'نوع طرف حساب معتبر نیست.');const branch=q.has('branch_id')?validate.id(q.get('branch_id')):scope.branchId;if(branch!=null)ledgerScope(session,branch,cookie,'finance.view');return ok(partyStatement(db,type,validate.id(q.get('party_id')),branch,q.get('from')??'',q.get('to')??'9999-12-31',Number(q.get('page')??1)));}
   if(q.has('invoice_id')){const inv=db.prepare('SELECT * FROM effective_invoices WHERE id=?').get(validate.id(q.get('invoice_id')));if(!inv)throw new HttpError(404,'فاکتور یافت نشد.');ledgerScope(session,Number(inv.branch_id),cookie,'invoices.view');
    const page=Number(q.get('page')??1),search=q.get('q')?.trim()??'';if(!Number.isSafeInteger(page)||page<1||page>100000||search.length>100)throw new HttpError(400,'صفحه یا جست‌وجوی ردیف‌ها معتبر نیست.');
    const params={invoice:Number(inv.id),q:`%${search}%`},where="i.invoice_id=:invoice AND i.kind='part' AND i.ref_id IS NOT NULL AND (i.name LIKE :q OR i.sku LIKE :q)";
    const total=Number(db.prepare(`SELECT COUNT(*) n FROM invoice_items i WHERE ${where}`).get(params)!.n);
    const items=db.prepare(`SELECT i.*,CAST(ROUND(i.qty*1000000) AS INTEGER)-COALESCE((SELECT SUM(l.qty_micro) FROM business_return_lines l JOIN business_returns r ON r.id=l.return_id WHERE l.invoice_item_id=i.id AND r.state!='rejected' AND l.rejection_release_reference IS NULL),0) eligible_micro FROM invoice_items i WHERE ${where} ORDER BY i.id LIMIT 100 OFFSET :offset`).all({...params,offset:(page-1)*100});
    return ok({invoice:inv,items,page,totalPages:Math.max(1,Math.ceil(total/100)),total});}
   if(q.has('id')){const doc=db.prepare('SELECT r.*,i.number invoice_number,i.customer_id,i.supplier_id FROM business_returns r JOIN invoices i ON i.id=r.invoice_id WHERE r.id=?').get(validate.id(q.get('id')));if(!doc)throw new HttpError(404,'مرجوعی یافت نشد.');ledgerScope(session,Number(doc.branch_id),cookie,'invoices.view');
    if(db.prepare('SELECT return_id FROM service_credit_documents WHERE return_id=?').get(doc.id))throw new HttpError(409,'این سند اصلاح خدمت است؛ از بخش «اصلاح مالی خدمات» آن را مشاهده کنید.');
    const lines=db.prepare(`SELECT l.*,i.name,i.sku,EXISTS(SELECT 1 FROM accounting_events e JOIN accounting_event_reviews r ON r.event_id=e.id JOIN accounting_journals j ON j.id=r.journal_id WHERE j.state='posted' AND ((e.source_type='stock' AND e.source_id=CAST(l.movement_id AS TEXT)) OR (l.movement_id IS NULL AND e.source_type='return_cost' AND e.source_id=CAST(l.id AS TEXT)))) cost_posted FROM business_return_lines l JOIN invoice_items i ON i.id=l.invoice_item_id WHERE l.return_id=? ORDER BY l.id LIMIT 100`).all(doc.id);
    const note=db.prepare('SELECT * FROM credit_notes WHERE return_id=? ORDER BY id DESC LIMIT 1').get(doc.id);
    const payments=db.prepare(`SELECT p.id,p.number,p.method,p.direction,p.amount-COALESCE((SELECT SUM(amount) FROM refunds WHERE payment_id=p.id),0)-COALESCE((SELECT allocated+credit_used FROM installment_receipt_funds WHERE id=p.id),0) refundable,${SETTLED_PAYMENT} settled FROM payments p WHERE p.invoice_id=? AND p.branch_id=? ORDER BY p.id DESC LIMIT 100`).all(doc.invoice_id,doc.branch_id);
    const historyPage=Number(q.get('history_page')??1);if(!Number.isSafeInteger(historyPage)||historyPage<1||historyPage>100000)throw new HttpError(400,'صفحهٔ سوابق معتبر نیست.');
    const historyCount=Number(db.prepare('SELECT COUNT(*) n FROM credit_notes WHERE return_id=?').get(doc.id)!.n);
    return ok({document:doc,lines,note,note_history_pages:Math.max(1,Math.ceil(historyCount/50)),note_history:db.prepare('SELECT id,number,status,amount,replaces_note_id,journal_id,reversal_id,requested_by,approved_by,created_at FROM credit_notes WHERE return_id=? ORDER BY id DESC LIMIT 50 OFFSET ?').all(doc.id,(historyPage-1)*50),note_lines:note?db.prepare('SELECT return_line_id,net_amount FROM credit_note_lines WHERE note_id=? ORDER BY id').all(note.id):[],obligation:invoiceObligation(db,Number(doc.invoice_id)),payments,refund_capacity:note?.status==='posted'?returnRefundCapacity(db,Number(doc.id)).remaining:0,
     locations:db.prepare('SELECT id,name FROM inventory_locations WHERE branch_id=? ORDER BY name LIMIT 200').all(doc.branch_id),actor_id:session.user.id});}
   const before=Number(q.get('before')??0);if(!Number.isSafeInteger(before)||before<0)throw new HttpError(400,'صفحه‌بندی معتبر نیست.');
   const rows=db.prepare(`SELECT r.*,i.number invoice_number,n.status credit_status,n.amount credit_amount FROM business_returns r JOIN invoices i ON i.id=r.invoice_id LEFT JOIN credit_notes n ON n.return_id=r.id AND n.id=(SELECT MAX(id) FROM credit_notes WHERE return_id=r.id) WHERE NOT EXISTS(SELECT 1 FROM service_credit_documents WHERE return_id=r.id) AND (?=0 OR r.id<?) ${scope.all?'':'AND r.branch_id=?'} ORDER BY r.id DESC LIMIT 51`).all(before,before,...(scope.all?[]:[scope.branchId]));
   return ok({returns:rows.slice(0,50),next:rows.length>50?rows[49].id:null});
  });response.headers.set('Cache-Control','no-store');return response;
 }catch(error){return fail(error);}
}
export async function POST(req:NextRequest){
 try{const session=requireSession(req),body=await readJson(req),db=getDb(),cookie=req.cookies.get(BRANCH_COOKIE)?.value;
  const permissions:Record<string,string>={request:'invoices.edit',authorize:'invoices.edit',receive:'inventory.manage',inspect:'inventory.manage',dispose:'inventory.manage',release_rejected:'inventory.manage',approve_zero_credit:'finance.manage',propose_credit:'finance.manage',approve_credit:'finance.manage',refund:'payments.refund',reverse_credit:'finance.manage'};
  if(typeof body.action!=='string'||!Object.hasOwn(permissions,body.action))throw new HttpError(400,'عملیات مرجوعی معتبر نیست.');const permission=permissions[body.action];requirePerm(session,permission);
  const source=body.action==='request'?db.prepare('SELECT branch_id FROM invoices WHERE id=?').get(validate.id(body.invoice_id))
   :['approve_credit','reverse_credit'].includes(body.action)?db.prepare('SELECT branch_id FROM credit_notes WHERE id=?').get(validate.id(body.id))
   :db.prepare('SELECT branch_id FROM business_returns WHERE id=?').get(validate.id(body.id));
  if(!source)throw new HttpError(404,'سند مرجع یافت نشد.');ledgerScope(session,Number(source.branch_id),cookie,permission);
  if(body.action!=='request'){
   const service=['approve_credit','reverse_credit'].includes(body.action)?db.prepare('SELECT d.return_id FROM service_credit_documents d JOIN credit_notes n ON n.return_id=d.return_id WHERE n.id=?').get(body.id):db.prepare('SELECT return_id FROM service_credit_documents WHERE return_id=?').get(body.id);
   if(service)throw new HttpError(409,'اصلاح خدمت از بخش «اصلاح مالی خدمات» انجام می‌شود؛ دریافت یا جابه‌جایی فیزیکی برای آن مجاز نیست.');
  }
  return durableJsonResponse(db,{actorId:session.user.id,branchId:Number(source.branch_id),operation:'business_return',scope:'business',key:req.headers.get('idempotency-key'),payload:body},()=>{
   switch(body.action){
    case 'request':return ok(requestReturn(db,session,body,cookie));
    case 'authorize':return ok(authorizeReturn(db,session,validate.id(body.id),body.accept,cookie));
    case 'receive':return ok(receiveReturn(db,session,validate.id(body.id),body.reference,cookie));
    case 'inspect':return ok(inspectReturn(db,session,validate.id(body.id),body,cookie));
    case 'dispose':return ok(disposeReturn(db,session,validate.id(body.id),body,cookie));
    case 'release_rejected':return ok(releaseRejectedReturn(db,session,validate.id(body.id),body.reference,cookie));
    case 'propose_credit':return ok(proposeCreditNote(db,session,validate.id(body.id),body,cookie));
    case 'approve_credit':return ok(approveCreditNote(db,session,validate.id(body.id),cookie));
    case 'approve_zero_credit':return ok(approveZeroReturnCredit(db,session,validate.id(body.id),body.reference,cookie));
    case 'refund':return ok(refundReturn(db,session,validate.id(body.id),body,cookie));
    case 'reverse_credit':return ok(reverseReturnCredit(db,session,validate.id(body.id),body.date,body.reason,cookie));
    default:throw new HttpError(400,'عملیات مرجوعی معتبر نیست.');
   }
  });
 }catch(error){return fail(error);}
}
