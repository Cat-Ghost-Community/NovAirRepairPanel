import { requirePageAccess } from "@/lib/page-access";
import Link from "next/link";
import { getDb } from "@/lib/db/schema";
import { fmtMoney, toFaDigits } from "@/lib/format";
import { EmptyState } from "@/components/ui";
import { Pagination } from "@/components/pagination";
import { resolvePaging } from "@/lib/pagination";
import { getSessionByToken, canUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { activeBranch,BRANCH_COOKIE } from '@/lib/branch';
import { inventoryValue } from '@/lib/inventory';

export const dynamic = "force-dynamic";

export default async function PartsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageAccess("/parts");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "inventory.view")) redirect("/");
  const sp = await searchParams;
  const db = getDb();
  const scope=activeBranch(session,cookieStore.get(BRANCH_COOKIE)?.value);
  const q = sp.q?.trim();
  let sql = `SELECT p.*, s.name supplier_name, COALESCE(SUM(st.qty),0) stock
    FROM parts p
    LEFT JOIN suppliers s ON s.id = p.preferred_supplier_id
    LEFT JOIN inventory_stock st ON st.part_id = p.id AND (? IS NULL OR st.location_id IN (SELECT id FROM inventory_locations WHERE branch_id=?))
    WHERE p.is_active = 1`;
  const params: any[] = [scope.branchId,scope.branchId];
  if (q) {
    sql += " AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.compatibility LIKE ?)";
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (sp.category) { sql += " AND p.category = ?"; params.push(sp.category); }
  sql+=' GROUP BY p.id';
  if (sp.filter === "low") sql += " HAVING stock > 0 AND stock <= COALESCE(p.reorder_point, p.min_stock, 0)";
  if (sp.filter === "out") sql += " HAVING stock = 0";
  const countSql = `SELECT COUNT(*) c FROM (${sql})`;
  const total = Number(db.prepare(countSql).get(...params)?.c ?? 0);
  const { page, perPage, offset, totalPages } = resolvePaging(sp, total);
  sql += ` ORDER BY p.name LIMIT ${perPage} OFFSET ${offset}`;
  const parts = JSON.parse(JSON.stringify(db.prepare(sql).all(...params) as any[])) as any[];

  const totalValue = inventoryValue(scope.branchId);
  const categories = db.prepare("SELECT DISTINCT category FROM parts WHERE category IS NOT NULL ORDER BY category").all() as any[];

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <div className="page-head">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="page-title">قطعات و موجودی</h1>
            <p className="page-sub">ارزش کل موجودی: <span className="font-medium">{fmtMoney(totalValue)}</span> · {toFaDigits(total)} کالا</p>
          </div>
          <div className="flex gap-2">
            <form className="flex gap-1.5">
              <input name="q" defaultValue={q} placeholder="جستجوی نام، کد، بارکد…" className="input !w-40 sm:!w-56" aria-label="جستجوی قطعات" />
              <button className="btn-secondary">جستجو</button>
            </form>
            <Link href="/parts/new" className="btn-primary">+ کالای جدید</Link>
          </div>
        </div>

        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">
          {[
            { label: "همه قطعات", href: "/parts", active: !sp.filter && !sp.category },
            { label: "کمبود موجودی", href: "/parts?filter=low", active: sp.filter === "low" },
            { label: "اتمام موجودی", href: "/parts?filter=out", active: sp.filter === "out" },
          ].map((f) => (
            <Link key={f.label} href={f.href} className={`filter-chip ${f.active ? "filter-chip-active" : "filter-chip-idle"}`}>{f.label}</Link>
          ))}
          {categories.map((c: any) => (
            <Link key={c.category} href={`/parts?category=${encodeURIComponent(c.category)}`} className={`filter-chip ${sp.category === c.category ? "filter-chip-active" : "filter-chip-idle"}`}>{c.category}</Link>
          ))}
        </div>
      </div>

      {parts.length === 0 ? (
        <div className="card">
          <EmptyState icon="package" title="قطعه‌ای پیدا نشد" body="قطعات هنگام مصرف در تعمیرات خودکار کسر و هنگام دریافت کالا اضافه می‌شوند." action={<Link href="/parts/new" className="btn-primary">اولین قطعه را اضافه کنید</Link>} />
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="th">قطعه</th>
                <th className="th hidden md:table-cell">دسته‌بندی</th>
                <th className="th">موجودی</th>
                <th className="th hidden lg:table-cell">قیمت خرید</th>
                <th className="th">قیمت</th>
                <th className="th hidden md:table-cell">تأمین‌کننده</th>
                <th className="th hidden lg:table-cell">انبار</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {parts.map((p) => {
                const threshold = p.reorder_point ?? p.min_stock ?? 0;
                const stockCls = p.stock === 0 ? "badge-red" : threshold > 0 && p.stock <= threshold ? "badge-amber" : "badge-green";
                return (
                  <tr key={p.id} className="row-hover">
                    <td className="td">
                      <Link href={`/parts/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                      <div className="text-xs text-zinc-400 font-mono">{p.sku}</div>
                    </td>
                    <td className="td hidden md:table-cell text-zinc-500">{p.category}</td>
                    <td className="td"><span className={stockCls}>{p.stock}</span></td>
                    <td className="td hidden lg:table-cell">{fmtMoney(p.avg_cost || p.purchase_price)}</td>
                    <td className="td font-medium">{fmtMoney(p.price)}</td>
                    <td className="td hidden md:table-cell text-zinc-500">{p.supplier_name ?? "—"}</td>
                    <td className="td hidden lg:table-cell text-zinc-500">{[p.location, p.shelf, p.bin].filter(Boolean).join(" · ") || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination base="/parts" sp={sp} page={page} totalPages={totalPages} total={total} perPage={perPage} unit="کالا" />
        </div>
      )}
    </div>
  );
}
