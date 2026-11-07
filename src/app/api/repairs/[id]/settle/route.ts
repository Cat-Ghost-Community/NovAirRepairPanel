import { NextRequest } from "next/server";
import { requireRepairAccess } from "@/lib/repair-access";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok, readJson, audit, validate, HttpError } from "@/lib/api";
import { transitionTicket, addCustomerEvent } from "@/lib/repair";
import { durableJsonResponse } from "@/lib/idempotency";
import { createCustomerReceipt } from "@/lib/customer-payments";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = requireSession(req);
    requirePerm(session, "repairs.edit");
    const id = validate.id((await params).id);
    const cookie = req.cookies.get("repaid_branch")?.value;
    const access = requireRepairAccess(session, id, cookie);
    const body = await readJson(req);
    const amount = validate.amount(body.amount ?? 0);
    const method = body.method ?? "cash";
    if (!["cash", "card", "pos", "bank", "transfer", "other", "credit"].includes(method) || (method === "credit" && amount > 0)) throw new HttpError(400, "روش دریافت معتبر نیست؛ نسیه سند دریافت وجه نیست.");
    if (body.mark_delivered != null && typeof body.mark_delivered !== "boolean") throw new HttpError(400, "وضعیت تحویل معتبر نیست.");
    if (amount > 0) requirePerm(session, "payments.create");
    if (body.mark_delivered) requirePerm(session, "repairs.deliver");
    const db = getDb();
    return durableJsonResponse(db, { actorId: session.user.id, branchId: access.branch_id, operation: "repair_settlement",
      key: req.headers.get("idempotency-key"), payload: { ticket_id: id, ...body } }, () => {
      requireRepairAccess(session, id, cookie);
      const ticket = db.prepare("SELECT customer_id,number FROM repair_tickets WHERE id=?").get(id)!;
      const invoice = db.prepare("SELECT id,status FROM invoices WHERE ticket_id=? AND status!='cancelled' ORDER BY id DESC LIMIT 1").get(id);
      if (invoice?.status === "draft") throw new HttpError(409, "ابتدا فاکتور پیش‌نویس را نهایی کنید.");
      if (body.mark_delivered && !invoice) throw new HttpError(409, "تحویل مالی نیازمند فاکتور نهایی است؛ ابتدا صدور فاکتور را تکمیل کنید.");
      const receipt = amount > 0 ? createCustomerReceipt(db, session, { customer_id: Number(ticket.customer_id), ticket_id: id,
        invoice_id: invoice ? Number(invoice.id) : null, amount, method, notes: "تسویهٔ پذیرش" }, access.branch_id) : null;
      if (body.mark_delivered) {
        transitionTicket(id, "Delivered", session.user.id, "تسویه و تحویل سریع");
        db.prepare("UPDATE repair_tickets SET delivered_by=? WHERE id=?").run(session.user.id, id);
        addCustomerEvent(Number(ticket.customer_id), "repair", `دستگاه پذیرش #${ticket.number} تحویل شد`, null, session.user.id, id);
      }
      audit(session, "settle", "repair_ticket", id, null, { amount, method, payment_id: receipt?.id ?? null, delivered: !!body.mark_delivered, branch_id: access.branch_id });
      return ok({ done: true, method, amount, payment_id: receipt?.id ?? null });
    });
  } catch (error) { return fail(error); }
}
