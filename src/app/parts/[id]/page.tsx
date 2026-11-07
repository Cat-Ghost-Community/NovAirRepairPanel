import { requirePageAccess } from "@/lib/page-access";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/schema";
import { fmtMoney, fmtDateTime, toFaDigits,faQty } from "@/lib/format";
import { PartStockActions } from "./stock-actions";
import { activeBranch, branchWhere, BRANCH_COOKIE } from "@/lib/branch";
import { cookies } from "next/headers";
import { canUser } from "@/lib/auth";
import { addQuantity } from "@/lib/money";

export const dynamic = "force-dynamic";

const MOVEMENT_LABELS: Record<string, string> = {
  purchase: "خرید", sale: "فروش", repair_consumption: "مصرف در تعمیر", return: "برگشتی",
  adjustment: "اصلاح", transfer_in: "انتقال ورودی", transfer_out: "انتقال خروجی",
  damage: "آسیب", loss: "زیان", warranty_return: "برگشت گارانتی", supplier_return: "برگشت به تأمین‌کننده",
};

export default async function PartDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePageAccess("/parts/[id]");
  const { id } = await params;
  const db = getDb();
  const scope = activeBranch(session, (await cookies()).get(BRANCH_COOKIE)?.value);
  const locationScope = branchWhere(scope, "l");
  const movementScope = branchWhere(scope, "m");
  const partId = Number(id);
  const p = db
    .prepare(
      `SELECT p.*, s.name supplier_name FROM parts p LEFT JOIN suppliers s ON s.id = p.preferred_supplier_id WHERE p.id = ?`
    )
    .get(partId) as any;
  if (!p) notFound();

  const stock = db
    .prepare(
      `SELECT st.*, l.name location_name FROM inventory_stock st JOIN inventory_locations l ON l.id = st.location_id WHERE st.part_id = ? AND ${locationScope.sql}`
    )
    .all(partId, ...locationScope.params) as any[];
  const movements = db
    .prepare(
      `SELECT m.*, l.name location_name, u.name user_name
       FROM inventory_movements m
       LEFT JOIN inventory_locations l ON l.id = m.location_id
       LEFT JOIN users u ON u.id = m.user_id
       WHERE m.part_id = ? AND ${movementScope.sql} ORDER BY m.created_at DESC, m.id DESC LIMIT 40`
    )
    .all(partId, ...movementScope.params) as any[];
  const locations = db.prepare("SELECT id, name FROM inventory_locations l WHERE " + locationScope.sql).all(...locationScope.params) as any[];
  const totalStock = stock.reduce((s: number, r: any) => addQuantity(s, r.qty), 0);
  const onOrder = db
    .prepare(`SELECT COALESCE(SUM(qty - received_qty),0) v FROM purchase_order_items WHERE part_id = ? AND po_id IN (SELECT id FROM purchase_orders WHERE status IN ('sent','partially_received') AND (@branch IS NULL OR branch_id=@branch))`)
    .get({ branch: scope.branchId }, partId) as any;

  const margin = p.price > 0 ? Math.round(((p.price - (p.avg_cost ?? p.purchase_price)) / p.price) * 100) : 0;

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6 space-y-4">
      <div className="card card-pad">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold">{p.name}</h1>
            <div className="text-sm text-zinc-500 font-mono">{p.sku}{p.barcode ? ` · ${p.barcode}` : ""}</div>
            <div className="mt-1 text-sm text-zinc-500">{p.category} · {p.brand} · سازگار با {p.compatibility}</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">{totalStock}</div>
            <div className="text-xs text-zinc-400">موجودی {toFaDigits(totalStock)}{onOrder.v > 0 ? ` · ${toFaDigits(onOrder.v)} عدد در سفارش خرید` : ""}</div>
            <div className="mt-1 text-sm">
              <span className="text-zinc-400">بهای تمام‌شده {fmtMoney(p.avg_cost ?? p.purchase_price)}</span> ·{" "}
              <span className="font-medium">{fmtMoney(p.price)}</span> ·{" "}
              <span className={margin >= 40 ? "text-emerald-600" : "text-amber-600"}>حاشیه سود {toFaDigits(margin)}٪</span>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-200 dark:border-zinc-800 pt-3">
          <PartStockActions partId={p.id} locations={JSON.parse(JSON.stringify(locations))} canAdjust={canUser(session, "inventory.edit")} purchaseCost={p.purchase_price ?? 0} />
          <Link href={`/purchase-orders/new?part_id=${p.id}`} className="btn-secondary btn-sm">سفارش مجدد از تأمین‌کننده</Link>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <section className="card card-pad">
          <h2 className="section-title mb-3">موجودی به تفکیک انبار</h2>
          {stock.length === 0 ? (
            <p className="text-sm text-zinc-400">در هیچ انباری موجودی نیست.</p>
          ) : (
            <div className="space-y-2">
              {stock.map((s) => (
                <div key={s.id} className="flex flex-wrap justify-between gap-2 text-sm min-w-0">
                  <span className="break-words min-w-0">{s.location_name}</span>
                  <span className="font-medium">{faQty(Number(s.qty))}{s.reserved > 0 ? ` (${faQty(Number(s.reserved))} رزرو)` : ""}</span>
                  {s.carrying_value!=null&&canUser(session,'finance.view')&&<span className="w-full text-xs text-zinc-500">ارزش دفتری دقیق: {fmtMoney(Number(s.carrying_value),'rial')}</span>}
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 pt-3 border-t border-zinc-200 dark:border-zinc-800 text-[13px] space-y-1.5 text-zinc-500">
            <div className="flex justify-between"><span>حداقل موجودی</span><span>{p.min_stock ?? 0}</span></div>
            <div className="flex justify-between"><span>نقطه سفارش</span><span>{p.reorder_point ?? 0}</span></div>
            <div className="flex justify-between"><span>تأمین‌کننده ترجیحی</span><span>{p.supplier_name ?? "—"}</span></div>
            <div className="flex justify-between"><span>محل قفسه</span><span>{[p.location, p.shelf, p.bin].filter(Boolean).join(" · ") || "—"}</span></div>
          </div>
        </section>

        <section className="card lg:col-span-2">
          <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800">
            <h2 className="section-title">سابقه گردش</h2>
          </div>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full">
              <thead className="border-b border-zinc-200 dark:border-zinc-800 sticky top-0 bg-white dark:bg-zinc-900">
                <tr><th className="th">زمان</th><th className="th">نوع</th><th className="th">تعداد</th><th className="th hidden sm:table-cell">انبار</th><th className="th hidden md:table-cell">یادداشت</th><th className="th hidden lg:table-cell">کاربر</th></tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td className="td whitespace-nowrap text-zinc-500 text-[13px]">{fmtDateTime(m.created_at)}</td>
                    <td className="td"><span className="badge-gray">{MOVEMENT_LABELS[m.type] ?? m.type}</span></td>
                    <td className={`td font-medium ${m.qty > 0 ? "text-emerald-600" : "text-red-600"}`}>{m.qty > 0 ? `+${m.qty}` : m.qty}</td>
                    <td className="td hidden sm:table-cell text-zinc-500">{m.location_name ?? "—"}</td>
                    <td className="td hidden md:table-cell text-zinc-500 text-[13px] max-w-[200px] truncate">{m.note}</td>
                    <td className="td hidden lg:table-cell text-zinc-500 text-[13px]">{m.user_name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
