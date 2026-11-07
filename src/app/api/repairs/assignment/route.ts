import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresRepairWorkflowHttp} from '@/lib/db/pg-repair-workflow-http';
import { NextRequest } from "next/server";
import { requireSession, fail, ok } from "@/lib/api";
import { BRANCH_COOKIE } from "@/lib/branch";
import { assignmentDashboard } from "@/lib/repair-assign";
import { isIsoDate } from "@/lib/assign-shared";

export const dynamic = "force-dynamic";

/** کارتابل ارجاع مدیر شعبه: دو گروه + تعمیرکاران با بار کاری */
export async function GET(req: NextRequest) {
 if(postgresIntegration())return postgresRepairWorkflowHttp(req,'assignment');
  try {
    const session = requireSession(req);
    const sp = req.nextUrl.searchParams;
    const q = String(sp.get("q") ?? "").slice(0, 80);
    const dateFrom = isIsoDate(sp.get("date_from")) ? String(sp.get("date_from")) : null;
    const dateTo = isIsoDate(sp.get("date_to")) ? String(sp.get("date_to")) : null;
    if (dateFrom && dateTo && dateFrom > dateTo) return Response.json({error:"تاریخ پایان نباید پیش از تاریخ شروع باشد."}, {status:400});
    const data = assignmentDashboard(session, { q, dateFrom, dateTo,page:sp.get('page')??undefined,phase:sp.get('phase')||undefined }, req.cookies.get(BRANCH_COOKIE)?.value);
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
