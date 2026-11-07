import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresCustomerFinanceHttp} from '@/lib/db/pg-customer-finance-http';
import { NextRequest } from "next/server";
import { requireSession, requirePerm, fail, ok } from "@/lib/api";
import { invoiceDetail, requireInvoiceBranch } from "@/lib/invoice";
import { BRANCH_COOKIE } from "@/lib/branch";

export const dynamic = "force-dynamic";

/** جزئیات کامل فاکتور: اقلام، پرداخت‌ها، چک‌ها، طرف حساب */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if(postgresIntegration())return postgresCustomerFinanceHttp(req,'invoice',Number((await params).id));
  try {
    const session = requireSession(req);
    requirePerm(session, "invoices.view");
    const { id } = await params;
    const data = invoiceDetail(Number(id));
    if (!data) return Response.json({ error: "فاکتور یافت نشد." }, { status: 404 });
    requireInvoiceBranch(session, Number(data.invoice.branch_id), req.cookies.get(BRANCH_COOKIE)?.value);
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
