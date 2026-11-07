import { requireRepairAccess } from "@/lib/repair-access";
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, fail, ok, requirePerm, validate, HttpError } from "@/lib/api";
import { createInvoice } from "@/lib/invoice";

/** Legacy workspace action delegates to the same invoice authority. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = requireSession(req);
    requirePerm(session, "invoices.create");
    const { id } = await params;
    const ticketId = validate.id(id);
    const cookie = req.cookies.get("repaid_branch")?.value;
    requireRepairAccess(session, ticketId, cookie);
    const identity = req.headers.get("idempotency-key");
    if (!identity || !/^[A-Za-z0-9_-]{8,64}$/.test(identity)) throw new HttpError(400, "شناسهٔ ضدتکرار صدور فاکتور الزامی است.");
    const ticket = getDb().prepare("SELECT customer_id FROM repair_tickets WHERE id=?").get(ticketId) as { customer_id: number };
    return ok(createInvoice(session, { type: "repair", ticket_id: ticketId, customer_id: ticket.customer_id,
      client_key: identity, confirm: true, notes: "خدمات تعمیر" }, cookie));
  } catch (error) { return fail(error); }
}
