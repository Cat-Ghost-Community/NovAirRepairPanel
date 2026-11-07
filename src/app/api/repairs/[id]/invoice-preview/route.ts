import { requireRepairAccess } from "@/lib/repair-access";
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok } from "@/lib/api";
import { HttpError } from "@/lib/api";
import { ticketAdvances } from "@/lib/repair-finance";

export const dynamic = "force-dynamic";

/**
 * پیش‌نمایش فاکتور تعمیر برای فرم: مشخصات دستگاه/مشتری + اقلام ثبت‌شدهٔ پذیرش (اسنپ‌شات).
 * اقلام فقط برای پیش‌پرکردن است؛ ویرایش آن‌ها در فاکتور، رکورد پذیرش را تغییر نمی‌دهد.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = requireSession(req);
    requirePerm(session, "invoices.create");
    const { id } = await params;
    requireRepairAccess(session, Number(id), req.cookies.get("repaid_branch")?.value);
    const ticketId = Number(id);
    if (!Number.isFinite(ticketId)) throw new HttpError(400, "شناسهٔ پذیرش نامعتبر است.");
    const db = getDb();
    const t = db
      .prepare(
        `SELECT t.id, t.number, t.customer_id, t.branch_id, t.technician_id, t.problem, t.status_id,
                c.first_name, c.last_name, c.mobile, d.brand, d.model, d.type,
                s.name status_name, u.name tech_name
         FROM repair_tickets t
         JOIN customers c ON c.id = t.customer_id
         JOIN devices d ON d.id = t.device_id
         JOIN repair_statuses s ON s.id = t.status_id
         LEFT JOIN users u ON u.id = t.technician_id
         WHERE t.id = ?`
      )
      .get(ticketId) as any;
    if (!t) throw new HttpError(404, "پذیرش یافت نشد.");
    const existing = db
      .prepare("SELECT id, number, status, total FROM invoices WHERE ticket_id = ? AND status != 'cancelled'")
      .get(ticketId) as any;
    const items = db.prepare("SELECT * FROM ticket_items WHERE ticket_id = ? ORDER BY id").all(ticketId) as any[];
    const advances = ticketAdvances(db, ticketId);
    return ok({
      advances: { settled: advances.settled, pending: advances.pending },
      ticket: {
        id: Number(t.id),
        number: String(t.number),
        customer_id: Number(t.customer_id),
        customer_name: `${t.first_name ?? ""} ${t.last_name ?? ""}`.trim(),
        customer_mobile: t.mobile ?? null,
        device: `${t.brand ?? ""} ${t.model ?? ""}`.trim(),
        device_type: t.type ?? null,
        problem: t.problem ?? null,
        status_name: t.status_name ?? null,
        tech_id: t.technician_id == null ? null : Number(t.technician_id),
        tech_name: t.tech_name ?? null,
      },
      existing_invoice: existing ? { id: Number(existing.id), number: String(existing.number), status: String(existing.status), total: Number(existing.total) } : null,
      items: items.map((i: any) => ({
        kind: i.kind,
        ref_id: i.ref_id ?? null,
        name: i.name,
        qty: Number(i.qty ?? 1),
        unit_price: Number(i.unit_price ?? 0),
        discount: 0,
        cost: Number(i.cost ?? 0),
        employee_id: i.added_by ?? null,
      })),
    });
  } catch (e) {
    return fail(e);
  }
}
