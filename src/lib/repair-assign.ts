import {resolvePaging,countOf} from './pagination';
import {changeRepairAssignment,requireAssignmentAuthority,currentWorkflowActor,enforceRepairWorkflow,repairWorkflow} from './repair-workflow';
import {atomic} from './db/transaction';
/**
 * هستهٔ ارجاع دستگاه به تعمیرکار — سمت سرور.
 *
 * اصول:
 *  - منبع حقیقت ارجاع، ستون `repair_tickets.technician_id` است و تاریخچهٔ آن
 *    در جدول فقط-افزودنی `repair_assignments` نگه داشته می‌شود.
 *  - ارجاع و ارجاع مجدد از یک مسیر واحد عبور می‌کنند (تک‌دستگاهی و گروهی).
 *  - به‌روزرسانی با compare-and-set انجام می‌شود تا دو مدیر هم‌زمان
 *    ارجاع یک دستگاه را بازنویسی نکنند (expect = تعمیرکار فعلی).
 *  - ارجاع مجدد پس از شروع تعمیر، دلیل الزامی دارد؛ هر رویداد با تراکنش،
 *    audit و اعلان ثبت می‌شود.
 */
import { getDb } from "@/lib/db/schema";
import { requirePerm, audit, HttpError } from "@/lib/api";
import { canUser, type Session } from "@/lib/auth";
import { transitionTicket, StatusError,getStatusByName } from "@/lib/repair";
import { activeBranch, branchWhere, type BranchScope } from "@/lib/branch";
import { repairPhase, type AssignResult, type AssignTicketCard, type TechnicianOption } from "@/lib/assign-shared";

/** دسترسی ارجاع + محدودهٔ شعبهٔ مؤثر */
export function requireAssignAccess(session: Session, cookieValue?: string | null): BranchScope {
  const scope=activeBranch(session,cookieValue);
  requireAssignmentAuthority(getDb(),session,scope.branchId??session.user.branch_id??-1);
  // activeBranch برای غیرمدیر همان شعبهٔ خود کاربر را قفل می‌کند
  return activeBranch(session, cookieValue);
}

function inScope(scope: BranchScope, branchId: number | null): boolean {
  if (scope.all || scope.branchId == null) return true;
  return branchId != null && Number(branchId) === scope.branchId;
}

/** فاز فقط از وضعیت ذخیره‌شده محاسبه می‌شود — نه از رنگ UI */
export function phaseOfRow(r: any) {
  return repairPhase({
    status_name: r.status_name,
    status_category: r.status_category,
    technician_id: r.technician_id == null ? (r.technician2_id==null?null:Number(r.technician2_id)) : Number(r.technician_id),
  });
}

function toCard(r: any): AssignTicketCard {
  let allowedNext: string[] = [];
  try {
    allowedNext = JSON.parse(r.allowed_next ?? "[]");
  } catch {}
  const phase = phaseOfRow(r);
  const delayed =
    !!r.estimated_completion &&
    String(r.estimated_completion) < new Date().toISOString().slice(0, 19).replace("T", " ") &&
    phase !== "ready" &&
    phase !== "closed";
  return {
    branch_name: r.branch_name ?? null, technician2_name: r.helper_name ?? null,
    branch_id:Number(r.branch_id),assignment_version:Number(r.assignment_version),workflow_revision:Number(r.workflow_revision),technician2_id:r.technician2_id==null?null:Number(r.technician2_id),
    id: Number(r.id),
    number: String(r.number),
    customer_id: Number(r.customer_id),
    customer_name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "مشتری",
    customer_mobile: r.mobile ?? null,
    device_brand: r.brand ?? null,
    device_model: r.model ?? null,
    device_type: r.type ?? null,
    created_at: String(r.created_at ?? ""),
    status_name: String(r.status_name ?? ""),
    status_color: r.status_color ?? null,
    status_category: r.status_category ?? null,
    technician_id: r.technician_id == null ? null : Number(r.technician_id),
    technician_name: r.tech_name ?? null,
    technician_color: r.tech_color ?? null,
    assigned_at: r.assigned_at ?? null,
    estimated_completion: r.estimated_completion ?? null,
    priority: r.priority ?? null,
    phase,
    delayed,
    allowed_next: allowedNext,
  };
}

