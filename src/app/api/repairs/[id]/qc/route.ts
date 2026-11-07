import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresRepairWorkHttp} from '@/lib/db/pg-repair-work-http';
import {atomicRepairMutation} from '@/lib/api';
import { requireRepairAccess } from "@/lib/repair-access";
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, fail, ok, readJson, requirePerm, audit, HttpError } from "@/lib/api";
import { atomic } from "@/lib/db/transaction";
import { transitionTicket, StatusError } from "@/lib/repair";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if(postgresIntegration())return postgresRepairWorkHttp(req,Number((await params).id),'qc');
  try {
    const session = requireSession(req);
    requirePerm(session, "repairs.status");
    const { id } = await params;
    requireRepairAccess(session, Number(id), req.cookies.get("repaid_branch")?.value);
    const ticketId = Number(id);
    const b = await readJson(req);
    const db = getDb();
    return atomicRepairMutation(db,req,session,Number(id),()=>{
    if (!["pass", "fail"].includes(b.result)) throw new HttpError(400, "نتیجه کنترل کیفیت معتبر نیست.");
    return atomic(db, () => {
    db.prepare("UPDATE repair_tickets SET qc_status = ?, qc_notes = ?, updated_at = datetime('now') WHERE id = ?")
      .run(b.result === "pass" ? "passed" : "failed", b.notes ?? null, ticketId);

    if (b.result === "pass") {
      // move to Ready for Pickup if currently in QC
      const t = db.prepare("SELECT status_id FROM repair_tickets WHERE id = ?").get(ticketId) as any;
      const qcStatus = db.prepare("SELECT id, name FROM repair_statuses WHERE name = 'Quality Control'").get() as any;
      if (t && qcStatus && t.status_id === qcStatus.id) {
        transitionTicket(ticketId, "Ready for Pickup", session.user.id, "کنترل کیفیت قبول");
      }
    } else if (b.result === "fail") {
      transitionTicket(ticketId, "In Repair", session.user.id, "کنترل کیفیت رد شد — بازگشت برای اصلاح");
    }
    audit(session, "quality_control", "repair_ticket", ticketId, null, { result: b.result });
    return ok({ ok: true });
    });
    });
  } catch (e) {
    return fail(e);
  }
}
