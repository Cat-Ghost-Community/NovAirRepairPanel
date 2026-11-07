import type { DatabaseSync } from "node:sqlite";
import type { Session } from "@/lib/auth";
import { audit, HttpError, requirePerm, validate } from "@/lib/api";
import { addPaymentInTx, syncInvoiceState } from "@/lib/invoice";
import { addCustomerEvent } from "@/lib/repair";
import { nextSeq } from "@/lib/db/schema";
import { atomic } from "@/lib/db/transaction";
import { SETTLED_PAYMENT, syncSalePaid,netInvoicePaid } from "@/lib/payment-state";
import { invoiceObligation } from '@/lib/invoice-obligation';
import { fmtMoney, parseDate } from "@/lib/format";
import { captureFinancialDocument } from "@/lib/accounting-events";
import { returnRefundCapacity } from '@/lib/return-state';

export type ReceiptInput = {
  customer_id?: number | null; invoice_id?: number | null; ticket_id?: number | null; sale_id?: number | null;
  amount: unknown; method?: string; reference?: string | null; notes?: string | null;
  cheque?: { due_date: string; bank_name?: string | null; sayad_id?: string | null } | null;
};
const METHODS = ["cash", "card", "pos", "transfer", "bank", "check", "cheque", "other"];

export function validChequeDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !parseDate(value)) {
    throw new HttpError(400, "سررسید چک معتبر نیست.");
  }
  return value;
}

/** Caller scopes linked documents first; every source reference must agree. */
export function createCustomerReceipt(db: DatabaseSync, session: Session, input: ReceiptInput, branchId: number): { id: number; number: string; paid?: number; balance?: number; status?: string } {
  requirePerm(session, "payments.create");
  return atomic(db, () => {
    const amount = validate.amount(input.amount);
    if (amount <= 0) throw new HttpError(400, "مبلغ باید بیشتر از صفر باشد.");
    const method = input.method ?? "cash";
    if (!METHODS.includes(method)) throw new HttpError(400, "روش پرداخت معتبر نیست؛ پرداخت آنلاین نیازمند تأیید درگاه است.");
    const check = method === "check" || method === "cheque";
    if (check) validChequeDate(input.cheque?.due_date);
    let customerId = input.customer_id;
    if (!input.invoice_id && input.ticket_id) {
      const linked = db.prepare("SELECT id FROM invoices WHERE ticket_id=? AND branch_id=? AND status!='cancelled' ORDER BY id DESC LIMIT 1").get(input.ticket_id, branchId);
      if (linked) return createCustomerReceipt(db, session, { ...input, invoice_id: Number(linked.id) }, branchId);
    }
    if (input.invoice_id) {
      const inv = db.prepare("SELECT * FROM invoices WHERE id=? AND branch_id=?").get(input.invoice_id, branchId) as Record<string, number | string> | undefined;
      if (!inv) throw new HttpError(404, "فاکتور یافت نشد.");
      if (inv.type === "purchase") throw new HttpError(400, "پرداخت خرید را از صفحه همان فاکتور ثبت کنید.");
      for (const key of ["customer_id", "ticket_id", "sale_id"] as const) {
        if (input[key] != null && input[key] !== inv[key]) throw new HttpError(400, "مراجع پرداخت با فاکتور مطابقت ندارند.");
      }
      return addPaymentInTx(db, session, inv, { ...input, amount, method: method === "pos" ? "card" : method === "bank" ? "transfer" : method }, branchId);
    }
    for (const [table, id, message] of [["repair_tickets", input.ticket_id, "پذیرش"], ["sales", input.sale_id, "فروش"]] as const) {
      if (!id) continue;
      const source = db.prepare(`SELECT customer_id FROM ${table} WHERE id=? AND branch_id=?`).get(id, branchId) as { customer_id: number } | undefined;
      if (!source) throw new HttpError(404, `${message} یافت نشد.`);
      if (customerId != null && customerId !== source.customer_id) throw new HttpError(400, "مشتری پرداخت با سند مبدأ مطابقت ندارد.");
      customerId = source.customer_id;
    }
    if (input.sale_id && input.ticket_id) throw new HttpError(400, "پرداخت نمی‌تواند هم‌زمان به فروش و پذیرش مستقل متصل باشد.");
    if (!customerId || !db.prepare("SELECT id FROM customers WHERE id=?").get(customerId)) throw new HttpError(400, "مشتری معتبر انتخاب کنید.");
    if (input.sale_id) {
      // Once linked, invoice owns allocation and prevents two competing limits.
      if (db.prepare("SELECT id FROM invoices WHERE sale_id=? AND status!='cancelled'").get(input.sale_id)) throw new HttpError(400, "پرداخت را روی فاکتور متصل به فروش ثبت کنید.");
      const sale = db.prepare("SELECT total,paid,status FROM sales WHERE id=?").get(input.sale_id) as { total: number; paid: number; status: string };
      if (sale.status === "cancelled" || amount > sale.total - sale.paid) throw new HttpError(400, "مبلغ یا وضعیت فروش اجازهٔ این پرداخت را نمی‌دهد.");
      // POS cheque allocation needs a separate instrument-reservation workflow.
      if (check) throw new HttpError(400, "برای پرداخت چکی فروش، ابتدا فاکتور رسمی صادر کنید.");
    }
    const number = nextSeq("payment", "PMT-");
    const id = Number(db.prepare(`INSERT INTO payments(number,customer_id,ticket_id,sale_id,amount,method,reference,notes,branch_id,user_id,direction)
      VALUES(?,?,?,?,?,?,?,?,?,?,'in')`).run(number, customerId, input.ticket_id ?? null, input.sale_id ?? null, amount, check ? "check" : method,
      input.reference ?? null, input.notes ?? null, branchId, session.user.id).lastInsertRowid);
    if (check) db.prepare(`INSERT INTO checks(number,kind,amount,issue_date,due_date,bank_name,sayad_id,customer_id,status,description,user_id,branch_id,payment_id)
      VALUES(?,'received',?,date('now'),?,?,?,?,'in_hand',?,?,?,?)`).run(input.reference ?? null, amount, input.cheque!.due_date,
      input.cheque?.bank_name ?? null, input.cheque?.sayad_id ?? null, customerId, `چک بابت سند ${number}`, session.user.id, branchId, id);
    if (input.sale_id) syncSalePaid(db, input.sale_id);
    audit(session, "create", "payment", id, null, { number, amount, method, branch_id: branchId });
    addCustomerEvent(customerId, "payment", `سند دریافت ${number} ثبت شد`, fmtMoney(amount, "rial"), session.user.id, input.ticket_id ?? null,branchId);
    captureFinancialDocument(db,"payment",id,"receipt",session.user.id,branchId);
    return { id, number };
  });
}

