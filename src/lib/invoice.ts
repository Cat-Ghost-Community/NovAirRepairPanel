/**
 * موتور یکپارچهٔ فاکتور — خرید، فروش و دستی/تعمیر.
 *
 * اصول:
 *  - محاسبهٔ مالی «فقط سمت سرور» معتبر است (fullTotals: تخفیف سطری/انتهایی + ارزش افزوده + عوارض + رند).
 *  - قیمت اقلام از کاتالوگ مرجع گرفته می‌شود؛ تغییر دستی قیمت مجوز `invoices.edit` می‌خواهد.
 *  - انبار فقط در «ثبت نهایی» تکان می‌خورد (moveStock) — پیش‌نویس اثری روی موجودی ندارد.
 *  - ضد‌تکرار: client_key یکتا + وضعیت‌محور بودن confirm؛ لغو = سند برگشتی انبار با audit، نه حذف تاریخچه.
 *  - اقلام فاکتور اسنپ‌شات‌اند؛ تغییر بعدی قیمت کالا/تعرفه روی فاکتورهای قبلی اثر ندارد.
 */
import type { DatabaseSync } from "node:sqlite";
import { getDb, nextSeq } from "@/lib/db/schema";
import { audit, HttpError, validate } from "@/lib/api";
import { canUser, type Session } from "@/lib/auth";
import { fullTotals } from "@/lib/finance";
import { moveStock, InventoryError } from "@/lib/inventory";
import { addCustomerEvent } from "@/lib/repair";
import { activeBranch, recordBranchId } from "@/lib/branch";
import { atomic } from "@/lib/db/transaction";
import { multiplyRial, rial, sumRial, quantityValue } from "@/lib/money";
import { netInvoicePaid, pendingInvoiceAmount, syncSalePaid,refreshInvoiceFinancialState } from "@/lib/payment-state";
import { invoiceObligation } from '@/lib/invoice-obligation';
import { parseDate } from "@/lib/format";
import { purchaseInvoiceSource, validateSourceLines, type SourceTotals } from "@/lib/invoice-source";
import { durableOperation } from "@/lib/idempotency";
import { createHash } from "node:crypto";
import { allocateTicketAdvances } from "@/lib/repair-finance";
import { captureFinancialDocument } from "@/lib/accounting-events";
import {postAutomaticFinancialEvent} from '@/lib/accounting';

export type InvoiceType = "purchase" | "sale" | "repair";

export const INVOICE_TYPE_FA: Record<InvoiceType, string> = {
  purchase: "فاکتور خرید",
  sale: "فاکتور فروش",
  repair: "فاکتور تعمیر",
};

// پیشوندها عمداً از ماژول‌های مبدأ جدا هستند: فروش صندوق SAL- و سفارش خرید PO- است،
// پس فاکتورها این‌جا PINV- (خرید) / SINV- (فروش) / INV- (تعمیر) شماره می‌خورند.
const TYPE_PREFIX: Record<InvoiceType, string> = { purchase: "PINV-", sale: "SINV-", repair: "INV-" };
const TYPE_PERM: Record<InvoiceType, string> = { purchase: "purchasing.manage", sale: "invoices.create", repair: "invoices.create" };
const LINE_KINDS = new Set(["part", "service", "labor", "fee", "other"]);

export function requireInvoiceBranch(session: Session, branchId: number, cookieValue?: string | null) {
  const scope = activeBranch(session, cookieValue);
  if (!scope.all && branchId !== scope.branchId) throw new HttpError(404, "فاکتور یافت نشد.");
}

export type RawLine = {
  kind: string;
  ref_id?: number | null;
  name?: string | null;
  sku?: string | null;
  qty?: number | string;
  unit_price?: number | string;
  discount?: number | string;
  cost?: number | string;
  employee_id?: number | null;
};

export type PaymentInput = {
  amount: number | string;
  method?: string;
  reference?: string | null;
  notes?: string | null;
  cheque?: { due_date: string; bank_name?: string | null; sayad_id?: string | null } | null;
};

function int(v: unknown, label: string, { min = 0, max = 1e15 }: { min?: number; max?: number } = {}): number {
  const n = rial(v ?? 0, label);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${label} نامعتبر است.`);
  return n;
}

function num(v: unknown, label: string, { min = 0, max = 1e6 }: { min?: number; max?: number } = {}): number {
  const n = quantityValue(v ?? 0);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${label} نامعتبر است.`);
  return n;
}

export type SanitizedLine = {
  kind: string;
  ref_id: number | null;
  name: string;
  sku: string | null;
  qty: number;
  unit_price: number;
  discount: number;
  cost: number;
  employee_id: number | null;
};

/**
 * اعتبارسنجی و تثبیت اقلام؛ قیمت مرجع از کاتالوگ:
 *  - خرید: purchase_price (و در نبودش avg_cost)
 *  - فروش/تعمیر: price (قیمت فروش) — هرگز جای هم استفاده نمی‌شوند.
 */
