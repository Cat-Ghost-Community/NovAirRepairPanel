import { requirePageAccess } from "@/lib/page-access";
import { toFaDigits, fmtMoney, fmtDate } from "@/lib/format";
import Link from "next/link";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db/schema";
import { EmptyState } from "@/components/ui";
import { InvStatusBadge } from "@/app/repairs/[id]/workspace-client";
import { Pagination } from "@/components/pagination";
import { countOf, resolvePaging } from "@/lib/pagination";
import { getSessionByToken, canUser } from "@/lib/auth";
import { BRANCH_COOKIE, activeBranch, branchWhere } from "@/lib/branch";
import { redirect } from "next/navigation";
import { InvoiceFilters } from "./invoice-filters";

export const dynamic = "force-dynamic";

const TYPE_FA: Record<string, string> = { purchase: "خرید", sale: "فروش", repair: "تعمیر" };
const TYPE_BADGE: Record<string, string> = { purchase: "badge-amber", sale: "badge-blue", repair: "badge-purple" };

/** فهرست یکپارچهٔ فاکتورها: خرید، فروش و تعمیر + فیلتر نوع/وضعیت/جست‌وجو/بازه */
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageAccess("/invoices");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "invoices.view")) redirect("/");
  const sp = await searchParams;
  const db = getDb();
  const q = (sp.q ?? "").trim();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from : undefined;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to : undefined;
  const type = ["purchase", "sale", "repair"].includes(sp.type ?? "") ? sp.type : undefined;

  const where: string[] = ["1=1"];
  const params: any[] = [];
  const scope = activeBranch(session, cookieStore.get(BRANCH_COOKIE)?.value);
  const bScope = branchWhere(scope, "i");
  if (bScope.sql !== "1=1") {
    where.push(bScope.sql);
    params.push(...bScope.params);
  }
  if (type) {
    where.push("COALESCE(i.type,'repair') = ?");
    params.push(type);
  }
  if (sp.status === "unpaid") where.push("i.status IN ('issued','partially_paid','overdue')");
  else if (sp.status) {
    where.push("i.status = ?");
    params.push(sp.status);
  }
  if (from) {
    where.push("date(i.date) >= date(?)");
    params.push(from);
  }
  if (to) {
    where.push("date(i.date) <= date(?)");
    params.push(to);
  }
  if (q) {
    const like = `%${q}%`;
    where.push("(i.number LIKE ? OR i.external_number LIKE ? OR (c.first_name || ' ' || c.last_name) LIKE ? OR sup.name LIKE ? OR t.number LIKE ?)");
    params.push(like, like, like, like, like);
  }
  const whereSql = where.join(" AND ");
  const base = `FROM effective_invoices i
    LEFT JOIN customers c ON c.id = i.customer_id AND COALESCE(i.type,'repair') != 'purchase'
    LEFT JOIN suppliers sup ON sup.id = i.supplier_id
    LEFT JOIN repair_tickets t ON t.id = i.ticket_id
    WHERE ${whereSql}`;

  const total = countOf(db, `SELECT COUNT(*) c ${base}`, params);
  const { page, perPage, offset, totalPages } = resolvePaging(sp, total);
  const invoices = JSON.parse(
    JSON.stringify(
      db
        .prepare(
          `SELECT i.*, c.first_name, c.last_name, c.company, sup.name supplier_name, t.number ticket_number ${base}
           ORDER BY i.created_at DESC, i.id DESC LIMIT ${perPage} OFFSET ${offset}`
        )
        .all(...params) as any[]
    )
  ) as any[];

  // مانده و Aging فقط برای مطالبات (فروش/تعمیر)؛ خرید پرداختی است
  const dueRow = db
    .prepare(
      `SELECT COALESCE(SUM(i.total - i.paid),0) due, COUNT(*) c ${base} AND i.status IN ('issued','partially_paid','overdue') AND COALESCE(i.type,'repair') != 'purchase'`
    )
    .get(...params) as any;
  const openInvoices = db
    .prepare(
      `SELECT i.total, i.paid, COALESCE(i.due_date, i.date) due ${base} AND i.status IN ('issued','partially_paid','overdue') AND COALESCE(i.type,'repair') != 'purchase'`
    )
    .all(...params) as any[];
  const aging = { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 };
  for (const i of openInvoices) {
    // eslint-disable-next-line react-hooks/purity
    const days = Math.floor((Date.now() - new Date(String(i.due) + "T00:00:00Z").getTime()) / 86400000);
    const bal = i.total - i.paid;
    if (days <= 0) aging.current += bal;
    else if (days <= 30) aging.d30 += bal;
    else if (days <= 60) aging.d60 += bal;
    else if (days <= 90) aging.d90 += bal;
    else aging.d90p += bal;
  }
  const canCreate = canUser(session, "invoices.create");
  const canPurchase = canUser(session, "purchasing.manage");

  const chipHref = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    p.delete("page");
    const qs = p.toString();
    return `/invoices${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <div className="page-head">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="page-title">فاکتورها</h1>
            <p className="page-sub">
              مانده مطالبات: <span className="font-medium text-amber-600">{fmtMoney(dueRow.due)}</span> در {toFaDigits(dueRow.c)} فاکتور
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/payments/new" className="btn-secondary">ثبت پرداخت</Link>
            {canPurchase && <Link href="/invoices/new?type=purchase" className="btn-secondary">فاکتور خرید</Link>}
            {canCreate && <Link href="/invoices/new" className="btn-primary">فاکتور جدید</Link>}
          </div>
        </div>

        {/* نوع فاکتور */}
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">
          {[
            { label: "همهٔ انواع", value: undefined },
            { label: "خرید", value: "purchase" },
            { label: "فروش", value: "sale" },
            { label: "تعمیر", value: "repair" },
          ].map((t) => (
            <Link key={t.label} href={chipHref({ type: t.value })} className={`filter-chip ${type === t.value ? "filter-chip-active" : "filter-chip-idle"}`}>
              {t.label}
            </Link>
          ))}
          <span className="mx-1 w-px bg-zinc-200 dark:bg-zinc-700" aria-hidden />
          {[
            { label: "همهٔ وضعیت‌ها", value: undefined },
            { label: "پرداخت‌نشده", value: "unpaid" },
            { label: "پرداخت‌شده", value: "paid" },
            { label: "سررسید گذشته", value: "overdue" },
            { label: "لغوشده", value: "cancelled" },
          ].map((s) => (
            <Link key={s.label} href={chipHref({ status: s.value })} className={`filter-chip ${(sp.status ?? undefined) === s.value ? "filter-chip-active" : "filter-chip-idle"}`}>
              {s.label}
            </Link>
          ))}
        </div>

        <InvoiceFilters q0={q} from0={from ?? ""} to0={to ?? ""} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5 mb-3">
        {[
          { label: "جاری", v: aging.current }, { label: "۱–۳۰ روز", v: aging.d30 },
          { label: "۳۱–۶۰ روز", v: aging.d60 }, { label: "۶۱–۹۰ روز", v: aging.d90 },
          { label: "بیش از ۹۰ روز", v: aging.d90p },
        ].map((a) => (
          <div key={a.label} className="card px-3 py-2.5">
            <div className="text-xs text-zinc-400">{a.label}</div>
            <div className={`text-sm font-semibold ${a.v > 0 ? "text-amber-600" : ""}`}>{fmtMoney(a.v)}</div>
          </div>
        ))}
      </div>

      {invoices.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="receipt"
            title={q || from || to ? "نتیجه‌ای برای این جست‌وجو نیست" : "اینجا فاکتوری نیست"}
            body={q || from || to ? "عبارت دیگری امتحان کنید یا فیلترها را پاک کنید." : "از «فاکتور جدید» خرید، فروش یا تعمیر ثبت کنید."}
            action={canCreate || canPurchase ? <Link href="/invoices/new" className="btn-primary btn-sm">فاکتور جدید</Link> : undefined}
          />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-zinc-200 dark:border-zinc-800">
                <tr>
                  <th className="th">فاکتور</th><th className="th">نوع</th><th className="th">طرف حساب</th>
                  <th className="th hidden md:table-cell">مرجع</th><th className="th">تاریخ</th><th className="th">جمع کل</th>
                  <th className="th">مانده</th><th className="th">وضعیت</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {invoices.map((i) => {
                  const t = (i.type ?? "repair") as string;
                  const overdue = ["issued", "partially_paid"].includes(i.status) && i.due_date && new Date(i.due_date + "T00:00:00Z") < new Date();
                  const party = t === "purchase" ? i.supplier_name ?? "—" : i.company ?? `${i.first_name ?? ""} ${i.last_name ?? ""}`.trim();
                  return (
                    <tr key={i.id} className="row-hover">
                      <td className="td">
                        <Link href={`/invoices/${i.id}`} className="font-mono text-[13px] font-semibold text-brand-600 hover:underline">{i.number}</Link>
                        {i.status === "draft" && <span className="badge-gray mr-1 !text-[10px]">پیش‌نویس</span>}
                      </td>
                      <td className="td"><span className={`${TYPE_BADGE[t]} !text-[10px]`}>{TYPE_FA[t]}</span></td>
                      <td className="td max-w-40 truncate">{party}</td>
                      <td className="td hidden md:table-cell">
                        {i.ticket_number ? (
                          <Link className="font-mono text-xs text-brand-600 hover:underline" href={`/repairs/${i.ticket_id}`}>{i.ticket_number}</Link>
                        ) : i.external_number ? (
                          <span className="text-xs text-zinc-500 ltr-num" dir="ltr">{i.external_number}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="td text-zinc-500 whitespace-nowrap">{fmtDate(i.date)}</td>
                      <td className="td">{fmtMoney(i.total)}</td>
                      <td className="td font-medium">
                        {i.status === "cancelled" ? <span className="text-zinc-400">—</span> : i.total - i.paid > 0 ? fmtMoney(i.total - i.paid) : <span className="text-zinc-400">تسویه</span>}
                      </td>
                      <td className="td"><InvStatusBadge status={overdue && i.status === "issued" ? "overdue" : i.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination base="/invoices" sp={sp} page={page} totalPages={totalPages} total={total} perPage={perPage} unit="فاکتور" />
        </div>
      )}
    </div>
  );
}
