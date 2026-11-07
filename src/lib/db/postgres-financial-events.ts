import {createHash} from 'node:crypto';
import type {FinancialDocument} from '../accounting-events';
import type {JournalLine} from '../journal-input';
import {rial,multiplyRial,sumRial} from '../money';
import {HttpError} from '../http-error';
import {validateId} from '../validate-id';
import {recognitionTemplates,type RecognitionKind} from '../recognition-templates';
import {POSTGRES_BASELINE} from './pg-production-schema';
import {safePostgresInteger,type PostgresDatabase} from './postgres';
import {authorizePostgresScope,postgresRelation,type Scope} from './postgres-auth';
import {postgresCreateScopedJournal,postgresPostScopedJournal} from './postgres-journals';
import {actualRepairIssueCost} from './pg-repair-cost';
const sources: Record<FinancialDocument,{table:string;fields:string}> = {
  commission_correction:{table:'commission_corrections',fields:'id,run_id,branch_id,user_id,kind,reverses_id,amount,expense_account,liability_amount,recovery_amount,posting_date,reason,evidence_reference,basis_hash,snapshot_hash,approved_by,state'},
  customer_credit:{table:'customer_credit_operations',fields:'id,kind,reverses_id,payment_id,invoice_id,source_invoice_id,installment_id,branch_id,customer_id,amount,source_account,posting_date,reason,evidence_reference,snapshot_hash,approved_by,state'},
  credit_note:{table:'credit_notes',fields:'id,return_id,invoice_id,branch_id,customer_id,supplier_id,amount,net_amount,tax_amount,status'},
  return_cost:{table:'business_return_lines',fields:'id,return_id,part_id,qty_micro,unit_cost,disposition,(SELECT branch_id FROM business_returns WHERE id=return_id) branch_id'},
  invoice:{table:"invoices",fields:"id,type,customer_id,supplier_id,branch_id,ticket_id,sale_id,purchase_order_id,status,subtotal,discount,tax,total"},
  payment:{table:"payments",fields:"id,invoice_id,sale_id,ticket_id,customer_id,supplier_id,branch_id,amount,method,direction"},
  refund:{table:"refunds",fields:"id,payment_id,invoice_id,sale_id,customer_id,branch_id,amount,method"},
  sale:{table:"sales",fields:"id,customer_id,branch_id,subtotal,discount,tax,total,status"},
  expense:{table:"expenses",fields:"id,branch_id,category,amount,date,method"},
  stock:{table:"inventory_movements",fields:"id,part_id,location_id,qty,type,unit_cost,ref_type,ref_id,branch_id"},
  cheque:{table:"checks",fields:"id,kind,amount,status,invoice_id,payment_id,bank_account_id,customer_id,supplier_id,branch_id,settled_at"},
  commission:{table:"payroll_runs",fields:"id,user_id,source_ticket_id,branch_id,earned_commission,net_payable,status"},
  bank:{table:"bank_transactions",fields:"id,account_id,type,amount,to_account_id,date,check_id"},
  commission_payment:{table:"commission_payments",fields:"id,run_id,branch_id,user_id,amount,method,payment_date"},
  repair:{table:'repair_tickets',fields:'id,number,customer_id,branch_id,status_id,completed_at,cancel_reason'},
};
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const integerColumns=new Map(POSTGRES_BASELINE.tables.map(t=>[t.name,new Set(t.columns.filter(c=>c.type==='bigint').map(c=>c.name))]));
function canonicalRow(table:string,row:Record<string,unknown>){
 const result:Record<string,unknown>={...row};for(const [name,value] of Object.entries(result))if(value!=null&&(integerColumns.get(table)?.has(name)||name==='branch_id'))result[name]=safePostgresInteger(value as string|number|bigint);
 return result;
}
export async function postgresRecognizedSource(db:PostgresDatabase,schema:string,type:'invoice'|'commission',id:number,branch:number){
 const q=(name:string)=>postgresRelation(schema,name);
 if(type==='invoice'){
  const invoice=(await db.query(`SELECT id,total,sale_id FROM ${q('invoices')} WHERE id=$1 AND branch_id=$2 AND status NOT IN ('draft','cancelled')`,[id,branch])).rows[0];
  if(invoice&&safePostgresInteger(invoice.total)===0)return true;
  if(invoice?.sale_id&&(await db.query(`SELECT e.id FROM ${q('accounting_events')} e JOIN ${q('accounting_event_reviews')} r ON r.event_id=e.id JOIN ${q('accounting_journals')} j ON j.id=r.journal_id WHERE e.source_type='sale' AND e.source_id=$1 AND e.branch_id=$2 AND j.state='posted' LIMIT 1`,[String(invoice.sale_id),branch])).rowCount)return true;
 }
 if((await db.query(`SELECT e.id FROM ${q('accounting_events')} e LEFT JOIN ${q('accounting_event_reviews')} r ON r.event_id=e.id LEFT JOIN ${q('accounting_journals')} j ON j.id=r.journal_id LEFT JOIN ${q('accounting_opening_event_links')} o ON o.event_id=e.id WHERE e.source_type=$1 AND e.source_id=$2 AND e.branch_id=$3 AND e.event_type=$4 AND (j.state='posted' OR o.event_id IS NOT NULL) LIMIT 1`,[type,String(id),branch,type==='invoice'?'confirm':'accrual'])).rowCount)return true;
 const cutover=(await db.query(`SELECT watermarks_json FROM ${q('accounting_cutover')} WHERE id=1`)).rows[0];
 return !!cutover&&id<=Number(JSON.parse(String(cutover.watermarks_json))[type]??0)&&!!(await db.query(`SELECT id FROM ${q('accounting_opening_documents')} WHERE branch_id=$1 AND status='posted'`,[branch])).rowCount;
}

