import {currentDeviceCatalog} from '@/lib/current-device-catalog';
import {deviceTypeLabel} from '@/lib/device-catalog';
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresShellState} from '@/lib/db/pg-shell';
import {readyApplicationPostgres} from '@/lib/db/pg-application';
import {listPostgresRepairs} from '@/lib/db/pg-repair-read';
import {repairReadAssignedOnly} from '@/lib/repair-workflow';
import { requirePageAccess } from "@/lib/page-access";
import Link from "next/link";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db/schema";
import { getSessionByToken } from "@/lib/auth";
import { BRANCH_COOKIE, activeBranch, branchWhere } from "@/lib/branch";
import { StatusBadge, PriorityBadge, Avatar, EmptyState } from "@/components/ui";
import { Icon } from "@/components/icon";
import { fmtDate, timeAgo, faNum } from "@/lib/format";
import { statusFa } from "@/lib/repair";
import { sourceFa } from "@/lib/status-fa";
import { Pagination } from "@/components/pagination";
import { countOf, resolvePaging } from "@/lib/pagination";

/** نشان «روش دریافت» — حضوری یا ارسال‌شده */
function sourceMeta(value?: string | null): { label: string; icon: string | null; cls: string } {
  const label = sourceFa(value);
  if (label === "ارسال شده") return { label, icon: "truck", cls: "badge-blue" };
  if (label === "حضوری") return { label, icon: "store", cls: "badge-gray" };
  if (label === "از نوبت") return { label, icon: "calendar", cls: "badge-gray" };
  return { label: label || "—", icon: null, cls: "badge-gray" };
}

export const dynamic = "force-dynamic";

