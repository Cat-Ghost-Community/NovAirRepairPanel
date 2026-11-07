import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok } from "@/lib/api";
import { HttpError } from "@/lib/api";
import { activeBranch, BRANCH_COOKIE } from "@/lib/branch";
import { purchaseInvoiceSource } from "@/lib/invoice-source";
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresFinancialRequest} from '@/lib/db/pg-financial-http';
import {postgresPurchasePreview} from '@/lib/db/pg-purchasing';
import {postgresFailure} from '@/lib/db/pg-http';

export const dynamic = "force-dynamic";

/** پیش‌نمایش سفارش خرید برای «فاکتور خرید» — اقلام با مقدار دریافت‌شده و بهای واحد */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if(postgresIntegration()){
    try{const {database,schema,token,branchId}=await postgresFinancialRequest(req,'purchasing.manage');const {id}=await params;return Response.json(await postgresPurchasePreview(database,schema,token,branchId,Number(id)),{headers:{'Cache-Control':'no-store'}});}catch(error){return postgresFailure(error);}
  }
  try {
    const session = requireSession(req);
    requirePerm(session, "purchasing.manage");
    const { id } = await params;
    const db = getDb();
    const po = db
      .prepare(
        `SELECT po.*, s.name supplier_name, b.name branch_name
         FROM purchase_orders po
         LEFT JOIN suppliers s ON s.id = po.supplier_id
         LEFT JOIN branches b ON b.id = po.branch_id
         WHERE po.id = ?`
      )
      .get(Number(id)) as any;
    if (!po) throw new HttpError(404, "سفارش خرید یافت نشد.");
    const scope = activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value);
    if (!scope.all && po.branch_id !== scope.branchId) throw new HttpError(404, "سفارش خرید یافت نشد.");
    const existing = db
      .prepare("SELECT id, number, status, subtotal, discount, tax, total FROM invoices WHERE purchase_order_id = ? AND status != 'cancelled'")
      .get(po.id) as any;
    const receivable = ["received", "partially_received"].includes(String(po.status));
    const source = receivable && !existing ? purchaseInvoiceSource(db, po) : null;
    return ok({
      po: {
        id: Number(po.id),
        number: String(po.number),
        supplier_id: po.supplier_id == null ? null : Number(po.supplier_id),
        supplier_name: po.supplier_name ?? null,
        branch_name: po.branch_name ?? null,
        status: String(po.status ?? "draft"),
        total: Number(po.total ?? 0),
        discount: source?.totals.discount ?? 0,
      },
      ready_to_invoice: receivable,
      source_totals: source?.totals ?? (existing ? { gross: existing.subtotal, discount: existing.discount, tax: existing.tax, duty: 0, total: existing.total } : null),
      existing_invoice: existing ? { id: Number(existing.id), number: String(existing.number), status: String(existing.status), total: Number(existing.total) } : null,
      items: source?.items ?? [],
    });
  } catch (e) {
    return fail(e);
  }
}
