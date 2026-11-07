import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresRepairWorkflowHttp} from '@/lib/db/pg-repair-workflow-http';
import {repairWorkflow} from '@/lib/repair-workflow';
import {getDb} from '@/lib/db/schema';
import { NextRequest } from "next/server";
import { requireSession, fail, ok } from "@/lib/api";
import { BRANCH_COOKIE } from "@/lib/branch";
import { myQueue } from "@/lib/repair-assign";

export const dynamic = "force-dynamic";

/** کارتابل تعمیرکار: دستگاه‌های ارجاع‌شده به خودم، گروه‌بندی‌شده بر اساس فاز */
export async function GET(req: NextRequest) {
 if(postgresIntegration())return postgresRepairWorkflowHttp(req,'queue');
  try {
    const session = requireSession(req);
    const data = myQueue(session, req.cookies.get(BRANCH_COOKIE)?.value,{page:req.nextUrl.searchParams.get('page')??undefined});
    return ok({...data,...repairWorkflow(getDb(),Number(session.user.branch_id??-1))});
  } catch (e) {
    return fail(e);
  }
}
