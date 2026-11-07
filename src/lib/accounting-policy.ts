import type { DatabaseSync } from "node:sqlite";
import type { Session } from "@/lib/auth";
import { accountingAdmin,accountingDate,ledgerScope } from "@/lib/accounting";
import { audit,HttpError,validate } from "@/lib/api";
import { atomic } from "@/lib/db/transaction";
import { recognitionTemplates,type RecognitionKind } from "@/lib/accounting-policy-plan";

export function proposeRecognitionPolicy(db:DatabaseSync,session:Session,input:{branch_id:number;kind:RecognitionKind;effective_date:string;reason:string},cookie?:string|null){
 accountingAdmin(session);ledgerScope(session,input.branch_id,cookie,'finance.manage');
 if(!Object.hasOwn(recognitionTemplates,input.kind))throw new HttpError(400,"قاعدهٔ شناسایی پشتیبانی نمی‌شود.");
 const date=accountingDate(input.effective_date);
 if(typeof input.reason!=='string'||input.reason.trim().length<10||input.reason.length>1000)throw new HttpError(400,"مبنای مستند سیاست را وارد کنید.");
 return atomic(db,()=>{const id=Number(db.prepare("INSERT INTO accounting_recognition_policies(branch_id,kind,effective_date,reason,proposed_by) VALUES(?,?,?,?,?)").run(input.branch_id,input.kind,date,input.reason.trim(),session.user.id).lastInsertRowid);
 audit(session,'propose','accounting_policy',id,null,{branch_id:input.branch_id,kind:input.kind,effective_date:date});return {id,status:'proposed'};});
}
export function changeRecognitionPolicy(db:DatabaseSync,session:Session,id:number,action:'approve'|'disable',cookie?:string|null){
 accountingAdmin(session);
 return atomic(db,()=>{const row=db.prepare("SELECT * FROM accounting_recognition_policies WHERE id=?").get(validate.id(id));
 if(!row)throw new HttpError(404,"سیاست یافت نشد.");ledgerScope(session,Number(row.branch_id),cookie,'finance.manage');
 if(action==='approve'){
   if(row.status!=='proposed')throw new HttpError(409,"سیاست در مرحلهٔ تأیید نیست.");
   if(row.proposed_by===session.user.id)throw new HttpError(403,"تأیید مستقل سیاست الزامی است.");
   if(!db.prepare("SELECT id FROM accounting_opening_documents WHERE branch_id=? AND status='posted'").get(row.branch_id))throw new HttpError(409,"ابتدا افتتاحیه و نقطهٔ شروع این شعبه را تأیید و اجرا کنید.");
   const template=recognitionTemplates[row.kind as RecognitionKind];
   const classifications:Record<string,string>={'1000':'asset','1100':'asset','1110':'asset','1120':'asset','1310':'asset','2010':'liability','2000':'liability','2030':'liability','2100':'liability','4000':'revenue','4010':'revenue','5000':'cogs','5010':'cogs','6020':'expense'};
   for(const code of [template.debit,template.credit])if(!db.prepare("SELECT code FROM accounting_accounts WHERE code=? AND active=1 AND classification=?").get(code,classifications[code]))throw new HttpError(409,"سرفصل فعال سیاست یا طبقه‌بندی آن معتبر نیست.");
   if(db.prepare("SELECT id FROM accounting_recognition_policies WHERE branch_id=? AND kind=? AND status='approved'").get(row.branch_id,row.kind))throw new HttpError(409,"سیاست فعال قبلی را ابتدا غیرفعال کنید.");
   db.prepare("UPDATE accounting_recognition_policies SET status='approved',approved_by=?,approved_at=?,min_event_id=(SELECT COALESCE(MAX(id),0) FROM accounting_events) WHERE id=?").run(session.user.id,new Date().toISOString(),id);
 }else{if(action!=='disable'||row.status!=='approved')throw new HttpError(409,"فقط سیاست فعال قابل غیرفعال‌کردن است.");db.prepare("UPDATE accounting_recognition_policies SET status='disabled' WHERE id=?").run(id);}
 audit(session,action,'accounting_policy',id,{status:row.status},{status:action==='approve'?'approved':'disabled',branch_id:row.branch_id});return {id,status:action==='approve'?'approved':'disabled'};
 });
}
