import type {DatabaseSync} from 'node:sqlite';
import type {Session} from '@/lib/auth';
import {auditRecord,HttpError,requirePerm,validate} from '@/lib/api';
import {createCustomerReceipt} from '@/lib/customer-payments';
import {atomic} from '@/lib/db/transaction';
import {ledgerScope} from '@/lib/accounting';

export type GroupCashInput={amount:unknown;method?:unknown;confirmed?:unknown;reference?:unknown};
export function validateGroupCash(session:Session,input:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new HttpError(400,'اطلاعات دریافت نقدی گروه معتبر نیست.');
 requirePerm(session,'payments.create');const body=input as GroupCashInput,amount=validate.amount(body.amount);
 if(amount<=0||body.method!=='cash'||body.confirmed!==true)throw new HttpError(400,'مبلغ مثبت و تأیید صریح تحویل واقعی وجه نقد لازم است؛ درخواست پرداخت، دریافت قطعی نیست.');
 if(typeof body.reference!=='string'||body.reference.trim().length<5||body.reference.length>500)throw new HttpError(400,'مرجع مستند دریافت وجه را بین ۵ تا ۵۰۰ نویسه وارد کنید.');
 return {amount,reference:body.reference.trim()};
}
/** One customer advance; no guessed per-device division, second ledger or cash. */
export function createGroupCashReceipt(db:DatabaseSync,session:Session,groupId:string,customer:number,branch:number,input:unknown){
 return atomic(db,()=>{
  ledgerScope(session,branch,null,'payments.create');
  const cash=validateGroupCash(session,input),members=db.prepare('SELECT id,customer_id,branch_id FROM repair_tickets WHERE group_receipt_id=? ORDER BY id LIMIT 101').all(groupId);
  if(!members.length||members.length>100||members.some(t=>t.customer_id!==customer||t.branch_id!==branch))throw new HttpError(409,'مشتری، شعبه یا اعضای قبض گروهی معتبر نیستند.');
  if(db.prepare('SELECT group_id FROM repair_group_receipts WHERE group_id=?').get(groupId))throw new HttpError(409,'برای این گروه قبلاً دریافت ثبت شده است؛ رسید موجود را بررسی کنید.');
  if(db.prepare('SELECT payment_id FROM repair_group_receipts WHERE branch_id=? AND evidence_reference=?').get(branch,cash.reference))throw new HttpError(409,'این مرجع دریافت نقدی در همین شعبه قبلاً ثبت شده است؛ از رسید موجود استفاده کنید.');
  const payment=createCustomerReceipt(db,session,{customer_id:customer,amount:cash.amount,method:'cash',reference:cash.reference,notes:`پیش‌دریافت تخصیص‌نیافتهٔ قبض گروهی ${groupId}`},branch);
  db.prepare('INSERT INTO repair_group_receipts(group_id,payment_id,customer_id,branch_id,confirmed_by,confirmed_at,evidence_reference,member_ids) VALUES(?,?,?,?,?,?,?,?)').run(groupId,payment.id,customer,branch,session.user.id,new Date().toISOString(),cash.reference,JSON.stringify(members.map(t=>t.id)));
  auditRecord(db,session,'confirm_cash','repair_group_receipt',payment.id,null,{group_id:groupId,amount:cash.amount,branch_id:branch,member_ids:members.map(t=>t.id)});
  const recognized=!!db.prepare("SELECT r.journal_id FROM accounting_events e JOIN accounting_event_reviews r ON r.event_id=e.id JOIN accounting_journals j ON j.id=r.journal_id AND j.state='posted' WHERE e.source_type='payment' AND e.source_id=? AND e.event_type='receipt'").get(String(payment.id));
  return {...payment,amount:cash.amount,accounting_state:recognized?'posted':'pending_review'};
 });
}
