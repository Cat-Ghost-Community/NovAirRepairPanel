import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import type { Session } from "@/lib/auth";
import { audit, HttpError, validate } from "@/lib/api";
import { accountingAdmin, ledgerScope } from "@/lib/accounting";
import { invoiceEvidence } from "@/lib/financial-cases";
import { verifiedSnapshot } from "@/lib/backup";
import { DB_PATH } from "@/lib/db/schema";
import { atomic } from "@/lib/db/transaction";
import { syncInvoiceState } from "@/lib/invoice";

const hash=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
type Correction={id:number;invoice_id:number;branch_id:number;evidence_hash:string;expected_paid:number;status:string;proposed_by:number;
  approved_by:number|null;backup_path:string|null;backup_sha256:string|null;rehearsal_json:string|null};
function correction(db:DatabaseSync,id:number,session:Session,cookie?:string|null) {
  const row=db.prepare("SELECT * FROM financial_corrections WHERE id=?").get(validate.id(id)) as Correction|undefined;
  if(!row) throw new HttpError(404,"پیشنهاد اصلاح یافت نشد.");
  ledgerScope(session,row.branch_id,cookie,"finance.manage");return row;
}
function unchanged(db:DatabaseSync,row:Correction) {
  const evidence=invoiceEvidence(db,row.invoice_id);
  if(!evidence||hash(JSON.stringify(evidence))!==row.evidence_hash||evidence.settled!==row.expected_paid) throw new HttpError(409,"مدارک مالی پس از پیشنهاد تغییر کرده‌اند؛ بررسی و پیشنهاد تازه لازم است.");
  return evidence;
}
export function proposeCacheCorrection(db:DatabaseSync,session:Session,invoiceId:number,reason:string,cookie?:string|null) {
  if(typeof reason!=="string"||reason.trim().length<10||reason.length>500) throw new HttpError(400,"دلیل مستند اصلاح را وارد کنید.");
  return atomic(db,()=>{
    const evidence=invoiceEvidence(db,validate.id(invoiceId));
    if(!evidence) throw new HttpError(404,"فاکتور یافت نشد.");
    const branch=Number(evidence.invoice.branch_id);ledgerScope(session,branch,cookie,"finance.manage");
    if(evidence.invoice.paid===evidence.settled) throw new HttpError(409,"ماندهٔ ذخیره‌شده با مدارک تسویه برابر است؛ اصلاح لازم نیست.");
    const json=JSON.stringify(evidence),digest=hash(json);
    const prior=db.prepare("SELECT id,status FROM financial_corrections WHERE kind='invoice_paid_cache' AND invoice_id=? AND evidence_hash=?").get(invoiceId,digest);
    if(prior) return {id:Number(prior.id),status:String(prior.status)};
    const id=Number(db.prepare(`INSERT INTO financial_corrections(kind,invoice_id,branch_id,evidence_json,evidence_hash,expected_paid,reason,proposed_by)
      VALUES('invoice_paid_cache',?,?,?,?,?,?,?)`).run(invoiceId,branch,json,digest,evidence.settled,reason.trim(),session.user.id).lastInsertRowid);
    audit(session,"propose","financial_correction",id,null,{invoice_id:invoiceId,evidence_hash:digest,expected_paid:evidence.settled,branch_id:branch});
    return {id,status:"proposed"};
  });
}
export function approveCacheCorrection(db:DatabaseSync,session:Session,id:number,cookie?:string|null) {
  accountingAdmin(session);
  return atomic(db,()=>{
    const row=correction(db,id,session,cookie);
    if(row.proposed_by===session.user.id) throw new HttpError(403,"پیشنهاددهنده نمی‌تواند اصلاح خودش را تأیید کند.");
    unchanged(db,row);
    if(row.status!=="proposed") throw new HttpError(409,"این پیشنهاد در مرحلهٔ تأیید نیست.");
    db.prepare("UPDATE financial_corrections SET status='approved',approved_by=? WHERE id=?").run(session.user.id,id);
    audit(session,"approve","financial_correction",id,null,{branch_id:row.branch_id,proposed_by:row.proposed_by});
    return {id,status:"approved"};
  });
}
/** Filesystem work deliberately occurs outside any writer transaction. The
 * approved evidence is compared against BOTH backup and live state afterwards. */
