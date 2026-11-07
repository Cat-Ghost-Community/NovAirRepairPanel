import type { DatabaseSync } from 'node:sqlite';
import { HttpError } from '@/lib/api';
import { refreshInvoiceFinancialState,syncSalePaid,netInvoicePaid } from '@/lib/payment-state';
import { invoiceObligation } from '@/lib/invoice-obligation';
import type { JournalLine } from '@/lib/accounting';
import { sumRial } from '@/lib/money';
import { requireCreditSchedule,applyCreditSchedule } from '@/lib/installments';

export function validateReturnPosting(db:DatabaseSync,event:Record<string,unknown>,lines:JournalLine[]){
 if(event.source_type!=='credit_note')return;
 const note=db.prepare('SELECT * FROM credit_notes WHERE id=?').get(Number(event.source_id));if(!note)throw new HttpError(404,'اعتبارنامه یافت نشد.');
 requireCreditSchedule(db,Number(note.id),'credit');
 const service=db.prepare('SELECT * FROM service_credit_documents WHERE return_id=?').get(note.return_id);
 if(service){
  const original=db.prepare("SELECT id FROM accounting_journals WHERE id=? AND state='posted' AND branch_id=?").get(service.original_journal_id,note.branch_id);
  if(!original)throw new HttpError(409,'سند درآمد اولیه دیگر معتبر نیست؛ بازبینی مستقل لازم است.');
  if(lines.some(line=>['4000','4010'].includes(line.account_code)&&line.account_code!==service.revenue_account))throw new HttpError(409,'برگشت خدمت باید از سرفصل واقعیِ درآمد اولیه انجام شود.');
 }
 if(note.customer_id!=null){const transferred=Number(db.prepare('SELECT COALESCE(SUM(remaining),0) n FROM active_customer_credit WHERE invoice_id=?').get(note.invoice_id)!.n);
  if(transferred>invoiceObligation(db,Number(note.invoice_id)).effective_total-Number(note.amount))throw new HttpError(409,'پیش از کاهش تعهد، اعتبار منتقل‌شدهٔ مازاد را از گردش برگشت تخصیص آزاد کنید.');}
 const customer=note.customer_id!=null,control=customer?'1100':'2000';
 const amount=(code:string,side:'debit'|'credit')=>sumRial(lines.filter(l=>l.account_code===code).map(l=>Number(l[side]??0)));
 const directional=customer?'credit':'debit',opposite=customer?'debit':'credit';
 if(amount(control,directional)!==note.amount||amount(control,opposite)!==0)throw new HttpError(400,'اثر اعتبارنامه بر حساب کنترل باید دقیقاً برابر مبلغ آن باشد.');
 const netCodes=customer?['4000','4010']:['1310'],taxCode=customer?'2020':'1200';
 if(sumRial(netCodes.map(code=>amount(code,opposite)))!==note.net_amount||amount(taxCode,opposite)!==note.tax_amount
 ||lines.some(l=>![control,...netCodes,taxCode].includes(l.account_code)))throw new HttpError(400,'تفکیک خالص و مالیات اعتبارنامه با سرفصل‌های مجاز تطبیق ندارد.');
 for(const line of lines.filter(l=>l.account_code===control)){
  const field=customer?'customer_id':'supplier_id',expected=customer?note.customer_id:note.supplier_id;
  if(line[field]!==expected)throw new HttpError(400,'طرف حساب اعتبارنامه با فاکتور اصلی سازگار نیست.');
 }
}
export function refreshReturnCompletion(db:DatabaseSync,id:number){
 const header=db.prepare('SELECT state,zero_credit_approved_by FROM business_returns WHERE id=?').get(id);if(!header||['requested','authorized','received','inspected','rejected','dispatched'].includes(String(header.state)))return;
 const note=db.prepare("SELECT id FROM credit_notes WHERE return_id=? AND status='posted'").get(id);if(!note&&!header.zero_credit_approved_by)return;
 const pending=db.prepare(`SELECT l.id FROM business_return_lines l WHERE l.return_id=? AND l.disposition!='rejected' AND COALESCE(l.cost_amount,l.unit_cost)>0
 AND NOT EXISTS(SELECT 1 FROM accounting_events e JOIN accounting_event_reviews r ON r.event_id=e.id JOIN accounting_journals j ON j.id=r.journal_id
 WHERE j.state='posted' AND ((l.movement_id IS NOT NULL AND e.source_type='stock' AND e.source_id=CAST(l.movement_id AS TEXT))
 OR (l.movement_id IS NULL AND e.source_type='return_cost' AND e.source_id=CAST(l.id AS TEXT)))) LIMIT 1`).get(id);
 if(!pending)db.prepare("UPDATE business_returns SET state='completed' WHERE id=?").run(id);
 else if(header.state==='completed')db.prepare("UPDATE business_returns SET state='credit_pending' WHERE id=?").run(id);
}
export function postPendingReturnCosts(db:DatabaseSync,returnId:number,post:(db:DatabaseSync,id:number)=>void){
 const events=db.prepare(`SELECT e.id FROM business_return_lines l JOIN accounting_events e
 ON (l.movement_id IS NOT NULL AND e.source_type='stock' AND e.source_id=CAST(l.movement_id AS TEXT))
 OR (l.movement_id IS NULL AND e.source_type='return_cost' AND e.source_id=CAST(l.id AS TEXT))
 LEFT JOIN accounting_event_reviews r ON r.event_id=e.id
 WHERE l.return_id=? AND r.event_id IS NULL ORDER BY e.id`).all(returnId);
 for(const event of events)post(db,Number(event.id));
}
export function finalizeReturnEvent(db:DatabaseSync,eventId:number,post?:(db:DatabaseSync,id:number)=>void){
 const event=db.prepare('SELECT e.source_type,e.source_id,r.journal_id,j.created_by executor_id FROM accounting_events e JOIN accounting_event_reviews r ON r.event_id=e.id JOIN accounting_journals j ON j.id=r.journal_id WHERE e.id=?').get(eventId);if(!event)return;
 let returnId:number|null=null;
 if(event.source_type==='credit_note'){
  const note=db.prepare('SELECT * FROM credit_notes WHERE id=?').get(Number(event.source_id));if(!note)return;
  if(note.status==='approved'){
   db.prepare("UPDATE credit_notes SET status='posted',journal_id=? WHERE id=?").run(event.journal_id,note.id);
   applyCreditSchedule(db,Number(note.id),'credit',Number(event.executor_id));
   refreshInvoiceFinancialState(db,Number(note.invoice_id));
   const inv=db.prepare('SELECT sale_id FROM invoices WHERE id=?').get(note.invoice_id);if(inv?.sale_id)syncSalePaid(db,Number(inv.sale_id));
  }
  returnId=Number(note.return_id);
  if(post)postPendingReturnCosts(db,returnId,post);
 }else if(event.source_type==='stock'){
  const row=db.prepare("SELECT l.return_id FROM inventory_movements m JOIN business_return_lines l ON l.id=m.ref_id WHERE m.id=? AND m.ref_type='business_return'").get(Number(event.source_id));if(row)returnId=Number(row.return_id);
 }else if(event.source_type==='return_cost'){
  const row=db.prepare('SELECT return_id FROM business_return_lines WHERE id=?').get(Number(event.source_id));if(row)returnId=Number(row.return_id);
 }
 if(returnId!=null)refreshReturnCompletion(db,returnId);
}
export function returnRefundCapacity(db:DatabaseSync,returnId:number){
 const note=db.prepare("SELECT n.*,i.type FROM credit_notes n JOIN invoices i ON i.id=n.invoice_id WHERE n.return_id=? AND n.status='posted'").get(returnId);
 if(!note)throw new HttpError(409,'ابتدا اعتبارنامهٔ معتبر را در دفترکل ثبت کنید.');
 const settled=db.prepare('SELECT COALESCE(SUM(amount),0) n FROM return_settlements WHERE return_id=?').get(returnId)!.n;
 const amount=Number(note.amount)-Number(settled);
 // This is the actual current excess settlement, not a separate credit counter.
 const paid=netInvoicePaid(db,Number(note.invoice_id),note.type==='purchase'?'out':'in');
 const available=Math.max(0,paid-invoiceObligation(db,Number(note.invoice_id)).effective_total);
 const free=Number(db.prepare("SELECT COALESCE(SUM(MAX(0,amount-refunded-allocated-credit_used)),0) n FROM installment_receipt_funds WHERE invoice_id=? AND branch_id=? AND direction=? AND settled=1").get(note.invoice_id,note.branch_id,note.type==='purchase'?'out':'in')!.n);
 return {note,remaining:Math.min(amount,available,free)};
}
