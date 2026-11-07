import { NextRequest } from "next/server";
import { captureFinancialDocument } from "@/lib/accounting-events";
import { getDb } from "@/lib/db/schema";
import { requireSession, fail, ok, readJson, audit, requirePerm, validate, HttpError } from "@/lib/api";
import { BRANCH_COOKIE, recordBranchId, branchWhere, activeBranch } from "@/lib/branch";
import { durableOperation } from "@/lib/idempotency";
import { parseDate } from "@/lib/format";
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresFinancialRequest} from '@/lib/db/pg-financial-http';
import {postgresCreateExpense,postgresExpenses} from '@/lib/db/pg-expenses';
import {postgresFailure} from '@/lib/db/pg-http';
import {readRequestJson} from '@/lib/request-json';

export async function GET(req: NextRequest) {
  if(postgresIntegration()){
    try{
      const {database,schema,token,branchId}=await postgresFinancialRequest(req,'expenses.view');
      return Response.json(await postgresExpenses(database,schema,token,branchId,{page:Number(req.nextUrl.searchParams.get('page')??1),size:Number(req.nextUrl.searchParams.get('size')??50)}),{headers:{'Cache-Control':'no-store'}});
    }catch(error){return postgresFailure(error);}
  }
  try {
    const session = requireSession(req);
    requirePerm(session, "expenses.view");
    const db = getDb();
    const scope = branchWhere(activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value));
    return ok({ expenses: db.prepare(`SELECT * FROM expenses WHERE ${scope.sql} ORDER BY date DESC,id DESC LIMIT 200`).all(...scope.params) });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  if(postgresIntegration()){
    try{
      const {database,schema,token,branchId,scope}=await postgresFinancialRequest(req,'expenses.manage');
      const branch=branchId??scope.session.user.branch_id;if(branch==null)return Response.json({error:'شعبهٔ هزینه مشخص نیست.'},{status:409});
      return Response.json(await postgresCreateExpense(database,schema,token,branch,req.headers.get('idempotency-key'),await readRequestJson(req)));
    }catch(error){return postgresFailure(error);}
  }
  try {
    const session = requireSession(req);
    requirePerm(session, "expenses.manage");
    const b = await readJson(req);
    const amount = validate.amount(b.amount ?? 0);
    if (!amount || amount <= 0) return Response.json({ error: "مبلغ باید بیشتر از صفر باشد." }, { status: 400 });
    const db = getDb();
    const branchId = recordBranchId(session, req.cookies.get(BRANCH_COOKIE)?.value);
    const date = b.date ?? new Date().toISOString().slice(0, 10);
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !parseDate(date)) throw new HttpError(400, "تاریخ هزینه معتبر نیست.");
    if (!["cash", "card", "transfer", "bank_transfer", "other"].includes(b.method ?? "cash")) throw new HttpError(400, "روش پرداخت هزینه معتبر نیست.");
    const category = validate.maxLength(validate.required(b.category ?? "سایر", "دسته‌بندی"), 100, "دسته‌بندی");
    return ok(durableOperation(db, { actorId: session.user.id, branchId, operation: "expense_create",
      key: req.headers.get("idempotency-key"), payload: b }, () => {
    const id = db
      .prepare("INSERT INTO expenses(category, amount, date, vendor, method, branch_id, description, user_id) VALUES(?,?,?,?,?,?,?,?)")
      .run(category, amount, date, b.vendor ?? null, b.method ?? "cash", branchId, b.description ?? null, session.user.id).lastInsertRowid as number;
    audit(session, "create", "expense", id, null, { category, amount, branch_id: branchId });
    captureFinancialDocument(db,"expense",Number(id),"record",session.user.id,branchId);
    return { id: Number(id) };
    }));
  } catch (e) {
    return fail(e);
  }
}
