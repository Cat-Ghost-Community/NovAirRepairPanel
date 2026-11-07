import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresCustomerFinanceHttp} from '@/lib/db/pg-customer-finance-http';
import { NextRequest } from "next/server";
import { requireSession, fail, ok, readJson } from "@/lib/api";
import { BRANCH_COOKIE } from "@/lib/branch";
import { confirmInvoice } from "@/lib/invoice";

export const dynamic = "force-dynamic";

/** ثبت نهایی فاکتور: انبار + پرداخت‌های اولیه + وضعیت (ضدتکرار وضعیت‌محور) */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if(postgresIntegration())return postgresCustomerFinanceHttp(req,'confirm',Number((await params).id));
  try {
    const session = requireSession(req);
    const { id } = await params;
    const b = await readJson(req);
    const data = confirmInvoice(
      session,
      Number(id),
      Array.isArray(b.payments) ? b.payments : [],
      req.cookies.get(BRANCH_COOKIE)?.value
    );
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
