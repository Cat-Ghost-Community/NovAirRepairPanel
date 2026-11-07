import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok } from "@/lib/api";
import { HttpError } from "@/lib/api";
import { activeBranch, BRANCH_COOKIE } from "@/lib/branch";

export const dynamic = "force-dynamic";

/** یک فروش صندوق با اقلام — برای پیش‌پرکردن «فاکتور رسمی از فروش» */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = requireSession(req);
    requirePerm(session, "invoices.view");
    const { id } = await params;
    const db = getDb();
    const sale = db
      .prepare(
        `SELECT s.*, c.first_name, c.last_name, c.company, c.mobile
         FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.id = ?`
      )
      .get(Number(id)) as any;
    if (!sale) throw new HttpError(404, "فروش یافت نشد.");
    const scope = activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value);
    if (!scope.all && sale.branch_id !== scope.branchId) throw new HttpError(404, "فروش یافت نشد.");
    const existing = db
      .prepare("SELECT id, number, status, total FROM invoices WHERE sale_id = ? AND status != 'cancelled'")
      .get(sale.id) as any;
    const items = db.prepare("SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id").all(sale.id) as any[];
    const payments = db.prepare("SELECT method, amount FROM payments WHERE sale_id = ? ORDER BY id").all(sale.id) as any[];
    return ok({
      sale: {
        id: Number(sale.id),
        number: String(sale.number),
        customer_id: sale.customer_id == null ? null : Number(sale.customer_id),
        customer_name: sale.customer_id == null ? null : sale.company ?? `${sale.first_name ?? ""} ${sale.last_name ?? ""}`.trim(),
        customer_mobile: sale.mobile ?? null,
        total: Number(sale.total ?? 0),
        subtotal: Number(sale.subtotal ?? 0),
        tax: Number(sale.tax ?? 0),
        discount: Number(sale.discount ?? 0),
        status: String(sale.status ?? "completed"),
        created_at: sale.created_at,
        payments: payments.map((p) => ({ method: p.method, amount: Number(p.amount) })),
      },
      existing_invoice: existing ? { id: Number(existing.id), number: String(existing.number), status: String(existing.status), total: Number(existing.total) } : null,
      items: items.map((i: any) => ({
        kind: ["part", "service", "labor", "fee", "other"].includes(i.kind) ? i.kind : "other",
        ref_id: i.ref_id ?? null,
        name: i.name,
        qty: Number(i.qty ?? 1),
        unit_price: Number(i.unit_price ?? 0),
        discount: 0,
        cost: Number(i.cost ?? 0),
      })),
    });
  } catch (e) {
    return fail(e);
  }
}
