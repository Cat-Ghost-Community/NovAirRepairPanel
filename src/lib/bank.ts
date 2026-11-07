import type { DatabaseSync } from "node:sqlite";
import type { Session } from "@/lib/auth";
import { audit, HttpError, requirePerm } from "@/lib/api";
import { canSwitchBranch } from "@/lib/branch";
import { atomic } from "@/lib/db/transaction";
import {normalizeBankInput,bankBalanceAfter,type BankInput} from '@/lib/bank-input';
export type {BankInput} from '@/lib/bank-input';
import { captureFinancialDocument } from "@/lib/accounting-events";

/** Bank accounts have no operating-branch ownership in the current schema.
 * Global balances therefore require existing cross-branch authority. Scoped
 * cheque collection remains available through its branch-owned instrument. */
export function requireCentralBankAccess(session: Session) {
  if (!canSwitchBranch(session.user.role)) throw new HttpError(403, "دسترسی به حساب‌های بانکی مرکزی نیازمند دسترسی بین‌شعبه‌ای است.");
}

export function mutateBank(db: DatabaseSync, session: Session, body: BankInput) {
  requirePerm(session, "finance.manage");
  requireCentralBankAccess(session);
  return atomic(db, () => {
    const input=normalizeBankInput(body),{amount,date,description}=input;
    const account = (id: number | undefined) => {
      const row = db.prepare("SELECT id,current_balance FROM bank_accounts WHERE id=? AND is_active=1").get(id ?? null) as { id: number; current_balance: number } | undefined;
      if (!row) throw new HttpError(404, "حساب بانکی فعال یافت نشد.");
      return row;
    };
    const change = (row: { id: number; current_balance: number }, delta: number) => {
      const after=bankBalanceAfter(row.current_balance,delta);
      db.prepare("UPDATE bank_accounts SET current_balance=? WHERE id=?").run(after, row.id);
    };
    if (input.kind === "transfer") {
      const source = account(body.from_account);
      const target = account(body.to_account);
      if (source.id === target.id) throw new HttpError(400, "حساب مبدأ و مقصد باید متفاوت باشند.");
      change(source, -amount);
      change(target, amount);
      const insert = db.prepare("INSERT INTO bank_transactions(account_id,type,amount,to_account_id,description,date,user_id) VALUES(?,?,?,?,?,?,?)");
      const id = Number(insert.run(source.id, "transfer_out", amount, target.id, description, date, session.user.id).lastInsertRowid);
      const incoming=insert.run(target.id, "transfer_in", amount, source.id, description, date, session.user.id);
      captureFinancialDocument(db,"bank",id,"transfer_out",session.user.id,session.user.branch_id??undefined);
      captureFinancialDocument(db,"bank",Number(incoming.lastInsertRowid),"transfer_in",session.user.id,session.user.branch_id??undefined);
      audit(session, "bank_transfer", "bank_transaction", id, null, { from_account: source.id, to_account: target.id, amount });
      return { ok: true, id };
    }
    const target = account(body.account_id);
    change(target, body.type === "withdraw" ? -amount : amount);
    const id = Number(db.prepare("INSERT INTO bank_transactions(account_id,type,amount,ref,description,date,user_id) VALUES(?,?,?,?,?,?,?)")
      .run(target.id, body.type!, amount, body.ref ?? null, description, date, session.user.id).lastInsertRowid);
    captureFinancialDocument(db,"bank",id,"movement",session.user.id,session.user.branch_id??undefined);
    audit(session, "bank_txn", "bank_transaction", id, null, { account_id: target.id, type: body.type, amount });
    return { ok: true, id };
  });
}
