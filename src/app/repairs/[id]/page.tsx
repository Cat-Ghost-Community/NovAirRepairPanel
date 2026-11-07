import {currentDeviceCatalog} from '@/lib/current-device-catalog';
import {deviceTypeLabel} from '@/lib/device-catalog';
import {NativeRepairStatusButton} from './native-status-button';
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresShellState} from '@/lib/db/pg-shell';
import {readyApplicationPostgres} from '@/lib/db/pg-application';
import {readPostgresRepair} from '@/lib/db/pg-repair-read';
import {PostgresRepairNotes} from '@/lib/db/pg-repair-notes';
import {requirePostgresIdentity} from '@/lib/db/pg-app-auth';
import {postgresRepairAccess,postgresAssignmentAuthority} from '@/lib/db/pg-repair-workflow';
import {hasPerm} from '@/lib/perms-shared';
import {HttpError} from '@/lib/http-error';
import {Pagination} from '@/components/pagination';
import {canAssignRepair,repairWorkflow} from '@/lib/repair-workflow';
import { requirePageAccess } from "@/lib/page-access";
import { requireRepairAccess } from "@/lib/repair-access";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/schema";
import { flagEnabledFor, canUser } from "@/lib/auth";
import { getStatuses } from "@/lib/repair";
import { ticketWorkLog } from "@/lib/worklog";
import { statusFa } from "@/lib/status-fa";
import { RepairCancellation } from '@/components/repair-cancellation';
import { cancellationPosition } from '@/lib/repair-cancellation';
import { Breadcrumb } from "@/components/breadcrumb";

const TYPE_FA: Record<string, string> = {
  mobile: "موبایل", laptop: "لپ‌تاپ", desktop: "دسکتاپ", tablet: "تبلت",
  console: "کنسول بازی", smartwatch: "ساعت هوشمند", printer: "پرینتر",
  network: "تجهیزات شبکه", other: "سایر",
};
import { fmtMoney, fmtDate, fmtDateTime, plain, timeAgo } from "@/lib/format";
import { StatusBadge, PriorityBadge, Avatar } from "@/components/ui";
import { Icon } from "@/components/icon";
import { RepairWorkspaceClient } from "./workspace-client";
import { DeliverSignatureButton } from "./deliver-signature";
import { AssignButton } from "./assign-button";
import { JourneyButton } from "@/components/journey-drawer";
import { PHASE_META, repairPhase } from "@/lib/assign-shared";
import { QR } from "@/components/qr";

export const dynamic = "force-dynamic";

