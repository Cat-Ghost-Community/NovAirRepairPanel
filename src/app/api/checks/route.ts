import { NextRequest } from "next/server";
import { requireSession, requirePerm, ok, fail, readJson, HttpError } from "@/lib/api";
import { getDb } from "@/lib/db/schema";
import { BRANCH_COOKIE, activeBranch, branchWhere, recordBranchId } from "@/lib/branch";
import { mutateCheck, type CheckInput } from "@/lib/checks";
import { durableOperation } from "@/lib/idempotency";
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresFinancialRequest} from '@/lib/db/pg-financial-http';
import {postgresChecks,postgresMutateCheck} from '@/lib/db/pg-checks';
import {postgresFailure} from '@/lib/db/pg-http';
import {readRequestJson} from '@/lib/request-json';

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if(postgresIntegration()){
    try{const {database,schema,token,branchId}=await postgresFinancialRequest(req,'finance.view');return Response.json(await postgresChecks(database,schema,token,branchId,{status:req.nextUrl.searchParams.get('status')??undefined,kind:req.nextUrl.searchParams.get('kind')??undefined,page:Number(req.nextUrl.searchParams.get('page')??1),size:Number(req.nextUrl.searchParams.get('size')??100)}),{headers:{'Cache-Control':'no-store'}});}catch(error){return postgresFailure(error);}
  }
  try {
    const session = requireSession(req);
    requirePerm(session, "finance.view");
    const db = getDb();
    const scope = branchWhere(activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value), "c");
    let sql = `SELECT c.*,cu.first_name || ' ' || cu.last_name customer_name,ba.name bank_account_name
      FROM checks c LEFT JOIN customers cu ON cu.id=c.customer_id LEFT JOIN bank_accounts ba ON ba.id=c.bank_account_id WHERE ${scope.sql}`;
    const args: (number | string)[] = [...scope.params];
    for (const key of ["status", "kind"] as const) {
      const value = req.nextUrl.searchParams.get(key);
      if (value) { sql += ` AND c.${key}=?`; args.push(value); }
    }
    const checks = db.prepare(`${sql} ORDER BY c.due_date,c.id LIMIT 300`).all(...args);
    const summary = db.prepare(`SELECT c.kind,c.status,COUNT(*) count,SUM(c.amount) total FROM checks c WHERE ${scope.sql} GROUP BY c.kind,c.status`).all(...scope.params);
    return ok({ checks, summary });
  } catch (e) { return fail(e); }
}

export async function POST(req: NextRequest) {
  if(postgresIntegration()){
    try{const {database,schema,token,branchId}=await postgresFinancialRequest(req,'finance.manage');return Response.json(await postgresMutateCheck(database,schema,token,branchId,req.headers.get('idempotency-key'),await readRequestJson(req)));}catch(error){return postgresFailure(error);}
  }
  try {
    const session = requireSession(req);
    requirePerm(session, "finance.manage");
    const body = await readJson<CheckInput>(req);
    const db = getDb();
    const cookie = req.cookies.get(BRANCH_COOKIE)?.value;
    const scope = activeBranch(session, cookie);
    let branchId = recordBranchId(session, cookie);
    if (body.id) {
      const check = db.prepare("SELECT branch_id FROM checks WHERE id=?").get(body.id) as { branch_id: number } | undefined;
      if (!check || (!scope.all && check.branch_id !== scope.branchId)) throw new HttpError(404, "چک یافت نشد.");
      branchId = check.branch_id;
    }
    return ok(durableOperation(db, { actorId: session.user.id, branchId, operation: "check_mutation",
      key: req.headers.get("idempotency-key"), payload: body }, () => mutateCheck(db, session, body, branchId)));
  } catch (e) { return fail(e); }
}