export function sanitizeLines(
  db: DatabaseSync,
  raw: RawLine[],
  type: InvoiceType,
  opts: { allowPriceOverride: boolean; allowInactive?: boolean; allowDuplicateParts?: boolean }
): SanitizedLine[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError(400, "فاکتور باید حداقل یک قلم داشته باشد.");
  if (raw.length > 300) throw new HttpError(400, "تعداد اقلام فاکتور بیش از حد مجاز است (۳۰۰ قلم).");

  const out: SanitizedLine[] = [];
  const seen = new Set<string>();
  for (let idx = 0; idx < raw.length; idx++) {
    const r = raw[idx];
    const kind = String(r?.kind ?? "other");
    if (!LINE_KINDS.has(kind)) throw new HttpError(400, `نوع قلم ردیف ${idx + 1} نامعتبر است.`);
    const qty = num(r?.qty ?? 1, `تعداد ردیف ${idx + 1}`, { min: 0.000001, max: 100000 });
    let name = String(r?.name ?? "").trim().slice(0, 200);
    let sku: string | null = r?.sku ? String(r.sku).slice(0, 60) : null;
    const refId = r?.ref_id == null ? null : validate.id(r.ref_id, `مرجع ردیف ${idx + 1}`);
    let refPrice: number | null = null;
    let refCost: number | null = null;

    if (kind === "part") {
      if (refId != null) {
        const part = db.prepare("SELECT id, name, sku, barcode, price, purchase_price, avg_cost FROM parts WHERE id = ? AND (? OR is_active = 1)").get(refId, opts.allowInactive ? 1 : 0) as any;
        if (!part) throw new HttpError(400, `کالای ردیف ${idx + 1} یافت نشد.`);
        name = name || String(part.name);
        sku = sku ?? (part.sku ?? part.barcode ?? null);
        refPrice = type === "purchase" ? Number(part.purchase_price ?? part.avg_cost ?? 0) : Number(part.price ?? 0);
        refCost = type === "purchase" ? null : Number(part.avg_cost ?? part.purchase_price ?? 0);
        // ارسال دوبارهٔ یک کالا با کد یکسان در دو ردیف — جلوگیری از خطای اسکن
        const key = `part:${refId}`;
        if (seen.has(key) && !opts.allowDuplicateParts) throw new HttpError(400, `کالای «${name}» دو بار در فاکتور آمده است — تعداد را در همان ردیف ویرایش کنید.`);
        seen.add(key);
      } else if (!name) {
        throw new HttpError(400, `کالای ردیف ${idx + 1} انتخاب نشده است.`);
      }
    }
    if (kind === "service" && refId != null) {
      const svc = db.prepare("SELECT id, name, price, cost FROM services WHERE id = ?").get(refId) as any;
      if (!svc) throw new HttpError(400, `خدمت ردیف ${idx + 1} یافت نشد.`);
      name = name || String(svc.name);
      refPrice = Number(svc.price || 0);
      refCost = Number(svc.cost || 0);
    }

    if (!name) throw new HttpError(400, `شرح ردیف ${idx + 1} خالی است.`);
    const unitPrice = int(r?.unit_price ?? refPrice ?? 0, `قیمت ردیف ${idx + 1}`, { min: 0 });
    if (!opts.allowPriceOverride && refPrice != null && unitPrice !== refPrice) {
      throw new HttpError(403, "تغییر قیمت کالا/خدمت نسبت به قیمت مرجع، نیازمند دسترسی «ویرایش فاکتور» است.");
    }
    const lineGross = multiplyRial(unitPrice, qty);
    const discount = Math.min(int(r?.discount ?? 0, `تخفیف ردیف ${idx + 1}`, { min: 0 }), lineGross);
    const cost = r?.cost != null ? int(r.cost, `بهای ردیف ${idx + 1}`) : refCost ?? (type === "purchase" ? unitPrice : 0);
    out.push({ kind, ref_id: refId, name, sku, qty, unit_price: unitPrice, discount, cost, employee_id: r?.employee_id == null ? null : Number(r.employee_id) });
  }
  return out;
}

function linesToFinance(lines: SanitizedLine[]) {
  return lines.map((l) => ({ kind: l.kind as any, ref_id: l.ref_id, name: l.name, qty: l.qty, unit_price: l.unit_price, cost: l.cost }));
}

/** جمع پرداخت‌شده بر اساس جهت سند (خرید = پرداختی، فروش/تعمیر = دریافتی) */
export function paidOf(db: DatabaseSync, invoiceId: number, type: InvoiceType): number {
  return netInvoicePaid(db, invoiceId, type === "purchase" ? "out" : "in");
}

/** به‌روزرسانی وضعیت/پرداخت‌شده — منبع: اسناد پرداخت واقعی */
export function syncInvoiceState(db: DatabaseSync, invoiceId: number) {
  refreshInvoiceFinancialState(db,invoiceId);
}

function nextInvoiceNumber(db: DatabaseSync, type: InvoiceType): string {
  return nextSeq("invoice", TYPE_PREFIX[type]);
}

/** ثبت پرداخت روی فاکتور — داخل تراکنش فراخوانی می‌شود */
export function addPaymentInTx(
  db: DatabaseSync,
  session: Session,
  inv: any,
  input: PaymentInput,
  branchFallback: number
): { id: number; number: string; paid: number; balance: number; status: string } {
  requirePaymentsPerm(session);
  return atomic(db, () => {
  inv = db.prepare("SELECT * FROM invoices WHERE id=?").get(inv.id);
  const scope = activeBranch(session);
  if (!inv || (!scope.all && inv.branch_id !== scope.branchId)) throw new HttpError(404, "فاکتور یافت نشد.");
  const type = (inv.type ?? "repair") as InvoiceType;
  if (inv.status === "draft") throw new HttpError(400, "ابتدا فاکتور را نهایی کنید.");
  if (inv.status === "cancelled") throw new HttpError(400, "این فاکتور لغو شده — امکان ثبت پرداخت ندارد.");
  const amount = int(input.amount, "مبلغ پرداخت", { min: 1 });
  const method = String(input.method ?? "cash");
  if (!["cash", "card", "transfer", "check", "cheque", "other"].includes(method)) throw new HttpError(400, "روش پرداخت نامعتبر است.");
  const paid = paidOf(db, inv.id, type);
  const pending = pendingInvoiceAmount(db, inv.id, type === "purchase" ? "out" : "in");
  const balance = invoiceObligation(db,inv.id).effective_total - paid - pending;
  if (balance <= 0) throw new HttpError(400, pending > 0 ? "چک‌های در جریان، ماندهٔ قابل پرداخت را پوشش می‌دهند؛ ابتدا وضعیت چک‌ها را تعیین کنید." : "این فاکتور قبلاً کامل تسویه شده است.");
  if (amount > balance) {
    throw new HttpError(400, `مبلغ بیشتر از مانده (${balance.toLocaleString("fa-IR")} ریال) است — مازاد را به‌عنوان علی‌الحساب جدا ثبت کنید.`);
  }
  const isCheck = method === "check" || method === "cheque";
  if (isCheck && !input.cheque?.due_date) throw new HttpError(400, "برای پرداخت چکی، تاریخ سرسید چک الزامی است.");
  if (isCheck && (!/^\d{4}-\d{2}-\d{2}$/.test(input.cheque!.due_date) || !parseDate(input.cheque!.due_date))) throw new HttpError(400, "سررسید چک معتبر نیست.");

  const direction = type === "purchase" ? "out" : "in";
  const number = nextSeq("payment", "PMT-");
  const payId = db
    .prepare(
      `INSERT INTO payments(number, customer_id, supplier_id, invoice_id, amount, method, reference, notes, branch_id, user_id, direction, sale_id, ticket_id)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      number,
      type === "purchase" ? 0 : Number(inv.customer_id ?? 0),
      type === "purchase" ? Number(inv.supplier_id ?? 0) || null : null,
      inv.id,
      amount,
      isCheck ? "check" : method,
      input.reference ?? null,
      input.notes ?? null,
      inv.branch_id ?? branchFallback,
      session.user.id,
      direction,
      inv.sale_id ?? null,
      inv.ticket_id ?? null
    ).lastInsertRowid as number;

  if (isCheck) {
    db.prepare(
      `INSERT INTO checks(number, kind, amount, issue_date, due_date, bank_name, sayad_id, customer_id, supplier_id, invoice_id, status, description, user_id, branch_id, payment_id)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      input.reference ?? null,
      direction === "out" ? "issued" : "received",
      amount,
      new Date().toISOString().slice(0, 10),
      input.cheque!.due_date,
      input.cheque?.bank_name ?? null,
      input.cheque?.sayad_id ?? null,
      type === "purchase" ? null : Number(inv.customer_id ?? 0) || null,
      type === "purchase" ? Number(inv.supplier_id ?? 0) || null : null,
      inv.id,
      "in_hand",
      `چک بابت فاکتور ${inv.number}`,
      session.user.id,
      inv.branch_id ?? branchFallback,
      payId
    );
  }

  syncInvoiceState(db, inv.id);
  if (inv.sale_id) syncSalePaid(db, Number(inv.sale_id));
  const fresh = db.prepare("SELECT paid, status FROM invoices WHERE id = ?").get(inv.id) as any;
  audit(session, "create", "payment", payId, null, { invoice: inv.number, amount, method: isCheck ? "check" : method, direction });
  captureFinancialDocument(db,"payment",payId,"receipt",session.user.id,Number(inv.branch_id??branchFallback));
  return { id: payId, number, paid: Number(fresh?.paid ?? 0), balance: invoiceObligation(db,inv.id).effective_total - Number(fresh?.paid ?? 0), status: String(fresh?.status ?? inv.status) };
  });
}

