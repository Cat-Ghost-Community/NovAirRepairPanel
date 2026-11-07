import { requirePageAccess } from "@/lib/page-access";
import Link from "next/link";
import { getDb } from "@/lib/db/schema";
import { EmptyState } from "@/components/ui";
import { Icon } from "@/components/icon";
import { toFaDigits } from "@/lib/format";
import { Pagination } from "@/components/pagination";
import { countOf, resolvePaging } from "@/lib/pagination";
import { canUser } from "@/lib/auth";
import { cookies } from "next/headers";
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresShellState} from '@/lib/db/pg-shell';
import {readyApplicationPostgres} from '@/lib/db/pg-application';
import {PostgresDevicesRepository} from '@/lib/db/pg-operational-profiles';
import {hasPerm} from '@/lib/perms-shared';
import { activeBranch, BRANCH_COOKIE } from "@/lib/branch";

export const dynamic = "force-dynamic";

const TYPE_ICONS: Record<string, string> = {
  mobile: "phone", laptop: "laptop", desktop: "monitor", tablet: "tablet", console: "gamepad", smartwatch: "watch", printer: "printer", network: "router", other: "plug",
};

const TYPE_FA: Record<string, string> = {
  mobile: "موبایل", laptop: "لپ‌تاپ", desktop: "دسکتاپ", tablet: "تبلت",
  console: "کنسول بازی", smartwatch: "ساعت هوشمند", printer: "پرینتر",
  network: "تجهیزات شبکه", other: "سایر",
};

