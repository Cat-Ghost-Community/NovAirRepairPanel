import { requirePageAccess } from "@/lib/page-access";
import { getDb } from "@/lib/db/schema";
import { ReportBuilderClient } from "./report-builder-client";
import { getSessionByToken, canUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {activeBranch,BRANCH_COOKIE} from "@/lib/branch";
import {REPORT_SOURCE_PERMISSIONS} from "@/lib/report-access";

export const dynamic = "force-dynamic";

export default async function ReportBuilderPage() {
  await requirePageAccess("/report-builder");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "reports.view")) redirect("/");
  const db = getDb();
  const branch=activeBranch(session,cookieStore.get(BRANCH_COOKIE)?.value).branchId;
  const saved = (db.prepare("SELECT id, name, source, config FROM saved_reports WHERE (? IS NULL OR branch_id=?) ORDER BY id DESC LIMIT 50").all(branch,branch) as any[]).filter(row=>REPORT_SOURCE_PERMISSIONS[row.source] && canUser(session,REPORT_SOURCE_PERMISSIONS[row.source]));
  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">گزارش‌ساز</h1>
        <p className="text-sm text-zinc-500 mt-0.5">گزارش دلخواه خود را بسازید: منبع داده، ستون‌ها، فیلتر و بازه تاریخ — سپس ذخیره یا خروجی بگیرید</p>
      </div>
      <ReportBuilderClient saved={JSON.parse(JSON.stringify(saved))} />
    </div>
  );
}
