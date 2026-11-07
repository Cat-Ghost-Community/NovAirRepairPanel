import {createHash} from 'node:crypto';import type {DatabaseSync} from 'node:sqlite';import type {Session} from '@/lib/auth';
import {HttpError,requirePerm,validate,auditRecord} from '@/lib/api';
import {accountingDate,ledgerScope,createJournal,postJournal} from '@/lib/accounting';
import {atomic} from '@/lib/db/transaction';
import {commissionEvidence} from '@/lib/commission-settlement';import {commissionPosition} from '@/lib/commission-position';
import {captureFinancialDocument} from '@/lib/accounting-events';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function text(value:unknown,label:string){if(typeof value!=='string'||value.trim().length<5||value.length>1000)throw new HttpError(400,`${label} را مستند وارد کنید.`);return value.trim();}
function scope(db:DatabaseSync,session:Session,id:number,cookie?:string|null){requirePerm(session,'team.manage');requirePerm(session,'finance.manage');const evidence=commissionEvidence(db,validate.id(id));ledgerScope(session,Number(evidence.run.branch_id),cookie,'finance.manage');return evidence;}
function basis(db:DatabaseSync,runId:number,kind:'reduction'|'reinstatement'|'recovery',amount:number,reverses:number|null){
 const evidence=commissionEvidence(db,runId),run=evidence.run,position=commissionPosition(db,runId);
 if(!run.source_ticket_id||Number(run.base_salary)!==0||Number(run.deductions)!==0)throw new HttpError(409,'این گردش برای پورسانت مستقلِ دارای پذیرش است؛ حقوق ثابت یا تلفیقی به تفکیک و سند اصلاحی مستقل نیاز دارد.');
 if((run.paid_at||['paid','partially_paid'].includes(String(run.status)))&&Number(position.paid)===0)throw new HttpError(409,'پرداخت تاریخی فاقد اسناد وجه است؛ ابتدا مدارک واقعی را تطبیق دهید.');
 const accrual=db.prepare(`SELECT j.id journal_id FROM accounting_events e JOIN accounting_event_reviews r ON r.event_id=e.id JOIN accounting_journals j ON j.id=r.journal_id
 WHERE e.source_type='commission' AND e.source_id=? AND e.branch_id=? AND e.event_type='accrual' AND j.state='posted'`).get(String(runId),run.branch_id);
 if(!accrual)throw new HttpError(409,'تعهد اصلی پورسانت در دفترکل نهایی نشده است.');
 const lines=db.prepare('SELECT l.account_code,l.debit,l.credit,l.employee_id,a.classification FROM accounting_lines l JOIN accounting_accounts a ON a.code=l.account_code WHERE l.journal_id=? ORDER BY l.position').all(accrual.journal_id);
 const expense=lines.filter(l=>Number(l.debit)>0&&['expense','cogs'].includes(String(l.classification)));
 if(expense.length!==1||expense[0].debit!==run.net_payable||lines.length!==2||!lines.some(l=>l.account_code==='2030'&&l.credit===run.net_payable&&l.employee_id===run.user_id))throw new HttpError(409,'تفکیک تعهد اولیه برای این اصلاح روشن نیست؛ تخصیص هزینهٔ مصوب لازم است.');
 const payouts=db.prepare(`SELECT p.id,p.amount,p.branch_id,r.journal_id,j.state FROM commission_payments p LEFT JOIN accounting_events e ON e.source_type='commission_payment' AND e.source_id=CAST(p.id AS TEXT)
 LEFT JOIN accounting_event_reviews r ON r.event_id=e.id LEFT JOIN accounting_journals j ON j.id=r.journal_id WHERE p.run_id=? ORDER BY p.id`).all(runId);
 if(payouts.some(p=>p.branch_id!==run.branch_id||p.state!=='posted'))throw new HttpError(409,'ثبت دفترکل یا انتساب برخی پرداخت‌های پورسانت کامل نیست.');
 const corrections=db.prepare("SELECT id,kind,amount,reverses_id,journal_id FROM commission_corrections WHERE run_id=? AND state='posted' ORDER BY id").all(runId);
 if(!amount||kind==='reduction'&&amount>Number(position.effective_commission)||kind==='recovery'&&amount>Number(position.recoverable))throw new HttpError(409,'مبلغ از پورسانتِ باقی‌مانده یا مطالبهٔ قابل بازیافت بیشتر است.');
 const reversed=reverses==null?null:db.prepare("SELECT c.id,c.amount-COALESCE((SELECT SUM(amount) FROM commission_corrections WHERE reverses_id=c.id AND state='posted'),0) remaining FROM commission_corrections c WHERE c.id=? AND c.run_id=? AND c.kind='reduction' AND c.state='posted'").get(reverses,runId);
 if(kind==='reinstatement'&&(!reversed||amount>Number(reversed.remaining)))throw new HttpError(409,'اعادهٔ پورسانت از ماندهٔ اصلاح قبلی بیشتر است.');
 const liability=kind==='reduction'?Math.min(amount,Number(position.payable)):kind==='reinstatement'?amount-Math.min(amount,Number(position.recoverable)):0;
 const recovery=amount-liability;
 if(recovery>0&&!db.prepare("SELECT code FROM accounting_accounts WHERE code='1320' AND active=1 AND classification='asset'").get())throw new HttpError(409,'سرفصل فعال مطالبات کارکنان (۱۳۲۰) را با مجوز مدیر مالی آماده کنید.');
 return {evidence_hash:evidence.hash,run,position,accrual,expense_account:String(expense[0].account_code),payouts,corrections,reversed,liability,recovery};
}
export function proposeCommissionCorrection(db:DatabaseSync,session:Session,input:{run_id:number;kind:'reduction'|'reinstatement'|'recovery';amount:unknown;reverses_id?:number;posting_date:string;reason:string;evidence_reference:string},cookie?:string|null){return atomic(db,()=>{
 const evidence=scope(db,session,input.run_id,cookie);if(!['reduction','reinstatement','recovery'].includes(input.kind)||(input.kind==='reinstatement')!==(input.reverses_id!=null))throw new HttpError(400,'نوع اصلاح و سند مرجع معتبر نیست.');
 const amount=validate.amount(input.amount),date=accountingDate(input.posting_date),reason=text(input.reason,'دلیل اصلاح'),reference=text(input.evidence_reference,'مرجع تصمیم مصوب'),snapshot=basis(db,input.run_id,input.kind,amount,input.reverses_id??null);
 const id=Number(db.prepare(`INSERT INTO commission_corrections(run_id,branch_id,user_id,kind,reverses_id,amount,expense_account,liability_amount,recovery_amount,posting_date,reason,evidence_reference,basis_hash,snapshot_json,snapshot_hash,proposed_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.run_id,evidence.run.branch_id,evidence.run.user_id,input.kind,input.reverses_id??null,amount,snapshot.expense_account,snapshot.liability,snapshot.recovery,date,reason,reference,evidence.hash,JSON.stringify(snapshot),hash(snapshot),session.user.id).lastInsertRowid);
 auditRecord(db,session,'propose','commission_correction',id,null,{run_id:input.run_id,kind:input.kind,amount,branch_id:evidence.run.branch_id});return {id,state:'proposed'};
});}
function doc(db:DatabaseSync,session:Session,id:number,cookie?:string|null){const row=db.prepare('SELECT * FROM commission_corrections WHERE id=?').get(validate.id(id));if(!row)throw new HttpError(404,'سند اصلاح پورسانت یافت نشد.');scope(db,session,Number(row.run_id),cookie);return row;}
function fresh(db:DatabaseSync,row:Record<string,unknown>){const snapshot=basis(db,Number(row.run_id),row.kind as 'reduction'|'reinstatement'|'recovery',Number(row.amount),row.reverses_id==null?null:Number(row.reverses_id));if(hash(snapshot)!==row.snapshot_hash||hash(JSON.parse(String(row.snapshot_json)))!==row.snapshot_hash)throw new HttpError(409,'مدارک، پرداخت‌ها یا ماندهٔ پورسانت تغییر کرده است؛ پیشنهاد تازه لازم است.');}
export function decideCommissionCorrection(db:DatabaseSync,session:Session,id:number,approve:boolean,cookie?:string|null){return atomic(db,()=>{
 const row=doc(db,session,id,cookie);if(row.state!=='proposed')throw new HttpError(409,'سند در مرحلهٔ تصمیم نیست.');
 if(approve){if(row.proposed_by===session.user.id||row.user_id===session.user.id)throw new HttpError(403,'تأیید باید مستقل از پیشنهاددهنده و دریافت‌کنندهٔ پورسانت باشد.');fresh(db,row);}
 db.prepare('UPDATE commission_corrections SET state=?,approved_by=?,approved_at=? WHERE id=?').run(approve?'approved':'rejected',approve?session.user.id:null,approve?new Date().toISOString():null,id);
 auditRecord(db,session,approve?'approve':'reject','commission_correction',id,{state:row.state},{branch_id:row.branch_id});return {id,state:approve?'approved':'rejected'};
});}
export function postCommissionCorrection(db:DatabaseSync,session:Session,id:number,input:{confirmed?:boolean;settlement_reference?:string},cookie?:string|null){return atomic(db,()=>{
 const row=doc(db,session,id,cookie);if(row.state==='posted')return {id,state:'posted',duplicate:true};if(row.state!=='approved')throw new HttpError(409,'تأیید مستقلِ اصلاح لازم است.');fresh(db,row);
 const reference=row.kind==='recovery'?text(input.settlement_reference,'مرجع وجه واقعاً بازیافت‌شده'):null;
 if(row.kind==='recovery')requirePerm(session,'payments.create');
 if(row.kind==='recovery'&&input.confirmed!==true)throw new HttpError(400,'دریافت واقعی وجه بازیافت‌شده را صریح تأیید کنید؛ کسر خودکار از حقوق مجاز نیست.');
 if(reference&&db.prepare("SELECT id FROM commission_corrections WHERE run_id=? AND settlement_reference=? AND state='posted'").get(row.run_id,reference))throw new HttpError(409,'این مرجع وجه قبلاً ثبت شده است.');
 const event=captureFinancialDocument(db,'commission_correction',id,String(row.kind),session.user.id,Number(row.branch_id));
 const amount=Number(row.amount),liability=Number(row.liability_amount),recovery=Number(row.recovery_amount),employee=Number(row.user_id);
 const lines=row.kind==='recovery'?[{account_code:'1000',debit:amount},{account_code:'1320',credit:amount,employee_id:employee}]:row.kind==='reduction'?[
  ...(liability?[{account_code:'2030',debit:liability,employee_id:employee}]:[]),...(recovery?[{account_code:'1320',debit:recovery,employee_id:employee}]:[]),{account_code:String(row.expense_account),credit:amount}
 ]:[{account_code:String(row.expense_account),debit:amount},...(liability?[{account_code:'2030',credit:liability,employee_id:employee}]:[]),...(recovery?[{account_code:'1320',credit:recovery,employee_id:employee}]:[])];
 const journal=createJournal(db,session,{branch_id:Number(row.branch_id),posting_date:String(row.posting_date),memo:String(row.reason),event_key:`financial-event:${event}`,source_type:'financial_event',source_id:String(event),lines},cookie);postJournal(db,session,journal.id,cookie);
 db.prepare('INSERT INTO accounting_event_reviews(event_id,journal_id,reason,approved_by) VALUES(?,?,?,?)').run(event,journal.id,`تصمیم مستقل سند اصلاح پورسانت ${id}`,row.approved_by);
 db.prepare("UPDATE commission_corrections SET state='posted',journal_id=?,settlement_reference=? WHERE id=?").run(journal.id,reference,id);
 auditRecord(db,session,'post','commission_correction',id,{state:row.state},{kind:row.kind,amount,journal_id:journal.id,approved_by:row.approved_by,branch_id:row.branch_id});return {id,state:'posted',journal_id:journal.id,duplicate:false};
});}
