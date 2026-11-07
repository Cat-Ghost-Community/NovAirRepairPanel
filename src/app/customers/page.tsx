import { requirePageAccess } from "@/lib/page-access";
import Link from "next/link";
import { getDb } from "@/lib/db/schema";
import { EmptyState } from "@/components/ui";
import { Pagination } from "@/components/pagination";
import { resolvePaging } from "@/lib/pagination";
import { fmtMoney, timeAgo, toFaDigits } from "@/lib/format";
import { MergeCustomers } from "./merge-customers";
import { CUSTOMER_TYPES, CUSTOMER_TYPE_FA, customerTypeFa, customerTypeBadge } from "@/lib/customer-type";
import { getSessionByToken, canUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { BRANCH_COOKIE, activeBranch } from "@/lib/branch";
import { redirect } from "next/navigation";
import {postgresIntegration} from "@/lib/db/pg-integration-config";
import {readyApplicationPostgres} from "@/lib/db/pg-application";
import {PostgresCustomersRepository} from "@/lib/db/pg-customers";
import {postgresCookieBranch} from '@/lib/db/pg-branch';
import {loadPostgresIdentity} from "@/lib/db/pg-app-auth";

import {hasPerm} from "@/lib/perms-shared";

export const dynamic = "force-dynamic";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageAccess("/customers");
  const cookieStore = await cookies();
  const pg=postgresIntegration(),application=pg?await readyApplicationPostgres():null;
  const identity=application?await loadPostgresIdentity(application.database,application.schema,cookieStore.get("repaid_session")?.value):null;
  const session=application?identity?.session??null:getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!pg&&!canUser(session, "customers.view")) redirect("/");
  const allowed=(permission:string)=>identity?hasPerm(identity.permissions,permission):canUser(session,permission);
  const sp = await searchParams;
  const typeFilter=CUSTOMER_TYPES.includes(sp.type as any)?sp.type:null;
  const q=sp.q?.trim();
  let total:number,page:number,perPage:number,totalPages:number,customers:any[];
  if(application){
    const branch=await postgresCookieBranch(application.database,application.schema,session,cookieStore.get(BRANCH_COOKIE)?.value);
    const result=await new PostgresCustomersRepository(application.database,application.schema).list(cookieStore.get('repaid_session')?.value,branch,{q,page:Number(sp.page??1),perPage:Number(sp.perPage??50),vip:sp.vip,blacklist:sp.blacklist,type:sp.type});
    ({customers,total,page,perPage}=result);totalPages=Math.max(1,Math.ceil(total/perPage));
  }else{
  const db = getDb();

  const financialBranch=activeBranch(session,cookieStore.get(BRANCH_COOKIE)?.value).branchId;
  let sql = `SELECT c.*,
    (SELECT COUNT(*) FROM devices d WHERE d.customer_id = c.id AND d.is_archived = 0 AND (:financialBranch IS NULL OR d.id IN (SELECT device_id FROM device_branch_access WHERE branch_id=:financialBranch))) device_count,
    (SELECT COUNT(*) FROM repair_tickets t WHERE t.customer_id = c.id AND (:financialBranch IS NULL OR t.branch_id=:financialBranch)) repair_count,
    (SELECT COALESCE(SUM(amount),0) FROM party_balance_events p WHERE p.kind='customer' AND p.party_id=c.id AND (:financialBranch IS NULL OR p.branch_id=:financialBranch)) balance
    FROM customers c WHERE c.is_archived = 0`;
  const params: any[] = [];
  if (q) {
    sql += " AND ((c.first_name || ' ' || c.last_name) LIKE ? OR c.company LIKE ? OR c.mobile LIKE ? OR c.email LIKE ? OR c.code LIKE ?)";
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  if (sp.vip === "1") sql += " AND c.is_vip = 1";
  if (sp.blacklist === "1") sql += " AND c.is_blacklisted = 1";

  if (typeFilter) sql += " AND c.customer_type = ?";
  if (typeFilter) params.push(typeFilter);
  // محدودهٔ شعبه: کاربران غیرمدیر همیشه به شعبهٔ خود قفل می‌شوند
  const bScope = financialBranch==null?{sql:"1=1",params:[]}:{sql:"c.id IN (SELECT customer_id FROM customer_branch_access WHERE branch_id=?)",params:[financialBranch]};
  if (bScope.sql !== "1=1") { sql += ` AND ${bScope.sql}`; params.push(...bScope.params); }
  const countWhere = `c.is_archived = 0${q ? " AND ((c.first_name || ' ' || c.last_name) LIKE ? OR c.company LIKE ? OR c.mobile LIKE ? OR c.email LIKE ? OR c.code LIKE ?)" : ""}${sp.vip === "1" ? " AND c.is_vip = 1" : ""}${sp.blacklist === "1" ? " AND c.is_blacklisted = 1" : ""}${typeFilter ? " AND c.customer_type = ?" : ""}${bScope.sql !== "1=1" ? ` AND ${bScope.sql}` : ""}`;
  total = Number(db.prepare(`SELECT COUNT(*) c FROM customers c WHERE ${countWhere}`).get(...params)?.c ?? 0);
  const paging=resolvePaging(sp,total); ({page,perPage,totalPages}=paging);const offset=paging.offset;
  sql += ` ORDER BY c.created_at DESC LIMIT ${perPage} OFFSET ${offset}`;
  customers = JSON.parse(JSON.stringify(db.prepare(sql).all({financialBranch},...params) as any[])) as any[];

  }

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <div className="page-head">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="page-title">مشتریان</h1>
            <p className="page-sub">{toFaDigits(total)} مشتری</p>
          </div>
          <div className="flex flex-wrap gap-2 min-w-0 max-w-full">
            <form className="flex gap-1.5 min-w-0 max-w-full">
              <input name="q" defaultValue={q} placeholder="جستجوی نام، تلفن، ایمیل…" className="input min-w-0 !w-40 sm:!w-56" aria-label="جستجوی مشتریان" />
              <input type="hidden" name="type" value={sp.type ?? ""} />
              <button className="btn-secondary">جستجو</button>
            </form>
            {!pg&&allowed("customers.edit") && <MergeCustomers customers={JSON.parse(JSON.stringify(customers.map((c) => ({ id: c.id, name: (c.first_name ?? "") + " " + (c.last_name ?? "") + (c.company ? ` (${c.company})` : ""), mobile: c.mobile }))))} />}
            {allowed("customers.create") && <Link href="/customers/new" className="btn-primary">+ مشتری جدید</Link>}
          </div>
        </div>

        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">
          <Link href="/customers" className={`filter-chip border ${!typeFilter ? "border-brand-600 filter-chip-active" : "border-zinc-200 dark:border-zinc-700 filter-chip-idle"}`}>همه</Link>
          {CUSTOMER_TYPES.map((t) => (
            <Link key={t} href={`/customers?type=${t}`} className={`filter-chip border ${typeFilter === t ? "border-brand-600 filter-chip-active" : "border-zinc-200 hover:border-brand-400 dark:border-zinc-700 filter-chip-idle"}`}>
              {CUSTOMER_TYPE_FA[t]}
            </Link>
          ))}
        </div>
      </div>

      {customers.length === 0 ? (
        <div className="card">
          <EmptyState icon="user" title="مشتری‌ای پیدا نشد" body={q ? `نتیجه‌ای برای «${q}» پیدا نشد — شماره تلفن یا املای دیگری را امتحان کنید.` : "اولین مشتری را اضافه کنید تا پذیرش ثبت کنید."}
            action={!q && allowed("customers.create") ? <Link href="/customers/new" className="btn-primary">افزودن مشتری</Link> : undefined} />
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="th">مشتری</th>
                <th className="th hidden sm:table-cell">نوع</th>
                <th className="th hidden md:table-cell">تماس</th>
                <th className="th hidden sm:table-cell">دستگاه‌ها</th>
                <th className="th hidden lg:table-cell">پذیرش‌ها</th>
                <th className="th">مانده</th>
                <th className="th hidden md:table-cell">برچسب‌ها</th>
                <th className="th hidden lg:table-cell">افزوده شد</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {customers.map((c) => (
                <tr key={c.id} className="row-hover">
                  <td className="td">
                    <Link href={`/customers/${c.id}`} className="font-medium hover:underline">
                      {c.company ? c.company : `${c.first_name??''} ${c.last_name??''}`.trim()}
                    </Link>
                    {c.is_vip ? <span className="badge-amber ml-1.5">VIP</span> : null}
                    {c.is_blacklisted ? <span className="badge-red ml-1.5">لیست سیاه</span> : null}
                    <div className="text-xs text-zinc-400">{c.code}</div>
                  </td>
                  <td className="td hidden sm:table-cell">
                    <span className={customerTypeBadge(c.customer_type)}>{customerTypeFa(c.customer_type)}</span>
                    {c.customer_type === "organization" && c.organization_name && (
                      <div className="text-xs text-zinc-400 mt-0.5">{c.organization_name}</div>
                    )}
                  </td>
                  <td className="td hidden md:table-cell text-zinc-500">
                    <div>{c.mobile}</div>
                    {c.email && <div className="text-xs">{c.email}</div>}
                  </td>
                  <td className="td hidden sm:table-cell">{c.device_count}</td>
                  <td className="td hidden lg:table-cell">{c.repair_count}</td>
                  <td className="td">
                    {c.balance===null?<span className="badge-amber">در انتظار تطبیق مالی</span>:c.balance > 0 ? <span className="badge-amber">{fmtMoney(c.balance)}</span> : <span className="text-zinc-400">—</span>}
                  </td>
                  <td className="td hidden md:table-cell">
                    <div className="flex gap-1 flex-wrap">
                      {JSON.parse(c.tags ?? "[]").slice(0, 3).map((t: string) => <span key={t} className="chip">{t}</span>)}
                    </div>
                  </td>
                  <td className="td hidden lg:table-cell text-zinc-400 text-[13px]">{timeAgo(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination base="/customers" sp={sp} page={page} totalPages={totalPages} total={total} perPage={perPage} unit="مشتری" />
        </div>
      )}
    </div>
  );
}
