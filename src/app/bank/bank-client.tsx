"use client";

import { SearchableSelect } from "@/components/searchable-select";


import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast, Modal } from "@/components/ui";
import { fmtMoney, fmtDateTime, toFaDigits, todayISO, getCurrencyUnit } from "@/lib/format";
import {bankAmountInput} from '@/lib/bank-input';
import { postFinancial } from "@/lib/financial-client";

type Account = { id: number; name: string; bank_name: string | null; account_number: string | null; card_number: string | null; sheba: string | null; current_balance: number };
type Txn = { id: number; account_name: string | null; type: string; amount: number; description: string | null; date: string | null; created_at: string };

const TYPE_FA: Record<string, string> = {
  deposit: "واریز", withdraw: "برداشت", transfer_in: "انتقال ورودی",
  transfer_out: "انتقال خروجی", pos_settlement: "تسویه کارتخوان",
};

export function BankClient({ accounts, txns,canManage=false }: { accounts: Account[]; txns: Txn[];canManage?:boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [txnOpen, setTxnOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ account_id: "", type: "deposit", amount: "", description: "", date: todayISO() });
  const [tr, setTr] = useState({ from_account: "", to_account: "", amount: "", description: "" });

  const post = async (payload: any, okMsg: string) => {
    setBusy(true);
    try {
      const data = await postFinancial<{ ok?: boolean; id?: number; error?: string }>("/api/bank", payload);
      if (data.ok || data.id) { toast(okMsg); router.refresh(); return true; }
      toast(data.error ?? "عملیات ناموفق بود", "error");
    } catch (error) { toast(error instanceof Error ? error.message : "مشکل شبکه؛ دوباره تلاش کنید.", "error"); }
    setBusy(false);
    return false;
  };

  const parseAmount = (value: string) => {
    try { return bankAmountInput(value,getCurrencyUnit()); }
    catch (error) { toast(error instanceof Error ? error.message : "مبلغ معتبر نیست.", "error"); return null; }
  };

  const addTxn = async () => {
    if (!form.account_id || !form.amount) { toast("حساب و مبلغ الزامی است", "error"); return; }
    const amount = parseAmount(form.amount);
    if (amount == null) return;
    const done = await post({ account_id: Number(form.account_id), type: form.type, amount, description: form.description, date: form.date }, "تراکنش ثبت شد");
    if (done) { setTxnOpen(false); setForm({ ...form, amount: "", description: "" }); setBusy(false); }
  };

  const doTransfer = async () => {
    if (!tr.from_account || !tr.to_account || !tr.amount) { toast("همه فیلدها الزامی است", "error"); return; }
    if (tr.from_account === tr.to_account) { toast("مبدأ و مقصد یکسان است", "error"); return; }
    const amount = parseAmount(tr.amount);
    if (amount == null) return;
    const done = await post({ action: "transfer", from_account: Number(tr.from_account), to_account: Number(tr.to_account), amount, description: tr.description }, "انتقال ثبت شد");
    if (done) { setTransferOpen(false); setTr({ from_account: "", to_account: "", amount: "", description: "" }); setBusy(false); }
  };

  return (
    <>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
        {accounts.map((a) => (
          <div key={a.id} className="card card-pad min-w-0">
            <div className="flex items-center justify-between">
              <div className="text-[13px] font-semibold">{a.name}</div>
              <span className="badge-blue">{a.bank_name ?? "بانک"}</span>
            </div>
            <div className={`mt-2 text-xl font-bold [overflow-wrap:anywhere] ${Math.abs(a.current_balance)>1e12?'!text-[clamp(1rem,4.5vw,1.25rem)]':''}`}>{Number.isSafeInteger(a.current_balance)?fmtMoney(a.current_balance):'نیازمند بررسی مانده'}</div>
            {a.card_number && <div className="text-xs text-zinc-400 mt-1" dir="ltr">{toFaDigits(a.card_number)}</div>}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {canManage&&<><button className="btn-primary btn-sm" onClick={() => setTxnOpen(true)}>+ واریز / برداشت</button>
        <button className="btn-secondary btn-sm" onClick={() => setTransferOpen(true)}>⇄ انتقال بین حساب‌ها</button></>}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="th">حساب</th>
              <th className="th">نوع</th>
              <th className="th">مبلغ</th>
              <th className="th">توضیحات</th>
              <th className="th">تاریخ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {txns.map((t) => (
              <tr key={t.id} className="row-hover">
                <td className="td">{t.account_name ?? "—"}</td>
                <td className="td">
                  <span className={`badge ${t.type === "withdraw" || t.type === "transfer_out" ? "badge-red" : "badge-green"}`}>{TYPE_FA[t.type] ?? t.type}</span>
                </td>
                <td className="td font-medium whitespace-nowrap">{fmtMoney(t.amount)}</td>
                <td className="td text-zinc-500">{t.description ?? "—"}</td>
                <td className="td text-zinc-500 whitespace-nowrap text-[13px]">{fmtDateTime(t.created_at)}</td>
              </tr>
            ))}
            {txns.length === 0 && (
              <tr><td colSpan={5} className="td text-center text-zinc-400 py-8">تراکنشی ثبت نشده</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* مودال واریز/برداشت */}
      <Modal open={txnOpen} onClose={() => setTxnOpen(false)} title="ثبت واریز / برداشت">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="bank-form-account">حساب</label>
            <SearchableSelect id="bank-form-account" className="input" value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
              <option value="">انتخاب کنید…</option>
              {accounts.map((a) => <option key={a.id} value={a.id} disabled={!Number.isSafeInteger(a.current_balance)}>{a.name}</option>)}
            </SearchableSelect>
          </div>
          <div>
            <label className="label" htmlFor="bank-form-type">نوع</label>
            <SearchableSelect id="bank-form-type" className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="deposit">واریز</option>
              <option value="withdraw">برداشت</option>
              <option value="pos_settlement">تسویه کارتخوان</option>
            </SearchableSelect>
          </div>
          <div>
            <label className="label" htmlFor="bank-form-amount">مبلغ ({getCurrencyUnit() === "toman" ? "تومان" : "ریال"})</label>
            <input id="bank-form-amount" className="input num" inputMode="decimal" dir="ltr" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="bank-form-date">تاریخ</label>
            <input id="bank-form-date" type="date" className="input" dir="ltr" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="bank-form-description">توضیحات</label>
            <input id="bank-form-description" className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-secondary" onClick={() => setTxnOpen(false)}>انصراف</button>
          <button className="btn-primary" disabled={busy} onClick={addTxn}>ثبت</button>
        </div>
      </Modal>

      {/* مودال انتقال */}
      <Modal open={transferOpen} onClose={() => setTransferOpen(false)} title="انتقال بین حساب‌ها">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="bank-transfer-from">از حساب</label>
            <SearchableSelect id="bank-transfer-from" className="input" value={tr.from_account} onChange={(e) => setTr({ ...tr, from_account: e.target.value })}>
              <option value="">انتخاب کنید…</option>
              {accounts.map((a) => <option key={a.id} value={a.id} disabled={!Number.isSafeInteger(a.current_balance)}>{a.name} — {Number.isSafeInteger(a.current_balance)?fmtMoney(a.current_balance):'نیازمند بررسی مانده'}</option>)}
            </SearchableSelect>
          </div>
          <div>
            <label className="label" htmlFor="bank-transfer-to">به حساب</label>
            <SearchableSelect id="bank-transfer-to" className="input" value={tr.to_account} onChange={(e) => setTr({ ...tr, to_account: e.target.value })}>
              <option value="">انتخاب کنید…</option>
              {accounts.map((a) => <option key={a.id} value={a.id} disabled={!Number.isSafeInteger(a.current_balance)}>{a.name}</option>)}
            </SearchableSelect>
          </div>
          <div>
            <label className="label" htmlFor="bank-transfer-amount">مبلغ ({getCurrencyUnit() === "toman" ? "تومان" : "ریال"})</label>
            <input id="bank-transfer-amount" className="input num" inputMode="decimal" dir="ltr" value={tr.amount} onChange={(e) => setTr({ ...tr, amount: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="bank-transfer-description">توضیحات</label>
            <input id="bank-transfer-description" className="input" value={tr.description} onChange={(e) => setTr({ ...tr, description: e.target.value })} />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-secondary" onClick={() => setTransferOpen(false)}>انصراف</button>
          <button className="btn-primary" disabled={busy} onClick={doTransfer}>ثبت انتقال</button>
        </div>
      </Modal>
    </>
  );
}