function requirePaymentsPerm(session: Session) {
  if (!canUser(session, "payments.create")) throw new HttpError(403, "ثبت پرداخت نیازمند دسترسی «ثبت پرداخت/دریافت» است.");
}

export type CreateInvoiceInput = {
  type: InvoiceType;
  client_key?: string | null;
  customer_id?: number | null;
  supplier_id?: number | null;
  ticket_id?: number | null;
  sale_id?: number | null;
  purchase_order_id?: number | null;
  employee_id?: number | null;
  branch_id?: number | null;
  date?: string | null;
  due_date?: string | null;
  external_number?: string | null;
  notes?: string | null;
  items?: RawLine[];
  end_discount?: number;
  confirm?: boolean;
  payments?: PaymentInput[];
};

/** ساخت فاکتور (پیش‌نویس یا ثبت نهایی) — ضدتکرار با client_key */
export function createInvoice(
  session: Session,
  input: CreateInvoiceInput,
  cookieValue?: string | null
): { id: number; number: string; duplicate: boolean; status: string; total: number; paid: number } {
  if (!input.client_key) return createInvoiceOnce(session, input, cookieValue);
  if (typeof input.client_key !== "string" || input.client_key.length > 64) throw new HttpError(400, "شناسهٔ ثبت فاکتور معتبر نیست.");
  const type = input.type;
  if (!["sale", "repair", "purchase"].includes(type)) throw new HttpError(400, "نوع فاکتور معتبر نیست.");
  if (!canUser(session, TYPE_PERM[type])) throw new HttpError(403, "مجوز صدور این نوع فاکتور را ندارید.");
  const db = getDb();
  let branchId = input.branch_id ?? recordBranchId(session, cookieValue);
  for (const [table, id] of [["sales", input.sale_id], ["purchase_orders", input.purchase_order_id], ["repair_tickets", input.ticket_id]] as const) {
    if (id == null) continue;
    const source = db.prepare(`SELECT branch_id FROM ${table} WHERE id=?`).get(id) as { branch_id: number } | undefined;
    if (!source) throw new HttpError(404, "سند مبدأ یافت نشد.");
    requireInvoiceBranch(session, source.branch_id, cookieValue);
    branchId = source.branch_id;
  }
  requireInvoiceBranch(session, branchId, cookieValue);
  let executed = false;
  const result = durableOperation(db, { actorId: session.user.id, branchId, operation: "invoice_create",
    key: createHash("sha256").update(input.client_key).digest("hex"), payload: input }, () => {
    executed = true;
    if (db.prepare("SELECT id FROM invoices WHERE client_key=? AND created_by=?").get(input.client_key!, session.user.id)) {
      throw new HttpError(409, "شناسهٔ قدیمی فاکتور فاقد رسید درخواست است؛ سند موجود را بررسی کنید و دوباره صادر نکنید.");
    }
    return createInvoiceOnce(session, input, cookieValue);
  });
  return { ...result, duplicate: result.duplicate || !executed };
}

