import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresAppointmentsHttp} from '@/lib/db/pg-appointments-http';
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, ok, fail, readJson, audit } from "@/lib/api";

export const dynamic = "force-dynamic";

const ALLOWED = ["requested", "confirmed", "completed", "cancelled"];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if(postgresIntegration())return postgresAppointmentsHttp(req,Number((await params).id));
  try {
    const session = requireSession(req);
    requirePerm(session, "appointments.manage");
    const { id } = await params;
    const db = getDb();
    const appt = db.prepare("SELECT * FROM appointments WHERE id = ?").get(Number(id)) as any;
    if (!appt) return Response.json({ error: "نوبت یافت نشد." }, { status: 404 });
    if (appt.status === "converted") return Response.json({ error: "این نوبت به پذیرش تبدیل شده و قابل تغییر نیست." }, { status: 400 });

    const body = (await readJson(req)) as Record<string, any>;
    if(body.technician_id && !db.prepare("SELECT 1 FROM users WHERE id=? AND role='technician' AND is_active=1 AND branch_id=?").get(Number(body.technician_id),appt.branch_id))return Response.json({error:"تعمیرکار فعال همین شعبه را انتخاب کنید."},{status:400});
    const next: Record<string, unknown> = {};
    if (typeof body.status === "string") {
      if (!ALLOWED.includes(body.status)) return Response.json({ error: "وضعیت نامعتبر است." }, { status: 400 });
      next.status = body.status;
    }
    if (typeof body.preferred_at === "string" && body.preferred_at) next.preferred_at = body.preferred_at;
    if (typeof body.notes === "string") next.notes = body.notes;
    if (typeof body.technician_id === "number") next.technician_id = body.technician_id;

    if (Object.keys(next).length === 0) return Response.json({ error: "تغییری ارسال نشده است." }, { status: 400 });

    const sets = Object.keys(next).map((k) => `${k} = ?`).join(", ");
    db.prepare(`UPDATE appointments SET ${sets} WHERE id = ?`).run(...(Object.values(next) as any[]), Number(id));
    audit(session, "update", "appointment", Number(id), appt, next);
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