export async function rehearseCacheCorrection(db:DatabaseSync,session:Session,id:number,cookie?:string|null) {
  accountingAdmin(session);
  if(db.isTransaction) throw new Error("Correction backup cannot run inside a transaction");
  const approved=correction(db,id,session,cookie);
  if(approved.status==="rehearsed"&&approved.backup_sha256){unchanged(db,approved);return {id,status:"rehearsed",backup_sha256:approved.backup_sha256};}
  if(approved.status==="applied")return {id,status:"applied",backup_sha256:approved.backup_sha256};
  if(approved.status!=="approved") throw new HttpError(409,"ابتدا تأیید مستقل اصلاح لازم است.");
  unchanged(db,approved);
  const bytes=await verifiedSnapshot(db),backupHash=hash(bytes);
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"repaid-correction-rehearsal-"));
  let restored:DatabaseSync|undefined;
  try {
    const restorePath=path.join(temp,"restored.db");fs.writeFileSync(restorePath,bytes,{mode:0o600});
    restored=new DatabaseSync(restorePath);restored.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
    unchanged(restored,approved);
    const before=restored.prepare("SELECT total,paid,status FROM invoices WHERE id=?").get(approved.invoice_id)!;
    atomic(restored,()=>syncInvoiceState(restored!,approved.invoice_id));
    const after=restored.prepare("SELECT total,paid,status FROM invoices WHERE id=?").get(approved.invoice_id)!;
    const integrity=restored.prepare("PRAGMA integrity_check").get()!.integrity_check;
    const foreignKeys=restored.prepare("PRAGMA foreign_key_check").all().length;
    if(after.paid!==approved.expected_paid||after.total!==before.total||integrity!=="ok"||foreignKeys) throw new HttpError(409,"بازآزمایی اصلاح در نسخهٔ بازیابی‌شده موفق نبود.");
    const backupDirectory=path.join(path.dirname(DB_PATH),"financial-correction-backups");fs.mkdirSync(backupDirectory,{recursive:true,mode:0o700});
    const backupPath=path.join(backupDirectory,`${id}-${backupHash}.db`);
    if(!fs.existsSync(backupPath)) fs.writeFileSync(backupPath,bytes,{flag:"wx",mode:0o600});
    if(hash(fs.readFileSync(backupPath))!==backupHash) throw new HttpError(409,"اثر انگشت نسخهٔ پشتیبان تطبیق ندارد.");
    return atomic(db,()=>{
      const current=correction(db,id,session,cookie);unchanged(db,current);
      if(current.status!=="approved"||current.approved_by!==approved.approved_by) throw new HttpError(409,"وضعیت تأیید اصلاح تغییر کرده است.");
      db.prepare("UPDATE financial_corrections SET status='rehearsed',backup_path=?,backup_sha256=?,rehearsal_json=? WHERE id=?")
        .run(backupPath,backupHash,JSON.stringify({before,after,integrity,foreignKeys,restored:true}),id);
      audit(session,"rehearse","financial_correction",id,null,{backup_sha256:backupHash,before,after,branch_id:current.branch_id});
      return {id,status:"rehearsed",backup_sha256:backupHash};
    });
  } finally {restored?.close();fs.rmSync(temp,{recursive:true,force:true});}
}
export function applyCacheCorrection(db:DatabaseSync,session:Session,id:number,cookie?:string|null) {
  accountingAdmin(session);
  return atomic(db,()=>{
    const row=correction(db,id,session,cookie);
    if(row.status==="applied") return {id,status:"applied",duplicate:true};
    if(row.status!=="rehearsed"||!row.approved_by||row.approved_by===row.proposed_by||!row.backup_path||!row.backup_sha256||!row.rehearsal_json) throw new HttpError(409,"تأیید مستقل، پشتیبان معتبر و بازآزمایی موفق لازم است.");
    unchanged(db,row);
    if(!fs.existsSync(row.backup_path)||hash(fs.readFileSync(row.backup_path))!==row.backup_sha256) throw new HttpError(409,"نسخهٔ پشتیبان اصلاح در دسترس یا معتبر نیست.");
    const before=db.prepare("SELECT paid,status,total FROM invoices WHERE id=?").get(row.invoice_id)!;
    syncInvoiceState(db,row.invoice_id);
    const after=db.prepare("SELECT paid,status,total FROM invoices WHERE id=?").get(row.invoice_id)!;
    if(after.paid!==row.expected_paid||after.total!==before.total) throw new HttpError(409,"نتیجهٔ اصلاح با بازآزمایی تطبیق ندارد.");
    db.prepare("UPDATE financial_corrections SET status='applied',applied_at=datetime('now') WHERE id=?").run(id);
    audit(session,"apply","financial_correction",id,before,{...after,invoice_id:row.invoice_id,backup_sha256:row.backup_sha256,approved_by:row.approved_by,branch_id:row.branch_id});
    return {id,status:"applied",duplicate:false};
  });
}