function createInvoiceOnce(
  session: Session,
  input: CreateInvoiceInput,
  cookieValue?: string | null
): { id: number; number: string; duplicate: boolean; status: string; total: number; paid: number } {
  const type = (String(input.type ?? "") as InvoiceType);
  if (!["purchase", "sale", "repair"].includes(type)) throw new HttpError(400, "نوع فاکتور نامعتبر است.");
  if ((input.sale_id != null && type !== "sale") || (input.purchase_order_id != null && type !== "purchase") || (input.ticket_id != null && type !== "repair")) throw new HttpError(400, "نوع فاکتور با سند مبدأ مطابقت ندارد.");
  if (!canUser(session, TYPE_PERM[type])) {
    throw new HttpError(403, type === "purchase" ? "صدور فاکتور خرید نیازمند دسترسی «ثبت و مدیریت خرید» است." : "صدور فاکتور نیازمند دسترسی «صدور فاکتور» است.");
  }
  const db = getDb();
  return atomic(db, () => {
  const allowPriceOverride = canUser(session, "invoices.edit");

  const clientKey = input.client_key ? String(input.client_key).slice(0, 64) : null;
  if (clientKey) {
    const dup = db.prepare("SELECT id, number, status, total, paid, branch_id FROM invoices WHERE client_key = ? AND created_by = ?").get(clientKey, session.user.id) as any;
    if (dup) {
      requireInvoiceBranch(session, Number(dup.branch_id), cookieValue);
      return { id: Number(dup.id), number: String(dup.number), duplicate: true, status: String(dup.status), total: Number(dup.total), paid: Number(dup.paid) };
    }
  }

  // طرف حساب
  let customerId: number | null = null;
  let supplierId: number | null = null;
  let sale: any = null;
  let po: any = null;

  // اتصال به فروش صندوق: طرف حساب و اقلام از سند فروش؛ انبار قبلاً کسر شده
  if (type === "sale" && input.sale_id != null) {
    sale = db.prepare("SELECT * FROM sales WHERE id = ?").get(Number(input.sale_id)) as any;
    if (!sale) throw new HttpError(400, "فروش صندوق انتخاب‌شده یافت نشد.");
    requireInvoiceBranch(session, Number(sale.branch_id), cookieValue);
    if (sale.status === "cancelled") throw new HttpError(409, "فروش لغوشده قابل تبدیل به فاکتور نیست.");
    if (input.customer_id != null && input.customer_id !== sale.customer_id) throw new HttpError(409, "مشتری فاکتور باید با فروش مبدأ یکسان باشد.");
    const existing = db.prepare("SELECT id, number, status, total, paid FROM invoices WHERE sale_id = ? AND status != 'cancelled'").get(sale.id) as any;
    if (existing) return { id: Number(existing.id), number: String(existing.number), duplicate: true, status: String(existing.status), total: Number(existing.total), paid: Number(existing.paid) };
    if (!sale.customer_id) throw new HttpError(400, "این فروش مشتری ثبت‌شده ندارد — فروش مهمان فاکتور رسمی نمی‌گیرد.");
    customerId = Number(sale.customer_id);
  }

  // اتصال به سفارش خرید دریافت‌شده: انبار از مسیر «رسید کالا» ثبت شده؛ فاکتور سند مالی است
  if (type === "purchase" && input.purchase_order_id != null) {
    po = db.prepare("SELECT * FROM purchase_orders WHERE id = ?").get(Number(input.purchase_order_id)) as any;
    if (!po) throw new HttpError(400, "سفارش خرید انتخاب‌شده یافت نشد.");
    requireInvoiceBranch(session, Number(po.branch_id), cookieValue);
    if (input.supplier_id != null && input.supplier_id !== po.supplier_id) throw new HttpError(409, "تأمین‌کننده باید با سفارش خرید مبدأ یکسان باشد.");
    if (!["received", "partially_received"].includes(String(po.status))) {
      throw new HttpError(400, "برای اتصال، ابتدا کالای سفارش را از انبار دریافت کنید — یا فاکتور خرید آزاد ثبت کنید.");
    }
    const existing = db.prepare("SELECT id, number, status, total, paid FROM invoices WHERE purchase_order_id = ? AND status != 'cancelled'").get(po.id) as any;
    if (existing) return { id: Number(existing.id), number: String(existing.number), duplicate: true, status: String(existing.status), total: Number(existing.total), paid: Number(existing.paid) };
    supplierId = Number(po.supplier_id);
  }

  if (type === "purchase" && supplierId == null) {
    supplierId = Number(input.supplier_id);
    const sup = db.prepare("SELECT id, name FROM suppliers WHERE id = ?").get(supplierId) as any;
    if (!sup) throw new HttpError(400, "تأمین‌کننده انتخاب نشده یا معتبر نیست.");
  } else if (type === "purchase" && supplierId != null) {
    const sup = db.prepare("SELECT id, name FROM suppliers WHERE id = ?").get(supplierId) as any;
    if (!sup) throw new HttpError(400, "تأمین‌کنندهٔ سفارش خرید معتبر نیست.");
  } else if (type !== "purchase" && customerId == null) {
    customerId = Number(input.customer_id);
    const cust = db.prepare("SELECT id FROM customers WHERE id = ?").get(customerId) as any;
    if (!cust) throw new HttpError(400, "مشتری انتخاب نشده یا معتبر نیست.");
  }
  let ticket: any = null;
  if (type === "repair") {
    ticket = db.prepare("SELECT * FROM repair_tickets WHERE id = ?").get(Number(input.ticket_id)) as any;
    if(ticket&&db.prepare("SELECT id FROM repair_statuses WHERE id=? AND name='Cancelled'").get(ticket.status_id))throw new HttpError(409,'پذیرش لغوشده برای صدور فاکتور تازه به بازبینی کنترل‌شده نیاز دارد.');
    if (!ticket) throw new HttpError(400, "پذیرش مرتبط انتخاب نشده است.");
    requireInvoiceBranch(session, Number(ticket.branch_id), cookieValue);
    if (Number(ticket.customer_id) !== customerId) throw new HttpError(400, "مشتری با پذیرش انتخابی هم‌خوانی ندارد.");
    const existing = db.prepare("SELECT id, number, status, total, paid FROM invoices WHERE ticket_id = ? AND status != 'cancelled'").get(ticket.id) as any;
    if (existing) return { id: Number(existing.id), number: String(existing.number), duplicate: true, status: String(existing.status), total: Number(existing.total), paid: Number(existing.paid) };
  }

  // اقلام: برای تعمیر از اقلام پذیرش، برای فروش از اقلام صندوق، برای خرید از اقلام سفارش (اسنپ‌شات)
  let rawItems = input.items;
  let sourceTotals: SourceTotals | null = null;
  if (type === "repair" && (!rawItems || rawItems.length === 0)) {
    const tItems = db.prepare("SELECT * FROM ticket_items WHERE ticket_id = ? ORDER BY id").all(ticket.id) as any[];
    if (tItems.length === 0) throw new HttpError(400, "چیزی برای فاکتور نیست — اول قطعه یا خدمت روی پذیرش ثبت کنید.");
    rawItems = tItems.map((i: any) => ({
      kind: i.kind, ref_id: i.ref_id, name: i.name, qty: i.qty, unit_price: i.unit_price, cost: i.cost, employee_id: i.added_by,
    }));
  }
  if (type === "sale" && sale) {
    const sItems = db.prepare("SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id").all(sale.id) as any[];
    if (sItems.length === 0) throw new HttpError(400, "این فروش قلمی ندارد.");
    const sourceItems: RawLine[] = sItems.map((i: any) => ({
      kind: LINE_KINDS.has(i.kind) ? i.kind : "other",
      ref_id: i.ref_id, name: i.name, qty: i.qty, unit_price: i.unit_price, cost: i.cost,
    }));
    validateSourceLines(rawItems, sourceItems);
    rawItems = sourceItems;
    const gross = sumRial(sourceItems.map(item => multiplyRial(Number(item.unit_price), Number(item.qty))));
    const discount = rial(sale.discount ?? 0);
    const tax = rial(sale.tax ?? 0);
    if (gross !== sale.subtotal || discount > gross || sumRial([gross - discount, tax]) !== sale.total) throw new HttpError(409, "مبلغ فروش با اقلام آن تطبیق ندارد؛ پیش از صدور فاکتور بررسی کنید.");
    sourceTotals = { gross, discount, tax, duty: 0, total: Number(sale.total) };
  }
  if (type === "purchase" && po) {
    const source = purchaseInvoiceSource(db, po);
    validateSourceLines(rawItems, source.items);
    rawItems = source.items;
    sourceTotals = source.totals;
  }
  const lines = sanitizeLines(db, rawItems ?? [], type, { allowPriceOverride: allowPriceOverride || sourceTotals != null, allowInactive: sourceTotals != null, allowDuplicateParts: sourceTotals != null });
  // آینه‌سازی با سند مبدأ: تخفیف سند فروش صندوق به‌طور پیش‌فرض منتقل می‌شود (نیازمند مجوز تخفیف نیست)
  const mirrorDiscount = sourceTotals?.discount ?? 0;
  const endDiscount = input.end_discount == null ? mirrorDiscount : int(input.end_discount, "تخفیف فاکتور", { min: 0 });
  if (sourceTotals && endDiscount !== sourceTotals.discount) throw new HttpError(409, "تخفیف فاکتور باید با سند مبدأ یکسان باشد.");
  if (endDiscount > 0 && !allowPriceOverride && mirrorDiscount !== endDiscount) {
    throw new HttpError(403, "اعمال تخفیف نیازمند دسترسی «ویرایش فاکتور» است.");
  }
  const totals = sourceTotals
    ? { ...sourceTotals, cost: sumRial(lines.map(line => multiplyRial(line.cost, line.qty))) }
    : fullTotals({ items: linesToFinance(lines), lineDiscounts: lines.map((l) => l.discount), endDiscount });

  const employeeId = input.employee_id == null ? null : Number(input.employee_id);
  if (employeeId != null) {
    const emp = db.prepare("SELECT id FROM users WHERE id = ? AND is_active = 1").get(employeeId) as any;
    if (!emp) throw new HttpError(400, "کارمند مسئول انتخاب‌شده معتبر نیست.");
  }
  const sourceBranch = ticket?.branch_id ?? sale?.branch_id ?? po?.branch_id;
  const branch = input.branch_id ?? sourceBranch ?? recordBranchId(session, cookieValue);
  requireInvoiceBranch(session, Number(branch), cookieValue);
  if (!db.prepare("SELECT id FROM branches WHERE id=? AND is_active=1").get(branch)) throw new HttpError(400, "شعبهٔ فعال معتبر انتخاب کنید.");
  if (sourceBranch != null && Number(branch) !== Number(sourceBranch)) throw new HttpError(400, "شعبهٔ فاکتور باید با سند مبدأ یکسان باشد.");
  const today = new Date().toISOString().slice(0, 10);
  const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : today;
  const due = input.due_date && /^\d{4}-\d{2}-\d{2}$/.test(input.due_date) ? input.due_date : (type === "sale" || type === "repair" ? new Date(Date.now() + 14 * 86400000 + 3.5 * 3600000).toISOString().slice(0, 10) : null);

  let invoiceId = 0;
  let number = "";
    // شمارهٔ یکتا حتی زیر ارسال هم‌زمان (UNIQUE + تلاش مجدد)
    let attempt = 0;
    for (;;) {
      number = nextInvoiceNumber(db, type);
      try {
        const res = db
          .prepare(
            `INSERT INTO invoices(number, type, customer_id, supplier_id, ticket_id, sale_id, purchase_order_id, branch_id, status, date, due_date, subtotal, discount, tax, total, paid, notes, external_number, employee_id, client_key, created_by)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
          )
          .run(
            number, type, customerId ?? 0, supplierId, ticket?.id ?? null, sale?.id ?? null, po?.id ?? null, branch, "draft", date, due,
            totals.gross, totals.discount, totals.tax + totals.duty, totals.total, 0,
            input.notes ? String(input.notes).slice(0, 500) : null,
            input.external_number ? String(input.external_number).slice(0, 60) : null,
            employeeId, clientKey, session.user.id
          );
        invoiceId = Number(res.lastInsertRowid);
        break;
      } catch (e: any) {
        if (String(e?.message ?? "").includes("invoices.client_key")) throw new HttpError(409, "شناسهٔ ثبت فاکتور قبلاً استفاده شده است؛ سند موجود را بررسی کنید.");
        if (String(e?.message ?? "").includes("UNIQUE") && ++attempt < 5) continue;
        throw e;
      }
    }

    const insItem = db.prepare(
      "INSERT INTO invoice_items(invoice_id, kind, ref_id, name, sku, qty, unit_price, cost, line_discount, total, employee_id, sort) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"
    );
    lines.forEach((l, sort) => {
      insItem.run(invoiceId, l.kind, l.ref_id, l.name, l.sku, l.qty, l.unit_price, l.cost, l.discount, multiplyRial(l.unit_price, l.qty) - l.discount, l.employee_id, sort);
    });

    audit(session, "create", "invoice", invoiceId, null, { number, type, total: totals.total, items: lines.length });

    if (input.confirm) {
      confirmInTx(db, session, invoiceId, branch, input.payments ?? []);
    }
  const fresh = db.prepare("SELECT status, total, paid FROM invoices WHERE id = ?").get(invoiceId) as any;
  return { id: invoiceId, number, duplicate: false, status: String(fresh?.status ?? "draft"), total: Number(fresh?.total ?? 0), paid: Number(fresh?.paid ?? 0) };
  });
}

/** ثبت نهایی داخل تراکنش: انبار (خرید/فروش آزاد) + پرداخت‌های اولیه + وضعیت */
function confirmInTx(db: DatabaseSync, session: Session, invoiceId: number, branchFallback: number, payments: PaymentInput[]) {
  const cancelled=db.prepare("SELECT t.id FROM invoices i JOIN repair_tickets t ON t.id=i.ticket_id JOIN repair_statuses s ON s.id=t.status_id WHERE i.id=? AND s.name='Cancelled' AND i.status='draft'").get(invoiceId);
  if(cancelled)throw new HttpError(409,'تأیید پیش‌نویسِ پذیرش لغوشده به بازبینی کنترل‌شده نیاز دارد.');
  const inv = db.prepare("SELECT * FROM invoices WHERE id = ?").get(invoiceId) as any;
  if (!inv) throw new HttpError(404, "فاکتور یافت نشد.");
  if (inv.status !== "draft") throw new HttpError(400, "این فاکتور قبلاً ثبت نهایی شده است.");
  const type = (inv.type ?? "repair") as InvoiceType;
  const items = db.prepare("SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort, id").all(invoiceId) as any[];

  // اسناد متصل: انبار از قبل از مسیر فروش صندوق / رسید کالای سفارش خرید ثبت شده — دوباره تکان نمی‌خورد
  const linkedToSource = inv.sale_id != null || inv.purchase_order_id != null;

  if ((type === "purchase" || type === "sale") && !linkedToSource) {
    for (const it of items) {
      if (it.kind !== "part" || it.ref_id == null) continue;
      const part = db.prepare("SELECT name FROM parts WHERE id = ?").get(it.ref_id) as any;
      try {
        moveStock({
          part_id: Number(it.ref_id),
          qty: type === "purchase" ? Number(it.qty) : -Number(it.qty),
          type: type === "purchase" ? "purchase" : "sale",
          ref_type: "invoice",
          ref_id: invoiceId,
          source_line_id:Number(it.id),
          unit_cost: type === "purchase" ? Number(it.unit_price) : Number(it.cost ?? 0),
          user_id: session.user.id,
          branch_id: inv.branch_id ?? branchFallback,
          note: `${type === "purchase" ? "Purchase" : "Sale"} invoice ${inv.number}`,
        });
      } catch (e) {
        if (e instanceof InventoryError) {
          throw new HttpError(400,/Not enough stock/.test(e.message)?`موجودی «${part?.name ?? it.name}» برای ثبت فروش کافی نیست.`:e.message);
        }
        throw e;
      }
    }
  }
  if (type === "purchase" || type === "sale") {
    // حتی برای اسناد متصل، علامت «انبار انجام شده» ثبت می‌شود تا گزارش‌ها یکدست بمانند
    db.prepare("UPDATE invoices SET stock_posted = 1 WHERE id = ?").run(invoiceId);
  }

  // فاکتور متصل به فروش صندوق: اسناد پرداخت همان فروش به فاکتور وصل می‌شوند (بدون سند مالی تکراری)
  if (inv.sale_id != null) {
    db.prepare("UPDATE payments SET invoice_id = ? WHERE sale_id = ? AND (invoice_id IS NULL OR invoice_id = ?)").run(invoiceId, Number(inv.sale_id), invoiceId);
  }

  db.prepare("UPDATE invoices SET status = 'issued', confirmed_at = datetime('now'), confirmed_by = ? WHERE id = ?").run(session.user.id, invoiceId);
  const advanceEvent=type === "repair" && inv.ticket_id?allocateTicketAdvances(db, session, inv):undefined;

  for (const p of payments) {
    const fresh = db.prepare("SELECT * FROM invoices WHERE id = ?").get(invoiceId) as any;
    addPaymentInTx(db, session, fresh, p, branchFallback);
  }
  syncInvoiceState(db, invoiceId);

  captureFinancialDocument(db,"invoice",invoiceId,"confirm",session.user.id,Number(inv.branch_id??branchFallback));
  // Recognition of the invoice must precede liability-to-receivable allocation.
  if(advanceEvent)postAutomaticFinancialEvent(db,advanceEvent);
  if(type==="repair"&&inv.ticket_id){
    const costs=db.prepare("SELECT i.qty,i.cost,m.extended_cost FROM ticket_items i LEFT JOIN inventory_movements m ON m.ref_type='ticket_item' AND m.ref_id=i.id AND m.type='repair_consumption' WHERE i.ticket_id=? AND i.kind='part' AND i.consumed=1").all(inv.ticket_id);
    const amount=sumRial(costs.map(line=>line.extended_cost==null?multiplyRial(Number(line.cost??0),Number(line.qty)):Number(line.extended_cost)));
    captureFinancialDocument(db,"invoice",invoiceId,"repair_cost_recognition",session.user.id,Number(inv.branch_id??branchFallback),amount);
  }
  audit(session, "confirm", "invoice", invoiceId, null, {
    number: inv.number,
    type,
    payments: payments.length,
    source: inv.sale_id != null ? "pos_sale" : inv.purchase_order_id != null ? "purchase_order" : null,
  });
  if (type !== "purchase" && inv.customer_id) {
    addCustomerEvent(Number(inv.customer_id), "invoice", `${INVOICE_TYPE_FA[type]} ${inv.number} ثبت نهایی شد`, null, session.user.id, inv.ticket_id ?? null,Number(inv.branch_id));
  }
}

/** ثبت نهایی فاکتور از بیرون (اکشن صفحه) */
export function confirmInvoice(session: Session, invoiceId: number, payments: PaymentInput[], cookieValue?: string | null): { status: string; already: boolean } {
  const db = getDb();
  return atomic(db, () => {
  const inv = db.prepare("SELECT * FROM invoices WHERE id = ?").get(invoiceId) as any;
  if (!inv) throw new HttpError(404, "فاکتور یافت نشد.");
  requireInvoiceBranch(session, Number(inv.branch_id), cookieValue);
  const type = (inv.type ?? "repair") as InvoiceType;
  if (!canUser(session, TYPE_PERM[type])) throw new HttpError(403, "ثبت نهایی این فاکتور برای شما مجاز نیست.");
  if (inv.status !== "draft") return { status: String(inv.status), already: true };

  const branch = recordBranchId(session, cookieValue);
  confirmInTx(db, session, invoiceId, branch, payments);
  const fresh = db.prepare("SELECT status FROM invoices WHERE id = ?").get(invoiceId) as any;
  return { status: String(fresh?.status ?? "issued"), already: false };
  });
}

/** لغو فاکتور با برگشت کنترل‌شدهٔ انبار (بدون حذف تاریخچه) */
export function cancelInvoice(session: Session, invoiceId: number, reason: string | null, cookieValue?: string | null): { status: string } {
  if (!canUser(session, "invoices.edit")) throw new HttpError(403, "لغو فاکتور نیازمند دسترسی «ویرایش فاکتور» است.");
  const db = getDb();
  return atomic(db, () => {
  const inv = db.prepare("SELECT * FROM invoices WHERE id = ?").get(invoiceId) as any;
  if (!inv) throw new HttpError(404, "فاکتور یافت نشد.");
  requireInvoiceBranch(session, Number(inv.branch_id), cookieValue);
  if (inv.status === "cancelled") return { status: "cancelled" };
  if(db.prepare("SELECT id FROM business_returns WHERE invoice_id=? AND state!='rejected' LIMIT 1").get(invoiceId))throw new HttpError(409,'فاکتور دارای گردش مرجوعی است؛ از اعتبارنامه و اسناد اصلاحی استفاده کنید.');
  const type = (inv.type ?? "repair") as InvoiceType;
  const paid = paidOf(db, invoiceId, type);
  if (paid > 0) throw new HttpError(400, "این فاکتور پرداخت/دریافت دارد — ابتدا از ماژول پرداخت‌ها برگشت وجه ثبت کنید، سپس لغو کنید.");
  if (pendingInvoiceAmount(db, invoiceId, type === "purchase" ? "out" : "in") > 0) throw new HttpError(400, "ابتدا وضعیت چک‌های وصول‌نشدهٔ فاکتور را تعیین کنید.");

  const branch = recordBranchId(session, cookieValue);
  const linkedToSource = inv.sale_id != null || inv.purchase_order_id != null;
    if (type !== "repair" && Number(inv.stock_posted) === 1 && !linkedToSource
      && db.prepare("SELECT id FROM invoice_items WHERE invoice_id=? AND kind='part' AND ref_id IS NOT NULL LIMIT 1").get(invoiceId)) {
      throw new HttpError(409,"لغو این فاکتور نیازمند ثبت و تأیید مرجوعی فیزیکی است؛ برای بررسی مدارک با مسئول مالی تماس بگیرید.");
    }
    // Repair consumption belongs to the repair workflow. Cancelling its
    // financial document must not pretend that physical parts were returned.
    db.prepare("UPDATE invoices SET status = 'cancelled', cancelled_at = datetime('now'), cancel_reason = ? WHERE id = ?").run(
      reason ? String(reason).slice(0, 300) : null,
      invoiceId
    );
    captureFinancialDocument(db,"invoice",invoiceId,"cancel",session.user.id,Number(inv.branch_id??branch),inv.status==="draft"?0:Number(inv.total));
    audit(session, "cancel", "invoice", invoiceId, { status: inv.status }, {
      status: "cancelled",
      reason,
      // اسناد متصل: برگشت انبار در ماژول مبدأ (صندوق/سفارش خرید) انجام می‌شود، نه این‌جا
      stock_reversed: false,
      linked_source: linkedToSource ? (inv.sale_id != null ? "pos_sale" : "purchase_order") : null,
    });
  return { status: "cancelled" };
  });
}

/** جزئیات کامل فاکتور برای API */
export function invoiceDetail(invoiceId: number) {
  const db = getDb();
  const invoice = db
    .prepare(
      `SELECT i.*, c.first_name, c.last_name, c.company, c.mobile, sup.name supplier_name,
              t.number ticket_number, t.delivered_at, e.name employee_name, b.name branch_name,
              sa.number sale_number, po2.number po_number
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id AND i.type != 'purchase'
       LEFT JOIN suppliers sup ON sup.id = i.supplier_id
       LEFT JOIN repair_tickets t ON t.id = i.ticket_id
       LEFT JOIN users e ON e.id = i.employee_id
       LEFT JOIN branches b ON b.id = i.branch_id
       LEFT JOIN sales sa ON sa.id = i.sale_id
       LEFT JOIN purchase_orders po2 ON po2.id = i.purchase_order_id
       WHERE i.id = ?`
    )
    .get(invoiceId) as any;
  if (!invoice) return null;
  const items = db.prepare("SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort, id").all(invoiceId) as any[];
  const payments = db.prepare("SELECT * FROM payments WHERE invoice_id = ? ORDER BY created_at, id").all(invoiceId) as any[];
  const checks = db.prepare("SELECT * FROM checks WHERE invoice_id = ? ORDER BY id").all(invoiceId) as any[];
  return { invoice:{...invoice,...invoiceObligation(db,invoiceId),paid:paidOf(db,invoiceId,invoice.type??'repair')}, items, payments, checks };
}

/** ویرایش پیش‌نویس فاکتور (فقط وضعیت draft) — اقلام و مبالغ بازنویسی می‌شوند ولی تاریخچه audit می‌ماند */
export function updateDraftInvoice(
  session: Session,
  invoiceId: number,
  input: { items?: RawLine[]; end_discount?: number; notes?: string | null; external_number?: string | null; employee_id?: number | null; due_date?: string | null },
  cookieValue?: string | null
): { id: number; number: string; total: number } {
  if (!canUser(session, "invoices.edit") && !canUser(session, "invoices.create")) {
    throw new HttpError(403, "ویرایش پیش‌نویس فاکتور مجاز نیست.");
  }
  const db = getDb();
  return atomic(db, () => {
  const inv = db.prepare("SELECT * FROM invoices WHERE id = ?").get(invoiceId) as any;
  if (!inv) throw new HttpError(404, "فاکتور یافت نشد.");
  requireInvoiceBranch(session, Number(inv.branch_id), cookieValue);
  if (inv.status !== "draft") throw new HttpError(400, "فقط فاکتور پیش‌نویس قابل ویرایش است — برای فاکتور نهایی‌شده از لغو/سند اصلاحی استفاده کنید.");
  const type = (inv.type ?? "repair") as InvoiceType;
  const allowPriceOverride = canUser(session, "invoices.edit");
  const oldItems = db.prepare("SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort, id").all(invoiceId) as any[];
  if (inv.sale_id != null || inv.purchase_order_id != null) {
    validateSourceLines(input.items, oldItems.map(item => ({ ...item, discount: item.line_discount ?? 0 })));
    if (input.end_discount != null && Number(input.end_discount) !== Number(inv.discount)) throw new HttpError(409, "مبلغ فاکتور متصل فقط از مسیر اصلاح سند مبدأ قابل تغییر است.");
    db.prepare("UPDATE invoices SET notes=COALESCE(?,notes),external_number=COALESCE(?,external_number),due_date=COALESCE(?,due_date) WHERE id=?")
      .run(input.notes ?? null, input.external_number ?? null, input.due_date ?? null, invoiceId);
    audit(session, "edit_metadata", "invoice", invoiceId, null, { branch_id: inv.branch_id });
    return { id: invoiceId, number: String(inv.number), total: Number(inv.total) };
  }

  let lines: SanitizedLine[] | null = null;
  if (input.items && input.items.length > 0) {
    lines = sanitizeLines(db, input.items, type, { allowPriceOverride });
  } else if (oldItems.length === 0) {
    throw new HttpError(400, "فاکتور باید حداقل یک قلم داشته باشد.");
  }
  const endDiscount = input.end_discount == null ? Number(inv.discount ?? 0) - oldItems.reduce((s, i) => s + Number(i.line_discount ?? 0), 0) : int(input.end_discount, "تخفیف فاکتور", { min: 0 });
  if (endDiscount > 0 && !allowPriceOverride) throw new HttpError(403, "اعمال تخفیف نیازمند دسترسی «ویرایش فاکتور» است.");

  const effectiveLines: SanitizedLine[] = lines ?? oldItems.map((i: any) => ({
    kind: i.kind, ref_id: i.ref_id, name: i.name, sku: i.sku, qty: Number(i.qty), unit_price: Number(i.unit_price),
    discount: Number(i.line_discount ?? 0), cost: Number(i.cost ?? 0), employee_id: i.employee_id ?? null,
  }));
  const totals = fullTotals({ items: linesToFinance(effectiveLines), lineDiscounts: effectiveLines.map((l) => l.discount), endDiscount });
    if (lines) {
      db.prepare("DELETE FROM invoice_items WHERE invoice_id = ?").run(invoiceId);
      const insItem = db.prepare(
        "INSERT INTO invoice_items(invoice_id, kind, ref_id, name, sku, qty, unit_price, cost, line_discount, total, employee_id, sort) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"
      );
      lines.forEach((l, sort) =>
        insItem.run(invoiceId, l.kind, l.ref_id, l.name, l.sku, l.qty, l.unit_price, l.cost, l.discount, multiplyRial(l.unit_price, l.qty) - l.discount, l.employee_id, sort)
      );
    }
    db.prepare(
      "UPDATE invoices SET subtotal = ?, discount = ?, tax = ?, total = ?, notes = COALESCE(?, notes), external_number = COALESCE(?, external_number), employee_id = COALESCE(?, employee_id), due_date = COALESCE(?, due_date) WHERE id = ?"
    ).run(
      totals.gross, totals.discount, totals.tax + totals.duty, totals.total,
      input.notes == null ? null : String(input.notes).slice(0, 500),
      input.external_number == null ? null : String(input.external_number).slice(0, 60),
      input.employee_id == null ? null : Number(input.employee_id),
      input.due_date ?? null,
      invoiceId
    );
    audit(session, "edit", "invoice", invoiceId, { total: inv.total }, { total: totals.total, items: effectiveLines.length });
  return { id: invoiceId, number: String(inv.number), total: totals.total };
  });
}

export type InvoiceListFilters = {  type?: string | null;
  status?: string | null;
  q?: string | null;
  from?: string | null;
  to?: string | null;
  party_id?: number | null;
  limit?: number;
  branch_id?: number | null;
};

export function listInvoices(filters: InvoiceListFilters) {
  const db = getDb();
  let sql = `SELECT i.*, c.first_name, c.last_name, c.company, sup.name supplier_name, t.number ticket_number,
                    e.name employee_name, sa.number sale_number, po2.number po_number
             FROM effective_invoices i
             LEFT JOIN customers c ON c.id = i.customer_id AND i.type != 'purchase'
             LEFT JOIN suppliers sup ON sup.id = i.supplier_id
             LEFT JOIN repair_tickets t ON t.id = i.ticket_id
             LEFT JOIN users e ON e.id = i.employee_id
             LEFT JOIN sales sa ON sa.id = i.sale_id
             LEFT JOIN purchase_orders po2 ON po2.id = i.purchase_order_id
             WHERE 1=1`;
  const params: any[] = [];
  if (filters.branch_id != null) { sql += " AND i.branch_id=?"; params.push(filters.branch_id); }
  const type = String(filters.type ?? "");
  if (["purchase", "sale", "repair"].includes(type)) {
    sql += " AND COALESCE(i.type,'repair') = ?";
    params.push(type);
  }
  const status = String(filters.status ?? "");
  if (status === "unpaid") {
    sql += " AND i.status IN ('issued','partially_paid','overdue')";
  } else if (status) {
    sql += " AND i.status = ?";
    params.push(status);
  }
  if (filters.from) {
    sql += " AND date(i.date) >= date(?)";
    params.push(filters.from);
  }
  if (filters.to) {
    sql += " AND date(i.date) <= date(?)";
    params.push(filters.to);
  }
  if (filters.party_id != null) {
    sql += " AND (i.customer_id = ? OR i.supplier_id = ?)";
    params.push(filters.party_id, filters.party_id);
  }
  const q = String(filters.q ?? "").trim();
  if (q) {
    const like = `%${q}%`;
    sql += ` AND (i.number LIKE ? OR i.external_number LIKE ? OR (COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')) LIKE ? OR sup.name LIKE ? OR t.number LIKE ?)`;
    params.push(like, like, like, like, like);
  }
  sql += " ORDER BY i.created_at DESC, i.id DESC LIMIT ?";
  const requestedLimit = Number(filters.limit ?? 200);
  params.push(Number.isSafeInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 500)) : 200);
  return db.prepare(sql).all(...params) as any[];
}
