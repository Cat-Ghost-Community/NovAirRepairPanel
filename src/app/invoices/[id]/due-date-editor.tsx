"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui";
import { JalaliDatePicker } from "@/components/jalali-date-picker";

/** ویرایش موعد تسویه فاکتور با تقویم جلالی */
export function DueDateEditor({ invoiceId, current }: { invoiceId: number; current: string | null }) {
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(current ?? "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/invoices", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: invoiceId, due_date: date || null }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error ?? "خطا");
      toast("موعد تسویه به‌روزرسانی شد");
      setOpen(false);
      router.refresh();
    } catch (e: any) {
      toast(e.message ?? "خطا", "error");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button className="text-brand-600 hover:underline text-xs mr-1" onClick={() => setOpen(true)} title="ویرایش موعد تسویه">
        تغییر
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 mt-1">
      <JalaliDatePicker value={date} onChange={setDate} placeholder="موعد تسویه (شمسی)" clearable />
      <button className="btn-primary btn-sm" disabled={busy} onClick={save}>ذخیره</button>
      <button className="btn-secondary btn-sm" onClick={() => setOpen(false)}>انصراف</button>
    </span>
  );
}
