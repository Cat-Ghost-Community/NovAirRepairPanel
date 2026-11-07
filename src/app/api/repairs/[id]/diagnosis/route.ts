import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresRepairWorkHttp} from '@/lib/db/pg-repair-work-http';
import {atomicRepairMutation} from '@/lib/api';
import { requireRepairAccess } from "@/lib/repair-access";
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, fail, ok, readJson, audit, requirePerm } from "@/lib/api";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if(postgresIntegration())return postgresRepairWorkHttp(req,Number((await params).id),'diagnosis');
  try {
    const session = requireSession(req);
    requirePerm(session, "repairs.edit");
    const { id } = await params;
    requireRepairAccess(session, Number(id), req.cookies.get("repaid_branch")?.value);
    const b = await readJson(req);
    const db = getDb();
    return atomicRepairMutation(db,req,session,Number(id),()=>{
    const before = db.prepare("SELECT diagnosis, diagnosis_outcome, root_cause FROM repair_tickets WHERE id = ?").get(Number(id)) as any;
    db.prepare("UPDATE repair_tickets SET diagnosis = ?, diagnosis_outcome = ?, root_cause = ?, updated_at = datetime('now') WHERE id = ?")
      .run(b.diagnosis ?? null, b.diagnosis_outcome ?? null, b.root_cause ?? null, Number(id));
    audit(session, "update", "repair_diagnosis", Number(id), before, b);
    return ok({ ok: true });
    });
  } catch (e) {
    return fail(e);
  }
}
