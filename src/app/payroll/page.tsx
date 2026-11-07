import { requirePageAccess } from "@/lib/page-access";
import { getDb } from "@/lib/db/schema";
import { getSessionByToken, canUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PayrollClient } from "./payroll-client";
import { activeBranch } from "@/lib/branch";
import Link from "next/link";
import { PAYROLL_SOURCE_JOINS,PAYROLL_BRANCH_SQL } from "@/lib/payroll-scope";

export const dynamic = "force-dynamic";

export default async function PayrollPage({searchParams}:{searchParams:Promise<{after?:string}>}) {
  await requirePageAccess("/payroll");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "team.view")) redirect("/");
  const db = getDb();
  const scope=activeBranch(session,cookieStore.get("repaid_branch")?.value),params=scope.all?[]:[scope.branchId];
  const requested=Number((await searchParams).after??0),after=Number.isSafeInteger(requested)&&requested>=0?requested:0;
  const canManage=canUser(session,"team.manage")&&canUser(session,"finance.manage");

  const staff = db.prepare(
    `SELECT u.id, u.name, u.role, u.avatar_color, p.salary_type, p.fixed_monthly, p.percent_repair, p.percent_parts, p.percent_only_labor, p.pay_period,
      COALESCE((SELECT SUM(CASE WHEN r.source_ticket_id IS NOT NULL AND r.base_salary=0 AND r.deductions=0
        THEN cp.payable ELSE cp.effective_commission END)
        FROM payroll_runs r JOIN commission_positions cp ON cp.run_id=r.id ${PAYROLL_SOURCE_JOINS}
        WHERE r.user_id = u.id AND (r.status IN ('pending','approved','partially_paid') OR EXISTS(SELECT 1 FROM commission_corrections cc WHERE cc.run_id=r.id AND cc.state='posted')) ${scope.all?"":`AND ${PAYROLL_BRANCH_SQL}=?`}),0) pending_commission,
      COALESCE((SELECT SUM(amount) FROM payroll_deductions d WHERE d.user_id = u.id ${scope.all?'':'AND d.branch_id=?'}),0) total_deductions
     FROM users u LEFT JOIN payroll_profiles p ON p.user_id = u.id
     WHERE u.is_active = 1 AND u.id>? ${scope.all?"":"AND u.branch_id=?"} ORDER BY u.id LIMIT 201`
  ).all(...params,...params,after,...params);
  const recentRuns = db.prepare(
    `SELECT r.*, u.name user_name,p.paid paid_amount,p.effective_net,p.effective_commission,p.payable,p.recoverable,p.recovered,
      EXISTS(SELECT 1 FROM commission_corrections c WHERE c.run_id=r.id AND c.kind IN ('reduction','reinstatement') AND c.state='posted') corrected
      FROM payroll_runs r JOIN users u ON u.id = r.user_id JOIN commission_positions p ON p.run_id=r.id ${PAYROLL_SOURCE_JOINS}
      WHERE 1=1 ${scope.all?"":`AND ${PAYROLL_BRANCH_SQL}=?`} ORDER BY r.id DESC LIMIT 50`
  ).all(...params);
  const recentDeductions = db.prepare(
    `SELECT d.*, u.name user_name FROM payroll_deductions d JOIN users u ON u.id = d.user_id
      ${scope.all?"":"WHERE d.branch_id=?"} ORDER BY d.id DESC LIMIT 50`
  ).all(...params);

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <div className="mb-4">
        <h1 className="text-xl font-bold tracking-tight">حقوق و دستمزد</h1>
        <p className="text-sm text-zinc-500 mt-0.5">حقوق ثابت، درصدی از اجرت و قطعات، تلفیقی + کسر حقوق (غیبت، تأخیر، تخلف)</p>
      </div>

      <PayrollClient
        key={scope.branchId??"all"}
        staff={JSON.parse(JSON.stringify(staff.slice(0,200)))}
        runs={JSON.parse(JSON.stringify(recentRuns))}
        deductions={JSON.parse(JSON.stringify(recentDeductions))}
        canManage={canManage}
        canPay={canManage&&canUser(session,"payments.create")}
      />
      <div className="mt-4 flex flex-wrap gap-2">{after>0&&<Link className="btn-secondary" href="/payroll">ابتدای کارکنان</Link>}{staff.length>200&&<Link className="btn-secondary" href={`/payroll?after=${staff[199].id}`}>کارکنان بعدی</Link>}</div>
    </div>
  );
}