export default async function RepairsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session=await requirePageAccess("/repairs");
  const deviceCatalog=await currentDeviceCatalog();
  const cookieStore = await cookies();
  const sp = await searchParams;
  const {tickets,statuses,counts,total,page,perPage,totalPages}=await(async()=>{
   if(postgresIntegration()){
    const token=cookieStore.get('repaid_session')?.value,state=await postgresShellState(token,cookieStore.get(BRANCH_COOKIE)?.value),{database,schema}=await readyApplicationPostgres();
    return listPostgresRepairs(database,schema,token,state.scope?.branchId??null,{page:Number(sp.page??1),perPage:Number(sp.perPage??50),q:sp.q,status:sp.status,mine:sp.mine==='1',delayed:sp.delayed==='1'});
   }
  const db = getDb();
  const statuses = db.prepare("SELECT id, name, color FROM repair_statuses ORDER BY sort").all() as any[];

  // فلگ «تعمیرکار فقط پذیرش‌های خودش» — اگر فعال و کاربر تعمیرکار باشد
  const sessionForFlag = getSessionByToken((await cookies()).get("repaid_session")?.value);
  if (sessionForFlag && repairReadAssignedOnly(sessionForFlag)) {
    sp.mine = "1";
  }
  const stId = (n: string) => statuses.find((s) => s.name === n)?.id ?? -1;

  let sql = `SELECT t.*, t.group_receipt_id, s.name status_name, s.color status_color, c.first_name, c.last_name,
    d.brand, d.model, d.type, u.name tech_name, u.avatar_color
    FROM repair_tickets t
    JOIN repair_statuses s ON s.id = t.status_id
    JOIN customers c ON c.id = t.customer_id
    JOIN devices d ON d.id = t.device_id
    LEFT JOIN users u ON u.id = t.technician_id WHERE 1=1`;
  const params: any[] = [];

  // محدودهٔ شعبه: کاربران غیرمدیر همیشه به شعبهٔ خود قفل می‌شوند
  const scope = activeBranch(session, cookieStore.get(BRANCH_COOKIE)?.value);
  {
    const b = branchWhere(scope, "t");
    if (b.sql !== "1=1") { sql += ` AND ${b.sql}`; params.push(...b.params); }
  }

  if (sp.status) { sql += " AND s.name = ?"; params.push(sp.status); }
  if (sp.mine === "1") {
    if (session) { sql += " AND t.technician_id = ?"; params.push(session.user.id); }
  }
  if (sp.delayed === "1") {
    sql += ` AND t.estimated_completion IS NOT NULL AND t.estimated_completion < datetime('now')
             AND s.is_open = 1`;
  }
  if (sp.q) {
    sql += " AND (t.number LIKE ? OR c.first_name || ' ' || c.last_name LIKE ? OR d.brand || ' ' || d.model LIKE ?)";
    const like = `%${sp.q}%`;
    params.push(like, like, like);
  }
  const total = countOf(db, sql, params);
  const { page, perPage, offset, totalPages } = resolvePaging(sp, total);
  sql += ` ORDER BY t.created_at DESC LIMIT ${perPage} OFFSET ${offset}`;
  const tickets = JSON.parse(JSON.stringify(db.prepare(sql).all(...params) as any[])) as any[];

  const counts = db
    .prepare(
      `SELECT status_id, COUNT(*) c FROM repair_tickets WHERE status_id IN (${statuses.filter((s:any)=>!['Delivered','Cancelled','Unrepairable','No Fault Found'].includes(s.name)).map((s:any)=>s.id).join(',')}) GROUP BY status_id`
    )
    .all() as any[];
  return {tickets,statuses,counts,total,page,perPage,totalPages};
  })();
  const openStatuses = statuses.filter((s: any) => !["Delivered", "Cancelled", "Unrepairable", "No Fault Found"].includes(s.name));
  const savedViews = [
    { label: "همه باز", href: "/repairs", active: !sp.status && sp.delayed !== "1" && sp.mine !== "1" },
    { label: "در انتظار تأیید", href: "/repairs?status=Waiting+for+Customer+Approval", active: sp.status === "Waiting for Customer Approval" },
    { label: "انتظار قطعه", href: "/repairs?status=Waiting+for+Parts", active: sp.status === "Waiting for Parts" },
    { label: "آماده تحویل", href: "/repairs?status=Ready+for+Pickup", active: sp.status === "Ready for Pickup" },
    { label: "معوق", href: "/repairs?delayed=1", active: sp.delayed === "1" },
    { label: "پذیرش‌های من", href: "/repairs?mine=1", active: sp.mine === "1" },
  ];

  const countFor = (id: number) => counts.find((c: any) => c.status_id === id)?.c ?? 0;

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <div className="page-head">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="page-title">پذیرش‌ها</h1>
            <p className="page-sub">
              {faNum(total)} پذیرش
              {sp.status ? ` · ${statusFa(sp.status)}` : ""}
            </p>
          </div>
          {postgresIntegration()?<button className="btn-primary" disabled title="فرم پذیرش در انتظار یکپارچه‌سازی است؛ تبدیل نوبت فعال است.">+ پذیرش جدید</button>:<Link href="/repairs/new" className="btn-primary">+ پذیرش جدید</Link>}
        </div>

        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5" role="tablist" aria-label="نمایه‌های ذخیره‌شده">
          {savedViews.map((v) => (
            <Link key={v.label} href={v.href} className={`filter-chip ${v.active ? "filter-chip-active" : "filter-chip-idle"}`}>
              {v.label}
            </Link>
          ))}
          <span className="flex-1" />
          {postgresIntegration()?<button className="filter-chip border border-zinc-300 dark:border-zinc-700" disabled title="نمای تابلو در انتظار یکپارچه‌سازی است.">▦ نمای تابلو</button>:<Link href="/repairs/board" className="filter-chip border border-zinc-300 dark:border-zinc-700">▦ نمای تابلو</Link>}
        </div>
      </div>

      {tickets.length === 0 ? (
        <div className="card">
          <EmptyState
            icon=""
            title="پذیرشی پیدا نشد"
            body="نمایه دیگری انتخاب کنید یا اولین پذیرش را ثبت کنید."
            action={postgresIntegration()?<button className="btn-primary" disabled title="فرم پذیرش در انتظار یکپارچه‌سازی است.">ثبت اولین پذیرش</button>:<Link href="/repairs/new" className="btn-primary">ثبت اولین پذیرش</Link>}
          />
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="card hidden overflow-hidden md:block">
            <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-zinc-200 dark:border-zinc-800">
                <tr>
                  <th className="th">شماره</th>
                  <th className="th">مشتری</th>
                  <th className="th">دستگاه</th>
                  <th className="th">روش دریافت</th>
                  <th className="th">وضعیت</th>
                  <th className="th">اولویت</th>
                  <th className="th">تعمیرکار</th>
                  <th className="th">ثبت</th>
                  <th className="th">موعد</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {tickets.map((t) => {
                  const overdue = t.estimated_completion && t.estimated_completion < new Date().toISOString().slice(0, 19).replace("T", " ") && !["Delivered", "Cancelled", "Unrepairable", "No Fault Found"].includes(t.status_name);
                  const sm = sourceMeta(t.source);
                  return (
                    <tr key={t.id} className="row-hover">
                      <td className="td">
                        <Link href={`/repairs/${t.id}`} className="font-mono text-[13px] font-semibold text-brand-600 hover:underline">{t.number}</Link>
                        <div className="max-w-[200px] truncate text-xs text-zinc-400">{t.problem}</div>
                        {t.group_receipt_id && (
                          postgresIntegration()?<span className="text-xs text-zinc-400" title="چاپ قبض گروهی در انتظار یکپارچه‌سازی است.">قبض گروهی</span>:<Link href={`/repairs/group-receipt/${t.group_receipt_id}`} className="text-xs text-brand-600 hover:underline" title="چاپ قبض گروهی همه دستگاه‌های این پذیرش">قبض گروهی</Link>
                        )}
                      </td>
                      <td className="td whitespace-nowrap">{t.first_name} {t.last_name}</td>
                      <td className="td whitespace-nowrap">{t.brand} {t.model}<div className="text-xs text-zinc-400">{deviceTypeLabel(deviceCatalog,t.type)}</div></td>
                      <td className="td whitespace-nowrap">
                        <span className={`${sm.cls} inline-flex items-center gap-1`}>{sm.icon && <Icon name={sm.icon} size={13} className="opacity-70" />}{sm.label}</span>
                      </td>
                      <td className="td"><StatusBadge name={t.status_name} color={t.status_color} /></td>
                      <td className="td"><PriorityBadge p={t.priority} /></td>
                      <td className="td">
                        {t.tech_name ? <span className="inline-flex items-center gap-1.5"><Avatar name={t.tech_name} color={t.avatar_color} size={22} />{t.tech_name.split(" ")[0]}</span> : <span className="text-zinc-400">—</span>}
                      </td>
                      <td className="td whitespace-nowrap text-zinc-500 text-[13px]">{timeAgo(t.created_at)}</td>
                      <td className="td whitespace-nowrap">
                        {t.estimated_completion ? <span className={overdue ? "text-red-600 font-medium" : ""}>{fmtDate(t.estimated_completion)}</span> : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
            <Pagination base="/repairs" sp={sp} page={page} totalPages={totalPages} total={total} perPage={perPage} unit="پذیرش" />
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {tickets.map((t) => {
              const sm = sourceMeta(t.source);
              return (
              <Link key={t.id} href={`/repairs/${t.id}`} className="card card-pad block">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-mono text-[13px] font-semibold text-brand-600">{t.number}</span>
                  <StatusBadge name={t.status_name} color={t.status_color} />
                </div>
                <div className="text-sm font-medium">{t.brand} {t.model}</div>
                <div className="text-xs text-zinc-500">{t.first_name} {t.last_name} · {timeAgo(t.created_at)}</div>
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  <PriorityBadge p={t.priority} />
                  <span className="chip inline-flex items-center gap-1">{sm.icon && <Icon name={sm.icon} size={12} className="opacity-70" />}{sm.label}</span>
                  {t.tech_name && <span className="chip">{t.tech_name.split(" ")[0]}</span>}
                </div>
              </Link>
              );
            })}
            <div className="card overflow-hidden">
              <Pagination base="/repairs" sp={sp} page={page} totalPages={totalPages} total={total} perPage={perPage} unit="پذیرش" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
