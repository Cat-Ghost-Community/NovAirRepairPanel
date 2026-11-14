import { requirePageAccess } from "@/lib/page-access";
import { getDb } from "@/lib/db/schema";
import { getSessionByToken, canUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PayrollClient } from "./payroll-client";
import { activeBranch } from "@/lib/branch";
import {canManagePayroll} from '@/lib/payroll-permissions';
import {payrollQuery,payrollRunFilter,CANCELLABLE_COMMISSION_SQL} from '@/lib/payroll-query';
import Link from "next/link";
import { PAYROLL_SOURCE_JOINS,PAYROLL_BRANCH_SQL } from "@/lib/payroll-scope";

export const dynamic = "force-dynamic";

export default async function PayrollPage({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
  await requirePageAccess("/payroll");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "team.view")) redirect("/");
  const db = getDb();
  const scope=activeBranch(session,cookieStore.get("repaid_branch")?.value),params=scope.all?[]:[scope.branchId];
  const search=await searchParams;let filters;try{filters=payrollQuery(search);}catch(error){return <div className="card card-pad m-6" role="alert"><p>{error instanceof Error?error.message:'فیلتر معتبر نیست.'}</p><Link href="/payroll" className="btn-secondary mt-3">پاک کردن فیلترها</Link></div>;}
  const filter=payrollRunFilter(filters),runParams=[...params,...filter.params];
  const requested=Number(search.after??0),after=Number.isSafeInteger(requested)&&requested>=0?requested:0;
  const canManage=canManagePayroll(session),canReview=canUser(session,"team.manage")&&canUser(session,"finance.manage");

  const staff = db.prepare(
    `SELECT u.id, u.name, u.role, u.avatar_color, p.salary_type, p.fixed_monthly, p.percent_repair, p.percent_parts, p.percent_only_labor, p.pay_period, p.is_active profile_active,
      COALESCE((SELECT SUM(CASE WHEN r.source_ticket_id IS NOT NULL AND r.base_salary=0 AND r.deductions=0
        THEN cp.payable ELSE cp.effective_commission END)
        FROM payroll_runs r JOIN commission_positions cp ON cp.run_id=r.id ${PAYROLL_SOURCE_JOINS}
        WHERE r.user_id = u.id AND (r.status IN ('pending','approved','partially_paid') OR EXISTS(SELECT 1 FROM commission_corrections cc WHERE cc.run_id=r.id AND cc.state='posted')) ${scope.all?"":`AND ${PAYROLL_BRANCH_SQL}=?`}),0) pending_commission,
      COALESCE((SELECT SUM(amount) FROM payroll_deductions d WHERE d.user_id = u.id ${scope.all?'':'AND d.branch_id=?'}),0) total_deductions
     FROM users u LEFT JOIN payroll_profiles p ON p.user_id = u.id
     WHERE u.is_active = 1 AND u.id>? ${scope.all?"":"AND u.branch_id=?"} ORDER BY u.id LIMIT 201`
  ).all(...params,...params,after,...params);
  const recentRuns = db.prepare(
    `SELECT r.*, u.name user_name,t.number ticket_number,CASE WHEN ${CANCELLABLE_COMMISSION_SQL} THEN 1 ELSE 0 END cancellable,p.paid paid_amount,p.effective_net,p.effective_commission,p.payable,p.recoverable,p.recovered,
      EXISTS(SELECT 1 FROM commission_corrections c WHERE c.run_id=r.id AND c.kind IN ('reduction','reinstatement') AND c.state='posted') corrected
      FROM payroll_runs r JOIN users u ON u.id = r.user_id JOIN commission_positions p ON p.run_id=r.id ${PAYROLL_SOURCE_JOINS}
      WHERE 1=1 ${scope.all?"":`AND ${PAYROLL_BRANCH_SQL}=?`} ${filter.sql} ORDER BY r.id DESC LIMIT 51 OFFSET ?`
  ).all(...runParams,(filters.page-1)*50);
  const summary=db.prepare(`SELECT COUNT(*) count,COALESCE(SUM(CASE WHEN r.status!='cancelled' THEN p.payable ELSE 0 END),0) payable,COALESCE(SUM(p.paid),0) paid,COALESCE(SUM(p.recoverable),0) recoverable FROM payroll_runs r JOIN users u ON u.id=r.user_id JOIN commission_positions p ON p.run_id=r.id ${PAYROLL_SOURCE_JOINS} WHERE 1=1 ${scope.all?"":`AND ${PAYROLL_BRANCH_SQL}=?`} ${filter.sql}`).get(...runParams) as {count:number;payable:number;paid:number;recoverable:number};
  const deductionFilter=payrollRunFilter({...filters,status:''});deductionFilter.sql=deductionFilter.sql.replaceAll('r.user_id','d.user_id').replaceAll('date(r.period_from)','date(d.date)');
  const recentDeductions = db.prepare(
    `SELECT d.*, u.name user_name FROM payroll_deductions d JOIN users u ON u.id = d.user_id
      WHERE 1=1 ${scope.all?"":"AND d.branch_id=?"} ${deductionFilter.sql} ORDER BY d.id DESC LIMIT 50`
  ).all(...params,...deductionFilter.params);

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <div className="mb-4">
        <h1 className="text-xl font-bold tracking-tight">حقوق و دستمزد</h1>
        <p className="text-sm text-zinc-500 mt-0.5">مدیریت قرارداد حقوق، پورسانت‌های مستند، پرداخت‌ها، ابطال و بازیافت با حفظ سابقه</p>
      </div>

      <PayrollClient
        key={(scope.branchId??"all")+':'+JSON.stringify(filters)}
        staff={JSON.parse(JSON.stringify(staff.slice(0,200)))}
        runs={JSON.parse(JSON.stringify(recentRuns.slice(0,50)))}
        filters={filters}
        summary={{...summary}}
        deductions={JSON.parse(JSON.stringify(recentDeductions))}
        canManage={canManage}
        canReview={canReview}
        canPay={canReview&&canUser(session,"payments.create")}
      />
      <nav aria-label="صفحه‌بندی پورسانت‌ها" className="mt-4 flex flex-wrap gap-3">{filters.page>1&&<Link className="btn-secondary" href={'/payroll?'+new URLSearchParams({...search,runPage:String(filters.page-1)} as Record<string,string>)}>پورسانت‌های قبلی</Link>}{recentRuns.length>50&&<Link className="btn-secondary" href={'/payroll?'+new URLSearchParams({...search,runPage:String(filters.page+1)} as Record<string,string>)}>پورسانت‌های بعدی</Link>}</nav>
      <div className="mt-4 flex flex-wrap gap-2">{after>0&&<Link className="btn-secondary" href="/payroll">ابتدای کارکنان</Link>}{staff.length>200&&<Link className="btn-secondary" href={`/payroll?after=${staff[199].id}`}>کارکنان بعدی</Link>}</div>
    </div>
  );
}
