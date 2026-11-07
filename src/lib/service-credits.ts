import {createHash} from 'node:crypto';import type {DatabaseSync} from 'node:sqlite';import type {Session} from '@/lib/auth';
import {HttpError,requirePerm,validate,auditRecord} from '@/lib/api';import {atomic} from '@/lib/db/transaction';
import {ledgerScope,accountingDate} from '@/lib/accounting';import {reviewFinancialEvent} from '@/lib/accounting-events';
import {approveCreditNote,reverseReturnCredit} from '@/lib/returns';import {nextSeq} from '@/lib/db/schema';import {sumRial} from '@/lib/money';
import {legacyCreditUniqueness} from '@/lib/credit-reissue-schema';
function words(value:unknown,label:string){if(typeof value!=='string'||value.trim().length<5||value.length>1000)throw new HttpError(400,`${label} را مستند وارد کنید.`);return value.trim();}
function scope(db:DatabaseSync,session:Session,invoiceId:number,cookie?:string|null){
 requirePerm(session,'finance.manage');const invoice=db.prepare('SELECT * FROM invoices WHERE id=?').get(validate.id(invoiceId));
 if(!invoice)throw new HttpError(404,'فاکتور یافت نشد.');ledgerScope(session,Number(invoice.branch_id),cookie,'finance.manage');
 if(invoice.type==='purchase'||!invoice.customer_id||['draft','cancelled'].includes(String(invoice.status)))throw new HttpError(409,'اصلاح خدمت به فاکتور قطعی مشتری نیاز دارد.');return invoice;
}
function original(db:DatabaseSync,invoice:Record<string,unknown>){
 if(db.prepare("SELECT id FROM invoice_items WHERE invoice_id=? AND kind NOT IN ('service','labor','fee') LIMIT 1").get(Number(invoice.id)))throw new HttpError(409,'این مسیر فقط برای فاکتور خدمت مستقل است؛ کالای مصرف‌شده به گردش مرجوعی و تعیین تکلیف جداگانه نیاز دارد.');
 const source=db.prepare(`SELECT j.id FROM accounting_events e JOIN accounting_event_reviews r ON r.event_id=e.id JOIN accounting_journals j ON j.id=r.journal_id
 WHERE e.source_type='invoice' AND e.source_id=? AND e.event_type='confirm' AND j.state='posted' AND j.branch_id=?`).get(String(invoice.id),Number(invoice.branch_id));
 if(!source)throw new HttpError(409,'سند درآمد اولیه باید در دفترکل نهایی شده باشد؛ افتتاحیه یا درآمد حدسی جایگزین آن نیست.');
 const revenue=db.prepare("SELECT account_code,SUM(credit-debit) amount FROM accounting_lines WHERE journal_id=? AND account_code IN ('4000','4010') GROUP BY account_code HAVING amount>0").all(source.id);
 if(revenue.length!==1)throw new HttpError(409,'تفکیک سرفصل درآمد اولیه روشن نیست؛ تصمیم تخصیص مستقل لازم است.');
 const lines=db.prepare('SELECT id,kind,name,qty,unit_price,line_discount,total FROM invoice_items WHERE invoice_id=? ORDER BY id LIMIT 201').all(Number(invoice.id));
 if(lines.length>200)throw new HttpError(409,'اصلاح فاکتور بزرگ به تفکیک مستند نیاز دارد.');
 return {journal_id:Number(source.id),revenue_account:String(revenue[0].account_code),revenue:Number(revenue[0].amount),invoice:{...invoice},lines:lines.map(line=>({...line}))};
}
export function proposeServiceCredit(db:DatabaseSync,session:Session,input:{invoice_id:number;reason:string;evidence_reference:string;tax_amount:unknown;lines:Array<{invoice_item_id:number;net_amount:unknown}>;replaces_note_id?:number},cookie?:string|null){
 return atomic(db,()=>{
  const invoice=scope(db,session,input.invoice_id,cookie),proof=original(db,invoice),reason=words(input.reason,'مبنای اصلاح خدمت'),evidence=words(input.evidence_reference,'مرجع تصمیم مشتری و مالیات');
  if(!Array.isArray(input.lines)||!input.lines.length||input.lines.length>200||input.lines.some(line=>!line||typeof line!=='object')||new Set(input.lines.map(line=>line.invoice_item_id)).size!==input.lines.length)throw new HttpError(400,'ردیف‌های یکتا و معتبر خدمت را انتخاب کنید.');
  const tax=validate.amount(input.tax_amount??0),entries=input.lines.map(line=>({id:validate.id(line.invoice_item_id),amount:validate.amount(line.net_amount)}));
  for(const line of entries){const item=proof.lines.find(item=>item.id===line.id);if(!item||line.amount<=0||line.amount>Number(item.total))throw new HttpError(409,'اعتبار ردیف از خالص خدمت اولیه بیشتر است.');}
  const net=sumRial(entries.map(line=>line.amount)),amount=sumRial([net,tax]);
  if(net>proof.revenue)throw new HttpError(409,'اعتبار از درآمد مستند اولیه بیشتر است.');
  const prior=db.prepare("SELECT COALESCE(SUM(amount),0) amount,COALESCE(SUM(tax_amount),0) tax FROM credit_notes WHERE invoice_id=? AND status IN ('approved','posted')").get(invoice.id)!;
  if(amount+Number(prior.amount)>Number(invoice.total)||tax+Number(prior.tax)>Number(invoice.tax))throw new HttpError(409,'اعتبار یا مالیات تجمعی از سند اصلی بیشتر است.');
  for(const line of entries){const priorLine=db.prepare("SELECT COALESCE(SUM(l.net_amount),0) amount FROM service_credit_lines l JOIN credit_notes n ON n.id=l.note_id WHERE l.invoice_item_id=? AND n.status IN ('approved','posted')").get(line.id)!;
   if(line.amount+Number(priorLine.amount)>Number(proof.lines.find(item=>item.id===line.id)!.total))throw new HttpError(409,'اعتبار تجمعی از ردیف اصلی بیشتر است.');}
  let returnId:number,replaces:number|null=null;
  if(input.replaces_note_id){
   if(legacyCreditUniqueness(db))throw new HttpError(409,'ابتدا مهاجرت محافظت‌شدهٔ اعتبارنامه‌ها را اجرا کنید.');
   const old=db.prepare('SELECT n.*,d.original_journal_id FROM credit_notes n JOIN service_credit_documents d ON d.return_id=n.return_id WHERE n.id=? AND n.invoice_id=?').get(validate.id(input.replaces_note_id),invoice.id);
   if(!old||old.status!=='reversed'||!old.reversal_id||old.original_journal_id!==proof.journal_id||db.prepare('SELECT id FROM credit_notes WHERE replaces_note_id=?').get(old.id))throw new HttpError(409,'جایگزینی فقط برای نسخهٔ برگشت‌شده و بدون جایگزین قبلی مجاز است.');
   if(old.reason===reason&&old.evidence_reference===evidence)throw new HttpError(400,'مبنای بازصدور و مرجع بازبینی تازه لازم است.');returnId=Number(old.return_id);replaces=Number(old.id);
  }else{
   returnId=Number(db.prepare("INSERT INTO business_returns(number,invoice_id,branch_id,kind,reason,delivery_reference,requested_by) VALUES(?,?,?,'customer',?,?,?)").run(nextSeq('service_correction','SVC-'),invoice.id,invoice.branch_id,reason,evidence,session.user.id).lastInsertRowid);
   const json=JSON.stringify(proof);db.prepare('INSERT INTO service_credit_documents(return_id,original_journal_id,revenue_account,source_json,source_hash) VALUES(?,?,?,?,?)').run(returnId,proof.journal_id,proof.revenue_account,json,createHash('sha256').update(json).digest('hex'));
  }
  const number=nextSeq('credit_note','CN-'),id=Number(db.prepare('INSERT INTO credit_notes(number,return_id,invoice_id,branch_id,customer_id,amount,net_amount,tax_amount,reason,evidence_reference,requested_by,replaces_note_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(number,returnId,invoice.id,invoice.branch_id,invoice.customer_id,amount,net,tax,reason,evidence,session.user.id,replaces).lastInsertRowid);
  for(const line of entries)db.prepare('INSERT INTO service_credit_lines(note_id,invoice_item_id,net_amount) VALUES(?,?,?)').run(id,line.id,line.amount);
  auditRecord(db,session,'propose','service_credit',id,null,{invoice_id:invoice.id,branch_id:invoice.branch_id,amount,return_id:returnId,replaces_note_id:replaces});return {id,number,return_id:returnId,status:'draft'};
 });
}
export function decideServiceCredit(db:DatabaseSync,session:Session,id:number,accept:boolean,cookie?:string|null){return atomic(db,()=>{
 const note=db.prepare('SELECT n.* FROM credit_notes n JOIN service_credit_documents d ON d.return_id=n.return_id WHERE n.id=?').get(validate.id(id));if(!note)throw new HttpError(404,'اصلاح خدمت یافت نشد.');
 const invoice=scope(db,session,Number(note.invoice_id),cookie);original(db,invoice);
 if(note.status!=='draft')throw new HttpError(409,'سند در مرحلهٔ تصمیم نیست.');if(note.requested_by===session.user.id)throw new HttpError(403,'تأیید یا رد مستقل لازم است.');
 if(!accept){db.prepare("UPDATE credit_notes SET status='void',approved_by=? WHERE id=?").run(session.user.id,id);auditRecord(db,session,'reject','service_credit',id,null,{branch_id:invoice.branch_id});return {id,status:'void'};}
 db.prepare("UPDATE business_returns SET state='authorized',authorized_by=? WHERE id=? AND state='requested'").run(session.user.id,note.return_id);
 return approveCreditNote(db,session,id,cookie);
});}
export function postServiceCredit(db:DatabaseSync,session:Session,id:number,date:string,cookie?:string|null){return atomic(db,()=>{
 const note=db.prepare('SELECT n.*,d.revenue_account FROM credit_notes n JOIN service_credit_documents d ON d.return_id=n.return_id WHERE n.id=?').get(validate.id(id));if(!note)throw new HttpError(404,'اصلاح خدمت یافت نشد.');scope(db,session,Number(note.invoice_id),cookie);
 if(note.status==='posted')return {id,journal_id:note.journal_id,duplicate:true};if(note.status!=='approved')throw new HttpError(409,'تأیید مستقل سند لازم است.');
 const event=db.prepare("SELECT id FROM accounting_events WHERE source_type='credit_note' AND source_id=? AND event_type='recognition'").get(String(id));if(!event)throw new HttpError(409,'رویداد منبع اعتبارنامه یافت نشد.');
 const lines=[{account_code:String(note.revenue_account),debit:Number(note.net_amount)},...(Number(note.tax_amount)?[{account_code:'2020',debit:Number(note.tax_amount)}]:[]),{account_code:'1100',credit:Number(note.amount),customer_id:Number(note.customer_id)}].filter(line=>Number(line.debit??line.credit)>0);
 const result=reviewFinancialEvent(db,session,Number(event.id),{posting_date:accountingDate(date),reason:`اصلاح مستقل و مصوب خدمت ${note.number}`,lines},cookie);
 auditRecord(db,session,'post','service_credit',id,null,{branch_id:note.branch_id,approved_by:note.approved_by});return {id,...result};
});}
export {reverseReturnCredit as reverseServiceCredit};
