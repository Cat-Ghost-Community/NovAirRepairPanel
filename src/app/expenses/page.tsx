import { requirePageAccess } from "@/lib/page-access";
import Link from "next/link";
import { getDb } from "@/lib/db/schema";
import { fmtMoney, fmtDate } from "@/lib/format";
import { EmptyState } from "@/components/ui";
import { Icon } from "@/components/icon";
import { Pagination } from "@/components/pagination";
import { countOf, resolvePaging } from "@/lib/pagination";
import { getSessionByToken, canUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { BRANCH_COOKIE, activeBranch, branchWhere } from "@/lib/branch";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const CATEGORY_ICONS: Record<string, string> = {
  Rent: "home", Utilities: "zap", Salary: "users", Tools: "wrench", Parts: "package", Marketing: "megaphone", Shipping: "truck", Maintenance: "sliders", Other: "clipboard",
};

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageAccess("/expenses");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "expenses.view")) redirect("/");
  const sp = await searchParams;
  const db = getDb();
  let sql = `SELECT e.*, b.name branch_name, u.name user_name FROM expenses e
       LEFT JOIN branches b ON b.id = e.branch_id LEFT JOIN users u ON u.id = e.user_id
       WHERE 1=1`;
  const params: any[] = [];
  const bScope = branchWhere(activeBranch(session, cookieStore.get(BRANCH_COOKIE)?.value), "e");
  if (bScope.sql !== "1=1") { sql += ` AND ${bScope.sql}`; params.push(...bScope.params); }
  if (sp.category) { sql += " AND e.category = ?"; params.push(sp.category); }
  if (sp.q) {
    sql += " AND (e.vendor LIKE ? OR e.description LIKE ? OR e.category LIKE ?)";
    const like = `%${sp.q}%`;
    params.push(like, like, like);
  }
  const total = countOf(db, sql, params);
  const { page, perPage, offset, totalPages } = resolvePaging(sp, total);
  sql += ` ORDER BY e.date DESC, e.id DESC LIMIT ${perPage} OFFSET ${offset}`;
  const expenses = JSON.parse(JSON.stringify(db.prepare(sql).all(...params) as any[])) as any[];
  const byCategory = db
    .prepare(
      `SELECT category, COALESCE(SUM(amount),0) total FROM expenses e
       WHERE e.date >= date('now','start of month') AND ${bScope.sql} GROUP BY category ORDER BY total DESC`
    )
    .all(...bScope.params) as any[];
  const monthTotal = byCategory.reduce((s: number, c: any) => s + c.total, 0);

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="page-head">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="page-title">هزینه‌ها</h1>
            <p className="page-sub">این ماه: <span className="font-medium">{fmtMoney(monthTotal)}</span></p>
          </div>
          <Link href="/expenses/new" className="btn-primary">+ هزینه جدید</Link>
        </div>
      </div>

      {byCategory.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6 mb-3">
          {byCategory.map((c) => (
            <div key={c.category} className="card px-3 py-2.5">
              <div className="text-xs text-zinc-400"><Icon name={CATEGORY_ICONS[c.category] ?? "clipboard"} size={13} className="inline align-[-2px] opacity-60" /> {c.category}</div>
              <div className="text-sm font-semibold">{fmtMoney(c.total)}</div>
            </div>
          ))}
        </div>
      )}

      {expenses.length === 0 ? (
        <div className="card"><EmptyState icon="banknote-down" title="هزینه‌ای ثبت نشده" body="اجاره، حقوق، خرید قطعات و سایر هزینه‌ها را ثبت کنید تا سود واقعی را ببینید." action={<Link href="/expenses/new" className="btn-primary">افزودن هزینه</Link>} /></div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="th">تاریخ</th><th className="th">دسته</th><th className="th">فروشنده</th>
                <th className="th hidden md:table-cell">توضیحات</th><th className="th hidden lg:table-cell">شعبه</th><th className="th text-right">مبلغ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {expenses.map((e) => (
                <tr key={e.id} className="row-hover">
                  <td className="td whitespace-nowrap text-zinc-500">{fmtDate(e.date)}</td>
                  <td className="td"><span className="badge-gray"><Icon name={CATEGORY_ICONS[e.category] ?? "clipboard"} size={13} className="inline align-[-2px] opacity-60" /> {e.category}</span></td>
                  <td className="td">{e.vendor}</td>
                  <td className="td hidden md:table-cell text-zinc-500 max-w-[240px] truncate">{e.description}</td>
                  <td className="td hidden lg:table-cell text-zinc-500">{e.branch_name ?? "—"}</td>
                  <td className="td text-right font-semibold">{fmtMoney(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <Pagination base="/expenses" sp={sp} page={page} totalPages={totalPages} total={total} perPage={perPage} unit="هزینه" />
        </div>
      )}
    </div>
  );
}
