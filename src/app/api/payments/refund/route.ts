import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresCustomerFinanceHttp} from '@/lib/db/pg-customer-finance-http';
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, fail, ok, readJson, requirePerm, HttpError, validate } from "@/lib/api";
import { activeBranch, BRANCH_COOKIE } from "@/lib/branch";
import { refundReceipt } from "@/lib/customer-payments";
import { durableOperation } from "@/lib/idempotency";

export async function POST(req: NextRequest) {
  if(postgresIntegration())return postgresCustomerFinanceHttp(req,'refund');
  try {
    const session = requireSession(req);
    requirePerm(session, "payments.refund");
    const body = await readJson<Parameters<typeof refundReceipt>[2]>(req);
    body.payment_id = validate.id(body.payment_id);
    const db = getDb();
    const payment = db.prepare("SELECT branch_id FROM payments WHERE id=?").get(body.payment_id) as { branch_id: number } | undefined;
    const scope = activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value);
    if (!payment || (!scope.all && payment.branch_id !== scope.branchId)) throw new HttpError(404, "سند پرداخت اصلی یافت نشد.");
    const result = durableOperation(db, { actorId: session.user.id, branchId: payment.branch_id, operation: "payment_refund",
      key: req.headers.get("idempotency-key"), payload: body }, () => refundReceipt(db, session, body, payment.branch_id));
    return ok(result);
  } catch (e) { return fail(e); }
}
