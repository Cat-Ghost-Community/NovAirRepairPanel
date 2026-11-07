"use client";

import { SearchableSelect } from "@/components/searchable-select";


import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast, Modal, EmptyState } from "@/components/ui";
import { fmtMoney, fmtDate, faNum, toFaDigits, todayISO, parseMoneyInput, getCurrencyUnit } from "@/lib/format";
import { postFinancial } from "@/lib/financial-client";

type Check = {
  id: number; number: string; kind: string; amount: number; issue_date: string | null;
  due_date: string; bank_name: string | null; cheque_serial: string | null; sayad_id: string | null;
  payer_payee: string | null; customer_name: string | null; bank_account_name: string | null;
  status: string; description: string | null;
  bank_account_id?: number | null;
};
type Account = { id: number; name: string; bank_name: string | null };

const KIND_FA: Record<string, string> = { received: "دریافتی", issued: "پرداختی" };

export function ChecksClient({ checks, accounts, statusFa }: { checks: Check[]; accounts: Account[]; summary: any[]; statusFa: Record<string, string> }) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<"received" | "issued">("received");
  const [filter, setFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedBanks, setSelectedBanks] = useState<Record<number, string>>({});
  const [form, setForm] = useState({
    number: "", kind: "received", amount: "", due_date: todayISO(), issue_date: todayISO(),
    bank_name: "", cheque_serial: "", sayad_id: "", payer_payee: "", description: "",
  });

  const list = useMemo(() =>
    checks.filter((c) => c.kind === tab && (filter === "all" || c.status === filter)),
    [checks, tab, filter]
  );

  const act = async (id: number, action: string, extra: any = {}) => {
    setBusy(true);
    try {
      const data = await postFinancial<{ ok: boolean; error?: string }>("/api/checks", { id, action, ...extra });
      if (data.ok) {
        toast(action === "pass" ? "چک وصول شد" : action === "bounce" ? "چک برگشت خورد" : "عملیات انجام شد");
        router.refresh();
      } else toast(data.error ?? "عملیات ناموفق بود", "error");
    } catch (error) { toast(error instanceof Error ? error.message : "مشکل شبکه — دوباره تلاش کنید", "error"); }
    setBusy(false);
  };

  const addCheck = async () => {
    if (!form.amount || !form.due_date) { toast("مبلغ و سررسید الزامی است", "error"); return; }
    setBusy(true);
    try {
      const data = await postFinancial<{ id: number; error?: string }>("/api/checks", { ...form, amount: parseMoneyInput(form.amount) });
      if (data.id) { toast("چک ثبت شد"); setAddOpen(false); setForm({ ...form, number: "", amount: "", description: "" }); router.refresh(); }
      else toast(data.error ?? "ثبت ناموفق بود", "error");
    } catch (error) { toast(error instanceof Error ? error.message : "مشکل شبکه — دوباره تلاش کنید", "error"); }
    setBusy(false);
  };

  const STATUSES = ["all", "in_hand", "passed", "bounced", "transferred_spend", "deposited"];

  return (
    <>
      {/* تب‌ها و فیلتر */}
      <div className="flex gap-1.5 flex-wrap items-center mb-3">
        {(["received", "issued"] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${tab === k ? "bg-brand-600 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}>
            چک‌های {KIND_FA[k]}
          </button>
        ))}
        <span className="w-4" />
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            className={`rounded-full px-2.5 py-1 text-xs transition ${filter === s ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400"}`}>
            {s === "all" ? "همه" : statusFa[s] ?? s}
          </button>
        ))}
        <span className="flex-1" />
        <button onClick={() => setAddOpen(true)} className="btn-primary btn-sm">+ ثبت چک</button>
      </div>

      {list.length === 0 ? (
        <div className="card">
          <EmptyState icon="receipt" title="چکی در این دسته نیست" body="با دکمه «ثبت چک» چک دریافتی یا پرداختی جدید اضافه کنید." />
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="th">شماره</th>
                <th className="th">مبلغ</th>
                <th className="th">سررسید</th>
                <th className="th">بانک</th>
                <th className="th hidden md:table-cell">طرف حساب</th>
                <th className="th">وضعیت</th>
                <th className="th">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {list.map((c) => {
                const overdue = c.status === "in_hand" && c.due_date < new Date().toISOString().slice(0, 10);
                return (
                  <tr key={c.id} className="row-hover">
                    <td className="td font-mono">{c.number}</td>
                    <td className="td font-semibold whitespace-nowrap">{fmtMoney(c.amount)}</td>
                    <td className="td whitespace-nowrap">
                      <span className={overdue ? "text-red-600 font-medium" : ""}>{fmtDate(c.due_date)}</span>
                      {overdue && <div className="text-xs text-red-500">سررسید گذشته</div>}
                    </td>
                    <td className="td text-zinc-500">{c.bank_name ?? "—"}</td>
                    <td className="td hidden md:table-cell">{c.customer_name ?? c.payer_payee ?? "—"}</td>
                    <td className="td">
                      <span className={`badge ${c.status === "passed" ? "badge-green" : c.status === "bounced" ? "badge-red" : "badge-blue"}`}>
                        {statusFa[c.status] ?? c.status}
                      </span>
                    </td>
                    <td className="td">
                      {["in_hand", "deposited"].includes(c.status) && (
                        <div className="flex flex-wrap gap-1">
                          {c.status === "in_hand" && (
                            <SearchableSelect className="input !w-auto max-w-40" aria-label={`حساب بانکی چک ${c.number ?? faNum(c.id)}`} value={selectedBanks[c.id] ?? String(c.bank_account_id ?? "")} disabled={busy} onChange={e => setSelectedBanks(previous => ({ ...previous, [c.id]: e.target.value }))}>
                              <option value="">حساب بانکی</option>
                              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                            </SearchableSelect>
                          )}
                          <button disabled={busy || (c.status === "in_hand" && !selectedBanks[c.id] && !c.bank_account_id)} onClick={() => act(c.id, "pass", { bank_account_id: Number(selectedBanks[c.id] || c.bank_account_id) })} className="btn-secondary btn-sm !py-1" title="وصول">وصول</button>
                          <button disabled={busy} onClick={() => act(c.id, "bounce")} className="btn-secondary btn-sm !py-1" title="برگشت">برگشت</button>
                          <button disabled title="تخصیص به بدهی تأمین‌کننده هنوز تأیید نشده است" className="btn-secondary btn-sm !py-1">خرج</button>
                          {accounts.length > 0 && c.status === "in_hand" && c.kind === "received" && (
                            <button disabled={busy || (!selectedBanks[c.id] && !c.bank_account_id)} onClick={() => act(c.id, "deposit_bank", { bank_account_id: Number(selectedBanks[c.id] || c.bank_account_id) })} className="btn-secondary btn-sm !py-1" title="خواباندن به بانک">به بانک</button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* مودال ثبت چک */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="ثبت چک جدید">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label">نوع چک</label>
            <SearchableSelect className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="received">دریافتی (از مشتری)</option>
              <option value="issued">پرداختی (به تأمین‌کننده)</option>
            </SearchableSelect>
          </div>
          <div>
            <label className="label">شماره چک</label>
            <input className="input" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="خودکار اگر خالی بماند" />
          </div>
          <div>
            <label className="label">مبلغ ({getCurrencyUnit() === "toman" ? "تومان" : "ریال"})</label>
            <input className="input num" dir="ltr" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div>
            <label className="label">تاریخ سررسید</label>
            <input type="date" className="input" dir="ltr" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          </div>
          <div>
            <label className="label">بانک</label>
            <input className="input" value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} placeholder="مثلاً بانک ملت" />
          </div>
          <div>
            <label className="label">سریال چک</label>
            <input className="input" dir="ltr" value={form.cheque_serial} onChange={(e) => setForm({ ...form, cheque_serial: e.target.value })} />
          </div>
          <div>
            <label className="label">شناسه صیاد</label>
            <input className="input" dir="ltr" value={form.sayad_id} onChange={(e) => setForm({ ...form, sayad_id: e.target.value })} />
          </div>
          <div>
            <label className="label">{form.kind === "received" ? "پرداخت‌کننده" : "دریافت‌کننده"}</label>
            <input className="input" value={form.payer_payee} onChange={(e) => setForm({ ...form, payer_payee: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">توضیحات</label>
            <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-secondary" onClick={() => setAddOpen(false)}>انصراف</button>
          <button className="btn-primary" disabled={busy} onClick={addCheck}>ثبت چک</button>
        </div>
      </Modal>
    </>
  );
}