/** Must be part of the authoritative source transaction. Native NUMERIC quantity
 * text remains decimal text in fresh PG snapshots; no float money arithmetic. */
export async function capturePostgresFinancialDocument(db:PostgresDatabase,schema:string,type:FinancialDocument,id:number,action:string,actorId?:number|null,explicitBranch?:number,controlAmount?:number){
 if(!db.isTransaction())throw Error('Financial event capture requires the source transaction');
 id=validateId(id);if(!Object.hasOwn(sources,type)||typeof action!=='string'||!/^[a-z][a-z_0-9]{0,79}$/.test(action))throw new HttpError(400,'نوع یا عمل منبع مالی معتبر نیست.');
 const q=(name:string)=>postgresRelation(schema,name),source=sources[type],fields=source.fields.replace(/FROM business_returns/g,'FROM '+q('business_returns'));
 const raw=(await db.query(`SELECT ${fields} FROM ${q(source.table)} WHERE id=$1`,[id])).rows[0];if(!raw)throw new HttpError(409,'مرجع واقعی سند مالی یافت نشد.');
 const document=canonicalRow(source.table,raw),branch=validateId(explicitBranch??document.branch_id);
 if(document.branch_id!=null&&document.branch_id!==branch)throw new HttpError(409,'انتساب شعبهٔ منبع مالی تطبیق ندارد.');
 let control=type==='invoice'||type==='sale'?rial(document.total):type==='stock'?multiplyRial(rial(document.unit_cost??0),String(document.qty).replace(/^-/,'')):type==='return_cost'?0:type==='commission'?rial(document.net_payable):type==='repair'?0:rial(document.amount);
 if(type==='return_cost')control=controlAmount??0; // Exact source cost below is mandatory for fractional returns.
 if(type==='payment'&&['check','cheque'].includes(String(document.method)))control=0;
 if(type==='cheque'&&document.status!=='passed')control=0;
 if(type==='invoice'&&document.sale_id!=null)control=0;
 if(controlAmount!=null)control=rial(controlAmount);
 if(type==='stock'||type==='return_cost'){
  const value=(await db.query(`SELECT ${type==='stock'?'extended_cost,valuation_json':'cost_amount,valuation_json'} FROM ${q(source.table)} WHERE id=$1`,[id])).rows[0];
  const amount=value[type==='stock'?'extended_cost':'cost_amount'];if(amount!=null){document.extended_cost=control=rial(safePostgresInteger(amount));}
  else if(type==='return_cost'&&controlAmount==null)throw new HttpError(409,'بهای دقیق برگشت برای ثبت رویداد موجود نیست.');
  if(value.valuation_json)document[type==='stock'?'carrying_valuation':'return_valuation']=JSON.parse(String(value.valuation_json));
 }
 let repairCost:Awaited<ReturnType<typeof actualRepairIssueCost>>|null=null;
 if(type==='invoice'&&action==='repair_cost_recognition'){
  if(document.type!=='repair'||document.ticket_id==null||['draft','cancelled'].includes(String(document.status)))throw new HttpError(409,'ثبت بهای تعمیر نیازمند صورتحساب قطعی و پذیرش اصلی است.');
  repairCost=await actualRepairIssueCost(db,schema,safePostgresInteger(document.ticket_id as string|number|bigint),branch);
  if(repairCost.snapshot.ticket.customer_id!==document.customer_id)throw new HttpError(409,'مالکیت صورتحساب و مدرک بهای تعمیر تطبیق ندارد.');
  if(controlAmount!=null&&rial(controlAmount)!==repairCost.amount)throw new HttpError(409,'مبلغ بهای تعمیر با خروج واقعی و مستند قطعات تطبیق ندارد.');
  control=repairCost.amount;
 }
 const lineTable=type==='invoice'?'invoice_items':type==='sale'?'sale_items':null;
 const lines=lineTable?(await db.query(`SELECT kind,ref_id,qty,unit_price,cost,total${type==='invoice'?',line_discount':''} FROM ${q(lineTable)} WHERE ${type==='invoice'?'invoice_id':'sale_id'}=$1 ORDER BY ${type==='invoice'?'sort,':''}id LIMIT 1001`,[id])).rows.map(row=>canonicalRow(lineTable,row)):[];
 if(lines.length>1000)throw new HttpError(409,'سند بزرگ به بررسی دسته‌ای منبع نیاز دارد.');
 const bankEvidence=type==='cheque'?(await db.query(`SELECT id,account_id,type,amount,check_id FROM ${q('bank_transactions')} WHERE check_id=$1 ORDER BY id LIMIT 1001`,[id])).rows.map(row=>canonicalRow('bank_transactions',row)):[];
 const payload={document,lines,bank_evidence:bankEvidence,repair_cost_lines:repairCost?.snapshot.items??[],...(repairCost?{repair_issue_cost:repairCost.snapshot,repair_issue_cost_hash:repairCost.source_hash,repair_cost_provenance:repairCost.requires_accounting_review?'legacy_issue_evidence_requires_review':'recorded_carrying_issue_evidence'}:{}),control_amount:control,currency:'IRR',policy:'review_required',branch_basis:type==='bank'?'actor_branch_requires_accounting_review':'source_document',quantity_format:'decimal_text_v1'},json=JSON.stringify(payload),hash=digest(json),key=`${type}:${id}:${action}`;
 const previous=(await db.query(`SELECT id,payload_hash FROM ${q('accounting_events')} WHERE event_key=$1`,[key])).rows[0];
 if(previous){if(previous.payload_hash!==hash)throw new HttpError(409,'رویداد این مرجع با محتوای دیگری ثبت شده است.');return safePostgresInteger(previous.id);}
 const inserted=await db.query(`INSERT INTO ${q('accounting_events')}(event_key,source_type,source_id,branch_id,event_type,payload_json,payload_hash,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[key,type,String(id),branch,action,json,hash,actorId??null]),eventId=safePostgresInteger(inserted.rows[0].id);
 await postPostgresAutomaticFinancialEvent(db,schema,eventId);return eventId;
}

async function actorScope(db:PostgresDatabase,schema:string,id:number,branch:number):Promise<Scope>{
 const raw=(await db.query(`SELECT id,name,email,role,branch_id,avatar_color FROM ${postgresRelation(schema,'users')} WHERE id=$1 AND is_active=1`,[id])).rows[0];
 if(!raw||(!['owner','admin'].includes(String(raw.role))&&safePostgresInteger(raw.branch_id)!==branch))throw new HttpError(409,'عامل فعلی منبع برای ثبت مالی معتبر نیست.');
 return {branchId:branch,session:{user:{id:safePostgresInteger(raw.id),name:String(raw.name),email:String(raw.email),role:String(raw.role),branch_id:raw.branch_id==null?null:safePostgresInteger(raw.branch_id),avatar_color:String(raw.avatar_color??'#0ea5e9')}}};
}
export async function postPostgresAutomaticFinancialEvent(db:PostgresDatabase,schema:string,eventId:number){
 if(!db.isTransaction())throw Error('Automatic accounting requires its source transaction');
 const q=(name:string)=>postgresRelation(schema,name),event=(await db.query(`SELECT * FROM ${q('accounting_events')} WHERE id=$1`,[validateId(eventId)])).rows[0];
 if(!event||event.actor_id==null)return {posted:false,reason:'no_active_source_actor'};
 const existing=(await db.query(`SELECT r.journal_id,j.state FROM ${q('accounting_event_reviews')} r JOIN ${q('accounting_journals')} j ON j.id=r.journal_id WHERE r.event_id=$1`,[eventId])).rows[0];if(existing)return {posted:['posted','reversed'].includes(String(existing.state)),journal_id:safePostgresInteger(existing.journal_id),duplicate:true};
 if(digest(String(event.payload_json))!==event.payload_hash)throw new HttpError(409,'اثر انگشت رویداد مالی معتبر نیست.');
 const payload=JSON.parse(String(event.payload_json)),d=payload.document as Record<string,unknown>,amount=rial(payload.control_amount),branch=safePostgresInteger(event.branch_id),date=String(event.created_at).slice(0,10);
 if(!amount)return {posted:false,reason:'no_independent_amount'};
 const sourceDate=event.source_type==='invoice'?(await db.query(`SELECT date FROM ${q('invoices')} WHERE id=$1`,[d.id])).rows[0]?.date:d.date??d.payment_date;
 if(sourceDate!=null&&String(sourceDate).slice(0,10)!==date)return {posted:false,reason:'late_or_backdated_review'};
 let kind:RecognitionKind|undefined;
 if(event.source_type==='invoice'&&event.event_type==='confirm'&&d.type!=='purchase'&&!d.sale_id&&d.customer_id&&d.tax===0&&!['draft','cancelled'].includes(String(d.status))&&payload.lines.length&&payload.lines.every((l:{kind:string})=>l.kind==='labor'))kind='service_invoice_v1';
 if(event.source_type==='payment'&&event.event_type==='receipt'&&d.method==='cash'){
  if(d.direction==='in'&&d.customer_id&&!d.invoice_id&&!d.sale_id)kind='cash_advance_v1';
  if(d.invoice_id&&!d.sale_id){const invoice=(await db.query(`SELECT type,status,customer_id,supplier_id FROM ${q('invoices')} WHERE id=$1 AND branch_id=$2`,[d.invoice_id,branch])).rows[0];
   if(invoice&&!['draft','cancelled'].includes(String(invoice.status))&&await postgresRecognizedSource(db,schema,'invoice',Number(d.invoice_id),branch)){
    if(d.direction==='in'&&invoice.type!=='purchase'&&Number(invoice.customer_id)===d.customer_id)kind='cash_receivable_v1';
    if(d.direction==='out'&&invoice.type==='purchase'&&Number(invoice.supplier_id)===d.supplier_id)kind='cash_payable_v1';
   }
  }
 }
 if(event.source_type==='commission_payment'&&d.method==='cash'&&await postgresRecognizedSource(db,schema,'commission',Number(d.run_id),branch))kind='commission_cash_v1';
 if(!kind)return {posted:false,reason:'source_policy_needs_review'};
 const policy=(await db.query(`SELECT * FROM ${q('accounting_recognition_policies')} WHERE branch_id=$1 AND kind=$2 AND status='approved' AND min_event_id<$3 AND effective_date<=$4`,[branch,kind,eventId,date])).rows[0];if(!policy)return {posted:false,reason:'no_approved_prospective_policy'};
 const template=recognitionTemplates[kind],scope=await actorScope(db,schema,safePostgresInteger(event.actor_id),branch);
 const line=(account:string,debit:number,credit:number):JournalLine=>({account_code:account,debit,credit,customer_id:['1100','2010'].includes(account)?Number(d.customer_id)||null:null,supplier_id:['2000','1310'].includes(account)?Number(d.supplier_id)||null:null,employee_id:account==='2030'?Number(d.user_id)||null:null});
 const draft=await postgresCreateScopedJournal(db,schema,scope,{branch_id:branch,posting_date:date,source_type:'financial_event',source_id:String(eventId),event_key:`financial-event:${eventId}`,memo:`ثبت خودکار طبق سیاست مصوب ${policy.id}: ${template.name}`,lines:[line(template.debit,amount,0),line(template.credit,0,amount)]});
 await db.query(`INSERT INTO ${q('accounting_event_reviews')}(event_id,journal_id,reason,approved_by) VALUES($1,$2,$3,$4)`,[eventId,draft.id,`اجرای خودکار سیاست مصوب ${policy.id}`,policy.approved_by]);
 await postgresPostScopedJournal(db,schema,scope,draft.id,draft.request_hash,eventId);
 await db.query(`INSERT INTO ${q('accounting_automatic_postings')}(event_id,policy_id,journal_id,executed_by) VALUES($1,$2,$3,$4)`,[eventId,policy.id,draft.id,event.actor_id]);
 await db.query(`INSERT INTO ${q('audit_logs')}(user_id,action,entity,entity_id,branch_id,"after") VALUES($1,'automatic_post','accounting_event',$2,$3,$4)`,[event.actor_id,eventId,branch,JSON.stringify({policy_id:safePostgresInteger(policy.id),journal_id:draft.id,policy_approved_by:safePostgresInteger(policy.approved_by)})]);
 return {posted:true,journal_id:draft.id,duplicate:false};
}

export async function reviewPostgresFinancialEvent(db:PostgresDatabase,schema:string,token:string,eventId:number,input:{posting_date:string;reason:string;lines:JournalLine[]}){
 return db.transaction(async()=>{
  const q=(name:string)=>postgresRelation(schema,name),event=(await db.query(`SELECT * FROM ${q('accounting_events')} WHERE id=$1`,[validateId(eventId)])).rows[0];if(!event)throw new HttpError(404,'رویداد مالی یافت نشد.');
  const scope=await authorizePostgresScope(db,schema,token,'finance.manage',safePostgresInteger(event.branch_id),true);
  if(['customer_credit','commission_correction'].includes(String(event.source_type)))throw new HttpError(409,'این منبع فقط از مسیر تأیید و اجرای همان سند قابل ثبت است.');
  if(typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>500)throw new HttpError(400,'دلیل و مبنای مستند بررسی را وارد کنید.');
  if((await db.query(`SELECT event_id FROM ${q('accounting_opening_event_links')} WHERE event_id=$1`,[eventId])).rowCount)throw new HttpError(409,'این منبع در افتتاحیهٔ مصوب لحاظ شده است.');
  if(digest(String(event.payload_json))!==event.payload_hash)throw new HttpError(409,'اثر انگشت رویداد معتبر نیست.');
  const payload=JSON.parse(String(event.payload_json)),control=rial(payload.control_amount),d=payload.document;
  if(!control||event.source_type==='repair'||payload.repair_carrying_cost_lines)throw new HttpError(409,'این منبع به مسیر مصوب و تطبیق مستقل WIP نیاز دارد.');
  if(event.source_type==='bank'&&['transfer_in','transfer_out'].includes(String(d.type)))throw new HttpError(409,'انتقال بانک باید از مسیر پیوند دوطرفهٔ مصوب ثبت شود.');
  if(event.source_type==='bank'&&d.check_id!=null)throw new HttpError(409,'این گردش بانک متعلق به چک است؛ شناسایی فقط از رویداد تسویهٔ همان چک مجاز است.');
  if(['credit_note','return_cost'].includes(String(event.source_type))||(event.source_type==='stock'&&d.ref_type==='business_return'))throw new HttpError(409,'مرجع مرجوعی فقط از گردش کنترل‌شدهٔ مرجوعی قابل ثبت است.');
  if(!Array.isArray(input.lines)||sumRial(input.lines.map(l=>l.debit??0))!==control||sumRial(input.lines.map(l=>l.credit??0))!==control)throw new HttpError(400,'جمع سطرها باید دقیقاً با مبلغ مرجع تطبیق داشته باشد.');
  const lines=input.lines.map(line=>{const result={...line};for(const [account,key,value] of [['1100','customer_id',d.customer_id],['2010','customer_id',d.customer_id],['2000','supplier_id',d.supplier_id],['2030','employee_id',d.user_id],['1020','bank_account_id',d.bank_account_id??d.account_id]] as const)if(line.account_code===account&&value){if(result[key]!=null&&result[key]!==value)throw new HttpError(400,'تفصیلی سند با مرجع تطبیق ندارد.');result[key]=value;}return result;});
  const draft=await postgresCreateScopedJournal(db,schema,scope,{branch_id:safePostgresInteger(event.branch_id),posting_date:input.posting_date,memo:input.reason,source_type:'financial_event',source_id:String(eventId),event_key:`financial-event:${eventId}`,lines});
  await postgresPostScopedJournal(db,schema,scope,draft.id,draft.request_hash,eventId);
  return {event_id:eventId,journal_id:draft.id,state:'posted'};
 });
}
