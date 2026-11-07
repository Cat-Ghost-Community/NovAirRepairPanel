import { NextRequest } from "next/server";
import { requireSession,requirePerm,ok,fail,readJson,audit,validate,HttpError } from "@/lib/api";
import { getDb } from "@/lib/db/schema";
import { upsertProfile,addDeduction,payrollReport } from "@/lib/payroll";
import { activeBranch,recordBranchId } from "@/lib/branch";
import { accountingDate,ledgerScope } from "@/lib/accounting";
import { durableJsonResponse } from "@/lib/idempotency";
import { quantityValue } from "@/lib/money";
import { approveCommission,commissionEvidence,recordCommissionPayment } from "@/lib/commission-settlement";
import { PAYROLL_SOURCE_JOINS,PAYROLL_BRANCH_SQL } from "@/lib/payroll-scope";

export async function GET(req:NextRequest){try{
  const session=requireSession(req);requirePerm(session,"team.view");requirePerm(session,"finance.view");
  const db=getDb(),sp=req.nextUrl.searchParams,cookie=req.cookies.get("repaid_branch")?.value,scope=activeBranch(session,cookie);
  const params=scope.all?[]:[scope.branchId];
  if(sp.get("user_id")){
    const userId=validate.id(sp.get("user_id")),user=db.prepare("SELECT branch_id FROM users WHERE id=?").get(userId);
    if(!user)throw new HttpError(404,"کارمند یافت نشد.");ledgerScope(session,Number(user.branch_id),cookie);
    const from=accountingDate(sp.get("from")??new Date(Date.now()-30*86400000).toISOString().slice(0,10)),to=accountingDate(sp.get("to")??new Date().toISOString().slice(0,10));
    if(from>to)throw new HttpError(400,"بازهٔ گزارش معتبر نیست.");
    const report=payrollReport(userId,from,to,scope.branchId);
    const deductions=db.prepare(`SELECT * FROM payroll_deductions WHERE user_id=? AND date BETWEEN ? AND ? ${scope.all?'':'AND branch_id=?'} ORDER BY id DESC LIMIT 200`).all(userId,from,to,...params);
    const runs=db.prepare(`SELECT r.*,p.paid paid_amount,p.effective_net,p.effective_commission,p.payable,p.recoverable,p.recovered
      FROM payroll_runs r JOIN users u ON u.id=r.user_id JOIN commission_positions p ON p.run_id=r.id ${PAYROLL_SOURCE_JOINS}
      WHERE r.user_id=? ${scope.all?"":`AND ${PAYROLL_BRANCH_SQL}=?`} ORDER BY r.id DESC LIMIT 50`).all(userId,...params);
    return ok({report,deductions,runs});
  }
  const after=sp.has("after")?validate.id(sp.get("after")):0;
  const staff=db.prepare(`SELECT u.id,u.name,u.role,u.avatar_color,p.salary_type,p.fixed_monthly,p.percent_repair,p.percent_parts,p.percent_only_labor,p.pay_period,
    COALESCE((SELECT SUM(CASE WHEN r.source_ticket_id IS NOT NULL AND r.base_salary=0 AND r.deductions=0
      THEN cp.payable ELSE cp.effective_commission END)
      FROM payroll_runs r JOIN commission_positions cp ON cp.run_id=r.id ${PAYROLL_SOURCE_JOINS} WHERE r.user_id=u.id
      AND (r.status IN ('pending','approved','partially_paid') OR EXISTS(SELECT 1 FROM commission_corrections cc WHERE cc.run_id=r.id AND cc.state='posted')) ${scope.all?"":`AND ${PAYROLL_BRANCH_SQL}=?`}),0) pending_commission,
    COALESCE((SELECT SUM(amount) FROM payroll_deductions d WHERE d.user_id=u.id ${scope.all?'':'AND d.branch_id=?'}),0) total_deductions
    FROM users u LEFT JOIN payroll_profiles p ON p.user_id=u.id WHERE u.is_active=1 AND u.id>? ${scope.all?"":"AND u.branch_id=?"} ORDER BY u.id LIMIT 201`)
    .all(...params,...params,after,...params);
  return ok({staff:staff.slice(0,200),next:staff.length>200?staff[199].id:null});
}catch(error){return fail(error);}}

export async function POST(req:NextRequest){try{
  const session=requireSession(req);requirePerm(session,"team.manage");requirePerm(session,"finance.manage");
  const body=await readJson(req),db=getDb(),cookie=req.cookies.get("repaid_branch")?.value;
  let branch:number;
  if(["pay_run","approve_run"].includes(body.action)){
    const evidence=commissionEvidence(db,validate.id(body.id));branch=Number(evidence.run.branch_id);
    ledgerScope(session,branch,cookie,"finance.manage");if(body.action==="pay_run")requirePerm(session,"payments.create");
  }else{
    const user=db.prepare("SELECT branch_id FROM users WHERE id=? AND is_active=1").get(validate.id(body.user_id));
    if(!user)throw new HttpError(404,"کارمند فعال یافت نشد.");branch=Number(user.branch_id);ledgerScope(session,branch,cookie,"finance.manage");
  }
  if(!Number.isSafeInteger(branch)||branch<=0)branch=recordBranchId(session,cookie);
  return durableJsonResponse(db,{actorId:session.user.id,branchId:branch,operation:"payroll",key:req.headers.get("idempotency-key"),payload:body},()=>{
    if(body.action==="approve_run")return ok(approveCommission(db,session,validate.id(body.id),cookie));
    if(body.action==="pay_run")return ok(recordCommissionPayment(db,session,validate.id(body.id),body,cookie));
    if(body.action==="save_profile"){
      const salaryType=body.salary_type??"fixed",period=body.pay_period??"monthly";
      if(!["fixed","percent","mixed"].includes(salaryType)||!["monthly","weekly","daily"].includes(period))throw new HttpError(400,"نوع حقوق یا دورهٔ پرداخت معتبر نیست.");
      const rate=(value:unknown)=>{const n=quantityValue(value??0);if(n>100)throw new HttpError(400,"درصد دستمزد نباید از صد بیشتر باشد.");return n;};
      const current=db.prepare("SELECT * FROM payroll_profiles WHERE user_id=?").get(body.user_id);
      upsertProfile({user_id:validate.id(body.user_id),salary_type:salaryType,fixed_monthly:validate.amount(body.fixed_monthly??0),percent_repair:rate(body.percent_repair),
        percent_parts:rate(body.percent_parts),percent_only_labor:body.percent_only_labor===true||body.percent_only_labor===1?1:0,pay_period:period,is_active:Number(current?.is_active??1)});
      audit(session,"payroll_profile","user",Number(body.user_id),current??null,{salary_type:salaryType,fixed_monthly:validate.amount(body.fixed_monthly??0),branch_id:branch});
      return ok({ok:true});
    }
    if(body.action==="add_deduction"){
      const amount=validate.amount(body.amount),date=accountingDate(body.date);
      if(!amount||!["absence","late","violation","mistake","other"].includes(body.reason??"other"))throw new HttpError(400,"مبلغ یا دلیل کسر معتبر نیست.");
      const notes=validate.maxLength(body.notes??"",500,"یادداشت");
      addDeduction(validate.id(body.user_id),amount,body.reason??"other",date,notes,session.user.id,branch);
      audit(session,"payroll_deduction","user",Number(body.user_id),null,{amount,date,reason:body.reason??"other",branch_id:branch});
      return ok({ok:true});
    }
    throw new HttpError(400,"عملیات دستمزد معتبر نیست.");
  });
}catch(error){return fail(error);}}
