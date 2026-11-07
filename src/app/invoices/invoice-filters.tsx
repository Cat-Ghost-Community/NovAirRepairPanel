"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icon";
import { JalaliDatePicker } from "@/components/jalali-date-picker";

/** نوار جست‌وجوی فاکتورها: عبارت + بازهٔ تاریخ — در URL می‌ماند */
export function InvoiceFilters({ q0, from0, to0 }: { q0: string; from0: string; to0: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(q0);
  const [from, setFrom] = useState(from0);
  const [to, setTo] = useState(to0);
  const lastRef = useRef("");

  useEffect(() => {
    const t = window.setTimeout(() => {
      const params = new URLSearchParams(sp.toString());
      params.delete("page");
      if (q.trim()) params.set("q", q.trim());
      else params.delete("q");
      if (from) params.set("from", from);
      else params.delete("from");
      if (to) params.set("to", to);
      else params.delete("to");
      const url = `/invoices${params.toString() ? `?${params.toString()}` : ""}`;
      if (url === lastRef.current) return;
      lastRef.current = url;
      router.replace(url, { scroll: false });
    }, 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, from, to]);

  const hasFilter = q.trim() || from || to;
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <div className="min-w-52 flex-1">
        <label className="label" htmlFor="inv-q">جست‌وجو (شماره فاکتور، مشتری، تأمین‌کننده، پذیرش)</label>
        <span className="relative block">
          <Icon name="search" size={15} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input id="inv-q" className="input !pr-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="مثلاً INV-0001 یا نام مشتری…" />
        </span>
      </div>
      <div className="w-40">
        <label className="label">از تاریخ</label>
        <JalaliDatePicker id="inv-from" value={from} onChange={setFrom} />
      </div>
      <div className="w-40">
        <label className="label">تا تاریخ</label>
        <JalaliDatePicker id="inv-to" value={to} onChange={setTo} />
      </div>
      {hasFilter && (
        <button className="btn-ghost btn-sm mb-0.5" onClick={() => { setQ(""); setFrom(""); setTo(""); }}>
          <Icon name="x" size={14} />
          پاک‌کردن
        </button>
      )}
    </div>
  );
}
