import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Session } from "@/lib/auth";
import { audit,HttpError,validate } from "@/lib/api";
import { ledgerScope,normalizeJournal,validateLedgerLines,type JournalLine } from "@/lib/accounting";
import { atomic } from "@/lib/db/transaction";

function editable(db:DatabaseSync,session:Session,id:number,cookie?:string|null){
  const row=db.prepare("SELECT * FROM accounting_journals WHERE id=?").get(validate.id(id));
  if(!row)throw new HttpError(404,"سند حسابداری یافت نشد.");
  ledgerScope(session,Number(row.branch_id),cookie,"finance.manage");
  if(row.state!=="draft"||row.source_type!=="manual")throw new HttpError(409,"فقط پیش‌نویس دستی قابل اصلاح یا ابطال است.");
  return row;
}
export function editJournalDraft(db:DatabaseSync,session:Session,id:number,input:{posting_date:string;memo:string;lines:JournalLine[];expected_hash:string},cookie?:string|null){
  return atomic(db,()=>{
    const row=editable(db,session,id,cookie);
    if(db.prepare("SELECT journal_id FROM accounting_journal_voids WHERE journal_id=?").get(id))throw new HttpError(409,"پیش‌نویس باطل‌شده قابل ویرایش نیست.");
    if(typeof input.expected_hash!=="string"||input.expected_hash!==row.request_hash)throw new HttpError(409,"نسخهٔ پیش‌نویس تغییر کرده است؛ دوباره سند را دریافت کنید.");
    const normalized=normalizeJournal({branch_id:Number(row.branch_id),posting_date:input.posting_date,memo:input.memo,lines:input.lines,
      event_key:String(row.event_key),source_type:String(row.source_type),source_id:String(row.source_id),reversal_of:null});
    const period=db.prepare("SELECT id FROM accounting_periods WHERE status='open' AND ? BETWEEN start_date AND end_date").get(normalized.posting_date);
    if(!period)throw new HttpError(409,"دورهٔ باز برای تاریخ پیش‌نویس وجود ندارد.");
    validateLedgerLines(db,normalized.lines);
    const before={memo:row.memo,posting_date:row.posting_date,request_hash:row.request_hash,lines:db.prepare("SELECT * FROM accounting_lines WHERE journal_id=? ORDER BY position").all(id)};
    const digest=createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
    db.prepare("UPDATE accounting_journals SET period_id=?,posting_date=?,memo=?,request_hash=? WHERE id=? AND state='draft'").run(period.id,normalized.posting_date,normalized.memo,digest,id);
    db.prepare("DELETE FROM accounting_lines WHERE journal_id=?").run(id);
    const insert=db.prepare(`INSERT INTO accounting_lines(journal_id,position,account_code,debit,credit,memo,customer_id,supplier_id,employee_id,part_id,bank_account_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
    for(const line of normalized.lines)insert.run(id,line.position,line.account_code,line.debit,line.credit,line.memo,line.customer_id,line.supplier_id,line.employee_id,line.part_id,line.bank_account_id);
    audit(session,"edit_draft","accounting_journal",id,before,{memo:normalized.memo,posting_date:normalized.posting_date,request_hash:digest,lines:normalized.lines,branch_id:row.branch_id});
    return {id,state:"draft",request_hash:digest};
  });
}
export function voidJournalDraft(db:DatabaseSync,session:Session,id:number,reason:string,cookie?:string|null){
  if(typeof reason!=="string"||reason.trim().length<5||reason.length>500)throw new HttpError(400,"دلیل ابطال پیش‌نویس را وارد کنید.");
  return atomic(db,()=>{
    const row=editable(db,session,id,cookie);
    const prior=db.prepare("SELECT reason FROM accounting_journal_voids WHERE journal_id=?").get(id);
    if(prior){if(prior.reason!==reason.trim())throw new HttpError(409,"پیش‌نویس با دلیل دیگری باطل شده است.");return {id,state:"voided",duplicate:true};}
    db.prepare("INSERT INTO accounting_journal_voids(journal_id,reason,actor_id) VALUES(?,?,?)").run(id,reason.trim(),session.user.id);
    audit(session,"void_draft","accounting_journal",id,{state:"draft"},{state:"voided",reason:reason.trim(),branch_id:row.branch_id});
    return {id,state:"voided",duplicate:false};
  });
}