export default async function RepairDetailPage({ params,searchParams }: { params: Promise<{ id: string }>;searchParams:Promise<Record<string,string|undefined>> }) {
  const session=await requirePageAccess("/repairs/[id]");
  const deviceCatalog=await currentDeviceCatalog();
  const cookieStore = await cookies();
  const { id } = await params;
  const ticketId=Number(id),sp=await searchParams;if(!Number.isSafeInteger(ticketId)||ticketId<=0)notFound();
  const data=await(async()=>{
   if(postgresIntegration()){
    const token=cookieStore.get('repaid_session')?.value,state=await postgresShellState(token,cookieStore.get('repaid_branch')?.value),{database,schema}=await readyApplicationPostgres();
    try{
     const bundle=await readPostgresRepair(database,schema,token,state.scope?.branchId??null,ticketId,{page:Number(sp.page??1),perPage:Number(sp.perPage??100)});
     let canAssign=false;
     if(hasPerm(state.permissions,'repairs.assign')&&bundle.t.status_category!=='closed'&&!['Delivered','Cancelled'].includes(String(bundle.t.status_name))&&bundle.t.delivered_at==null){
      try{const actor=await requirePostgresIdentity(database,schema,token,'repairs.assign',Number(bundle.t.branch_id));await postgresAssignmentAuthority(database,schema,actor,Number(bundle.t.branch_id));canAssign=true;}catch(error){if(!(error instanceof HttpError&&[403,404].includes(error.status)))throw error;}
     }
     const access=await postgresRepairAccess(database,schema,token,state.scope?.branchId??null,ticketId),assigned=[access.ticket.technician_id,access.ticket.technician2_id].includes(String(access.scope.session.user.id)),open=!['Cancelled','Delivered'].includes(String(bundle.t.status_name))&&bundle.t.delivered_at==null;
     const canWork=async(permission:string)=>{if(!hasPerm(state.permissions,permission))return false;try{await database.transaction(()=>postgresRepairAccess(database,schema,token,state.scope?.branchId??null,ticketId,{mutation:true,permission}));return true;}catch(error){if(error instanceof HttpError&&[403,404].includes(error.status))return false;throw error;}};
     const canTechnical=open&&await canWork('repairs.edit'),canStatus=open&&await canWork('repairs.status'),canTrack=(access.policy.mode==='legacy'||assigned)&&await canWork('repairs.notes');
     return {...bundle,canAssign,canTechnical,canStatus,canQc:canStatus&&bundle.t.status_name==='Quality Control',canTrack,allowedNext:canStatus?bundle.statuses.filter(s=>!['Delivered','Cancelled'].includes(String(s.name))&&(Array.isArray(access.ticket.allowed_next)?access.ticket.allowed_next:JSON.parse(String(bundle.t.allowed_next??'[]'))).includes(s.name)):[],canNotes:await new PostgresRepairNotes(database,schema).canWrite(token,state.scope?.branchId??null,ticketId)};
    }catch(error){if(error instanceof HttpError&&[403,404].includes(error.status))notFound();throw error;}
   }
  const db=getDb();
  try { requireRepairAccess(session, ticketId, cookieStore.get("repaid_branch")?.value); }
  catch { notFound(); }

  const t = db
    .prepare(
      `SELECT t.*, s.name status_name, s.color status_color, s.allowed_next, s.is_open, s.category status_category,
              c.first_name, c.last_name, c.mobile, c.email, c.code customer_code, c.is_vip, c.is_blacklisted, c.id customer_id,
              d.*, t.device_id AS dev_id, t.id AS ticket_row_id,
              u.name tech_name, u.avatar_color tech_color,
              u2.name tech2_name
       FROM repair_tickets t
       JOIN repair_statuses s ON s.id = t.status_id
       JOIN customers c ON c.id = t.customer_id
       JOIN devices d ON d.id = t.device_id
       LEFT JOIN users u ON u.id = t.technician_id
       LEFT JOIN users u2 ON u2.id = t.technician2_id
       WHERE t.id = ?`
    )
    .get(ticketId) as any;
  if (!t) notFound();
  // ستون id از d.* روی t.id می‌افتد — id واقعی پذیرش را دوباره می‌گذاریم
  t.id = t.ticket_row_id;

  const statuses = getStatuses();
  const current = statuses.find((s) => s.id === t.status_id);
  const allowedNext = (current?.allowed_next ?? []).filter(n=>n!=='Cancelled').map((n) => statuses.find((s) => s.name === n)).filter(Boolean);

  const history = db
    .prepare(
      `SELECT h.*, s.name status_name, s.color color, u.name user_name
       FROM repair_status_history h
       LEFT JOIN repair_statuses s ON s.id = h.to_status
       LEFT JOIN users u ON u.id = h.user_id
       WHERE h.ticket_id = ? ORDER BY h.created_at ASC, h.id ASC`
    )
    .all(ticketId) as any[];

  // شرح کارها: خصوصی فقط برای نویسنده، داخلی/عمومی برای پرسنل
  const viewer = session.user.id;
  const isPrivileged = ["owner", "admin", "manager"].includes(session.user.role);
  const notes = (
    db
      .prepare(
        `SELECT n.*, u.name user_name FROM repair_notes n LEFT JOIN users u ON u.id = n.user_id
         WHERE n.ticket_id = ? AND (n.kind != 'private' OR n.user_id = ?${isPrivileged ? " OR n.kind = 'private'" : ""})
         ORDER BY n.created_at DESC`
      )
      .all(ticketId, viewer) as any[]
  );

  const ticketItems = db
    .prepare("SELECT * FROM ticket_items WHERE ticket_id = ? ORDER BY id")
    .all(ticketId) as any[];

  const estimate = t.estimate_id
    ? db.prepare("SELECT * FROM estimates WHERE id = ?").get(t.estimate_id) as any
    : null;

  const invoice = db.prepare("SELECT * FROM invoices WHERE ticket_id = ? ORDER BY id DESC LIMIT 1").get(ticketId) as any;

  const attachments = db
    .prepare("SELECT id, filename, mime, size, phase, created_at FROM repair_attachments WHERE ticket_id = ? ORDER BY created_at DESC")
    .all(ticketId) as any[];

  const timeEntries = db
    .prepare(
      `SELECT te.*, u.name user_name FROM time_entries te LEFT JOIN users u ON u.id = te.user_id WHERE te.ticket_id = ? ORDER BY te.id DESC`
    )
    .all(ticketId) as any[];

  // گزارش کار تعمیرکار روی همین دستگاه: زمان‌سنج + تغییر وضعیت + شرح کار، با ساعت و روز
  const workLog = ticketWorkLog(ticketId, { id: session.user.id, privileged: isPrivileged });

  const warranty = db.prepare("SELECT * FROM warranties WHERE ticket_id = ? ORDER BY id DESC LIMIT 1").get(ticketId) as any;
  const messages = db
    .prepare("SELECT * FROM messages WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 10")
    .all(ticketId) as any[];

  const inspection = JSON.parse(t.inspection ?? "{}");
  const checklist = JSON.parse(t.checklist ?? "[]");

  const activeTimer = timeEntries.find((e: any) => e.started_at && !e.ended_at);

  // financials from items
  const subtotal = ticketItems.reduce((s: number, i: any) => s + i.qty * i.unit_price, 0);
  const cost = ticketItems.reduce((s: number, i: any) => s + (i.cost ?? 0) * i.qty, 0) + (t.diagnostic_fee_cost ?? 0);
  const paid = invoice?.paid ?? 0;

  const users = db.prepare("SELECT id, name, role, avatar_color FROM users WHERE is_active = 1 ORDER BY name").all() as any[];
  const parts = db
    .prepare(
      `SELECT p.id, p.name, p.sku, COALESCE(SUM(s.qty),0) stock, p.price, p.avg_cost
       FROM parts p LEFT JOIN inventory_stock s ON s.part_id = p.id
       WHERE p.is_active = 1 GROUP BY p.id ORDER BY p.name`
    )
    .all() as any[];
  const services = db.prepare("SELECT * FROM services WHERE is_active = 1 ORDER BY name").all() as any[];
  // تعرفهٔ فعال تعمیرات — برای انتخاب سریع اجرت در تب «قطعات و اجرت»
  const tariffs = db
    .prepare(
      "SELECT id, device_type, brand, title, labor_price, duration_min, warranty_days FROM repair_tariffs WHERE is_active = 1 ORDER BY device_type, title"
    )
    .all() as any[];

  const workAssigned=session.user.role!=='technician'||repairWorkflow(db,Number(t.branch_id)).mode==='legacy'||t.technician_id===session.user.id||t.technician2_id===session.user.id;
  const canEdit = workAssigned&&canUser(session, "repairs.edit");
  const canStatus = workAssigned&&canUser(session, "repairs.status");
  const canFinancial = canUser(session, "invoices.create") || canUser(session, "sales.*");
  const hidePrices = flagEnabledFor(session.user.role, "hide.prices");
  const isTech = session.user.role === "technician";
  const canSeeSecurity = !isTech || true; // technicians see hint; value reveal is audited + permitted
  const canReveal = workAssigned&&canUser(session, "repairs.edit");
  const canAssign = canAssignRepair(session,Number(t.branch_id));
  return {t,statuses,allowedNext,history,notes,ticketItems,estimate,invoice,attachments,timeEntries,workLog,warranty,messages,inspection,checklist,activeTimer,subtotal,cost,paid,users,parts,services,tariffs,canEdit,canStatus,canFinancial,hidePrices,canReveal,canAssign,canTrack:repairWorkflow(db,Number(t.branch_id)).mode==='legacy'?canEdit:t.technician_id===session.user.id||t.technician2_id===session.user.id,workflowRevision:repairWorkflow(db,Number(t.branch_id)).revision,nativeReadOnly:false,availableAdvance:null,pendingAdvance:null,financialNotes:[] as string[],costBasis:'estimate',timeSnapshot:undefined,pagination:null};
  })();
  const {t,statuses,allowedNext,history,notes,ticketItems,estimate,invoice,attachments,timeEntries,workLog,warranty,messages,inspection,checklist,activeTimer,subtotal,cost,paid,users,parts,services,tariffs,canEdit,canStatus,canFinancial,hidePrices,canReveal,canAssign,canTrack,workflowRevision,nativeReadOnly,availableAdvance,pendingAdvance,financialNotes,costBasis,timeSnapshot,pagination}=data;
  const phase = repairPhase({ status_name: t.status_name, status_category: t.status_category, technician_id: t.technician_id });
  const phaseMeta = PHASE_META[phase];

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <Breadcrumb items={[{ label: "پذیرش‌ها", href: "/repairs" }, { label: t.number }]} />
      {nativeReadOnly&&<div className="card card-pad mb-4 text-sm text-amber-700 dark:text-amber-300" role="status">ارجاع، عیب‌یابی، چک‌لیست، کنترل کیفیت و ثبت زمانِ دارای مجوز از PostgreSQL فعال است. تحویل، لغو، قطعات و سایر عملیاتِ تکمیل‌نشده غیرفعال‌اند. اعلان‌های وضعیت فقط در صف ثبت می‌شوند؛ ارسال خارجی هنوز فعال نیست.</div>}
      {/* Header */}
      <div className={`card card-pad ${phaseMeta.border}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-mono text-lg font-bold">{t.number}</h1>
              <StatusBadge name={t.status_name} color={t.status_color} />
              <span className={`${phaseMeta.badge} inline-flex items-center gap-1`}>
                <Icon name={phaseMeta.icon} size={10} />
                {phaseMeta.short}
              </span>
              <PriorityBadge p={t.priority} />
              {t.is_warranty ? <span className="badge-purple">گارانتی</span> : null}
              <QR text={`/repairs/${t.id}`} size={22} label />
            </div>
            <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              <Link href={`/customers/${t.customer_id}`} className="font-medium hover:underline">{t.first_name} {t.last_name}</Link>
              {t.is_vip ? <span className="badge-amber ml-1.5">VIP</span> : null}
              {t.is_blacklisted ? <span className="badge-red ml-1.5">لیست سیاه{t.blacklist_reason ? `: ${t.blacklist_reason}` : ""}</span> : null}
              <span className="text-zinc-400"> · {t.mobile}</span>
            </div>
            <div className="text-sm text-zinc-500">
              <Link href={`/devices/${t.dev_id}`} className="hover:underline">{t.brand} {t.model}</Link>
              <span className="text-zinc-400"> · {deviceTypeLabel(deviceCatalog,t.type)}</span>
              {t.imei && <span className="text-zinc-400"> · IMEI {t.imei}</span>}
            </div>
          </div>
          <div className="text-left text-xs text-zinc-500 space-y-0.5">
            <div>ثبت: {fmtDateTime(t.created_at)}</div>
            {t.estimated_completion && <div>موعد: {fmtDate(t.estimated_completion)}</div>}
            {t.delivered_at && <div className="text-emerald-600">تحویل: {fmtDate(t.delivered_at)}</div>}
            <div className="pt-1 flex gap-1.5 flex-wrap justify-end">
              <a href={nativeReadOnly?undefined:`/repairs/${t.id}/receipt?paper=a5`} aria-disabled={nativeReadOnly} target="_blank" className="btn-secondary btn-sm no-underline">قبض پذیرش</a>
              {!nativeReadOnly&&<JourneyButton ticketId={t.id} ticketNumber={t.number} compact />}
              {canAssign && (
                <AssignButton
                  item={{
                    id: t.id,
                    number: t.number,
                    customer_name: `${t.first_name} ${t.last_name ?? ""}`.trim(),
                    device_label: `${t.brand ?? ""} ${t.model ?? ""}`.trim() || "دستگاه",
                    expect: t.technician_id == null ? null : Number(t.technician_id),
                    branch_id:Number(t.branch_id),version:Number(t.assignment_version),workflow_revision:workflowRevision,
                    technician_name: t.tech_name ?? null,
                    phase,
                  }}
                />
              )}
            </div>
            <div className="pt-1">
              <span className="text-zinc-400">تعمیرکار: </span>
              {t.tech_name ? (
                <span className="inline-flex items-center gap-1 align-middle"><Avatar name={t.tech_name} color={t.tech_color} size={20} /> {t.tech_name}</span>
              ) : <span className="text-amber-600">ارجاع‌نشده</span>}
            </div>
          </div>
        </div>

        {/* Status transition bar */}
        {canStatus && allowedNext.length > 0 && (
          <div className="mt-4 pt-3 border-t border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center gap-1.5">
            <span className="text-xs uppercase tracking-wide text-zinc-400 mr-1">انتقال به:</span>
            {allowedNext.map((s: any) => (
              s.name === "Delivered" ? (
                <DeliverSignatureButton key={s.id} ticketId={t.id} statusName={s.name} customerName={`${t.first_name} ${t.last_name ?? ""}`.trim()} color={s.color} />
              ) : (
                nativeReadOnly?<NativeRepairStatusButton key={s.id} ticketId={t.id} version={Number(t.work_version)} status={s.name} color={s.color}/>:<form key={s.id} action={`/api/repairs/${t.id}/status`} method="post">
                  <input type="hidden" name="status" value={s.name} />
                  <button className="btn-secondary btn-sm" style={{ borderColor: s.color + "88" }}>
                    {statusFa(s.name)}
                  </button>
                </form>
              )
            ))}
          </div>
        )}
      </div>

      <RepairCancellation ticketId={t.id} cancelled={t.status_name==='Cancelled'} canCancel={!nativeReadOnly&&canStatus&&!t.delivered_at&&t.status_name!=='Cancelled'} requiresReview={!nativeReadOnly&&t.status_name==='Cancelled'?cancellationPosition(getDb(),t.id).requiresReview:false}/>
      <RepairWorkspaceClient
        key={t.id}
        ticket={JSON.parse(JSON.stringify({
          id: t.id,
          number: t.number,
          problem: t.problem,
          repair_type: t.repair_type,
          source: t.source,
          condition_notes: t.condition_notes,
          accessories: t.accessories,
          work_version: t.work_version,
          diagnosis: t.diagnosis,
          diagnosis_outcome: t.diagnosis_outcome,
          root_cause: t.root_cause,
          diagnostic_fee: t.diagnostic_fee,
          security_type: t.security_type,
          security_hint: t.security_hint,
          qc_status: t.qc_status,
          qc_notes: t.qc_notes,
          checklist,
          inspection,
          substatus: t.substatus,
          delivery_signature: t.delivery_signature,
          delivery_signed_name: t.delivery_signed_name,
          delivery_signed_at: t.delivery_signed_at,
          postal_tracking: t.postal_tracking,
          postal_sent_at: t.postal_sent_at,
        }))}
        statuses={statuses.map((s) => ({ id: s.id, name: s.name, color: s.color, category: s.category }))}
        statusName={t.status_name}
        history={JSON.parse(JSON.stringify(history))}
        notes={JSON.parse(JSON.stringify(notes))}
        items={JSON.parse(JSON.stringify(ticketItems))}
        attachments={JSON.parse(JSON.stringify(attachments))}
        timeEntries={JSON.parse(JSON.stringify(timeEntries))}
        workLog={workLog}
        activeTimer={activeTimer ? (plain(activeTimer) as any) : null}
        estimate={estimate ? { id: estimate.id, number: estimate.number, status: estimate.status, total: estimate.total, version: estimate.version, public_token: estimate.public_token } : null}
        invoice={invoice ? { id: invoice.id, number: invoice.number, status: invoice.status, total: invoice.total, paid: invoice.paid } : null}
        warranty={warranty ? { id: warranty.id, end_date: warranty.end_date, terms: warranty.terms } : null}
        messages={JSON.parse(JSON.stringify(messages))}
        parts={JSON.parse(JSON.stringify(parts))}
        services={JSON.parse(JSON.stringify(services))}
        tariffs={JSON.parse(JSON.stringify(tariffs))}
        users={users.map((u: any) => ({ id: u.id, name: u.name, role: u.role, avatar_color: u.avatar_color }))}
        flags={{ canEdit,canTechnical:'canTechnical' in data?data.canTechnical:canEdit,canQc:'canQc' in data?data.canQc:canEdit,canNotes:'canNotes' in data?data.canNotes:canEdit,canTrack, canStatus, canFinancial, canReveal, hidePrices }}
        financialSummary={{ subtotal, cost, paid, availableAdvance, pendingAdvance }}
        nativeReadOnly={nativeReadOnly}
        nativeTimeSnapshot={timeSnapshot}
        financialReview={nativeReadOnly?{notes:financialNotes,basis:costBasis}:undefined}
      />
      {pagination&&pagination.totalPages>1&&<div className="card overflow-hidden mt-4"><p className="px-4 pt-3 text-xs text-zinc-500">هر صفحه، بخش متناظر سوابق، یادداشت‌ها، اقلام، فایل‌ها و گاه‌شمار را نمایش می‌دهد.</p><Pagination base={`/repairs/${ticketId}`} sp={sp} page={pagination.page} perPage={pagination.perPage} total={pagination.total} totalPages={pagination.totalPages} unit="ردیف در هر بخش" /></div>}
    </div>
  );
}
