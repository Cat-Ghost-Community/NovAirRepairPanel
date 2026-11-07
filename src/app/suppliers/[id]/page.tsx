import { requirePageAccess } from "@/lib/page-access";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db/schema";
import { fmtMoney, fmtDate, faQty } from "@/lib/format";
import { getSessionByToken, canUser } from "@/lib/auth";
import { SupplierPurchaseList } from "./purchase-list-panel";
import { activeBranch, BRANCH_COOKIE } from "@/lib/branch";

export const dynamic = "force-dynamic";

const PO_STATUS: Record<string, string> = {
  draft: "badge-gray", sent: "badge-blue", partially_received: "badge-amber", received: "badge-green", cancelled: "badge-gray",
};

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageAccess("/suppliers/[id]");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "suppliers.view")) redirect("/");
  const canEdit = canUser(session, "suppliers.manage");

  const { id } = await params;
  const db = getDb();
  const branch=activeBranch(session,cookieStore.get(BRANCH_COOKIE)?.value).branchId;
  const s = db.prepare("SELECT * FROM suppliers WHERE id = ?").get(Number(id)) as any;
  if (!s) notFound();

  const pos = db.prepare("SELECT * FROM purchase_orders WHERE supplier_id = ? AND (? IS NULL OR branch_id=?) ORDER BY created_at DESC LIMIT 500").all(Number(id),branch,branch) as any[];
  const parts = db.prepare("SELECT * FROM parts WHERE preferred_supplier_id = ? AND is_active = 1").all(Number(id)) as any[];
  const purchaseListCount = Number(
    (db.prepare("SELECT COUNT(*) c FROM supplier_purchase_items WHERE supplier_id = ? AND status IN ('pending','ordered') AND (? IS NULL OR branch_id=?)").get(Number(id),branch,branch) as any).c ?? 0
  );

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6 space-y-4">
      <div className="card card-pad">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold">{s.name}</h1>
            <div className="text-sm text-zinc-500 space-x-3 mt-1">
              {s.contact_person && <span>{s.contact_person}</span>}
              {s.phone && <span>{s.phone}</span>}
              {s.email && <span>{s.email}</span>}
            </div>
            {s.address && <div className="text-sm text-zinc-400 mt-0.5">{s.address}</div>}
          </div>
          <div className="flex gap-2">
            <Link href={`/purchase-orders/new?supplier_id=${s.id}`} className="btn-primary btn-sm">+ سفارش خرید</Link>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-3 border-t border-zinc-200 dark:border-zinc-800 pt-3 text-sm">
          <div><div className="text-xs text-zinc-400">شرایط پرداخت</div><div>{s.payment_terms ?? "—"}</div></div>
          <div><div className="text-xs text-zinc-400">سقف اعتبار</div><div>{s.credit_limit ? fmtMoney(s.credit_limit) : "—"}</div></div>
          <div><div className="text-xs text-zinc-400">جمع خریدها</div><div>{fmtMoney(pos.reduce((a: number, p) => a + p.total, 0))}</div></div>
          <div><div className="text-xs text-zinc-400">قطعات تأمین‌شده</div><div>{faQty(parts.length)}</div></div>
          <div>
            <div className="text-xs text-zinc-400">لیست خرید</div>
            <div className={purchaseListCount > 0 ? "font-medium text-amber-600 dark:text-amber-400" : ""}>
              {purchaseListCount > 0 ? `${faQty(purchaseListCount)} قلم` : "—"}
            </div>
          </div>
        </div>
      </div>

      <SupplierPurchaseList
        supplierId={Number(s.id)}
        canEdit={canEdit}
        canOrder={canUser(session, "purchasing.manage")}
        supplierName={String(s.name)}
      />

      <section className="card">
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800"><h2 className="section-title">سفارش‌های خرید</h2></div>
        {pos.length === 0 ? (
          <p className="px-5 py-6 text-sm text-zinc-400">هنوز سفارش خریدی ثبت نشده است.</p>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {pos.map((po) => (
              <Link key={po.id} href={`/purchase-orders/${po.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                <span>
                  <span className="font-mono text-[13px] font-medium">{po.number}</span>
                  <span className="text-xs text-zinc-400"> · {fmtDate(po.date)} · expected {fmtDate(po.expected_date)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-sm font-medium">{fmtMoney(po.total)}</span>
                  <span className={PO_STATUS[po.status] ?? "badge-gray"}>{po.status.replace("_", " ")}</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800"><h2 className="section-title">قطعات تأمین‌شده</h2></div>
        <div className="p-3 grid sm:grid-cols-2 gap-2">
          {parts.map((p) => (
            <Link key={p.id} href={`/parts/${p.id}`} className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm hover:border-brand-400">
              {p.name} <span className="text-zinc-400 text-xs font-mono">{p.sku}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
