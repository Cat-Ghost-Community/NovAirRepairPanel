import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresAppointmentsHttp} from '@/lib/db/pg-appointments-http';
import { NextRequest } from "next/server";
import { getDb, nextSeq } from "@/lib/db/schema";
import { requireSession, fail, ok, audit, requirePerm } from "@/lib/api";
import { getStatusByName, addCustomerEvent } from "@/lib/repair";
import { BRANCH_COOKIE, recordBranchId } from "@/lib/branch";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if(postgresIntegration())return postgresAppointmentsHttp(req,Number((await params).id),true);
  try {
    const session = requireSession(req);
    requirePerm(session, "repairs.create");
    const { id } = await params;
    const db = getDb();
    const a = db.prepare("SELECT * FROM appointments WHERE id = ?").get(Number(id)) as any;
    if (!a) return Response.json({ error: "نوبت یافت نشد." }, { status: 404 });
    if (a.status === "converted") return Response.json({ error: "این نوبت قبلاً به پذیرش تبدیل شده است." }, { status: 400 });
    if (!a.customer_id) return Response.json({ error: "این نوبت مشتری ندارد." }, { status: 400 });

    let deviceId = a.device_id;
    if (!deviceId) {
      // create a placeholder device record
      deviceId = db
        .prepare("INSERT INTO devices(customer_id, type, brand, model, notes) VALUES(?,?,?,?,?)")
        .run(a.customer_id, "other", "نامشخص", "در پذیرش شناسایی می‌شود", "ایجادشده از نوبت").lastInsertRowid as number;
    }

    const statusNew = getStatusByName("New")!;
    const branch = a.branch_id ?? recordBranchId(session, req.cookies.get(BRANCH_COOKIE)?.value);
    const number = nextSeq("ticket", "R");
    const ticketId = db
      .prepare(
        `INSERT INTO repair_tickets(number, branch_id, customer_id, device_id, repair_type, priority, source, status_id, problem, created_by)
         VALUES(?,?,?,?,?,?,?,?,?,?)`
      )
      .run(number, branch, a.customer_id, deviceId, a.repair_type ?? "Appointment", "normal", "appointment", statusNew.id, a.notes ?? null, session.user.id).lastInsertRowid as number;

    db.prepare("INSERT INTO repair_status_history(ticket_id, from_status, to_status, user_id, note) VALUES(?,?,?,?,?)")
      .run(ticketId, null, statusNew.id, session.user.id, "تبدیل از نوبت‌دهی");
    db.prepare("UPDATE appointments SET status = 'converted', ticket_id = ? WHERE id = ?").run(ticketId, Number(id));
    audit(session, "convert", "appointment", Number(id), null, { ticket_id: ticketId });
    addCustomerEvent(a.customer_id, "repair", `Appointment converted to repair ${number}`, null, session.user.id, ticketId);
    return ok({ id: ticketId, number });
  } catch (e) {
    return fail(e);
  }
}
