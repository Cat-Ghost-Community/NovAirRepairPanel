import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {Session} from '@/lib/auth';
import {auditRecord,HttpError,requirePerm,validate} from '@/lib/api';
import {accountingDate,ledgerScope,createJournal,postJournal} from '@/lib/accounting';
import {captureFinancialDocument} from '@/lib/accounting-events';
import {atomic,readSnapshot} from '@/lib/db/transaction';
import {invoiceObligation} from '@/lib/invoice-obligation';
import {netInvoicePaid,pendingInvoiceAmount,refreshInvoiceFinancialState,syncSalePaid} from '@/lib/payment-state';
import {rial} from '@/lib/money';
import {refundReceipt} from '@/lib/customer-payments';
import {reviewFinancialEvent} from '@/lib/accounting-events';
import {refreshReturnCompletion} from '@/lib/return-state';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function text(value:unknown,label:string){if(typeof value!=='string'||value.trim().length<5||value.length>1000)throw new HttpError(400,`${label} را مستند وارد کنید.`);return value.trim();}

/** The pool belongs to an original verified receipt. An invoice-bound receipt
 * can release only genuine excess above its adjusted obligation. */
export function customerCreditSource(db:DatabaseSync,id:number){
 const fund=db.prepare('SELECT * FROM installment_receipt_funds WHERE id=?').get(validate.id(id));
 if(!fund||fund.direction!=='in'||!fund.customer_id||!fund.settled||!['cash','card','pos','transfer','bank','check','cheque'].includes(String(fund.method)))throw new HttpError(409,'منبع اعتبار باید رسید قطعی مشتری باشد؛ چک وصول‌نشده یا وجه نامشخص اعتبار قابل مصرف نیست.');
 if(fund.sale_id!=null&&fund.invoice_id==null)throw new HttpError(409,'ابتدا فاکتور رسمی فروش صندوق را صادر کنید تا اعتبار آن قابل تخصیص باشد.');
 const free=rial(fund.amount)-rial(fund.refunded)-rial(fund.allocated)-rial(fund.credit_used);
 if(free<0)throw new HttpError(409,'جمع مصرف و استرداد از وجه رسید بیشتر است؛ تطبیق مستقل لازم است.');
 let available=free;
 if(fund.invoice_id!=null){
  const inv=db.prepare('SELECT customer_id,branch_id,type,status FROM invoices WHERE id=?').get(fund.invoice_id);
  if(!inv||inv.type==='purchase'||inv.customer_id!==fund.customer_id||inv.branch_id!==fund.branch_id||['draft','cancelled'].includes(String(inv.status)))throw new HttpError(409,'انتساب یا وضعیت فاکتور منبع اعتبار معتبر نیست.');
  available=Math.min(free,Math.max(0,netInvoicePaid(db,Number(fund.invoice_id),'in')-invoiceObligation(db,Number(fund.invoice_id)).effective_total));
 }
 return {fund,available,source_account:fund.invoice_id==null?'2010':'1100'};
}
function recognizedInvoice(db:DatabaseSync,id:number){return !!db.prepare(`SELECT e.id FROM accounting_events e LEFT JOIN accounting_event_reviews r ON r.event_id=e.id LEFT JOIN accounting_journals j ON j.id=r.journal_id LEFT JOIN accounting_opening_event_links o ON o.event_id=e.id
 WHERE ((e.source_type='invoice' AND e.source_id=? AND e.event_type='confirm') OR (e.source_type='sale' AND e.source_id=CAST((SELECT sale_id FROM invoices WHERE id=?) AS TEXT))) AND (j.state='posted' OR o.event_id IS NOT NULL) LIMIT 1`).get(String(id),id);}