const CARD_FROM = `FROM repair_tickets t
  JOIN repair_statuses s ON s.id = t.status_id
  JOIN customers c ON c.id = t.customer_id
  JOIN devices d ON d.id = t.device_id
  LEFT JOIN users u ON u.id = t.technician_id LEFT JOIN users helper ON helper.id=t.technician2_id
  LEFT JOIN branches b ON b.id=t.branch_id LEFT JOIN branch_repair_workflows wf ON wf.branch_id=t.branch_id`;
const CARD_SELECT = `SELECT t.id, t.number, t.customer_id, t.priority, t.created_at, t.estimated_completion,
       t.technician_id, t.technician2_id, t.assignment_version, COALESCE(wf.revision,0) workflow_revision, t.branch_id, b.name branch_name, helper.name helper_name, c.first_name, c.last_name, c.mobile,
       d.brand, d.model, d.type, d.imei, d.serial,
       s.name status_name, s.color status_color, s.category status_category, s.allowed_next,
       u.name tech_name, u.avatar_color tech_color,
       (SELECT MAX(a.created_at) FROM repair_assignments a WHERE a.ticket_id = t.id) assigned_at
  ${CARD_FROM}`;

function searchWhere(q: string, dateFrom?: string | null, dateTo?: string | null): { sql: string; params: any[] } {
  const parts: string[] = [];
  const params: any[] = [];
  const term = q.trim();
  if (term) {
    const like = `%${term}%`;
    parts.push(
      `(t.number LIKE ? OR (c.first_name || ' ' || c.last_name) LIKE ? OR (d.brand || ' ' || d.model) LIKE ? OR d.imei LIKE ? OR d.serial LIKE ? OR c.mobile LIKE ? OR d.type LIKE ?)`
    );
    params.push(like, like, like, like, like, like, like);
  }
  if (dateFrom) {
    parts.push("date(t.created_at) >= date(?)");
    params.push(dateFrom);
  }
  if (dateTo) {
    parts.push("date(t.created_at) <= date(?)");
    params.push(dateTo);
  }
  return { sql: parts.length ? " AND " + parts.join(" AND ") : "", params };
}

