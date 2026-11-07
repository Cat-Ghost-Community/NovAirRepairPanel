import type {DatabaseSync} from 'node:sqlite';
import {getDb} from './db/schema';
import {canUser,flagEnabledFor,type Session} from './auth';
import {activeBranch,canSwitchBranch} from './branch';
import {HttpError,auditRecord,requirePerm} from './api';
import {atomic} from './db/transaction';
import {durableOperation} from './idempotency';
import type {RepairWorkflowMode} from './repair-workflow-shared';

export function repairWorkflow(db:DatabaseSync,branchId:number){
 const row=db.prepare('SELECT mode,revision FROM branch_repair_workflows WHERE branch_id=?').get(branchId);
 return {mode:(row?.mode??'legacy') as RepairWorkflowMode,revision:Number(row?.revision??0)};
}
export function currentWorkflowActor(db:DatabaseSync,session:Session){
 const user=db.prepare('SELECT id,role,branch_id,is_active FROM users WHERE id=?').get(session.user.id);
 if(!user||user.is_active!==1||user.role!==session.user.role||user.branch_id!==session.user.branch_id)throw new HttpError(409,'حساب یا شعبهٔ شما تغییر کرده است؛ دوباره وارد شوید.');
 if(activeBranch(session).branchId===-1)throw new HttpError(403,'شعبهٔ محل اشتغال شما فعال نیست.');
}
export function workflowSupervisor(db:DatabaseSync,session:Session,branchId:number){
 if(canSwitchBranch(session.user.role))return true;
 if(session.user.branch_id!==branchId)return false;
 return session.user.role==='manager'||!!db.prepare('SELECT 1 FROM repair_workflow_supervisors WHERE branch_id=? AND user_id=?').get(branchId,session.user.id);
}
export function canAssignRepair(session:Session,branchId:number,db=getDb()){
 const policy=repairWorkflow(db,branchId);
 return policy.mode==='legacy'?canUser(session,'repairs.assign'):workflowSupervisor(db,session,branchId)&&canUser(session,'repairs.assign');
}
export function repairReadAssignedOnly(session:Session){
 if(session.user.role!=='technician')return false;
 const branch=Number(session.user.branch_id??-1),db=getDb(),policy=repairWorkflow(db,branch);
 return policy.mode==='legacy'?flagEnabledFor('technician','repairs.only_assigned'):!workflowSupervisor(db,session,branch);
}
/** Also invoked after async request body/file reads so reassignment cannot race a stale tab. */
export function enforceRepairWorkflow(session:Session,ticketId:number,mutation=false,db=getDb()){
 const row=db.prepare('SELECT id,branch_id,technician_id,technician2_id FROM repair_tickets WHERE id=?').get(ticketId);
 if(!row)throw new HttpError(404,'پذیرش یافت نشد.');
 if(!canSwitchBranch(session.user.role)&&row.branch_id!==session.user.branch_id)throw new HttpError(404,'پذیرش یافت نشد.');
 if(session.user.role==='technician'){
  const policy=repairWorkflow(db,Number(row.branch_id));
  const restricted=mutation?policy.mode!=='legacy'||repairReadAssignedOnly(session):repairReadAssignedOnly(session);
  if(restricted&&row.technician_id!==session.user.id&&row.technician2_id!==session.user.id)throw new HttpError(403,'این دستگاه به شما ارجاع نشده است؛ با مدیر یا سرپرست شعبه تماس بگیرید.');
 }
 return row;
}
export function requireAssignmentAuthority(db:DatabaseSync,session:Session,branchId:number,targetId?:number){
 currentWorkflowActor(db,session);
 if(!canSwitchBranch(session.user.role)&&session.user.branch_id!==branchId)throw new HttpError(403,'ارجاع خارج از شعبهٔ محل اشتغال شما مجاز نیست.');
 const policy=repairWorkflow(db,branchId);
 if(policy.mode==='legacy')requirePerm(session,'repairs.assign');
 else{
  if(!workflowSupervisor(db,session,branchId))throw new HttpError(403,'انتخاب تعمیرکار فقط برای مدیر یا سرپرست تعیین‌شده مجاز است.');
  requirePerm(session,'repairs.assign');
  if(session.user.role==='technician'&&targetId===session.user.id)throw new HttpError(403,'سرپرست تعمیرکار نمی‌تواند دستگاه را به خودش ارجاع دهد؛ مدیر باید این ارجاع را ثبت کند.');
 }
 return policy;
}
export function workflowSettings(db:DatabaseSync,session:Session,branchId:number,search='',page=1){
 const scope=activeBranch(session);
 if(!scope.all&&scope.branchId!==branchId)throw new HttpError(404,'شعبه یافت نشد.');
 if(!db.prepare('SELECT 1 FROM branches WHERE id=? AND is_active=1').get(branchId))throw new HttpError(404,'شعبهٔ فعال یافت نشد.');
 const policy=repairWorkflow(db,branchId);
 const impact=db.prepare(`SELECT COUNT(*) active, SUM(CASE WHEN t.technician_id IS NULL THEN 1 ELSE 0 END) unassigned,
 SUM(CASE WHEN t.technician_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users u WHERE u.id=t.technician_id AND u.is_active=1 AND u.branch_id=t.branch_id) THEN 1 ELSE 0 END) invalid_assignments,
 (SELECT COUNT(*) FROM time_entries te JOIN repair_tickets rt ON rt.id=te.ticket_id WHERE rt.branch_id=? AND te.ended_at IS NULL) open_timers
 FROM repair_tickets t JOIN repair_statuses s ON s.id=t.status_id WHERE t.branch_id=? AND s.category!='closed'`).get(branchId,branchId);
 const supervisors=db.prepare('SELECT user_id FROM repair_workflow_supervisors WHERE branch_id=? ORDER BY user_id').all(branchId).map(r=>Number(r.user_id));
 const where="branch_id=? AND is_active=1 AND role NOT IN ('owner','admin','manager') AND (name LIKE ? OR email LIKE ?)",like=`%${search.slice(0,100)}%`;
 const employee_total=Number(db.prepare(`SELECT COUNT(*) n FROM users WHERE ${where}`).get(branchId,like,like)?.n??0);
 const employee_page=Math.min(Math.max(1,Math.floor(page)||1),Math.max(1,Math.ceil(employee_total/20)));
 const employees=db.prepare(`SELECT id,name,role FROM users WHERE ${where} ORDER BY name,id LIMIT 20 OFFSET ?`).all(branchId,like,like,(employee_page-1)*20);
 const supervisor_users=db.prepare('SELECT u.id,u.name,u.role,u.is_active,u.branch_id FROM repair_workflow_supervisors s JOIN users u ON u.id=s.user_id WHERE s.branch_id=? ORDER BY u.name').all(branchId);
 return {branch_id:branchId,...policy,supervisors,supervisor_users,employees,employee_total,employee_page,impact};
}
export function saveWorkflow(db:DatabaseSync,session:Session,input:{branch_id:number;mode:RepairWorkflowMode;revision:number;supervisors:number[];key:unknown}){
 requirePerm(session,'settings.edit');currentWorkflowActor(db,session);
 if(!canSwitchBranch(session.user.role))throw new HttpError(403,'انتخاب گردش کار فقط برای مدیر شرکت مجاز است.');
 if(!['legacy','managed','shared'].includes(input.mode)||!Number.isSafeInteger(input.revision)||!Array.isArray(input.supervisors)||input.supervisors.length>100)throw new HttpError(400,'تنظیمات گردش کار معتبر نیست.');
 const ids=[...new Set(input.supervisors)];
 return durableOperation(db,{actorId:session.user.id,branchId:input.branch_id,operation:'repair.workflow.configure',key:input.key,payload:input},()=>{
  const before=workflowSettings(db,session,input.branch_id);
  if(before.revision!==input.revision)throw new HttpError(409,'تنظیمات توسط مدیر دیگری تغییر کرده است؛ دوباره بارگذاری کنید.');
  for(const id of ids)if(!Number.isSafeInteger(id)||!db.prepare("SELECT 1 FROM users WHERE id=? AND branch_id=? AND is_active=1 AND role NOT IN ('owner','admin','manager')").get(id,input.branch_id))throw new HttpError(400,'سرپرست باید کارمند فعال همین شعبه باشد.');
  db.prepare(`INSERT INTO branch_repair_workflows(branch_id,mode,revision,updated_by) VALUES(?,?,?,?) ON CONFLICT(branch_id) DO UPDATE SET mode=excluded.mode,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=datetime('now')`).run(input.branch_id,input.mode,before.revision+1,session.user.id);
  db.prepare('DELETE FROM repair_workflow_supervisors WHERE branch_id=?').run(input.branch_id);
  for(const id of ids)db.prepare('INSERT INTO repair_workflow_supervisors(branch_id,user_id,granted_by) VALUES(?,?,?)').run(input.branch_id,id,session.user.id);
  auditRecord(db,session,'workflow_configure','branch',input.branch_id,{mode:before.mode,revision:before.revision,supervisors:before.supervisors},{mode:input.mode,revision:before.revision+1,supervisors:ids,branch_id:input.branch_id});
  return workflowSettings(db,session,input.branch_id);
 });
}
export type AssignmentInput={ticketId:number;targetId:number;expect:number|null;version?:number;workflowRevision?:number;reason?:string|null;pauseTimers?:boolean;clearHelper?:boolean;helperId?:number|null;claim?:boolean};
/** The ticket row remains authoritative. History, timers, audit and notifications commit with it. */
export function changeRepairAssignment(db:DatabaseSync,session:Session,input:AssignmentInput){
 return atomic(db,()=>{
  currentWorkflowActor(db,session);
  const row=db.prepare('SELECT t.*,s.name status_name,s.category status_category FROM repair_tickets t JOIN repair_statuses s ON s.id=t.status_id WHERE t.id=?').get(input.ticketId);
  if(!row)throw new HttpError(404,'پذیرش یافت نشد.');
  const branch=Number(row.branch_id),policy=repairWorkflow(db,branch);
  if(input.claim){
   if(policy.mode!=='shared'||session.user.role!=='technician'||session.user.branch_id!==branch||row.technician_id!=null||row.technician2_id!=null||input.targetId!==session.user.id)throw new HttpError(409,'این دستگاه دیگر در صف آزاد شما نیست.');
   requirePerm(session,'repairs.view');
  }else requireAssignmentAuthority(db,session,branch,input.targetId);
  if(policy.mode!=='legacy'&&(input.version!==row.assignment_version||input.workflowRevision!==policy.revision))throw new HttpError(409,'ارجاع یا گردش کار تغییر کرده است؛ صفحه را تازه کنید.');
  if(input.expect!==row.technician_id)throw new HttpError(409,'ارجاع این دستگاه هم‌اکنون تغییر کرده است؛ صفحه را تازه کنید.');
  if(row.status_category==='closed'||['Delivered','Cancelled'].includes(String(row.status_name))||policy.mode!=='legacy'&&row.delivered_at!=null)throw new HttpError(409,'پذیرش بسته یا تحویل‌شده از مسیر اصلاح یا گارانتی بررسی می‌شود؛ ارجاع عادی مجاز نیست.');
  if(policy.mode!=='legacy'&&row.technician_id!==input.targetId&&db.prepare('SELECT 1 FROM payroll_runs WHERE source_ticket_id=? AND earned_commission>0 LIMIT 1').get(input.ticketId))throw new HttpError(409,'کمیسیون ثبت‌شده وجود دارد؛ پیش از تغییر تعمیرکار، اصلاح جبران خدمت باید از مسیر مجاز بررسی شود.');
  const target=db.prepare("SELECT id,name FROM users WHERE id=? AND role='technician' AND is_active=1 AND branch_id=?").get(input.targetId,branch);
  if(!target)throw new HttpError(400,'تعمیرکار فعال همین شعبه را انتخاب کنید.');
  let helper=input.helperId===undefined?(input.clearHelper?null:row.technician2_id):input.helperId;
  if(input.helperId!=null&&(!Number.isSafeInteger(input.helperId)||input.helperId===input.targetId))throw new HttpError(400,'تعمیرکار دوم باید با تعمیرکار اصلی متفاوت باشد.');
  if(input.helperId===undefined&&row.technician_id!==input.targetId&&(helper===row.technician_id||helper===input.targetId))helper=null;
  if(helper===session.user.id&&session.user.role==='technician'&&policy.mode!=='legacy'&&row.technician2_id!==helper)throw new HttpError(403,'سرپرست تعمیرکار نمی‌تواند خودش را به‌عنوان تعمیرکار دوم انتخاب کند.');
  if(helper!=null&&!db.prepare("SELECT 1 FROM users WHERE id=? AND role='technician' AND is_active=1 AND branch_id=?").get(helper,branch))throw new HttpError(409,'تعمیرکار دوم در این شعبه فعال نیست؛ حذف تعمیرکار دوم را انتخاب کنید.');
  const unchanged=row.technician_id===input.targetId&&helper===row.technician2_id;
  if(unchanged&&!input.pauseTimers)return {ticket_id:input.ticketId,ok:true,skipped:true};
  const reason=String(input.reason??'').trim();
  if(row.technician_id!=null&&!reason&&(policy.mode!=='legacy'||!['New','Received'].includes(String(row.status_name))))throw new HttpError(400,'برای ارجاع مجدد، دلیل را وارد کنید.');
  if(reason.length>1000)throw new HttpError(400,'دلیل ارجاع بیش از حد طولانی است.');
  const timers=db.prepare('SELECT id,user_id,started_at FROM time_entries WHERE ticket_id=? AND ended_at IS NULL').all(input.ticketId).filter(t=>t.user_id!==input.targetId&&t.user_id!==helper);
  if(unchanged&&timers.length===0)return {ticket_id:input.ticketId,ok:true,skipped:true};
  if(timers.length&&!input.pauseTimers)throw new HttpError(409,'زمان‌سنج باز وجود دارد؛ توقف زمان‌سنج و تحویل کار را صریحاً تأیید کنید.');
  for(const timer of timers){const text=String(timer.started_at??'').replace(' ','T'),started=Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(text)?text:text+'Z');if(!Number.isFinite(started)||started>Date.now())throw new HttpError(409,'سابقهٔ زمان‌سنج معتبر نیست؛ پیش از تحویل کار باید بررسی شود.');}
  for(const timer of timers)db.prepare("UPDATE time_entries SET ended_at=datetime('now'),minutes_active=MAX(1,CAST(ROUND((julianday('now')-julianday(started_at))*1440) AS INTEGER)) WHERE id=? AND ended_at IS NULL").run(timer.id);
  db.prepare("UPDATE repair_tickets SET technician_id=?,technician2_id=?,assignment_version=assignment_version+1,updated_at=datetime('now') WHERE id=? AND assignment_version=?").run(input.targetId,helper,input.ticketId,Number(row.assignment_version));
  db.prepare('INSERT INTO repair_assignments(ticket_id,action,from_user_id,to_user_id,reason,user_id,actor_name,branch_id,workflow_revision,assignment_version,from_helper_id,to_helper_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(input.ticketId,input.claim?'claim':row.technician_id==null?'assign':'reassign',row.technician_id,input.targetId,reason||null,session.user.id,session.user.name,branch,policy.revision,Number(row.assignment_version)+1,row.technician2_id,helper);
  auditRecord(db,session,input.claim?'claim':'assign','repair_ticket',input.ticketId,{technician_id:row.technician_id,technician2_id:row.technician2_id,version:row.assignment_version},{technician_id:input.targetId,technician2_id:helper,version:Number(row.assignment_version)+1,reason,paused_timers:timers.map(t=>t.id),branch_id:branch});
  for(const recipient of new Set([input.targetId,...[row.technician_id,row.technician2_id,helper].filter(id=>id!=null).map(Number)])){
   if(!db.prepare('SELECT 1 FROM users WHERE id=? AND branch_id=? AND is_active=1').get(recipient,branch))continue;
   db.prepare('INSERT INTO notifications(user_id,title,body,link,branch_id) VALUES(?,?,?,?,?)').run(recipient,'تغییر ارجاع دستگاه',`${session.user.name} ارجاع پذیرش ${row.number} را ثبت کرد.`,`/repairs/${input.ticketId}`,branch);
  }
  return {ticket_id:input.ticketId,number:String(row.number),ok:true,version:Number(row.assignment_version)+1};
 });
}