export function refundReceipt(db: DatabaseSync, session: Session, input: { payment_id: number; amount?: unknown; reason?: string | null; method?: string;return_id?:number;document_reference?:string;confirmed?:boolean }, branchId: number,origin?:'customer-credit') {
  requirePerm(session, "payments.refund");
  return atomic(db, () => {
    const payment = db.prepare(`SELECT p.*, ${SETTLED_PAYMENT} settled FROM payments p WHERE p.id=? AND p.branch_id=?`)
      .get(input.payment_id, branchId) as { id: number; amount: number; method: string; settled: number; invoice_id: number | null; sale_id: number | null; customer_id: number;supplier_id:number|null;direction:string } | undefined;
    if (!payment) throw new HttpError(404, "سند پرداخت اصلی یافت نشد.");
    if(db.prepare('SELECT group_id FROM repair_group_receipts WHERE payment_id=?').get(payment.id)){
      requirePerm(session,'finance.manage');
      if(origin!=='customer-credit')throw new HttpError(409,'استرداد پیش‌دریافت گروه باید از گردش اعتبار مشتری و کنترل دفترکل انجام شود.');
    }
    if (!payment.settled) throw new HttpError(400, "چک وصول‌نشده قابل استرداد نقدی نیست؛ ابتدا وضعیت چک را تعیین کنید.");
    const refunded = db.prepare("SELECT COALESCE(SUM(amount),0) amount FROM refunds WHERE payment_id=?").get(payment.id) as { amount: number };
    const remaining = payment.amount - refunded.amount;
    const amount = validate.amount(input.amount ?? remaining);
    const allocated=Number(db.prepare('SELECT allocated FROM installment_receipt_funds WHERE id=?').get(payment.id)?.allocated??0);
    const creditUsed=Number(db.prepare('SELECT credit_used FROM installment_receipt_funds WHERE id=?').get(payment.id)?.credit_used??0);
    if(allocated+creditUsed>0&&amount>remaining-allocated-creditUsed)throw new HttpError(409,'وجه به قسط یا فاکتور دیگری تخصیص یافته است؛ ابتدا برگشت مستند تخصیص را ثبت کنید.');
    if(payment.invoice_id&&db.prepare("SELECT id FROM installment_schedules WHERE invoice_id=? AND status='active'").get(payment.invoice_id)){
      const scheduled=Number(db.prepare('SELECT COALESCE(SUM(amount-paid_amount),0) n FROM effective_installments WHERE invoice_id=? AND legacy_review=0').get(payment.invoice_id)!.n);
      const afterDue=Math.max(0,invoiceObligation(db,payment.invoice_id).effective_total-(netInvoicePaid(db,payment.invoice_id,'in')-amount));
      if(afterDue>scheduled)throw new HttpError(409,'این استرداد بدهی خارج از برنامهٔ پذیرفته‌شده ایجاد می‌کند؛ باززمان‌بندی مصوب لازم است.');
    }
    if (amount <= 0 || amount > remaining) throw new HttpError(400, "مبلغ بازگشت از ماندهٔ قابل بازگشت این سند بیشتر است یا معتبر نیست.");
    if(input.return_id!=null){
      if(input.confirmed!==true)throw new HttpError(400,'انجام وجه مرجوعی و مرجع واقعی آن باید صریح تأیید شود.');
      const capacity=returnRefundCapacity(db,validate.id(input.return_id));
      if(capacity.note.customer_id!=null?(payment.direction!=='in'||payment.customer_id!==capacity.note.customer_id):(payment.direction!=='out'||payment.supplier_id!==capacity.note.supplier_id))throw new HttpError(409,'جهت وجه یا طرف حساب با اعتبارنامهٔ اصلی تطبیق ندارد.');
      if(capacity.note.branch_id!==branchId||capacity.note.invoice_id!==payment.invoice_id||amount>capacity.remaining)throw new HttpError(409,'اعتبار مرجوعی با سند پرداخت یا مبلغ استرداد سازگار نیست.');
      if(typeof input.document_reference!=='string'||input.document_reference.trim().length<5||input.document_reference.length>1000)throw new HttpError(400,'مرجع سند استرداد را وارد کنید.');
      if(db.prepare('SELECT id FROM return_settlements WHERE return_id=? AND document_reference=?').get(input.return_id,input.document_reference.trim()))throw new HttpError(409,'این مرجع وجه برای مرجوعی قبلاً ثبت شده است.');}
    const method = input.method ?? (["check", "cheque"].includes(payment.method) ? "transfer" : payment.method);
    if (!["cash", "card", "pos", "transfer", "bank", "other"].includes(method)) throw new HttpError(400, "روش استرداد معتبر نیست؛ تأیید برخط درگاه در دسترس نیست.");
    const number = nextSeq("refund", "REF-");
    const id = Number(db.prepare(`INSERT INTO refunds(number,payment_id,invoice_id,sale_id,customer_id,amount,reason,method,user_id,branch_id)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(number, payment.id, payment.invoice_id, payment.sale_id, payment.customer_id, amount,
      input.reason ?? null, method, session.user.id, branchId).lastInsertRowid);
    if(input.return_id!=null){db.prepare('UPDATE refunds SET return_id=? WHERE id=?').run(input.return_id,id);
      db.prepare('INSERT INTO return_settlements(return_id,refund_id,amount,recorded_by,document_reference) VALUES(?,?,?,?,?)').run(input.return_id,id,amount,session.user.id,input.document_reference!.trim());}
    if (payment.invoice_id) syncInvoiceState(db, payment.invoice_id);
    if (payment.sale_id) syncSalePaid(db, payment.sale_id);
    audit(session, "refund", "payment", payment.id, null, { refund_id: id, number, amount, reason: input.reason, branch_id: branchId });
    if (payment.customer_id) addCustomerEvent(payment.customer_id, "refund", `استرداد ${number} ثبت شد`, fmtMoney(amount, "rial"), session.user.id,null,branchId);
    captureFinancialDocument(db,"refund",id,"refund",session.user.id,branchId);
    return { id, number, amount };
  });
}
