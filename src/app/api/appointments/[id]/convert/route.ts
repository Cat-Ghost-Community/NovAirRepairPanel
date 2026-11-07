import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresAppointmentsHttp} from '@/lib/db/pg-appointments-http';
import { NextRequest } from "next/server";
import { getDb, nextSeq } from "@/lib/db/schema";
import { requireSession, fail, ok, audit, requirePerm,readJson,HttpError,validate } from "@/lib/api";
import { getStatusByName, addCustomerEvent } from "@/lib/repair";
import { BRANCH_COOKIE, recordBranchId } from "@/lib/branch";
import {atomic} from '@/lib/db/transaction';
import {assertBranchResource} from '@/lib/branch-access';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if(postgresIntegration())return postgresAppointmentsHttp(req,Number((await params).id),true);
  try {
    const session = requireSession(req);
    requirePerm(session, "repairs.create");
    const { id } = await params;
    const db = getDb();
    const input=req.body?await readJson(req):{};
    return atomic(db,()=>{
    assertBranchResource(db,session,req.cookies.get(BRANCH_COOKIE)?.value,'appointment',Number(id));
    const a = db.prepare("SELECT * FROM appointments WHERE id = ?").get(Number(id)) as any;
    if (!a) return Response.json({ error: "نوبت یافت نشد." }, { status: 404 });
    if (a.status === "converted") return Response.json({ error: "این نوبت قبلاً به پذیرش تبدیل شده است." }, { status: 400 });
    if (!a.customer_id) return Response.json({ error: "این نوبت مشتری ندارد." }, { status: 400 });

    const deviceId = input.device_id==null?a.device_id:validate.id(input.device_id);
    if (!deviceId) {
      return Response.json({error:'ابتدا دستگاه واقعی مشتری را در نوبت انتخاب کنید؛ دستگاه فرضی ایجاد نمی‌شود.'},{status:409});
    }
    if(a.device_id!=null&&Number(a.device_id)!==Number(deviceId))throw new HttpError(409,'تغییر دستگاه اصلی نوبت مجاز نیست.');
    assertBranchResource(db,session,req.cookies.get(BRANCH_COOKIE)?.value,'device',Number(deviceId));
    if(!db.prepare('SELECT id FROM devices WHERE id=? AND customer_id=? AND is_archived=0').get(deviceId,a.customer_id))throw new HttpError(400,'دستگاه فعال متعلق به این مشتری را انتخاب کنید.');

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
    db.prepare("UPDATE appointments SET status = 'converted', ticket_id = ?,device_id=? WHERE id = ?").run(ticketId,deviceId, Number(id));
    audit(session, "convert", "appointment", Number(id), null, { ticket_id: ticketId });
    addCustomerEvent(a.customer_id, "repair", `Appointment converted to repair ${number}`, null, session.user.id, ticketId);
    return ok({ id: ticketId, number });
    });
  } catch (e) {
    return fail(e);
  }
}
