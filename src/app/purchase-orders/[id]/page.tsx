import { requirePageAccess } from "@/lib/page-access";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/schema";
import { fmtMoney, fmtDate } from "@/lib/format";
import { PoActions } from "./po-actions";
import { cookies } from "next/headers";
import { canUser } from "@/lib/auth";
import { activeBranch, BRANCH_COOKIE } from "@/lib/branch";
import { addQuantity } from "@/lib/money";

export const dynamic = "force-dynamic";

const PO_STATUS_FA: Record<string, string> = {
  draft: "پیش‌نویس", sent: "ارسال‌شده", partially_received: "دریافت جزئی", received: "دریافت کامل", cancelled: "لغوشده",
};

export default async function PODetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePageAccess("/purchase-orders/[id]");
  const { id } = await params;
  const scope = activeBranch(session, (await cookies()).get(BRANCH_COOKIE)?.value);
  const db = getDb();
  const poId = Number(id);
  const po = db
    .prepare(`SELECT po.*, s.name supplier_name FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ?`)
    .get(poId) as any;
  if (!po) notFound();
  if (!scope.all && po.branch_id !== scope.branchId) notFound();
  const items = db
    .prepare(
      `SELECT i.*, p.name part_name, p.sku FROM purchase_order_items i LEFT JOIN parts p ON p.id = i.part_id WHERE i.po_id = ?`
    )
    .all(poId) as any[];
  const receipts = db.prepare("SELECT * FROM goods_receipts WHERE po_id = ? ORDER BY created_at DESC").all(poId) as any[];
  const open = items.filter((i) => addQuantity(i.qty, -i.received_qty) > 0);
  // اتصال مالی: فاکتور خرید مرتبط (اگر صادر شده) یا امکان صدور
  const linkedInvoice = db
    .prepare("SELECT id, number, status FROM invoices WHERE purchase_order_id = ? AND status != 'cancelled'")
    .get(poId) as any;
  const canInvoice = !!session && canUser(session, "purchasing.manage");
  const needsReview = po.status === "partially_received" && (po.tax > 0 || po.discount > 0 || po.shipping > 0);
  const receivable = ["received", "partially_received"].includes(String(po.status)) && !needsReview;

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6 space-y-4">
      <div className="card card-pad">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-mono text-lg font-bold">{po.number}</h1>
            <div className="text-sm text-zinc-500">
              <Link href={`/suppliers/${po.supplier_id}`} className="hover:underline">{po.supplier_name}</Link>
              {" · "}ثبت {fmtDate(po.date)}{" · "}تحویل مورد انتظار {fmtDate(po.expected_date)}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {linkedInvoice ? (
                <Link href={`/invoices/${linkedInvoice.id}`} className="badge-blue no-underline">فاکتور خرید {linkedInvoice.number}</Link>
              ) : canInvoice && receivable ? (
                <Link href={`/invoices/new?po=${po.id}`} className="btn-secondary btn-sm no-underline">صدور فاکتور خرید</Link>
              ) : needsReview ? <span className="text-xs text-amber-600">تخصیص مالیات، تخفیف و حملِ دریافت جزئی نیازمند بررسی مالی است.</span> : !linkedInvoice && po.status !== "cancelled" ? (
                <span className="text-xs text-zinc-400">فاکتور خرید پس از «دریافت کالا» از همین‌جا صادر می‌شود.</span>
              ) : null}
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">{fmtMoney(po.total)}</div>
            <div className="text-xs text-zinc-400">{PO_STATUS_FA[po.status] ?? po.status}</div>
          </div>
        </div>
        {canInvoice && <PoActions poId={po.id} status={po.status} openItems={JSON.parse(JSON.stringify(open.map((i) => ({ id: i.id, name: i.part_name ?? i.name, remaining: addQuantity(i.qty, -i.received_qty) }))))} />}
      </div>

      <section className="card">
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800"><h2 className="section-title">اقلام</h2></div>
        <table className="w-full">
          <thead className="border-b border-zinc-200 dark:border-zinc-800">
            <tr><th className="th">قطعه</th><th className="th">سفارش‌داده‌شده</th><th className="th">دریافت‌شده</th><th className="th">قیمت واحد</th><th className="th">جمع کل</th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {items.map((i) => (
              <tr key={i.id}>
                <td className="td">{i.part_name ?? i.name}<div className="text-xs text-zinc-400 font-mono">{i.sku}</div></td>
                <td className="td">{i.qty}</td>
                <td className="td">
                  <span className={i.received_qty >= i.qty ? "text-emerald-600 font-medium" : ""}>{i.received_qty}</span>
                  {i.received_qty < i.qty && <span className="text-xs text-zinc-400"> ({addQuantity(i.qty, -i.received_qty)} باقی‌مانده)</span>}
                </td>
                <td className="td">{fmtMoney(i.unit_cost)}</td>
                <td className="td font-medium">{fmtMoney(i.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-5 py-3 text-right text-sm text-zinc-500 border-t border-zinc-200 dark:border-zinc-800">
          کالاها {fmtMoney(po.items_total)} · مالیات {fmtMoney(po.tax)} · حمل‌ونقل {fmtMoney(po.shipping)} · <span className="font-semibold text-zinc-900 dark:text-zinc-100">جمع کل {fmtMoney(po.total)}</span>
        </div>
      </section>

      {receipts.length > 0 && (
        <section className="card card-pad">
          <h2 className="section-title mb-2">رسیدهای کالا</h2>
          <div className="space-y-1 text-sm">
            {receipts.map((r) => (
              <div key={r.id} className="flex justify-between">
                <span className="font-mono">{r.number}</span>
                <span className="text-zinc-400">{fmtDate(r.created_at)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
