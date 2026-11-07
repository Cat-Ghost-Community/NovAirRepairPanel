import type { DatabaseSync } from "node:sqlite";
import type { Session } from "@/lib/auth";
import { audit, HttpError } from "@/lib/api";
import { rial, sumRial } from "@/lib/money";
import { netInvoicePaid, pendingInvoiceAmount } from "@/lib/payment-state";
import { captureFinancialDocument } from "@/lib/accounting-events";

type Advance = { id: number; customer_id: number; branch_id: number; sale_id: number | null; amount: number; refunded: number; method: string;
  check_id: number | null; check_status: string | null; check_invoice: number | null; check_amount: number | null; invalid_ref: number };

export function ticketAdvances(db: DatabaseSync, ticketId: number) {
  const rows = db.prepare(`SELECT p.id,p.customer_id,p.branch_id,p.sale_id,p.amount,p.method,
    COALESCE((SELECT SUM(r.amount) FROM refunds r WHERE r.payment_id=p.id),0) refunded,
    EXISTS(SELECT 1 FROM refunds r WHERE r.payment_id=p.id AND (r.invoice_id IS NOT NULL OR r.sale_id IS NOT p.sale_id
      OR r.customer_id IS NOT p.customer_id OR r.branch_id IS NOT p.branch_id)) invalid_ref,
    c.id check_id,c.status check_status,c.invoice_id check_invoice,c.amount check_amount
    FROM payments p LEFT JOIN checks c ON c.payment_id=p.id
    WHERE p.ticket_id=? AND p.invoice_id IS NULL AND p.direction='in'
    AND NOT EXISTS(SELECT 1 FROM active_customer_credit a WHERE a.payment_id=p.id AND a.remaining>0) ORDER BY p.id LIMIT 1001`).all(ticketId) as Advance[];
  if (rows.length > 1000) throw new HttpError(409, "تعداد اسناد پیش‌دریافت این پذیرش نیازمند بررسی مالی است.");
  let settled = 0;
  let pending = 0;
  for (const row of rows) {
    const amount = rial(row.amount);
    const refunded = rial(row.refunded);
    if (refunded > amount || row.invalid_ref || row.sale_id != null) throw new HttpError(409, "اسناد پیش‌دریافت و استرداد این پذیرش تطبیق ندارند.");
    if (["check", "cheque"].includes(row.method)) {
      if (!row.check_id || row.check_invoice != null || row.check_amount !== amount) throw new HttpError(409, "اتصال چکِ پیش‌دریافت نیازمند بررسی مالی است.");
      if (!["passed", "in_hand", "deposited", "transferred_spend", "bounced", "returned_to_bank"].includes(row.check_status ?? "")) throw new HttpError(409, "وضعیت چکِ پیش‌دریافت نیازمند بررسی مالی است.");
      if (row.check_status === "passed") settled = sumRial([settled, amount - refunded]);
      else if (["in_hand", "deposited", "transferred_spend"].includes(row.check_status ?? "")) {
        if (refunded) throw new HttpError(409, "چک وصول‌نشده دارای استرداد است؛ بررسی مالی لازم است.");
        pending = sumRial([pending, amount]);
      }
    } else settled = sumRial([settled, amount - refunded]);
  }
  return { rows, settled, pending };
}

/** Whole-document allocation only. Preserve receipt/refund amounts and dates,
 * link explicit same-ticket advances at confirmation, and audit the new link.
 * Splitting an overpayment needs a reviewed credit-allocation model. */
export function allocateTicketAdvances(db: DatabaseSync, session: Session, invoice: {
  id: number; ticket_id: number; customer_id: number; branch_id: number; total: number;
}) {
  if (!db.isTransaction) throw new Error("Advance allocation requires a transaction");
  const advances = ticketAdvances(db, invoice.ticket_id);
  if (!advances.rows.length) return;
  if (advances.rows.some(row => row.customer_id !== invoice.customer_id || row.branch_id !== invoice.branch_id)) throw new HttpError(409, "مشتری یا شعبهٔ پیش‌دریافت با فاکتور تطبیق ندارد.");
  const existing = sumRial([netInvoicePaid(db, invoice.id, "in"), pendingInvoiceAmount(db, invoice.id, "in")]);
  if (sumRial([existing, advances.settled, advances.pending]) > invoice.total) throw new HttpError(409, "پیش‌دریافت از مبلغ فاکتور بیشتر است؛ پیش از تخصیص، اعتبار یا استرداد را بررسی کنید.");
  const ids = advances.rows.map(row => row.id);
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(`UPDATE payments SET invoice_id=? WHERE id IN (${placeholders}) AND invoice_id IS NULL`).run(invoice.id, ...ids);
  db.prepare(`UPDATE refunds SET invoice_id=? WHERE payment_id IN (${placeholders}) AND invoice_id IS NULL`).run(invoice.id, ...ids);
  db.prepare(`UPDATE checks SET invoice_id=? WHERE payment_id IN (${placeholders}) AND invoice_id IS NULL`).run(invoice.id, ...ids);
  audit(session, "allocate_advances", "invoice", invoice.id, { payment_ids: ids, invoice_id: null },
    { invoice_id: invoice.id, ticket_id: invoice.ticket_id, settled: advances.settled, pending: advances.pending, branch_id: invoice.branch_id });
  return captureFinancialDocument(db,"invoice",invoice.id,"advance_allocation",session.user.id,invoice.branch_id,advances.settled);
}
