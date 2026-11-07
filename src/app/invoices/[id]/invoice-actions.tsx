"use client";

import { SearchableSelect } from "@/components/searchable-select";


import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Modal } from "@/components/ui";
import { Icon } from "@/components/icon";
import { JalaliDatePicker } from "@/components/jalali-date-picker";
import { fmtMoney, parseMoneyInput } from "@/lib/format";
import { toast } from "sonner";
import { postFinancial } from "@/lib/financial-client";

async function jfetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) } });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data as any)?.error ?? "عملیات ناموفق بود.");
  return data as T;
}

/** چاپ خودکار وقتی از فرم با ?print=1 برگشتیم */
export function AutoPrint() {
  const sp = useSearchParams();
  useEffect(() => {
    if (sp.get("print") === "1") {
      const t = setTimeout(() => window.print(), 500);
      return () => clearTimeout(t);
    }
  }, [sp]);
  return null;
}

/**
 * پنل اقدام‌های فاکتور: ثبت پرداخت/دریافت (نقد/کارت/چک)، ثبت نهایی پیش‌نویس،
 * لغو با دلیل و ویرایش پیش‌نویس. همه از API سرور با مجوز و اعتبارسنجی.
 */
export function InvoiceActions({
  invoiceId,
  status,
  type,
  balance,
  canPay,
  canEdit,
  canConfirm,
}: {
  invoiceId: number;
  status: string;
  type: string;
  balance: number;
  canPay: boolean;
  canEdit: boolean;
  canConfirm: boolean;
}) {
  const router = useRouter();
  const [payOpen, setPayOpen] = useState(false);
  const [method, setMethod] = useState("cash");
  const [amount, setAmount] = useState(String(Math.max(0, balance)));
  const [reference, setReference] = useState("");
  const [cheque, setCheque] = useState({ due_date: "", bank_name: "", sayad_id: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const isPurchase = type === "purchase";
  const closed = status === "cancelled";
  const payable = !closed && status !== "draft" && balance > 0;

  const submitPay = async () => {
    setError(null);
    let amt:number;
    try{amt=parseMoneyInput(String(amount),'rial');}catch(error){setError(error instanceof Error?error.message:'مبلغ معتبر نیست.');return;}
    if (!amt) {
      setError("مبلغ را وارد کنید.");
      return;
    }
    if (method === "check" && !cheque.due_date) {
      setError("برای چک، تاریخ سرسید الزامی است.");
      return;
    }
    setBusy(true);
    try {
      await postFinancial(`/api/invoices/${invoiceId}/payments`, {
          amount: amt,
          method,
          reference: reference || null,
          cheque: method === "check" ? { due_date: cheque.due_date, bank_name: cheque.bank_name || null, sayad_id: cheque.sayad_id || null } : null,
      });
      toast.success(isPurchase ? "سند پرداخت ثبت شد" : "سند دریافت ثبت شد");
      setPayOpen(false);
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? "ثبت پرداخت ناموفق بود.");
    } finally {
      setBusy(false);
    }
  };

  const doConfirm = async () => {
    setBusy(true);
    try {
      await jfetch(`/api/invoices/${invoiceId}/confirm`, { method: "POST", body: JSON.stringify({ payments: [] }) });
      toast.success("فاکتور ثبت نهایی شد");
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "ثبت نهایی ناموفق بود");
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async () => {
    setBusy(true);
    try {
      await jfetch(`/api/invoices/${invoiceId}/cancel`, { method: "POST", body: JSON.stringify({ reason: cancelReason || null }) });
      toast.success("فاکتور لغو شد و اثر انبار آن برگشت خورد");
      setCancelOpen(false);
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "لغو ناموفق بود");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "draft" && canConfirm && (
        <button className="btn-primary btn-sm" disabled={busy} onClick={() => void doConfirm()}>
          <Icon name="check-circle" size={14} />
          ثبت نهایی
        </button>
      )}
      {status === "draft" && canEdit && (
        <a className="btn-secondary btn-sm no-underline" href={`/invoices/new?edit=${invoiceId}`}>
          <Icon name="pencil" size={14} />
          ویرایش پیش‌نویس
        </a>
      )}
      {payable && canPay && (
        <button className="btn-primary btn-sm" onClick={() => { setPayOpen(true); setAmount(String(balance)); setError(null); }}>
          <Icon name="banknote" size={14} />
          {isPurchase ? "ثبت پرداخت" : "ثبت دریافت"}
        </button>
      )}
      {!closed && canEdit && (
        <button className="btn-ghost btn-sm text-red-600 dark:text-red-400" onClick={() => setCancelOpen(true)}>
          <Icon name="ban" size={14} />
          لغو فاکتور
        </button>
      )}

      <Modal open={payOpen} onClose={() => setPayOpen(false)} title={isPurchase ? "ثبت پرداخت به تأمین‌کننده" : "ثبت دریافت از مشتری"}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="ia-method">روش</label>
            <SearchableSelect id="ia-method" className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="cash">نقدی</option>
              <option value="card">کارتخوان / کارتی</option>
              <option value="check">چک</option>
            </SearchableSelect>
          </div>
          <div>
            <label className="label" htmlFor="ia-amount">مبلغ (ریال)</label>
            <input id="ia-amount" className="input ltr-num" dir="ltr" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <span className="mt-0.5 block text-xs text-zinc-400">مانده فعلی: {fmtMoney(balance)}</span>
          </div>
          <div>
            <label className="label" htmlFor="ia-ref">{method === "check" ? "شماره چک" : "شماره پیگیری (اختیاری)"}</label>
            <input id="ia-ref" className="input ltr-num" dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          {method === "check" && (
            <>
              <div>
                <label className="label" htmlFor="ia-due">سرسید چک</label>
                <JalaliDatePicker id="ia-due" value={cheque.due_date} onChange={(v) => setCheque((c) => ({ ...c, due_date: v }))} />
              </div>
              <div>
                <label className="label" htmlFor="ia-bank">بانک</label>
                <input id="ia-bank" className="input" value={cheque.bank_name} onChange={(e) => setCheque((c) => ({ ...c, bank_name: e.target.value }))} />
              </div>
              <p className="text-xs text-zinc-400 sm:col-span-2">چک در دفتر چک‌ها ثبت می‌شود و سرسید آن برای پیگیری لازم است.</p>
            </>
          )}
        </div>
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => setPayOpen(false)}>انصراف</button>
          <button className="btn-primary" disabled={busy} onClick={() => void submitPay()}>
            {busy ? "در حال ثبت…" : "ثبت سند"}
          </button>
        </div>
      </Modal>

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="لغو فاکتور">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          لغو فاکتور تاریخچه را حذف نمی‌کند؛ اگر موجودی جابه‌جا شده باشد، سند برگشتی کنترل‌شده در انبار ثبت می‌شود. فاکتور با پرداخت، ابتدا نیازمند برگشت وجه است.
        </p>
        <label className="label mt-3" htmlFor="ia-reason">دلیل لغو (اختیاری)</label>
        <textarea id="ia-reason" className="input" rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => setCancelOpen(false)}>انصراف</button>
          <button className="btn-danger" disabled={busy} onClick={() => void doCancel()}>
            {busy ? "در حال لغو…" : "لغو فاکتور"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
