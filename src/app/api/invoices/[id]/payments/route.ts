import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresCustomerFinanceHttp} from '@/lib/db/pg-customer-finance-http';
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, fail, ok, readJson, requirePerm, HttpError } from "@/lib/api";
import { activeBranch, BRANCH_COOKIE } from "@/lib/branch";
import { addPaymentInTx, type PaymentInput } from "@/lib/invoice";
import { durableOperation } from "@/lib/idempotency";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if(postgresIntegration())return postgresCustomerFinanceHttp(req,'invoice-payments',Number((await params).id));
  try {
    const session = requireSession(req);
    requirePerm(session, "payments.create");
    const { id } = await params;
    const body = await readJson<PaymentInput>(req);
    const db = getDb();
    const inv = db.prepare("SELECT * FROM invoices WHERE id=?").get(Number(id)) as { id: number; branch_id: number } | undefined;
    const scope = activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value);
    if (!inv || (!scope.all && inv.branch_id !== scope.branchId)) throw new HttpError(404, "فاکتور یافت نشد.");
    const result = durableOperation(db, { actorId: session.user.id, branchId: inv.branch_id, operation: "invoice_payment",
      key: req.headers.get("idempotency-key"), payload: { invoice_id: inv.id, ...body } }, () => addPaymentInTx(db, session, inv, body, inv.branch_id));
    return ok(result);
  } catch (e) { return fail(e); }
}
