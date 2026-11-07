import { requirePageAccess } from "@/lib/page-access";
import Link from "next/link";
import { getDb } from "@/lib/db/schema";
import { fmtMoney, fmtDate } from "@/lib/format";
import { EmptyState } from "@/components/ui";
import { Pagination } from "@/components/pagination";
import { countOf, resolvePaging } from "@/lib/pagination";
import { getSessionByToken, canUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { BRANCH_COOKIE, activeBranch, branchWhere } from "@/lib/branch";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  draft: "badge-gray", sent: "badge-blue", partially_received: "badge-amber", received: "badge-green", cancelled: "badge-gray",
};

const PO_STATUS_FA: Record<string, string> = {
  draft: "پیش‌نویس", sent: "ارسال‌شده", partially_received: "دریافت جزئی", received: "دریافت کامل", cancelled: "لغوشده",
};

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageAccess("/purchase-orders");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "purchasing.view")) redirect("/");
  const sp = await searchParams;
  const db = getDb();
  let sql = `SELECT po.*, s.name supplier_name,
        (SELECT COALESCE(SUM(qty),0) FROM purchase_order_items i WHERE i.po_id = po.id) total_qty,
        (SELECT COALESCE(SUM(received_qty),0) FROM purchase_order_items i WHERE i.po_id = po.id) received_qty
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE 1=1`;
  const params: any[] = [];
  { const bs = branchWhere(activeBranch(session, cookieStore.get(BRANCH_COOKIE)?.value), "po");
    if (bs.sql !== "1=1") { sql += ` AND ${bs.sql}`; params.push(...bs.params); } }
  if (sp.status) { sql += " AND po.status = ?"; params.push(sp.status); }
  if (sp.supplier) { sql += " AND po.supplier_id = ?"; params.push(Number(sp.supplier)); }
  const total = countOf(db, sql, params);
  const { page, perPage, offset, totalPages } = resolvePaging(sp, total);
  sql += ` ORDER BY po.created_at DESC LIMIT ${perPage} OFFSET ${offset}`;
  const pos = JSON.parse(JSON.stringify(db.prepare(sql).all(...params) as any[])) as any[];

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="page-head">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="page-title">سفارش‌های خرید</h1>
            <p className="page-sub">با دریافت کالا، موجودی انبار و بهای تمام‌شده به‌صورت خودکار به‌روز می‌شود.</p>
          </div>
          <Link href="/purchase-orders/new" className="btn-primary">+ سفارش خرید جدید</Link>
        </div>
      </div>
      {pos.length === 0 ? (
        <div className="card"><EmptyState icon="truck" title="هنوز سفارش خریدی نیست" body="سفارش خرید برای تهیه کالا از تأمین‌کننده — پس از دریافت، موجودی خودکار به‌روز می‌شود." action={<Link href="/purchase-orders/new" className="btn-primary">ثبت سفارش خرید</Link>} /></div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="th">سفارش</th><th className="th">تأمین‌کننده</th><th className="th">مورد انتظار</th>
                <th className="th">دریافت‌شده</th><th className="th">جمع کل</th><th className="th">وضعیت</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {pos.map((po) => (
                <tr key={po.id} className="row-hover">
                  <td className="td"><Link href={`/purchase-orders/${po.id}`} className="font-mono text-[13px] font-semibold text-brand-600 hover:underline">{po.number}</Link></td>
                  <td className="td">{po.supplier_name}</td>
                  <td className="td text-zinc-500">{fmtDate(po.expected_date)}</td>
                  <td className="td">
                    <span className={po.received_qty >= po.total_qty && po.total_qty > 0 ? "text-emerald-600" : ""}>{po.received_qty}/{po.total_qty}</span>
                  </td>
                  <td className="td font-medium">{fmtMoney(po.total)}</td>
                  <td className="td"><span className={STATUS[po.status] ?? "badge-gray"}>{PO_STATUS_FA[po.status] ?? po.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <Pagination base="/purchase-orders" sp={sp} page={page} totalPages={totalPages} total={total} perPage={perPage} unit="سفارش" />
        </div>
      )}
    </div>
  );
}
