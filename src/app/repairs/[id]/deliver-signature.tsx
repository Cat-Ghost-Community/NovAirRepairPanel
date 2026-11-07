"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, useToast } from "@/components/ui";
import { SignaturePad } from "@/components/signature-pad";
import { Checkbox } from "@/components/checkbox";
import { workflowError } from "@/lib/repair-workflow-shared";

/**
 * دکمه انتقال به «تحویل‌شده» با امضای تحویل‌گیرنده.
 * جایگزین فرم ساده انتقال وضعیت برای وضعیت Delivered — مودال حقوقی تحویل سالم دستگاه.
 */
export function DeliverSignatureButton({ ticketId, statusName, customerName, color }: { ticketId: number; statusName: string; customerName: string; color?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [fullName, setFullName] = useState(customerName);
  const [consent, setConsent] = useState(false);
  const [key,setKey]=useState('');
  const [error,setError]=useState<string|null>(null);
  const lock=useRef(false);

  const nameValid = fullName.trim().length >= 3;
  const canSubmit = !!signature && nameValid && consent && !busy;

  const submit = async () => {
    if(!canSubmit||lock.current)return;
    lock.current=true;setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/repairs/${ticketId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key":key },
        body: JSON.stringify({
          status: statusName,
          delivery_signature: signature,
          delivery_signed_name: fullName.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok!==true) throw new Error(data.error ?? "ثبت تحویل ناموفق بود");
      toast("تحویل با امضای مشتری ثبت شد");
      setOpen(false);
      router.refresh();
    } catch (e: any) {
      setError(workflowError(e,"ثبت تحویل تأیید نشد؛ ارتباط را بررسی و دوباره تلاش کنید."));
    } finally {
      setBusy(false);
      lock.current=false;
    }
  };

  return (
    <>
      <button className="btn-secondary btn-sm" style={color ? { borderColor: color + "88" } : undefined} onClick={() => {setSignature(null);setConsent(false);setFullName(customerName);setError(null);setKey(crypto.randomUUID());setOpen(true);}}>
        {statusName === "Delivered" ? "تحویل با امضا" : null}
      </button>
      <Modal open={open} onClose={()=>setOpen(false)} title="امضای تحویل دستگاه" dismissible={!busy} wide>
      {open && (
          <div className="min-w-0 space-y-4">
            <div>
              <h3 className="font-semibold">رسید تحویل دستگاه</h3>
              <p className="text-xs text-zinc-500 mt-0.5">پذیرش #{ticketId} — ثبت تحویل حضوری با امضای تحویل‌گیرنده</p>
            </div>

            {/* متن حقوقی رسید تحویل */}
            <div className="rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 p-3 text-[13px] leading-6 text-zinc-700 dark:text-zinc-300">
              <p>
                بدین‌وسیله تأیید می‌کنم دستگاه تعمیرشده به‌همراه لوازم همراه ذکرشده در رسید پذیرش را
                <strong> سالم و کامل </strong>
                تحویل گرفتم و از انجام کار و هزینه نهایی مطابق فاکتور اطلاع دارم.
                هرگونه ایراد احتمالی ناشی از تعمیر باید <strong>همین لحظه</strong> اعلام شود؛ پس از خروج دستگاه، تعمیرگاه بدون مسئولیت پذیرش بازگشت به‌خاطر ایرادهای ظاهری جدید نیست.
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                این رسید با امضای دست‌نویس، نام و تاریخ ثبت و به‌عنوان سند تحویل در سوابق تعمیرگاه نگهداری می‌شود.
              </p>
            </div>

            <div>
              <label className="label" htmlFor="dlv-name">نام و نام‌خانوادگی تحویل‌گیرنده *</label>
              <input id="dlv-name" className="input" autoComplete="name" maxLength={120} disabled={busy} value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>

            <div>
              <SignaturePad onChange={setSignature} disabled={busy} label="امضای تحویل‌گیرنده *" />
            </div>

            <Checkbox label="پذیرش مفاد رسید تحویل" checked={consent} disabled={busy} onCheckedChange={value=>setConsent(value)} className="items-start"><span className="pt-2 text-[13px] leading-6">دستگاه را سالم تحویل گرفتم و مفاد این رسید را می‌پذیرم. *</span></Checkbox>
            {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm leading-6 text-red-700 dark:bg-red-500/10 dark:text-red-400">{error}</p>}

            <div className="flex flex-wrap gap-2 justify-end border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <button className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>انصراف</button>
              <button className="btn-primary" disabled={!canSubmit} onClick={submit}>
                {busy ? "در حال ثبت…" : "ثبت تحویل و امضا"}
              </button>
            </div>
          </div>
      )}
      </Modal>
    </>
  );
}
