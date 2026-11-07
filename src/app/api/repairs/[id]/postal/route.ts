import { requireRepairAccess } from "@/lib/repair-access";
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok, readJson, audit } from "@/lib/api";
import { addCustomerEvent } from "@/lib/repair";

/** ثبت کد رهگیری پستی — هنگام ارسال پستی دستگاه پس از اتمام کار */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = requireSession(req);
    requirePerm(session, "repairs.edit");
    const { id } = await params;
    requireRepairAccess(session, Number(id), req.cookies.get("repaid_branch")?.value);
    const ticketId = Number(id);
    const b = await readJson(req);
    const db = getDb();

    const ticket = db.prepare("SELECT id, number FROM repair_tickets WHERE id = ?").get(ticketId) as any;
    if (!ticket) return Response.json({ error: "پذیرش یافت نشد." }, { status: 404 });

    const code = String(b.postal_tracking ?? "").trim();
    if (code && !/^[A-Za-z0-9\-]{5,30}$/.test(code)) {
      return Response.json({ error: "کد رهگیری پستی فقط شامل حروف لاتین، رقم و خط تیره (۵ تا ۳۰ نویسه) است." }, { status: 400 });
    }

    const before = db.prepare("SELECT postal_tracking, postal_sent_at FROM repair_tickets WHERE id = ?").get(ticketId) as any;
    db.prepare("UPDATE repair_tickets SET postal_tracking = ?, postal_sent_at = ?, updated_at = datetime('now') WHERE id = ?")
      .run(code || null, code ? new Date().toISOString().slice(0, 19).replace("T", " ") : null, ticketId);

    if (code) {
      addCustomerEvent((db.prepare("SELECT customer_id FROM repair_tickets WHERE id = ?").get(ticketId) as any).customer_id,
        "note", `دستگاه پذیرش ${ticket.number} با پست ارسال شد — کد رهگیری: ${code}`, null, session.user.id, ticketId);
    }
    audit(session, "update", "repair_ticket", ticketId, before, { postal_tracking: code || null });
    return ok({ ok: true, postal_tracking: code || null });
  } catch (e) {
    return fail(e);
  }
}
