"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, useToast } from "@/components/ui";
import { fmtMoney, moneyDisplayValue, toFaDigits, parseMoneyInput } from "@/lib/format";
import { postFinancial } from "@/lib/financial-client";
import { Select } from "@/components/select";

const METHODS = [
  { value: "cash", label: "نقد" },
  { value: "card", label: "کارتخوان" },
  { value: "transfer", label: "حواله بانکی" },
];

/**
 * بازگشت وجه یک پرداخت. مسیر API از قبل وجود داشت ولی هیچ دکمه‌ای آن را صدا
 * نمی‌زد؛ اکنون با اعتبارسنجی سقف (مبلغ پرداخت منهای استردادهای قبلی) در دسترس است.
 */
export function RefundButton({
  paymentId,
  refundable,
  method,
}: {
  paymentId: number;
  refundable: number;
  method: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] = useState(["check", "cheque", "online"].includes(method) ? "transfer" : method || "cash");

  if (refundable <= 0) return null;

  const submit = async () => {
    let value: number;
    try { value = parseMoneyInput(amount); }
    catch { toast("مبلغ بازگشت معتبر نیست.", "error"); return; }
    if (!value || value <= 0) {
      toast("مبلغ بازگشت باید بیشتر از صفر باشد.", "error");
      return;
    }
    if (value > refundable) {
      toast(`حداکثر مبلغ قابل بازگشت ${fmtMoney(refundable)} است.`, "error");
      return;
    }
    setBusy(true);
    try {
      await postFinancial("/api/payments/refund", { payment_id: paymentId, amount: value, reason, method: refundMethod });
      toast("بازگشت وجه ثبت شد");
      setOpen(false);
      setAmount("");
      setReason("");
      router.refresh();
    } catch (e: any) {
      toast(e.message ?? "بازگشت وجه انجام نشد.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="btn-ghost btn-sm text-red-600 dark:text-red-400" onClick={() => { setOpen(true); setAmount(toFaDigits(moneyDisplayValue(refundable))); }}>
        بازگشت وجه
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="بازگشت وجه به مشتری">
        <div className="space-y-3">
          <p className="text-xs text-zinc-500">
            حداکثر مبلغ قابل بازگشت از این سند: <span className="font-medium">{fmtMoney(refundable)}</span>
          </p>
          <label className="block">
            <span className="label">مبلغ بازگشت</span>
            <input className="input num" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="مبلغ بازگشت" />
          </label>
          <label className="block">
            <span className="label">روش بازگشت</span>
            <Select value={refundMethod} onChange={setRefundMethod} options={METHODS} ariaLabel="روش بازگشت" />
          </label>
          <label className="block">
            <span className="label">دلیل (اختیاری)</span>
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلاً انصراف مشتری از تعمیر" />
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>انصراف</button>
            <button type="button" className="btn-danger" onClick={submit} disabled={busy}>
              {busy ? "در حال ثبت…" : "ثبت بازگشت وجه"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
