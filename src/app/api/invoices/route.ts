import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresCustomerFinanceHttp} from '@/lib/db/pg-customer-finance-http';
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, fail, ok, readJson, audit, requirePerm, HttpError, validate } from "@/lib/api";
import { BRANCH_COOKIE, activeBranch } from "@/lib/branch";
import { createInvoice, listInvoices, requireInvoiceBranch, type CreateInvoiceInput } from "@/lib/invoice";
import { atomic } from "@/lib/db/transaction";
import { parseDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/** فهرست فاکتورها — نوع/وضعیت/جست‌وجو/بازهٔ تاریخ/طرف حساب */
export async function GET(req: NextRequest) {
  if(postgresIntegration())return postgresCustomerFinanceHttp(req,'invoices');
  try {
    const session = requireSession(req);
    requirePerm(session, "invoices.view");
    const sp = req.nextUrl.searchParams;
    const invoices = listInvoices({
      branch_id: activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value).branchId,
      type: sp.get("type"),
      status: sp.get("status"),
      q: sp.get("q"),
      from: sp.get("from"),
      to: sp.get("to"),
      party_id: sp.get("party_id") ? Number(sp.get("party_id")) : null,
      limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
    });
    return ok({ invoices });
  } catch (e) {
    return fail(e);
  }
}

/** صدور فاکتور (خرید/فروش/تعمیر) — پیش‌نویس یا ثبت نهایی، ضدتکرار با client_key */
export async function POST(req: NextRequest) {
  if(postgresIntegration())return postgresCustomerFinanceHttp(req,'invoices');
  try {
    const session = requireSession(req);
    const b = await readJson(req);
    if (b.client_key == null) b.client_key = req.headers.get("idempotency-key");
    if (typeof b.client_key !== "string" || !b.client_key || b.client_key.length > 64) throw new HttpError(400, "شناسهٔ ضدتکرار برای صدور فاکتور الزامی است.");
    for (const field of ["customer_id", "supplier_id", "ticket_id", "sale_id", "purchase_order_id", "employee_id", "branch_id"]) {
      if (b[field] != null) b[field] = validate.id(b[field]);
    }
    const data = createInvoice(
      session,
      {
        type: String(b.type ?? "") as CreateInvoiceInput["type"],
        client_key: b.client_key ?? null,
        customer_id: b.customer_id ?? null,
        supplier_id: b.supplier_id ?? null,
        ticket_id: b.ticket_id ?? null,
        sale_id: b.sale_id ?? null,
        purchase_order_id: b.purchase_order_id ?? null,
        employee_id: b.employee_id ?? null,
        branch_id: b.branch_id ?? null,
        date: b.date ?? null,
        due_date: b.due_date ?? null,
        external_number: b.external_number ?? null,
        notes: b.notes ?? null,
        items: Array.isArray(b.items) ? b.items : [],
        // نبود مقدار باید undefined بماند تا منطق «آینه‌سازی تخفیف سند مبدأ» در موتور فعال بماند
        end_discount: b.end_discount == null ? undefined : b.end_discount,
        confirm: !!b.confirm,
        payments: Array.isArray(b.payments) ? b.payments : [],
      },
      req.cookies.get(BRANCH_COOKIE)?.value
    );
    return ok(data, { status: data.duplicate ? 200 : 201 });
  } catch (e) {
    return fail(e);
  }
}

/** ویرایش فاکتور — فعلاً موعد تسویه */
export async function PATCH(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "invoices.edit");
    const b = await readJson(req);
    if (!b.id) return fail(new Error("شناسه فاکتور الزامی است"));
    const db = getDb();
    return atomic(db, () => {
    const invoice = db.prepare("SELECT branch_id,status FROM invoices WHERE id=?").get(Number(b.id)) as { branch_id: number; status: string } | undefined;
    if (!invoice) throw new HttpError(404, "فاکتور یافت نشد.");
    requireInvoiceBranch(session, invoice.branch_id, req.cookies.get(BRANCH_COOKIE)?.value);
    if (invoice.status === "cancelled") throw new HttpError(400, "فاکتور لغوشده قابل ویرایش نیست.");
    if (b.due_date != null && (!/^\d{4}-\d{2}-\d{2}$/.test(b.due_date) || !parseDate(b.due_date))) throw new HttpError(400, "تاریخ سررسید معتبر نیست.");
    db.prepare("UPDATE invoices SET due_date = COALESCE(?, due_date) WHERE id = ?").run(b.due_date ?? null, Number(b.id));
    audit(session, "edit", "invoice", Number(b.id), null, { due_date: b.due_date });
    return ok({ done: true });
    });
  } catch (e) {
    return fail(e);
  }
}
