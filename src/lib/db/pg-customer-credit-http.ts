import type {NextRequest} from 'next/server';
import {HttpError} from '../http-error';
import {readRequestJson} from '../request-json';
import {postgresFinancialRequest} from './pg-financial-http';
import {postgresFailure} from './pg-http';
import {pgDay,pgId,pgRecord,pgText,scopeFor} from './pg-customer-finance';
import {postgresRelation} from './postgres-auth';
import {postgresDurableOperation} from './postgres-operations';
import {safePostgresInteger} from './postgres';
import {
 decidePostgresCustomerCredit,listPostgresCustomerCredit,postPostgresCustomerCredit,
 proposePostgresCustomerCredit,refundPostgresCustomerCredit,
} from './postgres-customer-credit';

const reply=(value:unknown)=>Response.json(value,{headers:{'Cache-Control':'no-store'}});
const numeric=new Set(['id','reverses_id','payment_id','invoice_id','installment_id','amount','remaining','proposed_by','approved_by','journal_id','seq','paid_amount','total','paid','outstanding']);
function requiredText(value:unknown){const text=pgText(value,1000,true);if(!text)throw new HttpError(400,'مرجع مستند لازم است.');return text;}
function publicRows(rows:Record<string,unknown>[]){
 return rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,numeric.has(key)&&value!=null?safePostgresInteger(value as string|number|bigint):value])));
}

/** Existing customer-credit transport; all mutations use the native guarded
 * domain. The outer operation preserves legacy full-payload replay identities. */
export async function postgresCustomerCreditHttp(req:NextRequest){
 try{
  const mutation=req.method==='POST',permission=mutation?'finance.manage':'finance.view';
  const {database:db,schema,token,branchId,scope}=await postgresFinancialRequest(req,permission);
  const table=(name:string)=>postgresRelation(schema,name),query=req.nextUrl.searchParams;
  if(mutation){
   const body=pgRecord(await readRequestJson(req)),action=String(body.action??'');
   if(!['propose','approve','reject','post','refund'].includes(action))throw new HttpError(400,'عملیات اعتبار معتبر نیست.');
   const paymentAction=action==='propose'||action==='refund';
   const id=pgId(paymentAction?body.payment_id:body.id);
   const target=await scopeFor(db,schema,token,permission,branchId,{table:paymentAction?'payments':'customer_credit_operations',id});
   const key=req.headers.get('idempotency-key');
   const result=await postgresDurableOperation(db,schema,token,{
    permission,branchId:target,operation:'customer_credit',key,payload:body,legacyJsonResponse:true,
   },async()=>{
    if(action==='propose')return proposePostgresCustomerCredit(db,schema,token,key,{
     payment_id:id,invoice_id:pgId(body.invoice_id),amount:body.amount,
     installment_id:body.installment_id==null?null:pgId(body.installment_id),
     reverses_id:body.reverses_id==null?null:pgId(body.reverses_id),
     posting_date:pgDay(body.posting_date),reason:requiredText(body.reason),
     evidence_reference:requiredText(body.evidence_reference),
    },target);
    if(action==='approve'||action==='reject')return decidePostgresCustomerCredit(db,schema,token,key,id,action==='approve',target);
    if(action==='post')return postPostgresCustomerCredit(db,schema,token,key,id,target);
    return refundPostgresCustomerCredit(db,schema,token,key,{
     payment_id:id,amount:body.amount,reason:requiredText(body.reason),
     document_reference:requiredText(body.document_reference),confirmed:body.confirmed===true,
     ...(body.return_id==null?{}:{return_id:pgId(body.return_id)}),
    },target);
   });
   return reply(result);
  }
  if(branchId==null)throw new HttpError(400,'برای مدیریت اعتبار، شعبهٔ مشخص را انتخاب کنید.');
  const customer=pgId(query.get('customer_id')),page=Number(query.get('page')??1),search=(query.get('q')??'').trim();
  if(!Number.isSafeInteger(page)||page<1||page>100000||search.length>100)throw new HttpError(400,'جست‌وجو یا صفحه معتبر نیست.');
  return await db.transaction(async()=>{
   const exists=await db.query(`SELECT id FROM ${table('payments')} WHERE customer_id=$1 AND branch_id=$2 UNION ALL SELECT id FROM ${table('invoices')} WHERE customer_id=$1 AND branch_id=$2 LIMIT 1`,[customer,branchId]);
   if(!exists.rowCount)throw new HttpError(404,'سابقهٔ مالی مشتری در این شعبه یافت نشد.');
   const view=query.get('view'),offset=(page-1)*20;
   if(view==='invoices'){
    const rows=(await db.query(`SELECT id,number,total,paid,GREATEST(0,total-paid) outstanding FROM ${table('effective_invoices')} WHERE customer_id=$1 AND branch_id=$2 AND type!='purchase' AND status NOT IN ('draft','cancelled') AND total>paid AND number ILIKE '%'||$3||'%' ORDER BY id DESC LIMIT 21 OFFSET $4`,[customer,branchId,search,offset])).rows;
    return reply({invoices:publicRows(rows.slice(0,20)),hasMore:rows.length>20,page});
   }
   if(view==='installments'){
    const invoice=pgId(query.get('invoice_id'));
    if(!(await db.query(`SELECT id FROM ${table('invoices')} WHERE id=$1 AND customer_id=$2 AND branch_id=$3`,[invoice,customer,branchId])).rowCount)throw new HttpError(404,'فاکتور یافت نشد.');
    const rows=(await db.query(`SELECT id,seq,amount,paid_amount,due_date FROM ${table('effective_installments')} WHERE invoice_id=$1 AND branch_id=$2 AND legacy_review=0 AND amount>paid_amount ORDER BY seq,id LIMIT 21 OFFSET $3`,[invoice,branchId,offset])).rows;
    const active=!!(await db.query(`SELECT id FROM ${table('installment_schedules')} WHERE invoice_id=$1 AND status='active'`,[invoice])).rowCount;
    return reply({installments:publicRows(rows.slice(0,20)),active,hasMore:rows.length>20,page});
   }
   if(view==='operations'){
    const rows=(await db.query(`SELECT o.id,o.kind,o.reverses_id,o.payment_id,o.invoice_id,o.installment_id,o.amount,o.reason,o.evidence_reference,o.state,o.proposed_by,o.approved_by,o.posting_date,o.journal_id,p.number payment_number,i.number invoice_number,COALESCE(a.remaining,0) remaining FROM ${table('customer_credit_operations')} o JOIN ${table('payments')} p ON p.id=o.payment_id JOIN ${table('invoices')} i ON i.id=o.invoice_id LEFT JOIN ${table('active_customer_credit')} a ON a.id=o.id WHERE o.customer_id=$1 AND o.branch_id=$2 ORDER BY o.id DESC LIMIT 21 OFFSET $3`,[customer,branchId,offset])).rows;
    return reply({operations:publicRows(rows.slice(0,20)),hasMore:rows.length>20,page,actor_id:scope.session.user.id});
   }
   return reply(await listPostgresCustomerCredit(db,schema,token,customer,branchId,page));
  },{isolation:'repeatable read'});
 }catch(error){return postgresFailure(error);}
}
