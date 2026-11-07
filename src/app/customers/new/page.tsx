"use client";

import { useRef,useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui";
import { CustomerForm, EMPTY_CUSTOMER_FORM } from "@/components/customer-form";

export default function NewCustomerPage() {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<any>({ ...EMPTY_CUSTOMER_FORM });
  const [dupes, setDupes] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const operation=useRef<string|null>(null);

  const submit = async (force = false) => {
    setBusy(true);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json",'Idempotency-Key':operation.current??=crypto.randomUUID() },
        body: JSON.stringify({ ...form, force }),
      });
      const data = await res.json();
      if (res.status === 409 && data.duplicate) { setDupes(data.duplicates); setBusy(false); return; }
      if (!res.ok) throw new Error(data.error);
      toast(`مشتری ${data.code} ثبت شد`);
      router.push(data.redirect??`/customers/${data.id}`);
    } catch (e: any) {
      toast(e.message ?? "ذخیره مشتری ناموفق بود", "error");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <h1 className="text-xl font-bold tracking-tight">مشتری جدید</h1>
      <p className="text-sm text-zinc-500 mt-0.5">فقط نام و موبایل الزامی است — بقیه بعداً قابل تکمیل است.</p>
      <div className="card card-pad mt-4 space-y-3">
        <CustomerForm form={form} onChange={setForm} mode="page" />
        {dupes && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10 p-3 text-sm">
            <p className="font-medium text-amber-800 dark:text-amber-300">مشتری مشابه پیدا شد — قبل از ثبت بررسی کنید:</p>
            <ul className="mt-1 text-amber-700 dark:text-amber-400 list-disc pr-5">
              {dupes.map((d) => <li key={d.id}>{d.first_name} {d.last_name} · {d.mobile ?? d.email}</li>)}
            </ul>
          </div>
        )}
        <div className="flex gap-2 justify-end pt-2">
          <button className="btn-secondary" onClick={() => router.back()}>انصراف</button>
          <button className="btn-primary" disabled={busy || !form.first_name?.trim() || !form.last_name?.trim() || !form.mobile} onClick={() => submit(false)}>
            {busy ? "در حال ذخیره…" : "ذخیره مشتری"}
          </button>
        </div>
        {dupes && <button className="btn-secondary w-full" disabled={busy} onClick={() => submit(true)}>ثبت به هر حال (تکراری نیست)</button>}
      </div>
    </div>
  );
}
