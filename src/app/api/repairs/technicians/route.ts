import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresRepairWorkflowHttp} from '@/lib/db/pg-repair-workflow-http';
import { NextRequest } from "next/server";
import { requireSession, fail, ok } from "@/lib/api";
import { BRANCH_COOKIE } from "@/lib/branch";
import { requireAssignAccess, technicianOptions } from "@/lib/repair-assign";
import { repairWorkflow } from "@/lib/repair-workflow";
import { getDb } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/** تعمیرکاران قابل ارجاع با بار کاری واقعی — برای مودال ارجاع */
export async function GET(req: NextRequest) {
 if(postgresIntegration())return postgresRepairWorkflowHttp(req,'technicians');
  try {
    const session = requireSession(req);
    const scope = requireAssignAccess(session, req.cookies.get(BRANCH_COOKIE)?.value);
    const restrictSelf = session.user.role === "technician" && repairWorkflow(getDb(), Number(session.user.branch_id)).mode !== "legacy";
    return ok({ technicians: technicianOptions(session, scope).filter(t => !restrictSelf || t.id !== session.user.id) });
  } catch (e) {
    return fail(e);
  }
}
