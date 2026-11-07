import { getDb } from "@/lib/db/schema";
import { multiplyRial, percentRial, rial, roundRial, sumRial } from "@/lib/money";
import { refreshInvoiceFinancialState,SETTLED_PAYMENT } from "@/lib/payment-state";

export type LineItem = {
  kind: "service" | "part" | "labor" | "fee" | "product" | "device" | "other";
  ref_id?: number | null;
  name: string;
  qty: number;
  unit_price: number; // integer IRR
  cost?: number; // unit cost, integer IRR
  total?: number;
};

export function lineTotal(l: LineItem): number {
  return multiplyRial(l.unit_price, l.qty);
}

export function totals(items: LineItem[], discount = 0, taxRatePct = 0) {
  const subtotal = sumRial(items.map(lineTotal));
  discount = rial(discount);
  const afterDiscount = Math.max(0, subtotal - discount);
  const tax = percentRial(afterDiscount, taxRatePct);
  return { subtotal, discount, tax, total: sumRial([afterDiscount, tax]), cost: sumRial(items.map(i => multiplyRial(i.cost ?? 0, i.qty))) };
}

export function invoicePaid(invoiceId: number): number {
  const row = getDb()
    .prepare(`SELECT COALESCE(SUM(p.amount),0) p FROM payments p WHERE p.invoice_id = ? AND p.direction = 'in' AND ${SETTLED_PAYMENT}`)
    .get(invoiceId) as any;
  return row?.p ?? 0;
}

export function invoiceRefunded(invoiceId: number): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(r.amount),0) v FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE p.invoice_id = ?`
    )
    .get(invoiceId) as any;
  return row?.v ?? 0;
}

export function customerBalance(customerId: number, branchId?: number): number {
  const db = getDb();
  // Each obligation is counted once. POS becomes an invoice obligation when a
  // finalized linked invoice exists. Cash comes from net settled documents,
  // including unallocated advances, not independently maintained paid counters.
  const row=db.prepare("SELECT COALESCE(SUM(amount),0) balance FROM party_balance_events WHERE kind='customer' AND party_id=? AND (? IS NULL OR branch_id=?)").get(customerId,branchId??null,branchId??null) as {balance:number};
  if (!Number.isSafeInteger(row.balance)) throw new Error("ماندهٔ مشتری خارج از محدودهٔ مجاز است.");
  return row.balance;
}

export function syncInvoicePaid(invoiceId: number) {
  refreshInvoiceFinancialState(getDb(),invoiceId);
}

/** نرخ ارزش افزوده — اگر «فعال‌بودن ارزش افزوده» در تنظیمات خاموش باشد، صفر برگردانده می‌شود */
export function taxRatePct(): number {
  const db = getDb();
  const enabled = db.prepare("SELECT value FROM settings WHERE key = 'vat_enabled'").get() as any;
  if (enabled && String(enabled.value) === "0") return 0;
  const row = db.prepare("SELECT value FROM settings WHERE key = 'tax_rate'").get() as any;
  return Number(row?.value ?? 0);
}

/** عوارض شهرداری (درصد) */
export function dutyRatePct(): number {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'duty_rate'").get() as any;
  return Number(row?.value ?? 0);
}

/** رند کردن خودکار نهایی به مضرب تنظیم‌شده (مثلاً ۱۰۰۰ تومان) */
export function roundToSetting(amount: number): number {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'round_to'").get() as any;
  const step = Number(row?.value ?? 0);
  if (!step || step <= 1) return amount;
  return roundRial(amount, step);
}

/**
 * محاسبه نهایی فاکتور با ارزش افزوده + عوارض + تخفیف سطری/انتهایی + رند خودکار
 * ورودی مبلغ‌ها ریال است (واحد نمایش در UI جدا تصمیم می‌گیرد).
 */
export function fullTotals(opts: {
  items: LineItem[];
  lineDiscounts?: number[]; // تخفیف سطری هم‌طول با items
  endDiscount?: number; // تخفیف انتهای فاکتور
  taxPct?: number; // ارزش افزوده — پیش‌فرض از تنظیمات
  dutyPct?: number; // عوارض — پیش‌فرض از تنظیمات
  round?: boolean;
}) {
  const gross = sumRial(opts.items.map(lineTotal));
  const lineDisc = sumRial(opts.lineDiscounts ?? []);
  const endDisc = rial(opts.endDiscount ?? 0);
  const discount = Math.min(gross, sumRial([lineDisc, endDisc]));
  const afterDiscount = Math.max(0, gross - discount);
  const taxPct = opts.taxPct ?? taxRatePct();
  const dutyPct = opts.dutyPct ?? dutyRatePct();
  const tax = percentRial(afterDiscount, taxPct);
  const duty = percentRial(afterDiscount, dutyPct);
  const raw = sumRial([afterDiscount, tax, duty]);
  const total = opts.round === false ? raw : roundToSetting(raw);
  return { gross, discount, tax, duty, total, cost: sumRial(opts.items.map(i => multiplyRial(i.cost ?? 0, i.qty))) };
}

/** اعتبارسنجی مانده حساب مشتری نسبت به سقف اعتبار */
export function checkCreditLimit(customerId: number, newCharge: number): { ok: boolean; balance: number; limit: number } {
  const balance = customerBalance(customerId);
  const row = getDb().prepare("SELECT credit_limit FROM customers WHERE id = ?").get(customerId) as any;
  const limit = Number(row?.credit_limit ?? 0);
  if (limit <= 0) return { ok: true, balance, limit };
  return { ok: balance + newCharge <= limit, balance, limit };
}