export default async function DevicesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session=await requirePageAccess("/devices");
  const cookieStore=await cookies(),sp=await searchParams;
  const {devices,total,page,perPage,totalPages,canCreate}=await(async()=>{
   if(postgresIntegration()){
    const state=await postgresShellState(cookieStore.get('repaid_session')?.value,cookieStore.get(BRANCH_COOKIE)?.value),{database,schema}=await readyApplicationPostgres();
    const data=await new PostgresDevicesRepository(database,schema).list(cookieStore.get('repaid_session')?.value,state.scope?.branchId??null,{q:sp.q,type:sp.type,page:Number(sp.page??1),perPage:Number(sp.perPage??50)});
    return {...data,canCreate:hasPerm(state.permissions,'devices.create')};
   }
  const db = getDb();
  const q = sp.q?.trim();
  const branch = activeBranch(session, cookieStore.get(BRANCH_COOKIE)?.value).branchId;
  let sql = `SELECT d.*, c.first_name, c.last_name, c.id cid,
    (SELECT COUNT(*) FROM repair_tickets t WHERE t.device_id = d.id AND (? IS NULL OR t.branch_id=?)) repair_count
    FROM devices d JOIN customers c ON c.id = d.customer_id WHERE d.is_archived = 0`;
  const params: any[] = [branch, branch];
  sql += " AND (? IS NULL OR d.id IN (SELECT device_id FROM device_branch_access WHERE branch_id=?))";
  params.push(branch, branch);
  if (q) {
    sql += " AND (d.model LIKE ? OR d.brand LIKE ? OR d.serial LIKE ? OR d.imei LIKE ? OR c.first_name || ' ' || c.last_name LIKE ?)";
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  if (sp.type) { sql += " AND d.type = ?"; params.push(sp.type); }
  const total = countOf(db, sql, params);
  const { page, perPage, offset, totalPages } = resolvePaging(sp, total);
  sql += ` ORDER BY d.created_at DESC LIMIT ${perPage} OFFSET ${offset}`;
  const devices = JSON.parse(JSON.stringify(db.prepare(sql).all(...params) as any[])) as any[];


   return {devices,total,page,perPage,totalPages,canCreate:canUser(session,'devices.create')};
  })();
  const q=sp.q?.trim();

  const types = ["mobile", "laptop", "desktop", "tablet", "console", "smartwatch", "printer", "network", "other"];

  const typeHref = (type: string) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (type) params.set("type", type);
    return `/devices${params.size ? `?${params}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <div className="page-head">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="page-title">دستگاه‌ها</h1>
            <p className="page-sub">سابقه کامل تعمیرات هر دستگاه همیشه نگه‌داری می‌شود · {toFaDigits(total)} دستگاه</p>
          </div>
          <div className="flex min-w-0 flex-wrap gap-2">
            {canCreate && <Link href="/devices/new" className="btn-primary">+ افزودن دستگاه</Link>}
          </div>
        </div>

        <form className="mt-4 flex min-w-0 flex-wrap items-end gap-2" role="search" aria-label="جستجوی دستگاه‌ها">
          {sp.type && <input type="hidden" name="type" value={sp.type} />}
          <div className="min-w-0 flex-1 basis-52"><label className="label" htmlFor="devices-search">مدل، مشتری یا شناسه دستگاه</label><input id="devices-search" name="q" defaultValue={q} placeholder="نام مشتری، برند، مدل، IMEI یا سریال…" className="input" /></div>
          <button className="btn-secondary"><Icon name="search" size={15} /> جستجو</button>
          {(q || sp.type) && <Link href="/devices" className="btn-ghost">پاک‌کردن فیلترها</Link>}
        </form>

        <nav className="mt-3 flex flex-wrap gap-1.5" aria-label="نوع دستگاه">
          <Link href={typeHref("")} aria-current={!sp.type ? "page" : undefined} className={`filter-chip ${!sp.type ? "filter-chip-active" : "filter-chip-idle"}`}>همه</Link>
          {types.map((t) => (
            <Link key={t} href={typeHref(t)} aria-current={sp.type === t ? "page" : undefined} className={`filter-chip capitalize ${sp.type === t ? "filter-chip-active" : "filter-chip-idle"}`}>
              <Icon name={TYPE_ICONS[t]} size={13} className="inline align-[-2px] opacity-70" /> {TYPE_FA[t] ?? t}
            </Link>
          ))}
        </nav>
      </div>

      {devices.length === 0 ? (
        <div className="card">
          <EmptyState icon="phone" title="دستگاهی پیدا نشد" body={q || sp.type ? "با این فیلترها نتیجه‌ای پیدا نشد؛ عبارت جستجو یا نوع دستگاه را تغییر دهید." : "دستگاه‌ها هنگام پذیرش اضافه می‌شوند؛ در صورت داشتن مجوز می‌توانید دستگاه جدید ثبت کنید."} action={q || sp.type ? <Link href="/devices" className="btn-secondary">نمایش همه دستگاه‌ها</Link> : undefined} />
        </div>
      ) : (
        <div className="grid min-w-0 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {devices.map((d) => (
            <Link key={d.id} href={`/devices/${d.id}`} className="card min-w-0 p-4 sm:p-5 flex flex-col hover:border-brand-400 focus-visible:outline-2 focus-visible:outline-brand-500 focus-visible:outline-offset-2 transition-colors">
              <div className="flex items-start justify-between">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500 dark:bg-zinc-800/80 dark:text-zinc-400" aria-hidden><Icon name={TYPE_ICONS[d.type] ?? "plug"} size={22} strokeWidth={1.7} /></span>
                <span className="badge-gray">{toFaDigits(d.repair_count)} تعمیر</span>
              </div>
              <div className="mt-4 break-words text-sm font-semibold">{d.brand} {d.model}</div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500"><Icon name="user" size={13} /><span className="truncate">{d.first_name} {d.last_name}</span></div>
              <div className="my-3 rounded-lg bg-zinc-50 p-2.5 text-xs dark:bg-zinc-800/40"><span className="block text-zinc-400">{d.imei ? "IMEI" : d.serial ? "شماره سریال" : "شناسه دستگاه"}</span><bdi className="mt-1 block break-all font-mono text-zinc-600 dark:text-zinc-300">{d.imei || d.serial || "ثبت نشده"}</bdi></div>
              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-3 text-xs dark:border-zinc-800"><span className="text-zinc-500">{TYPE_FA[d.type] ?? "سایر"}</span><span className="inline-flex items-center gap-1 font-medium text-brand-600">پرونده و سوابق <Icon name="chevron-left" size={14} /></span></div>
            </Link>
          ))}
        </div>
      )}
      {devices.length > 0 && (
        <div className="card mt-3 overflow-hidden">
          <Pagination base="/devices" sp={sp} page={page} totalPages={totalPages} total={total} perPage={perPage} unit="دستگاه" />
        </div>
      )}
    </div>
  );
}