/** دادهٔ کارتابل مدیر شعبه — دو گروه: در انتظار ارجاع / ارجاع‌شده (بدون آمادهٔ تحویل و بسته‌ها) */
export function assignmentDashboard(
  session: Session,
  opts: { q?: string; dateFrom?: string | null; dateTo?: string | null;page?:string;perPage?:string;phase?:string },
  cookieValue?: string | null
) {
  const scope = requireAssignAccess(session, cookieValue);
  const db = getDb();
  const bw = branchWhere(scope, "t");
  const search = searchWhere(String(opts.q ?? ""), opts.dateFrom, opts.dateTo);
  const baseWhere=`WHERE ${bw.sql} AND s.category NOT IN ('closed','done') AND s.name NOT IN ('Ready for Pickup','Delivered')${search.sql}`;
  const groups=db.prepare(`SELECT s.id status_id,s.name status_name,s.category status_category,
    CASE WHEN COALESCE(t.technician_id,t.technician2_id) IS NULL THEN NULL ELSE 1 END technician_id,COUNT(*) total
    ${CARD_FROM} ${baseWhere} GROUP BY s.id,(COALESCE(t.technician_id,t.technician2_id) IS NULL)`).all(...bw.params,...search.params) as Array<{status_id:number;status_name:string;status_category:string;technician_id:number|null;total:number}>;
  const summary={awaiting:0,assigned:0,in_progress:0};
  for(const row of groups){const phase=phaseOfRow(row);if(phase in summary)summary[phase as keyof typeof summary]+=Number(row.total);}
  if(opts.phase&&!['awaiting','assigned','in_progress'].includes(opts.phase))throw new HttpError(400,'فیلتر مرحله نامعتبر است.');
  const filteredGroups=opts.phase?groups.filter(row=>phaseOfRow(row)===opts.phase):groups;
  const phaseParams:number[]=[];
  const phaseWhere=opts.phase?` AND (${filteredGroups.map(row=>{phaseParams.push(row.status_id,row.technician_id==null?1:0);return '(s.id=? AND (COALESCE(t.technician_id,t.technician2_id) IS NULL)=?)';}).join(' OR ')||'0'})`:'';
  const total=filteredGroups.reduce((sum,row)=>sum+Number(row.total),0);
  const paging=resolvePaging({page:opts.page,perPage:opts.perPage},total);
  const rows = db
    .prepare(
      `${CARD_SELECT}
       ${baseWhere}${phaseWhere}
       ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.created_at DESC,t.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...bw.params, ...search.params,...phaseParams,paging.perPage,paging.offset) as any[];

  const awaiting: AssignTicketCard[] = [];
  const assigned: AssignTicketCard[] = [];
  for (const r of rows) {
    const card = toCard(r);
    if (card.phase === "awaiting") awaiting.push(card);
    else if (card.phase === "assigned" || card.phase === "in_progress") assigned.push(card);
    // آمادهٔ تحویل و تحویل‌شده از این کارتابل خارج می‌شوند (صف تحویل جداگانه دارد)
  }
  return { awaiting, assigned, technicians: technicianOptions(session, scope),paging,summary };
}

/** تعمیرکاران مجاز با بار کاری واقعی (شمارش از دیتابیس — بدون آمار ساختگی) */
export function technicianOptions(session: Session, scopeOverride?: BranchScope, cookieValue?: string | null): TechnicianOption[] {
  const s = scopeOverride ?? activeBranch(session, cookieValue);
  const db = getDb();
  const techScope = branchWhere(s, "u");
  const rows = db
    .prepare(
      `SELECT u.id, u.name, u.avatar_color, u.branch_id, b.name branch_name,
              (SELECT COUNT(*) FROM repair_tickets t JOIN repair_statuses s2 ON s2.id = t.status_id
                WHERE t.technician_id = u.id AND t.branch_id=u.branch_id AND s2.category != 'closed' AND s2.name != 'Delivered') active_count,
              (SELECT COUNT(*) FROM repair_tickets t JOIN repair_statuses s2 ON s2.id = t.status_id
                WHERE t.technician_id = u.id AND t.branch_id=u.branch_id AND s2.name IN ('Diagnosing','In Repair','Waiting for Parts','Parts Available','Quality Control','Returned for Rework','Warranty')) in_progress_count
       FROM users u
       LEFT JOIN branches b ON b.id = u.branch_id
       WHERE u.is_active = 1 AND u.role = 'technician' AND ${techScope.sql}
       ORDER BY active_count, u.name`
    )
    .all(...techScope.params) as any[];
  return rows.map((u) => ({
    id: Number(u.id),
    name: String(u.name),
    avatar_color: u.avatar_color ?? null,
    branch_id: u.branch_id == null ? null : Number(u.branch_id),
    branch_name: u.branch_name ?? null,
    active_count: Number(u.active_count ?? 0),
    in_progress_count: Number(u.in_progress_count ?? 0),
  }));
}

export type AssignInputItem = { id: number; expect: number | null; version?:number; workflow_revision?:number };

/** ارجاع/ارجاع مجدد گروهی — نتیجهٔ هر دستگاه جداگانه گزارش می‌شود */
export function assignTickets(
  session: Session,
  input: { items: AssignInputItem[]; technician_id: number; reason?: string | null; pause_timers?: boolean; clear_helper?: boolean;helper_id?:number|null },
  cookieValue?: string | null
): { results: AssignResult[]; summary: { ok: number; skipped: number; failed: number } } {
  const scope = requireAssignAccess(session, cookieValue), db=getDb();
  const target=db.prepare("SELECT branch_id FROM users WHERE id=? AND is_active=1 AND role='technician'").get(input.technician_id);
  if(!target)throw new HttpError(400,'تعمیرکار فعال معتبر انتخاب کنید.');
  if(!inScope(scope,Number(target.branch_id)))throw new HttpError(403,'تعمیرکار انتخاب‌شده خارج از شعبهٔ مجاز است.');
  const results:AssignResult[]=[];
  if(!Array.isArray(input.items)||input.items.length===0||input.items.length>200)throw new HttpError(400,'از یک تا دویست دستگاه انتخاب کنید.');
  for(const item of input.items){
    try {
      const ticket=db.prepare('SELECT branch_id FROM repair_tickets WHERE id=?').get(item.id);
      if(!ticket || !inScope(scope,Number(ticket.branch_id)))throw new HttpError(404,'پذیرش در شعبهٔ مجاز یافت نشد.');
      results.push(changeRepairAssignment(db,session,{ticketId:item.id,targetId:Number(input.technician_id),expect:item.expect,version:item.version,workflowRevision:item.workflow_revision,reason:input.reason,pauseTimers:input.pause_timers,clearHelper:input.clear_helper,helperId:input.helper_id}));
    } catch(error){results.push({ticket_id:item.id,ok:false,reason:error instanceof HttpError?error.message:'ثبت ارجاع ناموفق بود؛ دوباره تلاش کنید.'});}
  }
  return {results,summary:{ok:results.filter(r=>r.ok&&!r.skipped).length,skipped:results.filter(r=>r.ok&&r.skipped).length,failed:results.filter(r=>!r.ok).length}};
}

/** کارتابل تعمیرکار — فقط دستگاه‌های خودِ او (ملاک دسترسی: ارجاع به همین کاربر)، گروه‌بندی‌شده بر اساس فاز */
export function myQueue(session: Session, cookieValue?: string | null,opts:{page?:string;perPage?:string}={}) {
  requirePerm(session, "repairs.view");
  const db = getDb();
  const scope=activeBranch(session,cookieValue);
  const total=Number(db.prepare("SELECT COUNT(*) n FROM repair_tickets t JOIN repair_statuses s ON s.id=t.status_id WHERE (t.technician_id=? OR t.technician2_id=?) AND (? IS NULL OR t.branch_id=?) AND s.category!='closed'").get(session.user.id,session.user.id,scope.branchId,scope.branchId)?.n??0);
  const paging=resolvePaging(opts,total);
  const rows = db
    .prepare(
      `${CARD_SELECT}
       WHERE (t.technician_id = ? OR t.technician2_id=?) AND (? IS NULL OR t.branch_id=?) AND s.category != 'closed'
       ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.updated_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(session.user.id,session.user.id,scope.branchId,scope.branchId,paging.perPage,paging.offset) as any[];
  const not_started: AssignTicketCard[] = [];
  const in_progress: AssignTicketCard[] = [];
  const ready: AssignTicketCard[] = [];
  for (const r of rows) {
    const card = toCard(r);
    if (card.phase === "assigned") not_started.push(card);
    else if (card.phase === "in_progress") in_progress.push(card);
    else if (card.phase === "ready") ready.push(card);
  }
  return { not_started, in_progress, ready,paging };
}

export function availableRepairs(session:Session,opts:{q?:string;page?:string}={}){
 const db=getDb();currentWorkflowActor(db,session);requirePerm(session,'repairs.view');
 const branch=Number(session.user.branch_id??-1),policy=repairWorkflow(db,branch);
 if(session.user.role!=='technician'||policy.mode!=='shared')throw new HttpError(403,'صف آزاد برای مسیر فعلی شما فعال نیست.');
 const search=searchWhere(opts.q??''),where=`t.branch_id=? AND t.technician_id IS NULL AND t.technician2_id IS NULL AND s.is_open=1 AND s.name NOT IN ('Ready for Pickup','Delivered','Cancelled') AND NOT EXISTS(SELECT 1 FROM time_entries te WHERE te.ticket_id=t.id AND te.ended_at IS NULL)${search.sql}`;
 const params=[branch,...search.params],total=countOf(db,`${CARD_SELECT} WHERE ${where}`,params),paging=resolvePaging(opts,total,20);
 const rows=db.prepare(`${CARD_SELECT} WHERE ${where} ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,t.created_at,t.id LIMIT ? OFFSET ?`).all(...params,paging.perPage,paging.offset) as any[];
 return {mode:policy.mode,revision:policy.revision,paging,tickets:rows.map(row=>{const card=toCard(row);return {id:card.id,number:card.number,device_brand:card.device_brand,device_model:card.device_model,priority:card.priority,assignment_version:card.assignment_version,workflow_revision:card.workflow_revision};})};
}

/** شروع صریح تعمیر: انتقال به «In Repair» + شروع زمان‌سنج اگر باز نبود */
export function startRepair(session: Session, ticketId: number, cookieValue?: string | null): { status: string; timer_started: boolean } {
  const db = getDb();
  return atomic(db,()=>{
  currentWorkflowActor(db,session);
  enforceRepairWorkflow(session,ticketId,true,db);
  const ticket = db.prepare("SELECT * FROM repair_tickets WHERE id = ?").get(ticketId) as any;
  if (!ticket) throw new HttpError(404, "پذیرش یافت نشد.");
  if(repairWorkflow(db,Number(ticket.branch_id)).mode!=='legacy'&&ticket.technician_id!==session.user.id&&ticket.technician2_id!==session.user.id)throw new HttpError(403,'شروع زمان کار فقط برای تعمیرکار ارجاع‌شده مجاز است.');
  const scope=activeBranch(session,cookieValue);
  if(!scope.all&&ticket.branch_id!==scope.branchId)throw new HttpError(404,'پذیرش یافت نشد.');
  // ملاک: ارجاع به همین کاربر (یا مجوز ارجاع برای مدیران) — نه محدودهٔ شعبه؛
  // چون مدیر می‌تواند از شعبهٔ دیگر هم به این تعمیرکار ارجاع داده باشد.
  if (Number(ticket.technician_id) !== session.user.id && Number(ticket.technician2_id)!==session.user.id && !canUser(session, "repairs.assign")) {
    throw new HttpError(403, "این دستگاه به شما ارجاع نشده است.");
  }
  requirePerm(session, "repairs.status");

  let targetStatus='In Repair';
  try {
    if(repairWorkflow(db,Number(ticket.branch_id)).mode!=='legacy'){
      let current=db.prepare('SELECT s.name FROM repair_tickets t JOIN repair_statuses s ON s.id=t.status_id WHERE t.id=?').get(ticketId)!;
      if(current.name==='New'&&getStatusByName('New')?.allowed_next.includes('Received')){transitionTicket(ticketId,'Received',session.user.id,'دریافت دستگاه ارجاع‌شده توسط تعمیرکار');current={name:'Received'};}
      const status=getStatusByName(String(current.name));
      targetStatus=status?.allowed_next.includes('Diagnosing')?'Diagnosing':String(current.name);
      if(!['Diagnosing','In Repair','Quality Control','Returned for Rework','Warranty'].includes(targetStatus))throw new HttpError(409,'در وضعیت فعلی شروع کار مجاز نیست؛ مرحلهٔ مجاز بعدی را طی کنید.');
    }
    transitionTicket(ticketId,targetStatus,session.user.id,'شروع کار از کارتابل');
  } catch (e) {
    if (e instanceof StatusError) throw new HttpError(400, "شروع تعمیر از وضعیت فعلی مجاز نیست — ابتدا وضعیت‌های میانی مجاز را طی کنید.");
    throw e;
  }

  let timerStarted = false;
  const open = db
    .prepare("SELECT id FROM time_entries WHERE ticket_id = ? AND user_id = ? AND ended_at IS NULL LIMIT 1")
    .get(ticketId, session.user.id) as any;
  if (!open) {
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const id = db.prepare("INSERT INTO time_entries(ticket_id, user_id, started_at) VALUES(?,?,?)").run(ticketId, session.user.id, now)
      .lastInsertRowid as number;
    audit(session, "create", "time_entry", id, null, { ticketId, action: "start", source: "queue" });
    timerStarted = true;
  }
  return { status: targetStatus, timer_started: timerStarted };
  });
}
