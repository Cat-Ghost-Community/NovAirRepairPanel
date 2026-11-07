import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresCustomerFinanceHttp} from '@/lib/db/pg-customer-finance-http';
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, fail, ok, readJson, requirePerm, HttpError, validate } from "@/lib/api";
import { activeBranch, branchWhere, BRANCH_COOKIE, recordBranchId } from "@/lib/branch";
import { createCustomerReceipt, type ReceiptInput } from "@/lib/customer-payments";
import { durableOperation } from "@/lib/idempotency";
import {readSnapshot} from '@/lib/db/transaction';

export async function GET(req: NextRequest) {
  if(postgresIntegration())return postgresCustomerFinanceHttp(req,'payments');
  try {
    const session = requireSession(req);
    requirePerm(session, "payments.view");
    const scope = branchWhere(activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value));
    const sp=req.nextUrl.searchParams,db=getDb();
    const page=Number(sp.get('page')??1),limit=Number(sp.get('limit')??200);
    if(!Number.isSafeInteger(page)||page<1||page>100000||!Number.isSafeInteger(limit)||limit<1||limit>200)throw new HttpError(400,'صفحه‌بندی پرداخت‌ها معتبر نیست.');
    const q=(sp.get('q')??'').trim();if(q.length>200)throw new HttpError(400,'عبارت جستجو بیش از حد طولانی است.');
    const where=`${scope.sql} AND (?='' OR number LIKE ? OR reference LIKE ?)`,params=[...scope.params,q,`%${q}%`,`%${q}%`];
    return readSnapshot(db,()=>{const total=Number(db.prepare(`SELECT COUNT(*) n FROM payments WHERE ${where}`).get(...params)!.n);
      const payments = db.prepare(`SELECT * FROM payments WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(...params,limit,(page-1)*limit);
      return ok({ payments,page,limit,total,totalPages:Math.max(1,Math.ceil(total/limit)),hasMore:page*limit<total });});
  } catch (e) { return fail(e); }
}

export async function POST(req: NextRequest) {
  if(postgresIntegration())return postgresCustomerFinanceHttp(req,'payments');
  try {
    const session = requireSession(req);
    requirePerm(session, "payments.create");
    const body = await readJson<ReceiptInput>(req);
    for (const field of ["customer_id", "invoice_id", "ticket_id", "sale_id"] as const) {
      if (body[field] != null) body[field] = validate.id(body[field]);
    }
    const db = getDb();
    const cookie = req.cookies.get(BRANCH_COOKIE)?.value;
    const scope = activeBranch(session, cookie);
    let branchId = recordBranchId(session, cookie);
    for (const [table, id] of [["invoices", body.invoice_id], ["repair_tickets", body.ticket_id], ["sales", body.sale_id]] as const) {
      if (!id) continue;
      const source = db.prepare(`SELECT branch_id FROM ${table} WHERE id=?`).get(id) as { branch_id: number } | undefined;
      if (!source || (!scope.all && source.branch_id !== scope.branchId)) throw new HttpError(404, "سند مبدأ یافت نشد.");
      branchId = source.branch_id;
    }
    const result = durableOperation(db, { actorId: session.user.id, branchId, operation: "customer_receipt",
      key: req.headers.get("idempotency-key"), payload: body }, () => createCustomerReceipt(db, session, body, branchId));
    return ok(result);
  } catch (e) { return fail(e); }
}
