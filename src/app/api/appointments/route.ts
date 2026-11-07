import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresAppointmentsHttp} from '@/lib/db/pg-appointments-http';
import {atomic} from "@/lib/db/transaction";
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, ok, fail, readJson, audit,HttpError } from "@/lib/api";
import { BRANCH_COOKIE, recordBranchId, activeBranch } from "@/lib/branch";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if(postgresIntegration())return postgresAppointmentsHttp(req);
  try {
    const session = requireSession(req);
    requirePerm(session, "appointments.view");
    const db = getDb();
    const status = req.nextUrl.searchParams.get("status") ?? "";
    const branch = activeBranch(session,req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    const rows = db.prepare("SELECT * FROM appointments WHERE (? IS NULL OR branch_id=?) AND (?='' OR status=?) ORDER BY preferred_at DESC LIMIT 200").all(branch,branch,status,status);
    return ok({ appointments: rows });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  if(postgresIntegration())return postgresAppointmentsHttp(req);
  try {
    const session = requireSession(req);
    requirePerm(session, "appointments.create");
    const body = await readJson(req);
    const { customer_id, device_id, repair_type, preferred_at, notes, technician_id } = body;
    if (!customer_id || !preferred_at) {
      return Response.json({ error: "مشتری و زمان نوبت الزامی است." }, { status: 400 });
    }
    const db = getDb();
    return atomic(db,()=>{
    const branch = recordBranchId(session, req.cookies.get(BRANCH_COOKIE)?.value);
    if(technician_id && !db.prepare("SELECT 1 FROM users WHERE id=? AND role='technician' AND is_active=1 AND branch_id=?").get(Number(technician_id),branch))throw new HttpError(400,"تعمیرکار فعال همین شعبه را انتخاب کنید.");
    const id = db
      .prepare(
        "INSERT INTO appointments(customer_id, device_id, repair_type, preferred_at, notes, technician_id, branch_id) VALUES(?,?,?,?,?,?,?)"
      )
      .run(
        Number(customer_id),
        device_id ? Number(device_id) : null,
        repair_type ?? "سرویس و تعمیر",
        String(preferred_at),
        notes ?? null,
        technician_id ? Number(technician_id) : null,
        branch
      ).lastInsertRowid as number;
    audit(session, "create", "appointment", id, null, { customer_id, preferred_at,branch_id:branch });
    return ok({ id });
    });
  } catch (e) {
    return fail(e);
  }
}
