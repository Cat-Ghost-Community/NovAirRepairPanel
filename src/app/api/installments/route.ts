import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresCustomerFinanceHttp} from '@/lib/db/pg-customer-finance-http';
import { NextRequest } from 'next/server';
import { requireSession,requirePerm,ok,fail,readJson,HttpError,validate } from '@/lib/api';
import { getDb } from '@/lib/db/schema';
import { activeBranch,BRANCH_COOKIE } from '@/lib/branch';
import { ledgerScope } from '@/lib/accounting';
import { durableJsonResponse } from '@/lib/idempotency';
import { readSnapshot } from '@/lib/db/transaction';
import { proposeInstallmentSchedule,decideInstallmentSchedule,allocateInstallmentReceipt,collectInstallment,reverseInstallmentAllocation,installmentCollected,installmentPosition } from '@/lib/installments';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){
  if(postgresIntegration())return postgresCustomerFinanceHttp(req,'installments');
 try{
  const session=requireSession(req);requirePerm(session,'finance.view');const db=getDb(),cookie=req.cookies.get(BRANCH_COOKIE)?.value,scope=activeBranch(session,cookie),q=req.nextUrl.searchParams;
  const page=Number(q.get('page')??1),search=q.get('q')?.trim()??'';if(!Number.isSafeInteger(page)||page<1||page>100000||search.length>100)throw new HttpError(400,'صفحه یا جست‌وجو معتبر نیست.');
  const response=readSnapshot(db,()=>{
   if(q.get('view')==='invoices'){
    const params={branch:scope.branchId,q:`%${search}%`,offset:(page-1)*50},where="i.type!='purchase' AND i.status NOT IN ('draft','cancelled') AND i.branch_id IS NOT NULL AND (:branch IS NULL OR i.branch_id=:branch) AND i.total-i.paid>0 AND i.number LIKE :q";
    const total=Number(db.prepare(`SELECT COUNT(*) n FROM effective_invoices i WHERE ${where}`).get({branch:params.branch,q:params.q})!.n);
    return ok({invoices:db.prepare(`SELECT i.id,i.number,i.total-i.paid remaining FROM effective_invoices i WHERE ${where} ORDER BY i.id DESC LIMIT 50 OFFSET :offset`).all(params),page,totalPages:Math.max(1,Math.ceil(total/50))});
   }
   if(q.get('view')==='queue'){
    const where="s.status IN ('proposed','approved') AND (:branch IS NULL OR s.branch_id=:branch) AND i.number LIKE :q",params={branch:scope.branchId,q:`%${search}%`};
    const total=Number(db.prepare(`SELECT COUNT(*) n FROM installment_schedules s JOIN invoices i ON i.id=s.invoice_id WHERE ${where}`).get(params)!.n);
    return ok({queue:db.prepare(`SELECT s.id,s.invoice_id,s.version,s.principal,s.status,i.number FROM installment_schedules s JOIN invoices i ON i.id=s.invoice_id WHERE ${where} ORDER BY s.id DESC LIMIT 50 OFFSET :offset`).all({...params,offset:(page-1)*50}),page,totalPages:Math.max(1,Math.ceil(total/50))});
   }
   const invoice=q.has('invoice_id')?validate.id(q.get('invoice_id')):null;
   if(invoice){const inv=db.prepare('SELECT branch_id,type FROM invoices WHERE id=?').get(invoice);if(!inv?.branch_id)throw new HttpError(404,'فاکتور دارای شعبه یافت نشد.');ledgerScope(session,Number(inv.branch_id),cookie,'finance.view');if(inv.type==='purchase')throw new HttpError(400,'این گردش اقساطِ دریافتنی مشتری است؛ پرداختنی تأمین‌کننده گردش جدا دارد.');}
   if(q.get('view')==='receipts'){
    if(!invoice)throw new HttpError(400,'فاکتور را مشخص کنید.');
    const where=`p.invoice_id=:invoice AND p.direction='in' AND p.settled=1 AND p.method!='other' AND p.amount-p.refunded-p.allocated-p.credit_used>0 AND p.number LIKE :q
      AND EXISTS(SELECT 1 FROM installment_schedules s WHERE s.invoice_id=p.invoice_id AND s.status='active' AND NOT EXISTS(SELECT 1 FROM json_each(s.source_json,'$.payments') old WHERE json_extract(old.value,'$.id')=p.id AND json_extract(old.value,'$.settled')=1 AND json_extract(old.value,'$.amount')>json_extract(old.value,'$.refunded')))`;
    const params={invoice,q:`%${search}%`},total=Number(db.prepare(`SELECT COUNT(*) n FROM installment_receipt_funds p WHERE ${where}`).get(params)!.n);
    return ok({receipts:db.prepare(`SELECT p.id,p.number,p.amount-p.refunded-p.allocated-p.credit_used available FROM installment_receipt_funds p WHERE ${where} ORDER BY p.id DESC LIMIT 50 OFFSET :offset`).all({...params,offset:(page-1)*50}),page,totalPages:Math.max(1,Math.ceil(total/50))});
   }
   if(q.get('view')==='history'){
    if(!invoice)throw new HttpError(400,'فاکتور را مشخص کنید.');
    const allocationPage=Number(q.get('allocation_page')??1),legacyPage=Number(q.get('legacy_page')??1);if(![allocationPage,legacyPage].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=100000))throw new HttpError(400,'صفحهٔ سابقه معتبر نیست.');
    const count=Number(db.prepare('SELECT COUNT(*) n FROM installment_schedules WHERE invoice_id=?').get(invoice)!.n),allocations=Number(db.prepare('SELECT COUNT(*) n FROM installment_allocations a JOIN installments i ON i.id=a.installment_id WHERE i.invoice_id=?').get(invoice)!.n),legacyCount=Number(db.prepare('SELECT COUNT(*) n FROM installments WHERE invoice_id=? AND schedule_id IS NULL').get(invoice)!.n);
    const proposals=db.prepare('SELECT s.*,u.name proposed_name,a.name approved_name FROM installment_schedules s JOIN users u ON u.id=s.proposed_by LEFT JOIN users a ON a.id=s.approved_by WHERE s.invoice_id=? ORDER BY s.id DESC LIMIT 10 OFFSET ?').all(invoice,(page-1)*10);
    return ok({actor_id:session.user.id,position:installmentPosition(db,invoice),schedules:proposals,page,totalPages:Math.max(1,Math.ceil(count/10)),allocationPages:Math.max(1,Math.ceil(allocations/50)),legacyPages:Math.max(1,Math.ceil(legacyCount/100)),legacy:db.prepare('SELECT id,seq,amount,paid_amount,due_date,status FROM installments WHERE invoice_id=? AND schedule_id IS NULL ORDER BY id LIMIT 100 OFFSET ?').all(invoice,(legacyPage-1)*100),
     terms:db.prepare('SELECT t.* FROM installment_schedule_terms t WHERE t.schedule_id IN (SELECT id FROM installment_schedules WHERE invoice_id=? ORDER BY id DESC LIMIT 10 OFFSET ?) ORDER BY t.schedule_id,t.seq').all(invoice,(page-1)*10),
     allocations:db.prepare(`SELECT a.*,p.number payment_number FROM installment_allocation_balances a JOIN payments p ON p.id=a.payment_id JOIN installments i ON i.id=a.installment_id WHERE i.invoice_id=? ORDER BY a.id DESC LIMIT 50 OFFSET ?`).all(invoice,(allocationPage-1)*50)});
   }
   const status=q.get('status')??'all';if(!['all','pending','partially_paid','paid','overdue','legacy_review'].includes(status))throw new HttpError(400,'وضعیت معتبر نیست.');
   const where="(:branch IS NULL OR i.branch_id=:branch) AND (:invoice IS NULL OR i.invoice_id=:invoice) AND (:status='all' OR i.status=:status)",params={branch:scope.branchId,invoice,status};
   const total=Number(db.prepare(`SELECT COUNT(*) n FROM effective_installments i WHERE ${where}`).get(params)!.n);
   return ok({installments:db.prepare(`SELECT i.*,c.first_name||' '||COALESCE(c.last_name,'') customer_name,v.number invoice_number FROM effective_installments i LEFT JOIN customers c ON c.id=i.customer_id LEFT JOIN invoices v ON v.id=i.invoice_id WHERE ${where} ORDER BY i.due_date,i.id LIMIT 100 OFFSET :offset`).all({...params,offset:(page-1)*100}),page,totalPages:Math.max(1,Math.ceil(total/100)),total,
    totals:{...db.prepare(`SELECT COALESCE(SUM(CASE WHEN legacy_review=0 THEN amount-paid_amount ELSE 0 END),0) remaining,COALESCE(SUM(CASE WHEN legacy_review=0 THEN paid_amount ELSE 0 END),0) allocated_current,COALESCE(SUM(legacy_review),0) legacy_review FROM effective_installments i WHERE (:branch IS NULL OR i.branch_id=:branch) AND (:invoice IS NULL OR i.invoice_id=:invoice)`).get({branch:scope.branchId,invoice}),collected:installmentCollected(db,scope.branchId,invoice)}});
  });response.headers.set('Cache-Control','no-store');return response;
 }catch(error){return fail(error);}
}
export async function POST(req:NextRequest){
  if(postgresIntegration())return postgresCustomerFinanceHttp(req,'installments');
 try{
  const session=requireSession(req);requirePerm(session,'finance.manage');const b=await readJson(req),db=getDb(),cookie=req.cookies.get(BRANCH_COOKIE)?.value;
  if(!['generate','propose','decide','pay','allocate','reverse_allocation'].includes(b.action))throw new HttpError(409,'نوشتن مستقیم اقساط قدیمی مسدود است؛ پیشنهاد برنامه یا تخصیص رسید معتبر لازم است.');
  const source=['generate','propose'].includes(b.action)?db.prepare('SELECT branch_id FROM invoices WHERE id=?').get(validate.id(b.invoice_id))
   :b.action==='decide'?db.prepare('SELECT branch_id FROM installment_schedules WHERE id=?').get(validate.id(b.id))
   :b.action==='reverse_allocation'?db.prepare('SELECT branch_id FROM installment_allocations WHERE id=?').get(validate.id(b.id))
   :db.prepare('SELECT COALESCE(s.branch_id,i.branch_id) branch_id FROM installments x LEFT JOIN installment_schedules s ON s.id=x.schedule_id LEFT JOIN invoices i ON i.id=x.invoice_id WHERE x.id=?').get(validate.id(b.id));
  if(!source?.branch_id)throw new HttpError(404,'سند دارای انتساب معتبر یافت نشد.');ledgerScope(session,Number(source.branch_id),cookie,'finance.manage');
  if(b.action==='pay')requirePerm(session,'payments.create');
  return durableJsonResponse(db,{actorId:session.user.id,branchId:Number(source.branch_id),operation:'installments',scope:'business',key:req.headers.get('idempotency-key'),payload:b},()=>{
   switch(b.action){
    case 'generate':case 'propose':return ok(proposeInstallmentSchedule(db,session,b,cookie));
    case 'decide':return ok(decideInstallmentSchedule(db,session,validate.id(b.id),b.decision,b.reason,cookie));
    case 'pay':return ok(collectInstallment(db,session,b,cookie));
    case 'allocate':return ok(allocateInstallmentReceipt(db,session,b,cookie));
    default:return ok(reverseInstallmentAllocation(db,session,b,cookie));
   }
  });
 }catch(error){return fail(error);}
}