function sourceReady(db:DatabaseSync,fund:Record<string,unknown>){
 const receipt=db.prepare(`SELECT e.id FROM accounting_events e JOIN accounting_event_reviews r ON r.event_id=e.id JOIN accounting_journals j ON j.id=r.journal_id
 WHERE j.state='posted' AND e.branch_id=? AND ((e.source_type='payment' AND e.source_id=?) OR (e.source_type='cheque' AND e.source_id=CAST((SELECT id FROM checks WHERE payment_id=? AND status='passed') AS TEXT))) LIMIT 1`).get(fund.branch_id as number,String(fund.id),fund.id as number);
 return !!receipt&&(fund.invoice_id==null||recognizedInvoice(db,Number(fund.invoice_id)));
}
function customerControl(db:DatabaseSync,customer:number,branch:number){
 const operational=Number(db.prepare("SELECT COALESCE(SUM(amount),0) n FROM party_balance_events WHERE kind='customer' AND party_id=? AND branch_id=?").get(customer,branch)!.n);
 const ledger=Number(db.prepare("SELECT COALESCE(SUM(l.debit-l.credit),0) n FROM accounting_lines l JOIN accounting_journals j ON j.id=l.journal_id WHERE j.state IN ('posted','reversed') AND l.customer_id=? AND j.branch_id=? AND l.account_code IN ('1100','2010')").get(customer,branch)!.n);
 const pending=Number(db.prepare(`SELECT COUNT(*) n FROM accounting_events e LEFT JOIN accounting_event_reviews r ON r.event_id=e.id LEFT JOIN accounting_opening_event_links o ON o.event_id=e.id
 WHERE e.branch_id=? AND json_extract(e.payload_json,'$.document.customer_id')=? AND json_extract(e.payload_json,'$.control_amount')>0 AND r.event_id IS NULL AND o.event_id IS NULL`).get(branch,customer)!.n);
 if(pending)throw new HttpError(409,'رویداد مالیِ بررسی‌نشده برای این مشتری وجود دارد؛ ابتدا دفترکل را تکمیل کنید.');
 if(!Number.isSafeInteger(operational)||!Number.isSafeInteger(ledger)||operational!==ledger)throw new HttpError(409,'ماندهٔ مشتری با حساب‌های کنترل دفترکل تطبیق ندارد؛ افتتاحیه و رویدادهای مالی را بررسی کنید.');
 return {operational,ledger};
}
function position(db:DatabaseSync,input:{payment_id:number;invoice_id:number;installment_id?:number|null;reverses_id?:number|null},amount:number,kind:'allocation'|'reversal'){
 if(!amount)throw new HttpError(400,'مبلغ تخصیص یا برگشت باید مثبت باشد.');
 const source=customerCreditSource(db,input.payment_id),target=db.prepare('SELECT id,branch_id,customer_id,type,status,sale_id FROM invoices WHERE id=?').get(validate.id(input.invoice_id));
 if(!target||target.type==='purchase'||['draft','cancelled'].includes(String(target.status)))throw new HttpError(409,'فاکتور مقصد باید تعهد قطعی مشتری باشد.');
 if(target.branch_id!==source.fund.branch_id||target.customer_id!==source.fund.customer_id||target.id===source.fund.invoice_id)throw new HttpError(409,'منبع و مقصد باید متعلق به یک مشتری و یک شعبه و دو تعهد متفاوت باشند.');
 const due=Math.max(0,invoiceObligation(db,Number(target.id)).effective_total-netInvoicePaid(db,Number(target.id),'in')-pendingInvoiceAmount(db,Number(target.id),'in'));
 const original=input.reverses_id==null?null:db.prepare('SELECT * FROM active_customer_credit WHERE id=?').get(validate.id(input.reverses_id));
 if(kind==='allocation'&&(!amount||amount>source.available||amount>due))throw new HttpError(409,'مبلغ از اعتبار واقعاً آزاد یا ماندهٔ قابل تخصیص فاکتور بیشتر است.');
 if(kind==='reversal'&&(!original||original.payment_id!==source.fund.id||original.invoice_id!==target.id||amount>Number(original.remaining)))throw new HttpError(409,'برگشت از ماندهٔ تخصیص معتبر بیشتر است.');
 const active=db.prepare("SELECT id FROM installment_schedules WHERE invoice_id=? AND status='active'").get(target.id);
 const installment=input.installment_id==null?null:db.prepare('SELECT * FROM effective_installments WHERE id=?').get(validate.id(input.installment_id));
 if(active&&(!installment||installment.invoice_id!==target.id||installment.schedule_id!==active.id))throw new HttpError(409,'برای فاکتور اقساطی، قسطِ نسخهٔ فعال را صریح انتخاب کنید؛ سابقهٔ تسویه بازنویسی نمی‌شود.');
 if(!active&&input.installment_id!=null)throw new HttpError(409,'قسط انتخابی دیگر عضو برنامهٔ فعال نیست؛ باززمان‌بندی مستقل لازم است.');
 if(kind==='allocation'&&installment&&amount>Number(installment.amount)-Number(installment.paid_amount))throw new HttpError(409,'اعتبار از ماندهٔ قسط انتخابی بیشتر است.');
 if(kind==='reversal'&&original?.installment_id!==input.installment_id&&!(original?.installment_id==null&&input.installment_id==null))throw new HttpError(409,'قسط برگشت با تخصیص اولیه تطبیق ندارد.');
 const {operational,ledger}=customerControl(db,Number(target.customer_id),Number(target.branch_id));
 if(!sourceReady(db,source.fund))throw new HttpError(409,'ثبت قطعی رسید یا فاکتور مبدأ در دفترکل کامل نیست؛ منبع اعتبار را بررسی کنید.');
 if(!recognizedInvoice(db,Number(target.id)))throw new HttpError(409,'ابتدا فاکتور مقصد را در دفترکل شناسایی کنید.');
 const sourceCredits=source.fund.invoice_id==null?[]:db.prepare("SELECT id,amount,journal_id FROM credit_notes WHERE invoice_id=? AND status='posted' ORDER BY id").all(source.fund.invoice_id);
 return {source:source.fund,available:source.available,source_account:original?.source_account??source.source_account,source_credits:sourceCredits,target,due,installment:installment?{id:installment.id,schedule_id:installment.schedule_id,amount:installment.amount,paid_amount:installment.paid_amount}:null,original:original?{id:original.id,remaining:original.remaining}:null,operational,ledger};
}
export function proposeCustomerCredit(db:DatabaseSync,session:Session,input:{payment_id:number;invoice_id:number;amount:unknown;installment_id?:number;reverses_id?:number;posting_date:string;reason:string;evidence_reference:string},cookie?:string|null){
 requirePerm(session,'finance.manage');
 return atomic(db,()=>{
  const scope=db.prepare('SELECT branch_id FROM payments WHERE id=?').get(validate.id(input.payment_id));if(!scope)throw new HttpError(404,'رسید یافت نشد.');ledgerScope(session,Number(scope.branch_id),cookie,'finance.manage');
  const source=customerCreditSource(db,validate.id(input.payment_id));
  const amount=validate.amount(input.amount),kind=input.reverses_id==null?'allocation':'reversal',date=accountingDate(input.posting_date),reason=text(input.reason,'دلیل'),reference=text(input.evidence_reference,'مرجع رضایت/سند');
  const snapshot=position(db,input,amount,kind),json=JSON.stringify(snapshot);
  const id=Number(db.prepare(`INSERT INTO customer_credit_operations(kind,reverses_id,payment_id,invoice_id,source_invoice_id,installment_id,branch_id,customer_id,amount,source_account,posting_date,reason,evidence_reference,snapshot_json,snapshot_hash,proposed_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
   .run(kind,input.reverses_id??null,source.fund.id,input.invoice_id,source.fund.invoice_id,input.installment_id??null,source.fund.branch_id,source.fund.customer_id,amount,snapshot.source_account,date,reason,reference,json,hash(snapshot),session.user.id).lastInsertRowid);
  auditRecord(db,session,'propose','customer_credit',id,null,{kind,payment_id:source.fund.id,invoice_id:input.invoice_id,amount,branch_id:source.fund.branch_id});return {id,state:'proposed'};
 });
}
function document(db:DatabaseSync,session:Session,id:number,cookie?:string|null){const row=db.prepare('SELECT * FROM customer_credit_operations WHERE id=?').get(validate.id(id));if(!row)throw new HttpError(404,'سند تخصیص اعتبار یافت نشد.');ledgerScope(session,Number(row.branch_id),cookie,'finance.manage');return row;}
function fresh(db:DatabaseSync,row:Record<string,unknown>){
 const snapshot=position(db,{payment_id:Number(row.payment_id),invoice_id:Number(row.invoice_id),installment_id:row.installment_id==null?null:Number(row.installment_id),reverses_id:row.reverses_id==null?null:Number(row.reverses_id)},Number(row.amount),row.kind as 'allocation'|'reversal');
 if(hash(snapshot)!==row.snapshot_hash||hash(JSON.parse(String(row.snapshot_json)))!==row.snapshot_hash)throw new HttpError(409,'منابع اعتبار، نسخهٔ قسط یا ماندهٔ فاکتور تغییر کرده است؛ پیشنهاد تازه تهیه کنید.');return snapshot;
}
export function decideCustomerCredit(db:DatabaseSync,session:Session,id:number,approve:boolean,cookie?:string|null){return atomic(db,()=>{
 const row=document(db,session,id,cookie);if(row.state!=='proposed')throw new HttpError(409,'سند در انتظار تصمیم نیست.');
 if(approve){if(row.proposed_by===session.user.id)throw new HttpError(403,'تأیید مستقل از پیشنهاددهنده الزامی است.');fresh(db,row);}
 db.prepare('UPDATE customer_credit_operations SET state=?,approved_by=?,approved_at=? WHERE id=?').run(approve?'approved':'rejected',approve?session.user.id:null,approve?new Date().toISOString():null,id);
 auditRecord(db,session,approve?'approve':'reject','customer_credit',id,{state:row.state},{branch_id:row.branch_id});return {id,state:approve?'approved':'rejected'};
});}
export function postCustomerCredit(db:DatabaseSync,session:Session,id:number,cookie?:string|null){return atomic(db,()=>{
 const row=document(db,session,id,cookie);if(row.state==='posted')return {id,state:'posted',duplicate:true};if(row.state!=='approved')throw new HttpError(409,'ابتدا تأیید مستقل سند را بگیرید.');fresh(db,row);
 const event=captureFinancialDocument(db,'customer_credit',id,String(row.kind),session.user.id,Number(row.branch_id));
 const allocation=row.kind==='allocation',amount=Number(row.amount),party=Number(row.customer_id);
 const journal=createJournal(db,session,{branch_id:Number(row.branch_id),posting_date:String(row.posting_date),memo:String(row.reason),event_key:`financial-event:${event}`,source_type:'financial_event',source_id:String(event),lines:[
  {account_code:String(row.source_account),debit:allocation?amount:0,credit:allocation?0:amount,customer_id:party,memo:`رسید ${row.payment_id}؛ ${row.source_invoice_id==null?'پیش‌دریافت':`فاکتور مبدأ ${row.source_invoice_id}`}`},
  {account_code:'1100',debit:allocation?0:amount,credit:allocation?amount:0,customer_id:party,memo:`فاکتور مقصد ${row.invoice_id}`}
 ]},cookie);
 postJournal(db,session,journal.id,cookie);
 db.prepare('INSERT INTO accounting_event_reviews(event_id,journal_id,reason,approved_by) VALUES(?,?,?,?)').run(event,journal.id,`تأیید مستقل سند اعتبار ${id}`,row.approved_by);
 db.prepare("UPDATE customer_credit_operations SET state='posted',journal_id=? WHERE id=?").run(journal.id,id);
 for(const invoice of [row.source_invoice_id,row.invoice_id])if(invoice!=null){refreshInvoiceFinancialState(db,Number(invoice));const sale=db.prepare('SELECT sale_id FROM invoices WHERE id=?').get(invoice);if(sale?.sale_id)syncSalePaid(db,Number(sale.sale_id));}
 if(row.source_invoice_id!=null)for(const r of db.prepare("SELECT return_id FROM credit_notes WHERE invoice_id=? AND status='posted' LIMIT 1000").all(row.source_invoice_id))refreshReturnCompletion(db,Number(r.return_id));
 auditRecord(db,session,'post','customer_credit',id,{state:row.state},{amount:row.amount,journal_id:journal.id,approved_by:row.approved_by,branch_id:row.branch_id});return {id,state:'posted',journal_id:journal.id,duplicate:false};
});}

/** Records a confirmed cash disbursement, not a request to an external provider. */
export function refundCustomerCredit(db:DatabaseSync,session:Session,input:{payment_id:number;amount:unknown;reason:string;document_reference:string;confirmed:boolean;return_id?:number},cookie?:string|null){
 requirePerm(session,'finance.manage');requirePerm(session,'payments.refund');
 return atomic(db,()=>{
  const scope=db.prepare('SELECT branch_id FROM payments WHERE id=?').get(validate.id(input.payment_id));if(!scope)throw new HttpError(404,'رسید یافت نشد.');ledgerScope(session,Number(scope.branch_id),cookie,'finance.manage');
  const source=customerCreditSource(db,input.payment_id),amount=validate.amount(input.amount),reference=text(input.document_reference,'مرجع استرداد واقعی'),reason=text(input.reason,'دلیل استرداد');
  if(input.confirmed!==true||!amount||amount>source.available)throw new HttpError(409,'انجام وجه را تأیید کنید؛ مبلغ نباید از اعتبار آزاد بیشتر باشد.');
  if(!sourceReady(db,source.fund))throw new HttpError(409,'ثبت قطعی منبع وجه در دفترکل کامل نیست.');customerControl(db,Number(source.fund.customer_id),Number(source.fund.branch_id));
  if(db.prepare('SELECT id FROM customer_credit_refunds WHERE payment_id=? AND document_reference=?').get(input.payment_id,reference))throw new HttpError(409,'این سند استرداد قبلاً ثبت شده است.');
  const refund=refundReceipt(db,session,{payment_id:input.payment_id,amount,reason,method:'cash',confirmed:true,document_reference:reference,return_id:input.return_id},Number(source.fund.branch_id),'customer-credit');
  const event=db.prepare("SELECT id FROM accounting_events WHERE source_type='refund' AND source_id=? AND event_type='refund'").get(String(refund.id))!;
  let reviewed=db.prepare('SELECT journal_id FROM accounting_event_reviews WHERE event_id=?').get(event.id);
  if(!reviewed){reviewFinancialEvent(db,session,Number(event.id),{posting_date:new Date().toISOString().slice(0,10),reason:`استرداد نقدیِ انجام‌شده و مستند: ${reference}`,lines:[{account_code:source.source_account,debit:amount,customer_id:Number(source.fund.customer_id)},{account_code:'1000',credit:amount}]},cookie);reviewed=db.prepare('SELECT journal_id FROM accounting_event_reviews WHERE event_id=?').get(event.id);}
  db.prepare('INSERT INTO customer_credit_refunds(refund_id,payment_id,branch_id,customer_id,amount,source_account,document_reference,recorded_by,journal_id) VALUES(?,?,?,?,?,?,?,?,?)').run(refund.id,input.payment_id,source.fund.branch_id,source.fund.customer_id,amount,source.source_account,reference,session.user.id,reviewed!.journal_id);
  auditRecord(db,session,'refund_credit','payment',input.payment_id,null,{refund_id:refund.id,amount,document_reference:reference,journal_id:reviewed!.journal_id,branch_id:source.fund.branch_id});return refund;
 });
}

export function customerCreditList(db:DatabaseSync,session:Session,customer:number,branch:number,page=1){
 ledgerScope(session,branch,null,'finance.view');if(!Number.isSafeInteger(page)||page<1||page>100000)throw new HttpError(400,'صفحهٔ اعتبار معتبر نیست.');
 return readSnapshot(db,()=>{
  const sources=db.prepare(`SELECT p.id,p.number,p.invoice_id,p.amount,p.refunded,p.credit_used used,p.method,
   CASE WHEN p.method NOT IN ('cash','card','pos','transfer','bank','check','cheque') OR (p.sale_id IS NOT NULL AND p.invoice_id IS NULL) OR (p.invoice_id IS NOT NULL AND (i.id IS NULL OR i.type='purchase' OR i.status IN ('draft','cancelled') OR i.customer_id!=p.customer_id OR i.branch_id!=p.branch_id)) THEN 0
   ELSE MAX(0,MIN(p.amount-p.refunded-p.allocated-p.credit_used,CASE WHEN p.invoice_id IS NULL THEN p.amount ELSE MAX(0,i.paid-i.total) END)) END available
   FROM installment_receipt_funds p LEFT JOIN effective_invoices i ON i.id=p.invoice_id WHERE p.customer_id=? AND p.branch_id=? AND p.direction='in' AND p.settled=1 ORDER BY p.id DESC LIMIT 21 OFFSET ?`).all(customer,branch,(page-1)*20);
  return {sources:sources.slice(0,20),hasMore:sources.length>20,page};
 });
}
