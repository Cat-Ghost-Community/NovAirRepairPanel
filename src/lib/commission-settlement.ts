import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Session } from "@/lib/auth";
import { audit,HttpError,requirePerm,validate } from "@/lib/api";
import { accountingDate,ledgerScope } from "@/lib/accounting";
import { captureFinancialDocument } from "@/lib/accounting-events";
import { atomic } from "@/lib/db/transaction";
import { rial,sumRial } from "@/lib/money";
import { PAYROLL_SOURCE_JOINS,PAYROLL_BRANCH_SQL } from "@/lib/payroll-scope";
import {commissionPosition,correctedCommissionApproval} from '@/lib/commission-position';
import {requirePayrollManager} from '@/lib/payroll-permissions';

export function commissionEvidence(db:DatabaseSync,id:number) {
  const run=db.prepare(`SELECT r.id,r.user_id,r.base_salary,r.earned_commission,r.deductions,r.net_payable,r.source_ticket_id,
    r.status,r.paid_at,${PAYROLL_BRANCH_SQL} branch_id,s.name ticket_status FROM payroll_runs r JOIN users u ON u.id=r.user_id
    ${PAYROLL_SOURCE_JOINS} LEFT JOIN repair_statuses s ON s.id=t.status_id WHERE r.id=?`).get(validate.id(id));
  if(!run) throw new HttpError(404,"سند دستمزد یافت نشد.");
  const refunds=run.source_ticket_id==null?[]:db.prepare(`SELECT r.id,r.amount,r.payment_id FROM refunds r JOIN payments p ON p.id=r.payment_id
    LEFT JOIN invoices i ON i.id=p.invoice_id WHERE p.ticket_id=? OR i.ticket_id=? ORDER BY r.id LIMIT 1001`).all(run.source_ticket_id,run.source_ticket_id);
  if(refunds.length>1000)throw new HttpError(409,"تعداد اصلاحات مالی پذیرش نیازمند بررسی دسته‌ای است.");
  const credits=run.source_ticket_id==null?[]:db.prepare("SELECT n.id,n.amount FROM credit_notes n JOIN invoices i ON i.id=n.invoice_id WHERE i.ticket_id=? AND n.status='posted' ORDER BY n.id LIMIT 1001").all(run.source_ticket_id);
  if(credits.length>1000)throw new HttpError(409,'تعداد اعتبارنامه‌ها نیازمند بررسی دسته‌ای است.');
  const stable={id:run.id,user_id:run.user_id,base_salary:run.base_salary,earned_commission:run.earned_commission,deductions:run.deductions,net_payable:run.net_payable,
    source_ticket_id:run.source_ticket_id,branch_id:run.branch_id,ticket_status:run.ticket_status,refunds,...(credits.length?{credits}:{})};
  return {run,refunds,credits,hash:createHash("sha256").update(JSON.stringify(stable)).digest("hex")};
}
function eligible(evidence:ReturnType<typeof commissionEvidence>,corrected=false) {
  const {run,refunds,credits}=evidence;
  const gross=sumRial([rial(run.base_salary),rial(run.earned_commission)]),deductions=rial(run.deductions),net=rial(run.net_payable);
  if(deductions>gross||gross-deductions!==net||!net)throw new HttpError(409,"اجزای دستمزد با مبلغ قابل پرداخت تطبیق ندارد.");
  if(!corrected&&Number(run.earned_commission)>0 && (!run.source_ticket_id||run.ticket_status!=="Delivered"||refunds.length||credits.length))throw new HttpError(409,"پورسانتِ بدون منبع قطعی، استردادشده یا تعمیرِ تحویل‌نشده نیازمند اصلاح مصوب است؛ پرداخت مسدود شد.");
}
export function approveCommission(db:DatabaseSync,session:Session,id:number,cookie?:string|null) {
  requirePerm(session,"team.manage");requirePerm(session,"finance.manage");
  return atomic(db,()=>{
    const evidence=commissionEvidence(db,id),run=evidence.run;
    ledgerScope(session,Number(run.branch_id),cookie,"finance.manage");const corrected=correctedCommissionApproval(db,id,evidence.hash);eligible(evidence,corrected);
    if(run.user_id===session.user.id)throw new HttpError(403,"تأیید دستمزد خودتان مجاز نیست.");
    if(corrected)return {id,approved:true,corrected:true,duplicate:true};
    const prior=db.prepare("SELECT evidence_hash FROM commission_approvals WHERE run_id=?").get(id);
    if(prior){if(prior.evidence_hash!==evidence.hash)throw new HttpError(409,"مدارک تأیید دستمزد تغییر کرده‌اند؛ اصلاح مصوب لازم است.");return {id,approved:true,duplicate:true};}
    if(run.status!=="pending")throw new HttpError(409,"فقط دستمزد در انتظار و فاقد تأیید قدیمی قابل تأیید است.");
    db.prepare("INSERT INTO commission_approvals(run_id,branch_id,approved_by,amount,evidence_hash) VALUES(?,?,?,?,?)").run(id,run.branch_id,session.user.id,run.net_payable,evidence.hash);
    db.prepare("UPDATE payroll_runs SET status='approved' WHERE id=?").run(id);
    audit(session,"approve","commission",id,{status:run.status},{status:"approved",amount:run.net_payable,branch_id:run.branch_id});
    return {id,approved:true,duplicate:false};
  });
}
/** Unrecognized drafts can be cancelled; recognized liabilities require a reviewed compensating document. */
export function cancelPendingCommission(db:DatabaseSync,session:Session,id:number,input:{reason:unknown;reference:unknown},cookie?:string|null){
 requirePayrollManager(session);
 return atomic(db,()=>{
  requirePayrollManager(session);
  const {run}=commissionEvidence(db,id);ledgerScope(session,Number(run.branch_id),cookie,'finance.view');
  if(typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>1000||typeof input.reference!=='string'||input.reference.trim().length<5||input.reference.length>200)throw new HttpError(400,'دلیل لغو و مرجع تصمیم را مستند وارد کنید.');
  if(run.user_id===session.user.id)throw new HttpError(403,'تغییر دستمزد خودتان به تصمیم مستقل نیاز دارد.');
  if(run.status==='cancelled')return {ok:true,id,cancelled:true,duplicate:true};
  const guarded=db.prepare(`SELECT 1 WHERE EXISTS(SELECT 1 FROM commission_approvals WHERE run_id=?)
   OR EXISTS(SELECT 1 FROM commission_payments WHERE run_id=?)
   OR EXISTS(SELECT 1 FROM commission_corrections WHERE run_id=? AND state!='rejected')
   OR EXISTS(SELECT 1 FROM accounting_events e JOIN accounting_event_reviews review ON review.event_id=e.id WHERE e.source_type='commission' AND e.source_id=?)`).get(id,id,id,String(id));
  if(run.status!=='pending'||run.paid_at||guarded)throw new HttpError(409,'این پورسانت تأیید یا ثبت مالی شده است؛ ابطال باید از مسیر اصلاح مصوب انجام شود.');
  db.prepare("UPDATE payroll_runs SET status='cancelled' WHERE id=? AND status='pending'").run(id);
  captureFinancialDocument(db,'commission',id,'cancellation',session.user.id,Number(run.branch_id));
  audit(session,'cancel','commission',id,{status:run.status},{status:'cancelled',reason:input.reason.trim(),reference:input.reference.trim(),branch_id:run.branch_id});
  return {ok:true,id,cancelled:true,duplicate:false};
 });
}
export function recordCommissionPayment(db:DatabaseSync,session:Session,id:number,input:{amount:unknown;method:string;payment_date:string;document_reference:string;confirmed:boolean},cookie?:string|null) {
  requirePerm(session,"team.manage");requirePerm(session,"finance.manage");requirePerm(session,"payments.create");
  return atomic(db,()=>{
    const evidence=commissionEvidence(db,id),run=evidence.run;
    ledgerScope(session,Number(run.branch_id),cookie,"finance.manage");const corrected=correctedCommissionApproval(db,id,evidence.hash),position=commissionPosition(db,id);eligible(evidence,corrected);
    const approval=db.prepare("SELECT * FROM commission_approvals WHERE run_id=?").get(id);
    if(!corrected&&(!approval||approval.evidence_hash!==evidence.hash||approval.amount!==run.net_payable))throw new HttpError(409,"تأیید مستندِ معتبر برای دستمزد وجود ندارد.");
    if(!corrected&&!["approved","partially_paid"].includes(String(run.status)))throw new HttpError(409,"وضعیت دستمزد اجازهٔ پرداخت جدید نمی‌دهد.");
    const amount=rial(input.amount),date=accountingDate(input.payment_date);
    if(input.confirmed!==true||!['cash','card','transfer'].includes(input.method)||typeof input.document_reference!=="string"||input.document_reference.trim().length<3||input.document_reference.length>200)throw new HttpError(400,"روش، تاریخ و مرجع پرداختِ انجام‌شده را صریح تأیید کنید.");
    if(db.prepare("SELECT id FROM commission_payments WHERE run_id=? AND method=? AND document_reference=?").get(id,input.method,input.document_reference.trim()))throw new HttpError(409,"این مرجع پرداخت برای دستمزد قبلاً ثبت شده است.");
    const paid=rial(db.prepare("SELECT COALESCE(SUM(amount),0) amount FROM commission_payments WHERE run_id=?").get(id)!.amount);
    if(!amount||amount>Number(position.payable))throw new HttpError(400,"مبلغ پرداخت از ماندهٔ تأییدشده بیشتر است یا معتبر نیست.");
    const paymentId=Number(db.prepare(`INSERT INTO commission_payments(run_id,branch_id,user_id,amount,method,payment_date,document_reference,recorded_by)
      VALUES(?,?,?,?,?,?,?,?)`).run(id,run.branch_id,run.user_id,amount,input.method,date,input.document_reference.trim(),session.user.id).lastInsertRowid);
    const status=Number(position.net_paid)+amount===position.effective_net?"paid":"partially_paid";
    db.prepare("UPDATE payroll_runs SET status=?,paid_at=CASE WHEN ?='paid' THEN datetime('now') ELSE NULL END WHERE id=?").run(status,status,id);
    captureFinancialDocument(db,"commission_payment",paymentId,"disbursement",session.user.id,Number(run.branch_id));
    audit(session,"disburse","commission",id,{paid},{payment_id:paymentId,amount,paid:sumRial([paid,amount]),status,branch_id:run.branch_id});
    return {id,payment_id:paymentId,amount,paid:sumRial([paid,amount]),remaining:Number(position.payable)-amount,status};
  });
}
