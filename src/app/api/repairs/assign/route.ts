import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresRepairWorkflowHttp} from '@/lib/db/pg-repair-workflow-http';
import {atomic} from '@/lib/db/transaction';
import {assertRequestSession as recheckSession} from '@/lib/api';
import { NextRequest } from "next/server";
import { requireSession, fail, ok, readJson } from "@/lib/api";
import { BRANCH_COOKIE } from "@/lib/branch";
import { assignTickets, type AssignInputItem } from "@/lib/repair-assign";
import {getDb} from '@/lib/db/schema';
import {requireAssignmentAuthority,repairWorkflow} from '@/lib/repair-workflow';
import {activeBranch} from '@/lib/branch';
import {durableOperation} from '@/lib/idempotency';
import {HttpError} from '@/lib/api';

export const dynamic = "force-dynamic";

/**
 * ارجاع / ارجاع مجدد (تک‌دستگاهی و گروهی).
 * هر دستگاه با «expect» (تعمیرکار فعلی) مقایسه و به‌صورت اتمیک به‌روزرسانی می‌شود؛
 * نتیجهٔ هر دستگاه جداگانه برگردانده می‌شود تا موفقیت جزئی پنهان نماند.
 */
export async function POST(req: NextRequest) {
 if(postgresIntegration())return postgresRepairWorkflowHttp(req,'assign');
  try {
    const session = requireSession(req);
    const b = await readJson(req);
    const rawItems = Array.isArray(b.items) ? b.items : b.ticket_id != null ? [{ id: b.ticket_id, expect: b.expect ?? null }] : [];
    const items: AssignInputItem[] = rawItems.map((it: any) => ({
      id: Number(it?.id ?? 0),
      expect: it?.expect == null ? null : Number(it.expect),
      version:it?.version,workflow_revision:it?.workflow_revision,
    }));
    const db=getDb(),scope=activeBranch(session,req.cookies.get(BRANCH_COOKIE)?.value);
    return atomic(db,()=>{recheckSession(req);
    let branch=Number(session.user.branch_id??0),controlled=false;
    for(const item of items){const row=db.prepare('SELECT branch_id FROM repair_tickets WHERE id=?').get(item.id);if(!row||!scope.all&&row.branch_id!==scope.branchId)throw new HttpError(404,'پذیرش در شعبهٔ مجاز یافت نشد.');branch=Number(row.branch_id);requireAssignmentAuthority(db,session,branch,Number(b.technician_id));controlled ||= repairWorkflow(db,branch).mode!=='legacy';}
    const work = () => assignTickets(
      session,
      {
        items,
        technician_id: Number(b.technician_id),
        reason: b.reason == null ? null : String(b.reason),
        pause_timers:b.pause_timers===true,clear_helper:b.clear_helper===true,
        helper_id:b.helper_id===undefined?undefined:b.helper_id===null?null:Number(b.helper_id),
      },
      req.cookies.get(BRANCH_COOKIE)?.value
    );
    const key=b.operation_key??req.headers.get('idempotency-key');
    const data=controlled||key?durableOperation(db,{actorId:session.user.id,branchId:branch,operation:'repair.assign',scope:'business',key,payload:b},work):work();
    return ok(data);
    });
  } catch (e) {
    return fail(e);
  }
}
