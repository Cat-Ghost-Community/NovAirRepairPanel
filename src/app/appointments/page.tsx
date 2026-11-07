import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresShellState} from '@/lib/db/pg-shell';
import {readyApplicationPostgres} from '@/lib/db/pg-application';
import {PostgresAppointments} from '@/lib/db/pg-appointments';
import {hasPerm} from '@/lib/perms-shared';
import { requirePageAccess } from "@/lib/page-access";
import Link from "next/link";
import { getDb } from "@/lib/db/schema";
import { fmtDateTime, toFaDigits } from "@/lib/format";
import { EmptyState } from "@/components/ui";
import { ConvertButton } from "./convert-button";
import { NewAppointmentButton } from "./new-appointment";
import { AppointmentActions } from "./appointment-actions";
import { Pagination } from "@/components/pagination";
import { countOf, resolvePaging } from "@/lib/pagination";
import { getSessionByToken, canUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { BRANCH_COOKIE, activeBranch, branchWhere } from "@/lib/branch";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = { requested: "درخواستی", confirmed: "تأییدشده", completed: "انجام‌شده", cancelled: "لغوشده", converted: "تبدیل‌شده" };
const STATUS_BADGE: Record<string, string> = {
  requested: "badge-amber", confirmed: "badge-blue", completed: "badge-green", cancelled: "badge-gray", converted: "badge-green",
};

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageAccess("/appointments");
  const cookieStore = await cookies();
  const sp=await searchParams;
  const native=Boolean(postgresIntegration());
  const {appts,customers,technicians,upcoming,total,page,perPage,totalPages,canCreate,canManage,canConvert}=await(async()=>{
    if(native){
      const state=await postgresShellState(cookieStore.get('repaid_session')?.value,cookieStore.get(BRANCH_COOKIE)?.value),{database,schema}=await readyApplicationPostgres(),repo=new PostgresAppointments(database,schema),token=cookieStore.get('repaid_session')?.value,branch=state.scope?.branchId??null;
      const data=await repo.list(token,branch,{q:sp.q,status:sp.status,page:Number(sp.page??1),perPage:Number(sp.perPage??50)}),customerData=await repo.selectors(token,branch,{kind:'customers'}),techData=await repo.selectors(token,branch,{kind:'technicians'});
      return {...data,appts:data.appointments as any[],customers:customerData.options.map(c=>({id:Number(c.id),first_name:String(c.first_name??''),last_name:String(c.last_name??''),mobile:String(c.mobile??'')})),technicians:techData.options.map(u=>({id:Number(u.id),name:String(u.name),role:String(u.role)})),canCreate:hasPerm(state.permissions,'appointments.create'),canManage:hasPerm(state.permissions,'appointments.manage'),canConvert:hasPerm(state.permissions,'repairs.create')};
    }
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "appointments.view")) redirect("/");
  const db = getDb();
  let sql = `SELECT a.*, c.first_name, c.last_name, c.mobile, d.brand, d.model, u.name tech_name
       FROM appointments a
       LEFT JOIN customers c ON c.id = a.customer_id
       LEFT JOIN devices d ON d.id = a.device_id
       LEFT JOIN users u ON u.id = a.technician_id
       WHERE 1=1`;
  const params: any[] = [];
  const bScope = branchWhere(activeBranch(session, cookieStore.get(BRANCH_COOKIE)?.value), "a");
  if (bScope.sql !== "1=1") { sql += ` AND ${bScope.sql}`; params.push(...bScope.params); }
  if (sp.status) { sql += " AND a.status = ?"; params.push(sp.status); }
  if (sp.q) {
    sql += " AND (a.repair_type LIKE ? OR (c.first_name || ' ' || c.last_name) LIKE ? OR c.mobile LIKE ?)";
    const like = `%${sp.q}%`;
    params.push(like, like, like);
  }
  const total = countOf(db, sql, params);
  const { page, perPage, offset, totalPages } = resolvePaging(sp, total);
  sql += ` ORDER BY a.preferred_at DESC LIMIT ${perPage} OFFSET ${offset}`;
  const appts = JSON.parse(JSON.stringify(db.prepare(sql).all(...params) as any[])) as any[];

  const selectorBranch=activeBranch(session,cookieStore.get(BRANCH_COOKIE)?.value).branchId;
  const customers = (db.prepare("SELECT id, first_name, last_name, mobile FROM customers WHERE (? IS NULL OR id IN (SELECT customer_id FROM customer_branch_access WHERE branch_id=?)) ORDER BY first_name LIMIT 500").all(selectorBranch,selectorBranch) as any[]).map((c) => ({ id: c.id, first_name: c.first_name, last_name: c.last_name, mobile: c.mobile }));
  const technicians = (db.prepare("SELECT id, name, role FROM users WHERE role='technician' AND is_active=1 AND (? IS NULL OR branch_id=?) ORDER BY name LIMIT 500").all(selectorBranch,selectorBranch) as any[]).map((u) => ({ id: u.id, name: u.name, role: u.role }));

  const upcoming = Number((db.prepare(`SELECT COUNT(*) c FROM appointments a WHERE a.status IN ('requested','confirmed') AND ${bScope.sql}`).get(...bScope.params) as any).c);

    return {appts,customers,technicians,upcoming,total,page,perPage,totalPages,canCreate:canUser(session,'appointments.create'),canManage:canUser(session,'appointments.manage'),canConvert:canUser(session,'repairs.create')};
  })();

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="page-head">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="page-title">نوبت‌ها</h1>
            <p className="page-sub">
              {toFaDigits(upcoming)} نوبت پیش‌رو — با تبدیل نوبت، یک پذیرش آماده به‌صورت خودکار ساخته می‌شود.
            </p>
          </div>
          {canCreate&&<NewAppointmentButton customers={customers} technicians={technicians} native={native} />}
        </div>
      </div>
      {appts.length === 0 ? (
        <div className="card"><EmptyState icon="calendar-days" title="نوبتی نیست" body="مشتری‌ها قبل از مراجعه نوبت رزرو می‌کنند — با یک کلیک به پذیرش تبدیل می‌شود." /></div>
      ) : (
        <div className="space-y-2">
          {appts.map((a) => (
            <div key={a.id} className="card card-pad flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {a.repair_type ? a.repair_type + " — " : ""}
                  {a.customer_id ? (
                    <Link href={`/customers/${a.customer_id}`} className="text-brand-600 hover:underline">{a.first_name} {a.last_name}</Link>
                  ) : "—"}
                </div>
                <div className="text-[13px] text-zinc-500">
                  {fmtDateTime(a.preferred_at)}
                  {a.brand && a.model ? ` · ${a.brand} ${a.model}` : ""}
                  {a.tech_name ? ` · تعمیرکار: ${a.tech_name}` : ""}
                </div>
                {a.notes && <div className="text-xs text-zinc-400 mt-0.5">{a.notes}</div>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={STATUS_BADGE[a.status] ?? "badge-gray"}>{STATUS_LABEL[a.status] ?? a.status}</span>
                {canConvert && ['requested','confirmed'].includes(a.status) && a.customer_id && (
                  <ConvertButton appointmentId={Number(a.id)} customerId={Number(a.customer_id)} deviceId={a.device_id ? Number(a.device_id) : null} repairType={a.repair_type ?? null} native={native} version={native?Number(a.version):undefined} />
                )}
                {canManage && a.status !== "converted" && a.customer_id && (
                  <AppointmentActions id={Number(a.id)} status={a.status} preferredAt={a.preferred_at} notes={a.notes} version={native?Number(a.version):undefined} />
                )}
              </div>
            </div>
          ))}
          <div className="card overflow-hidden">
            <Pagination base="/appointments" sp={sp} page={page} totalPages={totalPages} total={total} perPage={perPage} unit="نوبت" />
          </div>
        </div>
      )}
    </div>
  );
}
