import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Session } from '@/lib/auth';
import { HttpError,requirePerm,validate,auditRecord } from '@/lib/api';
import { ledgerScope } from '@/lib/accounting';
import { atomic } from '@/lib/db/transaction';
import { rial,sumRial } from '@/lib/money';
import { invoiceObligation } from '@/lib/invoice-obligation';
import { netInvoicePaid,pendingInvoiceAmount,SETTLED_PAYMENT } from '@/lib/payment-state';
import { createCustomerReceipt } from '@/lib/customer-payments';

function text(value:unknown,label:string){if(typeof value!=='string'||value.trim().length<5||value.length>1000)throw new HttpError(400,`${label} را مستند وارد کنید.`);return value.trim();}
function day(value:unknown){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw new HttpError(400,'تاریخ معتبر میلادی برای ذخیره‌سازی لازم است.');return value;}
function utc(year:number,month:number,date:number){const value=new Date(0);value.setUTCFullYear(year,month,date);return value;}
function hash(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
/** Collections are original receipts once, across all agreement versions. */
export function installmentCollected(db:DatabaseSync,branch:number|null,invoice:number|null=null){
 const value=Number(db.prepare(`SELECT COALESCE(SUM(p.amount-p.refunded),0) n FROM installment_receipt_funds p WHERE p.direction='in' AND p.settled=1 AND (:branch IS NULL OR p.branch_id=:branch) AND (:invoice IS NULL OR p.invoice_id=:invoice)
 AND (EXISTS(SELECT 1 FROM installments i WHERE i.invoice_id=p.invoice_id) OR EXISTS(SELECT 1 FROM installment_schedules s WHERE s.invoice_id=p.invoice_id))`).get({branch,invoice})!.n);
 if(!Number.isSafeInteger(value))throw new HttpError(409,'وصول اقساط از محدودهٔ مبلغ صحیح بیشتر است؛ تطبیق لازم است.');return value;
}
export function installmentPosition(db:DatabaseSync,invoiceId:number){
 const active=db.prepare("SELECT * FROM installment_schedules WHERE invoice_id=? AND status='active'").get(invoiceId);
 const obligation=invoiceObligation(db,invoiceId).effective_total,paid=netInvoicePaid(db,invoiceId,'in'),outstanding=Math.max(0,obligation-paid);
 const scheduled=Number(db.prepare('SELECT COALESCE(SUM(amount-paid_amount),0) n FROM effective_installments WHERE invoice_id=? AND legacy_review=0').get(invoiceId)!.n);
 const free=active?Number(db.prepare(`SELECT COALESCE(SUM(MAX(0,p.amount-p.refunded-p.allocated-p.credit_used)),0) n FROM installment_receipt_funds p WHERE p.invoice_id=:invoice AND p.branch_id=:branch AND p.customer_id=:customer AND p.direction='in' AND p.settled=1 AND p.method!='other'
 AND NOT EXISTS(SELECT 1 FROM json_each(:basis,'$.payments') old WHERE json_extract(old.value,'$.id')=p.id AND json_extract(old.value,'$.settled')=1 AND json_extract(old.value,'$.amount')>json_extract(old.value,'$.refunded'))`).get({invoice:invoiceId,branch:active.branch_id,customer:active.customer_id,basis:active.source_json})!.n):0;
 const invalid=Number(db.prepare('SELECT COUNT(*) n FROM installment_allocation_balances a JOIN installments i ON i.id=a.installment_id WHERE i.invoice_id=? AND a.remaining!=a.verified_amount').get(invoiceId)!.n);
 const difference=active?scheduled-outstanding-free:0;if(![obligation,paid,outstanding,scheduled,free,difference].every(Number.isSafeInteger))throw new HttpError(409,'تطبیق اقساط خارج از محدودهٔ مبلغ صحیح است.');
 return {active_id:active?.id??null,obligation,paid,outstanding,scheduled,unallocated:free,difference,unverified_allocations:invalid,pending_instruments:pendingInvoiceAmount(db,invoiceId,'in'),requiresReview:invalid>0||difference!==0};
}
export function installmentInvoice(db:DatabaseSync,session:Session,id:number,cookie?:string|null,permission='finance.manage'){
 const inv=db.prepare('SELECT * FROM invoices WHERE id=?').get(validate.id(id));if(!inv||!inv.branch_id)throw new HttpError(404,'فاکتور دارای شعبهٔ معتبر یافت نشد.');ledgerScope(session,Number(inv.branch_id),cookie,permission);
 if(inv.type==='purchase'||!inv.customer_id||['draft','cancelled'].includes(String(inv.status)))throw new HttpError(409,'فقط تعهد قطعی مشتری می‌تواند برنامهٔ اقساط فعال داشته باشد.');return inv;
}
function basis(db:DatabaseSync,invoiceId:number,noteId:number|null){
 const inv=db.prepare('SELECT id,branch_id,customer_id,status,total FROM invoices WHERE id=?').get(invoiceId)!;
 const note=noteId==null?null:db.prepare('SELECT id,invoice_id,amount,net_amount,tax_amount,status,return_id FROM credit_notes WHERE id=?').get(noteId);
 if(noteId!=null&&(!note||note.invoice_id!==invoiceId))throw new HttpError(400,'اعتبارنامه متعلق به این فاکتور نیست.');
 const effective=invoiceObligation(db,invoiceId).effective_total+(note?.status==='posted'?Number(note.amount):0);
 const payments=db.prepare(`SELECT p.id,p.amount,p.direction,p.method,p.customer_id,p.branch_id,${SETTLED_PAYMENT} settled,
 COALESCE((SELECT SUM(amount) FROM refunds WHERE payment_id=p.id),0) refunded,
 COALESCE((SELECT status FROM checks WHERE payment_id=p.id),'') cheque_state
 FROM payments p WHERE p.invoice_id=? ORDER BY p.id`).all(invoiceId);
 const active=db.prepare("SELECT id FROM installment_schedules WHERE invoice_id=? AND status='active'").get(invoiceId);
 const rows=db.prepare('SELECT id,customer_id,invoice_id,amount,paid_amount,due_date,seq,status,schedule_id FROM installments WHERE invoice_id=? ORDER BY id').all(invoiceId);
 const allocations=db.prepare(`SELECT a.id,a.payment_id,a.installment_id,a.amount,COALESCE((SELECT SUM(amount) FROM installment_allocation_reversals WHERE allocation_id=a.id),0) reversed FROM installment_allocations a JOIN installments i ON i.id=a.installment_id WHERE i.invoice_id=? ORDER BY a.id`).all(invoiceId);
 const credits=db.prepare("SELECT id,amount,status FROM credit_notes WHERE invoice_id=? AND status IN ('posted','reversed') AND id!=? ORDER BY id").all(invoiceId,noteId??-1);
 const paid=netInvoicePaid(db,invoiceId,'in'),pending=pendingInvoiceAmount(db,invoiceId,'in');if(![paid,pending,effective].every(n=>Number.isSafeInteger(n)&&n>=0))throw new HttpError(409,'ماندهٔ منبع اقساط صحیح نیست؛ تطبیق مستقل مالی لازم است.');
 return {invoice:{id:inv.id,branch_id:inv.branch_id,customer_id:inv.customer_id,total:inv.total},effective_without_target_credit:effective,paid,pending,active_id:active?.id??null,payments,rows,allocations,credits,note:note?{id:note.id,amount:note.amount,net_amount:note.net_amount,tax_amount:note.tax_amount,return_id:note.return_id}:null};
}
type Proposal={invoice_id:number;reason:string;evidence_reference:string;credit_note_id?:number;purpose?:'ordinary'|'credit'|'credit_reversal';lines?:Array<{amount:number;due_date:string}>;count?:number;start_date?:string};
export function proposeInstallmentSchedule(db:DatabaseSync,session:Session,input:Proposal,cookie?:string|null){
 requirePerm(session,'finance.manage');return atomic(db,()=>{
  const inv=installmentInvoice(db,session,input.invoice_id,cookie),reason=text(input.reason,'دلیل برنامه'),proof=text(input.evidence_reference,'مرجع توافق/بازبینی');
  const purpose=input.purpose??'ordinary',noteId=input.credit_note_id==null?null:validate.id(input.credit_note_id);
  if(!['ordinary','credit','credit_reversal'].includes(purpose)||(purpose==='ordinary')!==(noteId==null))throw new HttpError(400,'نوع اصلاح و اعتبارنامه را مشخص کنید.');
  const note=noteId==null?null:db.prepare('SELECT status,amount FROM credit_notes WHERE id=? AND invoice_id=?').get(noteId,inv.id);
  if(noteId!=null&&(!note||(purpose==='credit'?!['draft','approved'].includes(String(note.status)):note.status!=='posted')))throw new HttpError(409,'وضعیت اعتبارنامه برای این پیشنهاد مناسب نیست.');
  const snapshot=basis(db,Number(inv.id),noteId);
  if(snapshot.pending>0)throw new HttpError(409,'ابتدا وضعیت چک‌های در انتظار را تعیین کنید؛ وجه نامطمئن مبنای برنامه نیست.');
  if(snapshot.payments.some(p=>p.direction==='in'&&(p.branch_id!==inv.branch_id||p.customer_id!==inv.customer_id||p.method==='other')))throw new HttpError(409,'انتساب یا تأیید یکی از رسیدهای قدیمی مبهم است؛ تطبیق مستقل لازم است.');
  const legacy=snapshot.rows.filter(r=>r.schedule_id==null);
  const historicalReceipts=sumRial(snapshot.payments.filter(p=>p.direction==='in'&&p.settled).map(p=>rial(p.amount)));
  if(legacy.some(r=>r.customer_id!==inv.customer_id)||sumRial(legacy.map(r=>rial(r.paid_amount??0)))>historicalReceipts)throw new HttpError(409,'ادعای پرداخت یا مشتریِ سابقهٔ قدیمی با رسیدهای معتبر تطبیق ندارد؛ اصلاح مستقل سابقه لازم است.');
  const obligation=snapshot.effective_without_target_credit-(purpose==='credit'?Number(note!.amount):0);
  if(obligation<0)throw new HttpError(409,'اصلاح از تعهد معتبر بیشتر است؛ پیشنهاد قابل قبول نیست.');
  const principal=Math.max(0,obligation-snapshot.paid);
  let terms=input.lines;
  if(terms==null){
   const count=input.count??3;if(!Number.isInteger(count)||count<2||count>36||principal<count)throw new HttpError(400,'تعداد اقساط باید بین ۲ و ۳۶ و متناسب با ماندهٔ مثبت باشد.');
   const start=day(input.start_date??new Date().toISOString().slice(0,10)),date=new Date(start),base=Math.floor(principal/count);
   terms=Array.from({length:count},(_,i)=>{const last=utc(date.getUTCFullYear(),date.getUTCMonth()+i+1,0);return {amount:i===count-1?principal-base*(count-1):base,due_date:utc(last.getUTCFullYear(),last.getUTCMonth(),Math.min(date.getUTCDate(),last.getUTCDate())).toISOString().slice(0,10)};});
  }
  if(!Array.isArray(terms)||terms.length>120||(!terms.length&&principal!==0))throw new HttpError(400,'ردیف‌های برنامه باید با ماندهٔ واقعی سازگار باشند.');
  const lines=terms.map(line=>{if(!line||typeof line!=='object')throw new HttpError(400,'ردیف برنامه معتبر نیست.');const amount=rial(line.amount);if(!amount)throw new HttpError(400,'قسط صفر ثبت نمی‌شود.');return {amount,due_date:day(line.due_date)};});
  if(sumRial(lines.map(l=>l.amount))!==principal)throw new HttpError(409,'جمع برنامه دقیقاً باید برابر ماندهٔ معتبر پس از اصلاح باشد.');
  const version=Number(db.prepare('SELECT COALESCE(MAX(version),0)+1 v FROM installment_schedules WHERE invoice_id=?').get(inv.id)!.v),json=JSON.stringify(snapshot);
  const id=Number(db.prepare(`INSERT INTO installment_schedules(invoice_id,branch_id,customer_id,version,parent_id,credit_note_id,purpose,principal,source_json,source_hash,reason,evidence_reference,proposed_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(inv.id,inv.branch_id,inv.customer_id,version,snapshot.active_id,noteId,purpose,principal,json,hash(snapshot),reason,proof,session.user.id).lastInsertRowid);
  lines.forEach((line,i)=>db.prepare('INSERT INTO installment_schedule_terms(schedule_id,seq,amount,due_date) VALUES(?,?,?,?)').run(id,i+1,line.amount,line.due_date));
  auditRecord(db,session,'propose','installment_schedule',id,null,{invoice_id:inv.id,branch_id:inv.branch_id,principal,purpose,credit_note_id:noteId,version});return {id,version,principal,status:'proposed'};
 });
}
function unchanged(db:DatabaseSync,schedule:Record<string,unknown>){
 if(hash(JSON.parse(String(schedule.source_json)))!==schedule.source_hash||hash(basis(db,Number(schedule.invoice_id),schedule.credit_note_id==null?null:Number(schedule.credit_note_id)))!==schedule.source_hash)throw new HttpError(409,'منابع یا نسخهٔ برنامه پس از پیشنهاد تغییر کرده‌اند؛ پیشنهاد تازه لازم است.');
}
function activate(db:DatabaseSync,schedule:Record<string,unknown>){
 unchanged(db,schedule);db.prepare("UPDATE installment_schedules SET status='superseded' WHERE invoice_id=? AND status='active'").run(Number(schedule.invoice_id));
 db.prepare("UPDATE installment_schedules SET status='active' WHERE id=?").run(Number(schedule.id));
 const terms=db.prepare('SELECT * FROM installment_schedule_terms WHERE schedule_id=? ORDER BY seq').all(Number(schedule.id));
 for(const line of terms)db.prepare(`INSERT INTO installments(customer_id,invoice_id,seq,amount,due_date,status,user_id,schedule_id,schedule_term_id) VALUES(?,?,?,?,?,'pending',?,?,?)`).run(Number(schedule.customer_id),Number(schedule.invoice_id),line.seq,line.amount,line.due_date,Number(schedule.proposed_by),Number(schedule.id),line.id);
}
export function decideInstallmentSchedule(db:DatabaseSync,session:Session,id:number,action:'approve'|'reject'|'cancel',reason:string,cookie?:string|null){
 requirePerm(session,'finance.manage');return atomic(db,()=>{
  const s=db.prepare('SELECT * FROM installment_schedules WHERE id=?').get(validate.id(id));if(!s)throw new HttpError(404,'پیشنهاد اقساط یافت نشد.');ledgerScope(session,Number(s.branch_id),cookie,'finance.manage');const proof=text(reason,'دلیل تصمیم');
  if(!['proposed','approved'].includes(String(s.status)))throw new HttpError(409,'فقط پیشنهاد در انتظار قابل تصمیم‌گیری است.');
  if(action==='approve'){
   if(s.status!=='proposed'||s.proposed_by===session.user.id)throw new HttpError(403,'تأیید باید مستقل از پیشنهاددهنده باشد.');unchanged(db,s);
   db.prepare("UPDATE installment_schedules SET status='approved',approved_by=?,approved_at=datetime('now') WHERE id=?").run(session.user.id,id);
   if(s.purpose==='ordinary')activate(db,{...s,status:'approved',approved_by:session.user.id});
  }else{
   if(!['reject','cancel'].includes(action)||action==='reject'&&s.status!=='proposed')throw new HttpError(400,'تصمیم معتبر نیست.');
   if(action==='cancel'&&s.proposed_by!==session.user.id&&!['owner','admin'].includes(session.user.role))throw new HttpError(403,'لغو پیشنهاد فقط برای پیشنهاددهنده یا مدیر مجاز است.');
   db.prepare('UPDATE installment_schedules SET status=? WHERE id=?').run(action==='cancel'?'cancelled':'rejected',id);
  }
  auditRecord(db,session,action,'installment_schedule',id,{status:s.status},{reason:proof,branch_id:s.branch_id});return {id,status:String(db.prepare('SELECT status FROM installment_schedules WHERE id=?').get(id)!.status)};
 });
}
export function requireCreditSchedule(db:DatabaseSync,noteId:number,purpose:'credit'|'credit_reversal'){
 const note=db.prepare('SELECT invoice_id FROM credit_notes WHERE id=?').get(noteId);if(!note)return;
 const relevant=db.prepare("SELECT id FROM installment_schedules WHERE invoice_id=? AND status='active' UNION ALL SELECT id FROM installments WHERE invoice_id=? AND schedule_id IS NULL LIMIT 1").get(note.invoice_id,note.invoice_id);if(!relevant)return;
 const proposal=db.prepare("SELECT * FROM installment_schedules WHERE credit_note_id=? AND purpose=? AND status='approved'").get(noteId,purpose);
 if(!proposal)throw new HttpError(409,'اصلاح اعتبارنامه به باززمان‌بندی مستقلاً تأییدشدهٔ اقساط نیاز دارد.');unchanged(db,proposal);
}
export function applyCreditSchedule(db:DatabaseSync,noteId:number,purpose:'credit'|'credit_reversal',executorId:number){
 const proposal=db.prepare("SELECT * FROM installment_schedules WHERE credit_note_id=? AND purpose=? AND status='approved'").get(noteId,purpose);if(proposal){activate(db,proposal);
  const user=db.prepare('SELECT id,name,email,role,branch_id,avatar_color FROM users WHERE id=?').get(executorId);if(!user)throw new HttpError(409,'عامل اجرای سند مشخص نیست.');
  auditRecord(db,{user} as Session,'activate_credit','installment_schedule',Number(proposal.id),null,{note_id:noteId,purpose,branch_id:proposal.branch_id,principal:proposal.principal});
 }
}
export function allocateInstallmentReceipt(db:DatabaseSync,session:Session,input:{id:number;payment_id:number;amount:unknown;reference:string},cookie?:string|null){
 requirePerm(session,'finance.manage');return atomic(db,()=>{
  const line=db.prepare('SELECT * FROM effective_installments WHERE id=?').get(validate.id(input.id));if(!line||!line.branch_id)throw new HttpError(404,'قسط دارای انتساب معتبر یافت نشد.');ledgerScope(session,Number(line.branch_id),cookie,'finance.manage');
  if(line.legacy_review||line.schedule_state!=='active')throw new HttpError(409,'سابقهٔ قدیمی یا غیرفعال قابل تسویه نیست؛ ابتدا برنامهٔ معتبر را تأیید کنید.');
  if(installmentPosition(db,Number(line.invoice_id)).requiresReview)throw new HttpError(409,'برنامه با ماندهٔ واقعی تطبیق ندارد؛ باززمان‌بندی یا بررسی وجه لازم است.');
  const invoice=installmentInvoice(db,session,Number(line.invoice_id),cookie),fund=db.prepare('SELECT * FROM installment_receipt_funds WHERE id=?').get(validate.id(input.payment_id));const amount=rial(input.amount),reference=text(input.reference,'مرجع بررسی رسید');
  if(invoice.branch_id!==line.branch_id||invoice.customer_id!==line.customer_id)throw new HttpError(409,'انتساب فعلی فاکتور با برنامهٔ پذیرفته‌شده تطبیق ندارد.');
  if(!fund||!fund.settled||fund.direction!=='in'||fund.branch_id!==line.branch_id||fund.invoice_id!==invoice.id||fund.customer_id!==invoice.customer_id||['other'].includes(String(fund.method)))throw new HttpError(409,'رسید معتبرِ تسویه‌شده و متعلق به همین فاکتور/شعبه لازم است.');
  if(!amount||amount>Number(line.amount)-Number(line.paid_amount)||amount>Number(fund.amount)-Number(fund.refunded)-Number(fund.allocated)-Number(fund.credit_used))throw new HttpError(409,'مبلغ از قسط یا وجه واقعاً تخصیص‌نیافته بیشتر است.');
  const schedule=db.prepare('SELECT source_json FROM installment_schedules WHERE id=?').get(line.schedule_id)!;if(JSON.parse(String(schedule.source_json)).payments.some((p:{id:number;settled:number;amount:number;refunded:number})=>p.id===fund.id&&p.settled&&p.amount>p.refunded))throw new HttpError(409,'این رسید قبلاً در ماندهٔ آغاز برنامه لحاظ شده است؛ دوباره قسط را تسویه نمی‌کند.');
  const id=Number(db.prepare('INSERT INTO installment_allocations(installment_id,payment_id,branch_id,amount,evidence_reference,created_by) VALUES(?,?,?,?,?,?)').run(line.id,fund.id,line.branch_id,amount,reference,session.user.id).lastInsertRowid);
  const posting=db.prepare("SELECT j.id FROM accounting_events e JOIN accounting_event_reviews r ON r.event_id=e.id JOIN accounting_journals j ON j.id=r.journal_id WHERE e.source_type='payment' AND e.source_id=? AND j.state='posted' LIMIT 1").get(String(fund.id));
  auditRecord(db,session,'allocate','installment',Number(line.id),null,{allocation_id:id,payment_id:fund.id,amount,branch_id:line.branch_id});return {id,installment_id:Number(line.id),payment_id:Number(fund.id),amount,accounting_state:posting?'posted':'pending_review',status:String(db.prepare('SELECT status FROM effective_installments WHERE id=?').get(line.id)!.status)};
 });
}
export function collectInstallment(db:DatabaseSync,session:Session,input:{id:number;amount?:unknown;method?:string;reference:string;confirmed:boolean;create_payment?:boolean},cookie?:string|null){
 requirePerm(session,'finance.manage');requirePerm(session,'payments.create');return atomic(db,()=>{
  const line=db.prepare('SELECT * FROM effective_installments WHERE id=?').get(validate.id(input.id));if(!line||!line.branch_id)throw new HttpError(404,'قسط یافت نشد.');ledgerScope(session,Number(line.branch_id),cookie,'finance.manage');
  if(line.legacy_review||line.schedule_state!=='active')throw new HttpError(409,'تسویهٔ سابقهٔ قدیمی بدون برنامهٔ پذیرفته‌شده مسدود است.');
  if(installmentPosition(db,Number(line.invoice_id)).requiresReview)throw new HttpError(409,'تطبیق برنامه و وجوه کامل نیست؛ ثبت دریافت قسط مسدود است.');
  if(input.create_payment===false||input.confirmed!==true||!['cash','card','transfer'].includes(input.method??'cash'))throw new HttpError(400,'فقط وجه واقعاً دریافت‌شده با تأیید صریح ثبت می‌شود؛ برای رسید موجود از تخصیص استفاده کنید.');
  const amount=rial(input.amount??Number(line.amount)-Number(line.paid_amount));if(!amount||amount>Number(line.amount)-Number(line.paid_amount))throw new HttpError(409,'مبلغ از ماندهٔ معتبر قسط بیشتر است.');
  const reference=text(input.reference,'مرجع وجه واقعی'),invoice=installmentInvoice(db,session,Number(line.invoice_id),cookie);
  if(invoice.branch_id!==line.branch_id||invoice.customer_id!==line.customer_id)throw new HttpError(409,'انتساب فاکتور و برنامه تطبیق ندارد.');
  const receipt=createCustomerReceipt(db,session,{invoice_id:Number(line.invoice_id),amount,method:input.method??'cash',reference},Number(line.branch_id));
  const result=allocateInstallmentReceipt(db,session,{id:Number(line.id),payment_id:receipt.id,amount,reference},cookie);
  return {...result,ok:true,number:receipt.number};
 });
}
export function reverseInstallmentAllocation(db:DatabaseSync,session:Session,input:{id:number;amount:unknown;reason:string},cookie?:string|null){
 requirePerm(session,'finance.manage');return atomic(db,()=>{
  const row=db.prepare('SELECT * FROM installment_allocation_balances WHERE id=?').get(validate.id(input.id));if(!row)throw new HttpError(404,'تخصیص یافت نشد.');ledgerScope(session,Number(row.branch_id),cookie,'finance.manage');const amount=rial(input.amount),reason=text(input.reason,'دلیل برگشت تخصیص');
  if(!amount||amount>Number(row.remaining))throw new HttpError(409,'برگشت از ماندهٔ تخصیص بیشتر است.');const id=Number(db.prepare('INSERT INTO installment_allocation_reversals(allocation_id,amount,reason,created_by) VALUES(?,?,?,?)').run(row.id,amount,reason,session.user.id).lastInsertRowid);
  auditRecord(db,session,'reverse_allocation','installment',Number(row.installment_id),null,{reversal_id:id,allocation_id:row.id,amount,branch_id:row.branch_id});return {id,amount};
 });
}
