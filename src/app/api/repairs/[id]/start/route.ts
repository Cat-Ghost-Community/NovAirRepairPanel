import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresRepairWorkHttp} from '@/lib/db/pg-repair-work-http';
import {atomic} from '@/lib/db/transaction';
import {assertRequestSession as recheckSession} from '@/lib/api';
import { requireRepairAccess } from "@/lib/repair-access";
import { NextRequest } from "next/server";
import { requireSession, fail, ok,readJson,HttpError,assertRequestSession } from "@/lib/api";
import { BRANCH_COOKIE } from "@/lib/branch";
import { startRepair } from "@/lib/repair-assign";
import {getDb} from '@/lib/db/schema';
import {repairWorkflow} from '@/lib/repair-workflow';
import {durableOperation} from '@/lib/idempotency';

export const dynamic = "force-dynamic";

/** شروع صریح تعمیر از کارتابل تعمیرکار — انتقال به «In Repair» + شروع زمان‌سنج */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if(postgresIntegration())return postgresRepairWorkHttp(req,Number((await params).id),'start');
  try {
    const session = requireSession(req);
    const { id } = await params;
    requireRepairAccess(session, Number(id), req.cookies.get("repaid_branch")?.value);
    const body=req.body==null?{}:await readJson(req);assertRequestSession(req);
    const db=getDb();return atomic(db,()=>{recheckSession(req);const row=db.prepare('SELECT branch_id FROM repair_tickets WHERE id=?').get(Number(id))!,branch=Number(row.branch_id),policy=repairWorkflow(db,branch);
    const work=()=>{const current=db.prepare('SELECT assignment_version FROM repair_tickets WHERE id=?').get(Number(id));if(policy.mode!=='legacy'&&(current?.assignment_version!==body.version||repairWorkflow(db,branch).revision!==body.workflow_revision))throw new HttpError(409,'ارجاع یا مسیر تعمیر تغییر کرده است؛ کارتابل را تازه کنید.');return startRepair(session,Number(id),req.cookies.get(BRANCH_COOKIE)?.value);};
    const key=req.headers.get('idempotency-key');
    const data=policy.mode!=='legacy'||key?durableOperation(db,{actorId:session.user.id,branchId:branch,operation:'repair.start',key,payload:{ticket_id:Number(id),...body}},work):work();
    return ok(data);
    });
  } catch (e) {
    return fail(e);
  }
}
