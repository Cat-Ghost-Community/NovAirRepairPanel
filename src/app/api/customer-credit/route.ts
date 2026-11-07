import {NextRequest} from 'next/server';
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresCustomerCreditHttp} from '@/lib/db/pg-customer-credit-http';
import {getDb} from '@/lib/db/schema';
import {requireSession,requirePerm,readJson,ok,fail,HttpError,validate} from '@/lib/api';
import {activeBranch,BRANCH_COOKIE} from '@/lib/branch';
import {ledgerScope} from '@/lib/accounting';
import {readSnapshot} from '@/lib/db/transaction';
import {durableJsonResponse} from '@/lib/idempotency';
import {customerCreditList,proposeCustomerCredit,decideCustomerCredit,postCustomerCredit,refundCustomerCredit} from '@/lib/customer-credit';
export const dynamic='force-dynamic';

export async function GET(req:NextRequest){try{
 if(postgresIntegration())return postgresCustomerCreditHttp(req);
 const session=requireSession(req);requirePerm(session,'finance.view');const db=getDb(),q=req.nextUrl.searchParams,cookie=req.cookies.get(BRANCH_COOKIE)?.value;
 const scope=activeBranch(session,cookie),branch=q.has('branch_id')?validate.id(q.get('branch_id')):scope.branchId;if(branch==null)throw new HttpError(400,'برای مدیریت اعتبار، شعبهٔ مشخص را انتخاب کنید.');ledgerScope(session,branch,cookie,'finance.view');
 const customer=validate.id(q.get('customer_id')),page=Number(q.get('page')??1),search=(q.get('q')??'').trim();if(!Number.isSafeInteger(page)||page<1||page>100000||search.length>100)throw new HttpError(400,'جست‌وجو یا صفحه معتبر نیست.');
 const response=readSnapshot(db,()=>{
  if(!db.prepare('SELECT id FROM payments WHERE customer_id=? AND branch_id=? UNION ALL SELECT id FROM invoices WHERE customer_id=? AND branch_id=? LIMIT 1').get(customer,branch,customer,branch))throw new HttpError(404,'سابقهٔ مالی مشتری در این شعبه یافت نشد.');
  if(q.get('view')==='invoices'){
   const rows=db.prepare("SELECT id,number,total,paid,MAX(0,total-paid) outstanding FROM effective_invoices WHERE customer_id=? AND branch_id=? AND type!='purchase' AND status NOT IN ('draft','cancelled') AND total>paid AND number LIKE ? ORDER BY id DESC LIMIT 21 OFFSET ?").all(customer,branch,`%${search}%`,(page-1)*20);
   return ok({invoices:rows.slice(0,20),hasMore:rows.length>20,page});
  }
  if(q.get('view')==='installments'){
   const invoice=validate.id(q.get('invoice_id'));if(!db.prepare('SELECT id FROM invoices WHERE id=? AND customer_id=? AND branch_id=?').get(invoice,customer,branch))throw new HttpError(404,'فاکتور یافت نشد.');
   const rows=db.prepare('SELECT id,seq,amount,paid_amount,due_date FROM effective_installments WHERE invoice_id=? AND branch_id=? AND legacy_review=0 AND amount>paid_amount ORDER BY seq,id LIMIT 21 OFFSET ?').all(invoice,branch,(page-1)*20);
   const active=!!db.prepare("SELECT id FROM installment_schedules WHERE invoice_id=? AND status='active'").get(invoice);
   return ok({installments:rows.slice(0,20),active,hasMore:rows.length>20,page});
  }
  if(q.get('view')==='operations'){
   const rows=db.prepare(`SELECT o.id,o.kind,o.reverses_id,o.payment_id,o.invoice_id,o.installment_id,o.amount,o.reason,o.evidence_reference,o.state,o.proposed_by,o.approved_by,o.posting_date,o.journal_id,
    p.number payment_number,i.number invoice_number,COALESCE(a.remaining,0) remaining FROM customer_credit_operations o JOIN payments p ON p.id=o.payment_id JOIN invoices i ON i.id=o.invoice_id LEFT JOIN active_customer_credit a ON a.id=o.id WHERE o.customer_id=? AND o.branch_id=? ORDER BY o.id DESC LIMIT 21 OFFSET ?`).all(customer,branch,(page-1)*20);
   return ok({operations:rows.slice(0,20),hasMore:rows.length>20,page,actor_id:session.user.id});
  }
  return ok(customerCreditList(db,session,customer,branch,page));
 });response.headers.set('Cache-Control','no-store');return response;
}catch(e){return fail(e);}}

export async function POST(req:NextRequest){try{
 if(postgresIntegration())return postgresCustomerCreditHttp(req);
 const session=requireSession(req);requirePerm(session,'finance.manage');const body=await readJson(req),db=getDb(),cookie=req.cookies.get(BRANCH_COOKIE)?.value;
 const id=body.action==='propose'||body.action==='refund'?validate.id(body.payment_id):validate.id(body.id);
 const target=body.action==='propose'||body.action==='refund'?db.prepare('SELECT branch_id FROM payments WHERE id=?').get(id):db.prepare('SELECT branch_id FROM customer_credit_operations WHERE id=?').get(id);
 if(!target)throw new HttpError(404,'سند اعتبار یافت نشد.');ledgerScope(session,Number(target.branch_id),cookie,'finance.manage');
 return durableJsonResponse(db,{actorId:session.user.id,branchId:Number(target.branch_id),operation:'customer_credit',key:req.headers.get('idempotency-key'),payload:body},()=>{
  if(body.action==='propose')return ok(proposeCustomerCredit(db,session,body,cookie));
  if(body.action==='approve'||body.action==='reject')return ok(decideCustomerCredit(db,session,id,body.action==='approve',cookie));
  if(body.action==='post')return ok(postCustomerCredit(db,session,id,cookie));
  if(body.action==='refund')return ok(refundCustomerCredit(db,session,body,cookie));
  throw new HttpError(400,'عملیات اعتبار معتبر نیست.');
 });
}catch(e){return fail(e);}}
