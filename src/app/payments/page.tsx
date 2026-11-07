import { requirePageAccess } from "@/lib/page-access";
import Link from "next/link";
import { getDb } from "@/lib/db/schema";
import { fmtMoney, fmtDateTime } from "@/lib/format";
import { EmptyState } from "@/components/ui";
import { Pagination } from "@/components/pagination";
import { countOf, resolvePaging } from "@/lib/pagination";
import { getSessionByToken, canUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { BRANCH_COOKIE, activeBranch, branchWhere } from "@/lib/branch";
import { redirect } from "next/navigation";
import {settledCashTotals,SETTLED_PAYMENT} from '@/lib/payment-state';

export const dynamic = "force-dynamic";

const METHOD_LABELS: Record<string, string> = { cash: "نقدی", card: "کارتخوان", transfer: "حواله بانکی", online: "پرداخت آنلاین", check: "چک", other: "سایر" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageAccess("/payments");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "payments.view")) redirect("/");
  const sp = await searchParams;
  const db = getDb();
  let sql = `SELECT p.*, ${SETTLED_PAYMENT} settled, c.first_name, c.last_name, i.number invoice_number, s.number sale_number
       FROM payments p
       LEFT JOIN customers c ON c.id = p.customer_id
       LEFT JOIN invoices i ON i.id = p.invoice_id
       LEFT JOIN sales s ON s.id = p.sale_id
       WHERE 1=1`;
  const params: any[] = [];
  const bScope = branchWhere(activeBranch(session, cookieStore.get(BRANCH_COOKIE)?.value), "p");
  if (bScope.sql !== "1=1") { sql += ` AND ${bScope.sql}`; params.push(...bScope.params); }
  if (sp.method) { sql += " AND p.method = ?"; params.push(sp.method); }
  if (sp.direction) { sql += " AND p.direction = ?"; params.push(sp.direction); }
  if (sp.q) {
    sql += " AND (p.number LIKE ? OR (c.first_name || ' ' || c.last_name) LIKE ?)";
    const like = `%${sp.q}%`;
    params.push(like, like);
  }
  const total = countOf(db, sql, params);
  const { page, perPage, offset, totalPages } = resolvePaging(sp, total);
  sql += ` ORDER BY p.created_at DESC LIMIT ${perPage} OFFSET ${offset}`;
  const payments = JSON.parse(JSON.stringify(db.prepare(sql).all(...params) as any[])) as any[];
  const refunds = db
    .prepare(
      `SELECT r.*, c.first_name, c.last_name, u.name user_name FROM refunds r
       LEFT JOIN customers c ON c.id = r.customer_id LEFT JOIN users u ON u.id = r.user_id
       WHERE ${bScope.sql.replace("p.", "r.")}
       ORDER BY r.created_at DESC LIMIT 5`
    )
    .all(...bScope.params) as any[];

  const now=new Date(),today = now.toISOString().slice(0, 10);
  const until=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1)).toISOString().slice(0,10),branch=activeBranch(session,cookieStore.get(BRANCH_COOKIE)?.value).branchId;
  const inToday=settledCashTotals(db,branch,today,until).inflow;
  const inMonth=settledCashTotals(db,branch,today.slice(0,7)+'-01',until).inflow;
  const refunded = (db.prepare(`SELECT COALESCE(SUM(r.amount),0) v FROM refunds r WHERE r.created_at >= datetime('now','start of month') AND ${bScope.sql.replace("p.", "r.")}`).get(...bScope.params) as any).v;

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="page-head">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="page-title">دریافت و پرداخت</h1>
            <p className="page-sub">وصول امروز: <span className="font-medium text-emerald-600">{fmtMoney(inToday)}</span> · وصول ماه میلادی: <span className="font-medium">{fmtMoney(inMonth)}</span> · برگشتی: <span className="text-red-500">{fmtMoney(refunded)}</span></p>
            <p className="mt-1 text-xs text-zinc-500">مبنای وصول، تاریخ دریافت وجه یا وصول قطعی چک است (UTC)؛ چک در جریان، وجه وصول‌شده نیست.</p>
          </div>
          <div className="flex flex-wrap gap-2"><Link href="/payments/credit" className="btn-secondary">اعتبار مشتریان</Link><Link href="/payments/new" className="btn-primary">+ ثبت پرداخت</Link></div>
        </div>
      </div>

      {refunds.length > 0 && (
        <section className="card mb-3">
          <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-800"><h2 className="section-title">بازگشت‌های اخیر</h2></div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {refunds.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                <span><span className="font-medium text-red-600">−{fmtMoney(r.amount)}</span> · {r.reason ?? "بازگشت وجه"} · {r.first_name} {r.last_name} <span className="text-xs text-zinc-400">by {r.user_name}</span></span>
                <span className="text-xs text-zinc-400">{fmtDateTime(r.created_at)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {payments.length === 0 ? (
        <div className="card"><EmptyState icon="banknote" title="پرداختی ثبت نشده" body="پرداخت‌ها هنگام دریافت در تحویل، فروش صندوق یا ثبت دستی اینجا می‌آیند." action={<Link href="/payments/new" className="btn-primary">ثبت پرداخت</Link>} /></div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="th">پرداخت</th><th className="th">مشتری</th><th className="th hidden md:table-cell">مرجع</th>
                <th className="th">روش</th><th className="th">مبلغ</th><th className="th hidden sm:table-cell">تاریخ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {payments.map((p) => (
                <tr key={p.id} className="row-hover">
                  <td className="td font-mono text-[13px]">{p.number}</td>
                  <td className="td">{p.first_name ? `${p.first_name} ${p.last_name}` : "حضوری"}</td>
                  <td className="td hidden md:table-cell">
                    {p.invoice_number ? <span className="chip">INV {p.invoice_number}</span> : p.sale_number ? <span className="chip">SALE {p.sale_number}</span> : "—"}
                  </td>
                  <td className="td"><span>{METHOD_LABELS[p.method] ?? p.method}</span>{!p.settled&&<span className="badge-amber mt-1 block w-fit">وصول‌نشده</span>}</td>
                  <td className={`td font-semibold ${p.direction === "out" ? "text-red-600" : "text-emerald-600"}`}>
                    {p.direction === "out" ? "−" : ""}{fmtMoney(p.amount)}
                  </td>
                  <td className="td hidden sm:table-cell text-zinc-500 whitespace-nowrap text-[13px]">{fmtDateTime(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <Pagination base="/payments" sp={sp} page={page} totalPages={totalPages} total={total} perPage={perPage} unit="سند پرداخت" />
        </div>
      )}
    </div>
  );
}
