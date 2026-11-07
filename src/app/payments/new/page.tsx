"use client";

import { SearchableSelect } from "@/components/searchable-select";


import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/components/ui";
import { fmtMoney, parseMoneyInput, moneyDisplayValue, getCurrencyUnit } from "@/lib/format";
import { postFinancial } from "@/lib/financial-client";

export default function NewPaymentPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const toast = useToast();
  const [unpaid, setUnpaid] = useState<any[]>([]);
  const [invoiceId, setInvoiceId] = useState(sp.get("invoice_id") ?? "");
  const [customerId, setCustomerId] = useState(sp.get("customer_id") ?? "");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  // فیلدهای چک
  const [chequeDue, setChequeDue] = useState("");
  const [chequeBank, setChequeBank] = useState("");
  const [chequeSayad, setChequeSayad] = useState("");

  useEffect(() => {
    fetch("/api/invoices?status=unpaid").then((r) => r.json()).then((d) => setUnpaid(d.invoices ?? []));
  }, []);

  const selected = unpaid.find((i) => String(i.id) === invoiceId);

  useEffect(() => {
    if (selected && !amount) setAmount(moneyDisplayValue(selected.total - selected.paid));
  }, [selected]);

  const submit = async () => {
    setBusy(true);
    try {
      const data = await postFinancial<{ number: string }>("/api/payments", {
          invoice_id: invoiceId ? Number(invoiceId) : null,
          customer_id: selected ? selected.customer_id : customerId ? Number(customerId) : null,
          amount: parseMoneyInput(amount),
          method,
          reference,
          cheque: method === "check" ? { due_date: chequeDue || null, bank_name: chequeBank || null, sayad_id: chequeSayad || null } : undefined,
      });
      toast(`سند ${data.number} ثبت شد`);
      router.push(invoiceId ? `/invoices/${invoiceId}` : "/payments");
    } catch (e: any) {
      toast(e.message, "error");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl p-4 sm:p-6">
      <h1 className="text-xl font-bold tracking-tight">ثبت پرداخت</h1>
      <div className="card card-pad mt-4 space-y-3">
        <div>
          <label className="label" htmlFor="inv">بابت فاکتور (اختیاری)</label>
          <SearchableSelect id="inv" className="input" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
            <option value="">— تخصیص‌نیافته / پیش‌پرداخت —</option>
            {unpaid.map((i) => (
              <option key={i.id} value={i.id}>
                {i.number} · {i.first_name} {i.last_name} · مانده {fmtMoney(i.total - i.paid)}
              </option>
            ))}
          </SearchableSelect>
        </div>
        {selected && (
          <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/60 px-3 py-2 text-sm flex justify-between">
            <span className="text-zinc-500">مانده فاکتور {selected.number}</span>
            <span className="font-semibold">{fmtMoney(selected.total - selected.paid)}</span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="amt">مبلغ ({getCurrencyUnit() === "toman" ? "تومان" : "ریال"}) *</label>
            <input id="amt" type="number" step="0.01" min="0.01" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="mth">روش پرداخت</label>
            <SearchableSelect id="mth" className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="cash">نقدی</option><option value="card">کارتخوان</option>
              <option value="transfer">حواله بانکی</option><option value="check">چک</option><option value="other">سایر</option>
            </SearchableSelect>
          </div>
          <div className="col-span-2">
            <label className="label" htmlFor="ref">مرجع (شماره چک، شماره تراکنش…)</label>
            <input id="ref" className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          {method === "check" && (
            <>
              <div>
                <label className="label" htmlFor="ch-due">سررسید چک *</label>
                <input id="ch-due" type="date" dir="ltr" className="input" value={chequeDue} onChange={(e) => setChequeDue(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="ch-bank">بانک</label>
                <input id="ch-bank" className="input" value={chequeBank} onChange={(e) => setChequeBank(e.target.value)} placeholder="مثلاً ملی ایران" />
              </div>
              <div className="col-span-2">
                <label className="label" htmlFor="ch-sayad">شناسه صیاد</label>
                <input id="ch-sayad" className="input" dir="ltr" value={chequeSayad} onChange={(e) => setChequeSayad(e.target.value)} />
              </div>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={() => router.back()}>انصراف</button>
          <button className="btn-primary" disabled={busy || !amount || Number(amount) <= 0} onClick={submit}>
            {busy ? "در حال ثبت…" : "ثبت پرداخت"}
          </button>
        </div>
      </div>
    </div>
  );
}
