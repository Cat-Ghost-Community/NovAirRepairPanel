"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui";
import { fmtMoney, fmtDate, toFaDigits } from "@/lib/format";
import { SignaturePad } from "@/components/signature-pad";
import { Checkbox } from "@/components/checkbox";
import { workflowError } from "@/lib/repair-workflow-shared";

export function TrackActions({ estimateToken, customerName, total, validUntil }: { estimateToken: string; customerName?: string; total?: number; validUntil?: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [signing, setSigning] = useState(false);
  const [reason, setReason] = useState("");
  const [error,setError]=useState<string|null>(null);
  const lock=useRef(false);

  const act = async (action: "approve" | "reject", extra: any = {}) => {
    if(lock.current)return;lock.current=true;setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/track/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: estimateToken, action, reason, ...extra }),
      });
      const data = await res.json().catch(()=>null);
      if (!res.ok||data?.ok!==true) throw new Error(data?.error??'ثبت پاسخ برآورد تأیید نشد.');
      toast(action === "approve" ? "برآورد با امضای شما تأیید شد — شروع می‌کنیم!" : "برآورد رد شد");
      setSigning(false);
      router.refresh();
    } catch (e: any) {
      setError(workflowError(e,'ثبت پاسخ تأیید نشد؛ ارتباط را بررسی و دوباره تلاش کنید.'));
    } finally {
      setBusy(false);
      lock.current=false;
    }
  };

  if (rejecting) {
    return (
      <div className="mt-3 space-y-2">
        <textarea className="input min-h-16" placeholder="دلیل را بنویسید (اختیاری)…" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex gap-2">
          <button className="btn-secondary btn-sm flex-1" onClick={() => setRejecting(false)} disabled={busy}>بازگشت</button>
          <button className="btn-danger btn-sm flex-1" onClick={() => act("reject")} disabled={busy}>تأیید عدم پذیرش</button>
        </div>
        {error&&<p role="alert" className="text-sm leading-6 text-red-600 dark:text-red-400">{error}</p>}
      </div>
    );
  }

  if (signing) {
    return <div><SignatureApproval estimateToken={estimateToken} customerName={customerName} total={total} validUntil={validUntil} busy={busy} onDone={act} onCancel={() => {setSigning(false);setError(null);}} />{error&&<p role="alert" className="mt-3 text-sm leading-6 text-red-600 dark:text-red-400">{error}</p>}</div>;
  }

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs leading-6 text-zinc-500">برای تأیید، تصویر امضای دست‌نویس شما همراه نام و زمان در سوابق برآورد نگهداری می‌شود.</p>
      <div className="flex gap-2">
        <button className="btn-primary flex-1" onClick={() => setSigning(true)}>تأیید و امضا</button>
        <button className="btn-secondary flex-1" disabled={busy} onClick={() => setRejecting(true)}>رد برآورد</button>
      </div>
    </div>
  );
}

/** مرحله امضا: رضایت‌نامه حقوقی + نام کامل + امضای دست‌نویس */
function SignatureApproval({
  estimateToken,
  customerName,
  total,
  validUntil,
  busy,
  onDone,
  onCancel,
}: {
  estimateToken: string;
  customerName?: string;
  total?: number;
  validUntil?: string | null;
  busy: boolean;
  onDone: (action: "approve", extra: any) => void;
  onCancel: () => void;
}) {
  const [signature, setSignature] = useState<string | null>(null);
  const [fullName, setFullName] = useState(customerName ?? "");
  const [consent, setConsent] = useState(false);
  const nameValid = fullName.trim().length >= 3;
  const canSubmit = !!signature && nameValid && consent && !busy;

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-zinc-200 dark:border-zinc-700 p-3 bg-zinc-50/60 dark:bg-zinc-900/60">
      <h3 className="font-semibold text-sm">فرم تأیید و امضای برآورد</h3>

      {/* متن رضایت حقوقی */}
      <div className="rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 p-3 text-[13px] leading-6 text-zinc-700 dark:text-zinc-300">
        <p>
          بدین‌وسیله تأیید می‌کنم برآورد هزینه تعمیر دستگاه به مبلغ <strong>{total !== undefined ? fmtMoney(total) : "—"}</strong>
          {validUntil ? <> (معتبر تا {fmtDate(validUntil)})</> : null} را می‌پذیرم و اجازه شروع تعمیر را صادر می‌کنم.
          در صورت تغییر هزینه (مثلاً کشف ایراد پنهان)، پیش از ادامه کار با من هماهنگ می‌شود.
          مسئولیت نگهداری دستگاه در مدت تعمیر و شرایط گارانتی مطابق مقررات تعمیرگاه است.
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          این تأیید با تصویر امضا، نام، تاریخ، ساعت و نشانی IP در سوابق تعمیرگاه نگهداری می‌شود. پیش از ثبت نهایی، مبلغ و مفاد برآورد را بررسی کنید.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="sig-name">نام و نام‌خانوادگی امضاکننده *</label>
        <input id="sig-name" className="input" autoComplete="name" maxLength={120} disabled={busy} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="مثلاً علی رضایی" />
        {fullName.trim() !== "" && !nameValid && <p className="text-xs text-red-600 mt-1">نام کامل را وارد کنید</p>}
      </div>

      <div>
        <SignaturePad onChange={setSignature} disabled={busy} label="امضای تأیید برآورد *" />
      </div>

      <Checkbox label="پذیرش برآورد و ثبت امضا" checked={consent} disabled={busy} onCheckedChange={value=>setConsent(value)} className="items-start"><span className="pt-2 text-[13px] leading-6">مبلغ و مفاد برآورد را خوانده‌ام و ثبت این امضا همراه با تأیید برآورد را می‌پذیرم. *</span></Checkbox>

      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary btn-sm flex-1" onClick={onCancel} disabled={busy}>بازگشت</button>
        <button className="btn-primary flex-1" disabled={!canSubmit} onClick={() => onDone("approve", { signature, signed_name: fullName.trim() })}>
          {busy ? "در حال ثبت…" : "ثبت امضا و تأیید نهایی"}
        </button>
      </div>
    </div>
  );
}
