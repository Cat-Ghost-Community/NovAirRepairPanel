import type { DatabaseSync } from "node:sqlite";
import type { Session } from "@/lib/auth";
import { audit, HttpError, requirePerm, validate } from "@/lib/api";
import { atomic } from "@/lib/db/transaction";
import { syncInvoiceState } from "@/lib/invoice";
import { validChequeDate } from "@/lib/customer-payments";
import { syncSalePaid } from "@/lib/payment-state";
import { nextSeq } from "@/lib/db/schema";
import { captureFinancialDocument } from "@/lib/accounting-events";

export type CheckInput = {
  id?: number; action?: string; amount?: unknown; kind?: string; number?: string;
  due_date?: string; issue_date?: string; bank_name?: string; cheque_serial?: string;
  sayad_id?: string; payer_payee?: string; customer_id?: number; supplier_id?: number;
  invoice_id?: number; status?: string; bank_account_id?: number; description?: string; spent_to?: string;
};
type CheckRow = { id: number; kind: string; amount: number; status: string; bank_account_id: number | null;
  payment_id: number | null; invoice_id: number | null; number: string; branch_id: number };

function account(db: DatabaseSync, id: number | null | undefined) {
  const found = id && db.prepare("SELECT id,current_balance FROM bank_accounts WHERE id=? AND is_active=1").get(id) as { id: number; current_balance: number } | undefined;
  if (!found) throw new HttpError(400, "حساب بانکی فعال را انتخاب کنید.");
  return found;
}

/** Terminal settlement is a single atomic event, protected even when retried
 * with a new request key. Reversing a settled cheque requires an explicit bank
 * correction workflow; a status edit must never erase its history. */
export function mutateCheck(db: DatabaseSync, session: Session, input: CheckInput, branchId: number) {
  requirePerm(session, "finance.manage");
  return atomic(db, () => {
    if (input.id || input.action) {
      const check = db.prepare("SELECT * FROM checks WHERE id=? AND branch_id=?").get(input.id ?? null, branchId) as CheckRow | undefined;
      if (!check) throw new HttpError(404, "چک یافت نشد.");
      const action = input.action;
      if (!["pass", "bounce", "spend", "deposit_bank"].includes(action ?? "")) throw new HttpError(400, "عملیات چک معتبر نیست.");
      const target = action === "pass" ? "passed" : action === "bounce" ? "bounced" : action === "spend" ? "transferred_spend" : "deposited";
      if (check.status === target) return { ok: true, id: check.id, already: true };
      const allowed = action === "pass" || action === "bounce" ? ["in_hand", "deposited"] : ["in_hand"];
      if (!allowed.includes(check.status)) throw new HttpError(409, "وضعیت فعلی چک اجازهٔ این عملیات را نمی‌دهد؛ اصلاح سند مالی لازم است.");
      if (action === "pass") {
        const bank = account(db, check.bank_account_id ?? input.bank_account_id);
        const amount = validate.amount(check.amount);
        if (amount <= 0) throw new HttpError(400, "مبلغ چک معتبر نیست.");
        const change = check.kind === "issued" ? -amount : amount;
        if (!Number.isSafeInteger(bank.current_balance + change)) throw new HttpError(400, "ماندهٔ حساب خارج از محدودهٔ مجاز است.");
        db.prepare("UPDATE bank_accounts SET current_balance=current_balance+? WHERE id=?").run(change, bank.id);
        db.prepare(`INSERT INTO bank_transactions(account_id,type,amount,description,date,user_id,check_id)
          VALUES(?,?,?,?,datetime('now'),?,?)`).run(bank.id, check.kind === "issued" ? "withdraw" : "deposit", amount,
          `وصول چک شماره ${check.number ?? check.id}`, session.user.id, check.id);
        db.prepare("UPDATE checks SET status='passed',bank_account_id=?,settled_at=datetime('now') WHERE id=?").run(bank.id, check.id);
      } else if (action === "deposit_bank") {
        if (check.kind !== "received") throw new HttpError(400, "فقط چک دریافتی به بانک سپرده می‌شود.");
        const bank = account(db, input.bank_account_id);
        db.prepare("UPDATE checks SET status='deposited',bank_account_id=? WHERE id=?").run(bank.id, check.id);
      } else if (action === "spend") {
        // No counterparty allocation exists. Do not claim a supplier payment
        // or receivable settlement from a free-text recipient.
        throw new HttpError(409, "خرج چک نیازمند تخصیص به بدهی تأمین‌کننده است؛ این گردش هنوز تأیید نشده است.");
      } else db.prepare("UPDATE checks SET status='bounced' WHERE id=?").run(check.id);
      if (check.invoice_id) syncInvoiceState(db, check.invoice_id);
      if (check.payment_id) {
        const payment = db.prepare("SELECT sale_id FROM payments WHERE id=?").get(check.payment_id) as { sale_id: number | null };
        if (payment.sale_id) syncSalePaid(db, payment.sale_id);
      }
      captureFinancialDocument(db,"cheque",check.id,String(action),session.user.id,branchId);
      audit(session, `check_${action}`, "check", check.id, { status: check.status }, { status: target, branch_id: branchId });
      return { ok: true, id: check.id, already: false };
    }
    const amount = validate.amount(input.amount);
    if (amount <= 0) throw new HttpError(400, "مبلغ چک باید بیشتر از صفر باشد.");
    const due = validChequeDate(input.due_date);
    const kind = input.kind ?? "received";
    if (!["received", "issued"].includes(kind) || (input.status && input.status !== "in_hand")) throw new HttpError(400, "نوع یا وضعیت آغازین چک معتبر نیست.");
    // Allocations must originate from payment APIs so one cheque cannot settle
    // an invoice without its authoritative payment document.
    if (input.invoice_id) throw new HttpError(400, "چک فاکتور را از بخش ثبت پرداخت همان فاکتور ایجاد کنید.");
    if (input.issue_date) validChequeDate(input.issue_date);
    if (input.customer_id && !db.prepare("SELECT id FROM customers WHERE id=?").get(input.customer_id)) throw new HttpError(400, "مشتری یافت نشد.");
    if (input.supplier_id && !db.prepare("SELECT id FROM suppliers WHERE id=?").get(input.supplier_id)) throw new HttpError(400, "تأمین‌کننده یافت نشد.");
    if (input.bank_account_id) account(db, input.bank_account_id);
    const id = Number(db.prepare(`INSERT INTO checks(number,kind,amount,issue_date,due_date,bank_name,cheque_serial,sayad_id,payer_payee,customer_id,supplier_id,status,bank_account_id,description,user_id,branch_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,'in_hand',?,?,?,?)`).run(input.number || nextSeq("check", "CH-"), kind, amount, input.issue_date ?? null,
      due, input.bank_name ?? null, input.cheque_serial ?? null, input.sayad_id ?? null, input.payer_payee ?? null, input.customer_id ?? null,
      input.supplier_id ?? null, input.bank_account_id ?? null, input.description ?? null, session.user.id, branchId).lastInsertRowid);
    audit(session, "check_create", "check", id, null, { amount, kind, branch_id: branchId });
    return { ok: true, id, already: false };
  });
}
