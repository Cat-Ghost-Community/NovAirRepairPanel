"use client";
import {escapeHtml} from '@/lib/html';

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { EmptyState, useToast } from "@/components/ui";
import { Select } from "@/components/select";
import { parseMoneyInput, faQty, fmtMoney, toEnDigits } from "@/lib/format";
import {postFinancial} from '@/lib/financial-client';

type Item = {
  id: number;
  name: string;
  qty: number;
  unit: string | null;
  est_cost: number;
  note: string | null;
  priority: string;
  status: string;
  sku: string | null;
  created_by_name: string | null;
};

const STATUS_FA: Record<string, { label: string; cls: string }> = {
  pending: { label: "در انتظار خرید", cls: "badge-amber" },
  ordered: { label: "سفارش داده شد", cls: "badge-blue" },
  purchased: { label: "خریداری شد", cls: "badge-green" },
  cancelled: { label: "لغو شد", cls: "badge-gray" },
};

const PRIORITY_FA: Record<string, { label: string; cls: string }> = {
  urgent: { label: "فوری", cls: "badge-red" },
  normal: { label: "معمولی", cls: "badge-gray" },
  low: { label: "کم‌اهمیت", cls: "badge-gray" },
};

/** گام بعدی وضعیت: در انتظار خرید ← سفارش داده شد ← خریداری شد */
const NEXT_STATUS: Record<string, string> = { pending: "ordered", ordered: "purchased" };
const NEXT_LABEL: Record<string, string> = { ordered: "سفارش شد", purchased: "خریداری شد" };

const EMPTY_FORM = { name: "", qty: "1", unit: "", est_cost: "", note: "", priority: "normal", part_id: 0 };
const num = (v: string) => Number(toEnDigits(String(v ?? "")).replace(/\D/g, "")) || 0;

/** لیست خرید تأمین‌کننده — اقلام آزاد یا متصل به قطعهٔ انبار */
export function SupplierPurchaseList({
  supplierId,
  canEdit,
  canOrder,
  supplierName,
}: {
  supplierId: number;
  canEdit: boolean;
  /** مجوز ساخت سفارش خرید از لیست (purchasing.manage) */
  canOrder: boolean;
  /** نام تأمین‌کننده — روی سربرگ چاپ می‌آید */
  supplierName?: string;
}) {
  const toast = useToast();
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [sugs, setSugs] = useState<Array<{ id: number; name: string; sku: string | null }>>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const url = `/api/suppliers/${supplierId}/purchase-list${showDone ? "?done=1" : ""}`;

  /** بارگذاری لیست — هم بار اول و هم پس از هر تغییر (افزودن/وضعیت/حذف) استفاده می‌شود */
  const load = useCallback(
    () =>
      fetch(url)
        .then((r) => r.json())
        .then((d) => setItems(d.items ?? []))
        .catch(() => {})
        .finally(() => setLoading(false)),
    [url]
  );

  useEffect(() => {
    void load();
  }, [load]);

  /** جستجوی قطعهٔ انبار برای اتصال قلم لیست به کالای واقعی */
  const onName = (value: string) => {
    setForm((f) => ({ ...f, name: value, part_id: 0 }));
    if (timer.current) clearTimeout(timer.current);
    const q = value.trim();
    if (q.length < 2) {
      setSugs([]);
      return;
    }
    timer.current = setTimeout(() => {
      fetch(`/api/parts/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d) => setSugs(((d.parts ?? []) as any[]).slice(0, 6) as any))
        .catch(() => setSugs([]));
    }, 250);
  };

  const add = async () => {
    if (!form.name.trim()) {
      toast("نام کالا الزامی است.", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/suppliers/${supplierId}/purchase-list`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          part_id: form.part_id || undefined,
          qty: num(form.qty) || 1,
          unit: form.unit.trim(),
          est_cost: parseMoneyInput(String(form.est_cost||'0'),undefined,true),
          note: form.note.trim(),
          priority: form.priority,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error ?? "ذخیره نشد.");
      toast("قلم به لیست خرید اضافه شد");
      setForm({ ...EMPTY_FORM });
      setSugs([]);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "ذخیره نشد.", "error");
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (item: Item, status: string, label: string) => {
    const res = await fetch(`/api/suppliers/purchase-list/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      toast(data.error ?? "وضعیت تغییر نکرد.", "error");
      return;
    }
    toast(`«${item.name}» ${label}`);
    await load();
  };

  const remove = async (item: Item) => {
    if (!confirm(`«${item.name}» از لیست خرید حذف شود؟`)) return;
    const res = await fetch(`/api/suppliers/purchase-list/${item.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      toast(data.error ?? "حذف نشد.", "error");
      return;
    }
    toast("قلم حذف شد");
    await load();
  };

  /** تبدیل همهٔ اقلام باز لیست به یک سفارش خرید واقعی برای همین تأمین‌کننده */
  const convert = async () => {
    if (!confirm("همهٔ اقلام باز این لیست به یک سفارش خرید تبدیل شود؟")) return;
    setBusy(true);
    try {
      const data = await postFinancial<{number:string;count:number}>(`/api/suppliers/${supplierId}/purchase-list/convert`,{});
      toast(`سفارش خرید ${data.number} با ${faQty(data.count)} قلم ساخته شد`);
      await load();
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "سفارش خرید ساخته نشد.", "error");
    } finally {
      setBusy(false);
    }
  };

  /** چاپ لیست خرید (یا ذخیرهٔ PDF) از طریق پنجرهٔ چاپ مرورگر */
  const printList = () => {
    const openItems = items.filter((i) => i.status === "pending" || i.status === "ordered");
    if (openItems.length === 0) {
      toast("قلم بازی برای چاپ وجود ندارد.", "error");
      return;
    }
    const w = window.open("", "_blank", "width=820,height=900");
    if (!w) {
      toast("پنجرهٔ چاپ باز نشد — اجازهٔ pop-up این سایت را بدهید.", "error");
      return;
    }
    const rows = openItems
      .map(
        (i) =>
          `<tr><td>${escapeHtml(i.name)}${i.sku ? ` (${escapeHtml(i.sku)})` : ""}</td><td>${faQty(i.qty)}${i.unit ? " " + escapeHtml(i.unit) : ""}</td>` +
          `<td>${escapeHtml(PRIORITY_FA[i.priority]?.label ?? "")}</td><td>${escapeHtml(i.note)}</td></tr>`
      )
      .join("");
    w.document.write(
      `<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><title>لیست خرید</title>` +
        `<style>body{font-family:Tahoma,Arial,sans-serif;padding:24px;color:#111}` +
        `h1{font-size:18px;margin:0}h2{font-size:13px;font-weight:400;color:#555;margin:4px 0 16px}` +
        `table{width:100%;border-collapse:collapse;font-size:13px}` +
        `th,td{border:1px solid #ddd;padding:6px 8px;text-align:right}th{background:#f4f4f5}` +
        `@media print{body{padding:0}}</style></head><body>` +
        `<h1>لیست خرید${supplierName ? ` — ${escapeHtml(supplierName)}` : ""}</h1>` +
        `<h2>تاریخ چاپ: ${new Date().toLocaleDateString("fa-IR")} · ${faQty(openItems.length)} قلم</h2>` +
        `<table><thead><tr><th>کالا</th><th>تعداد</th><th>اولویت</th><th>یادداشت</th></tr></thead>` +
        `<tbody>${rows}</tbody></table>` +
        `<script nonce="${escapeHtml(document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce??'')}">window.onload=function(){window.print()}<\/script></body></html>`
    );
    w.document.close();
  };

  const activeTotal = items
    .filter((i) => i.status === "pending" || i.status === "ordered")
    .reduce((sum, i) => sum + Number(i.est_cost) * Number(i.qty), 0);
  const pendingCount = items.filter((i) => i.status === "pending").length;

  return (
    <section className="card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
        <div>
          <h2 className="section-title">لیست خرید از این تأمین‌کننده</h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {pendingCount > 0 ? `${faQty(pendingCount)} قلم در انتظار خرید` : "قلمی در انتظار خرید نیست"}
            {activeTotal > 0 && <> · برآورد {fmtMoney(activeTotal)}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className={`${showDone ? "btn-primary" : "btn-secondary"} btn-sm`}
            onClick={() => setShowDone((v) => !v)}
            aria-pressed={showDone}
          >
            {showDone ? "پنهان‌کردن خریداری‌شده‌ها" : "نمایش خریداری‌شده‌ها"}
          </button>
          <button className="btn-secondary btn-sm" onClick={printList}>
            <Icon name="printer" size={15} /> چاپ لیست
          </button>
          <a
            className="btn-secondary btn-sm"
            href={`/api/suppliers/${supplierId}/purchase-list/excel${showDone ? "?done=1" : ""}`}
          >
            <Icon name="download" size={15} /> اکسل
          </a>
          {canOrder && (
            <button className="btn-secondary btn-sm" onClick={convert} disabled={busy}>
              <Icon name="cart" size={15} /> تبدیل به سفارش خرید
            </button>
          )}
          {canEdit && (
            <button className="btn-primary btn-sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              <Icon name="plus" size={15} /> افزودن قلم
            </button>
          )}
        </div>
      </div>

      {open && canEdit && (
        <div className="grid gap-3 border-b border-zinc-200 bg-zinc-50/70 px-5 py-4 sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-900/40">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="pl-name">نام کالا / قطعه</label>
            <input
              id="pl-name"
              className="input"
              value={form.name}
              onChange={(e) => onName(e.target.value)}
              placeholder="مثلاً برد شارژ — برای اتصال به قطعهٔ انبار تایپ کنید"
              autoComplete="off"
            />
            {sugs.length > 0 && (
              <div className="mt-1 divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-700 dark:bg-zinc-900">
                {sugs.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-right text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    onClick={() => {
                      setForm((f) => ({ ...f, name: p.name, part_id: p.id }));
                      setSugs([]);
                    }}
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="mr-2 shrink-0 font-mono text-xs text-zinc-400">{p.sku ?? ""}</span>
                  </button>
                ))}
              </div>
            )}
            {form.part_id > 0 && <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">به قطعهٔ انبار متصل شد.</p>}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="pl-qty">تعداد</label>
              <input id="pl-qty" className="input" value={form.qty} onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))} inputMode="numeric" />
            </div>
            <div>
              <label className="label" htmlFor="pl-unit">واحد</label>
              <input id="pl-unit" className="input" value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} placeholder="عدد" />
            </div>
            <div>
              <label className="label" htmlFor="pl-priority">اولویت</label>
              <Select
                id="pl-priority"
                value={form.priority}
                onChange={(v) => setForm((f) => ({ ...f, priority: v }))}
                options={[
                  { value: "urgent", label: "فوری" },
                  { value: "normal", label: "معمولی" },
                  { value: "low", label: "کم‌اهمیت" },
                ]}
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="pl-cost">بهای تقریبی هر واحد (اختیاری)</label>
            <input
              id="pl-cost"
              className="input"
              value={form.est_cost}
              onChange={(e) => setForm((f) => ({ ...f, est_cost: e.target.value }))}
              inputMode="numeric"
              placeholder="مثلاً ۱۵۰۰۰۰"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="label" htmlFor="pl-note">یادداشت (اختیاری)</label>
            <input
              id="pl-note"
              className="input"
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="مثلاً: اورجینال، همراه با گارانتی"
            />
          </div>

          <div className="flex gap-2 sm:col-span-2">
            <button className="btn-primary" onClick={add} disabled={busy}>
              {busy ? "در حال ذخیره…" : "افزودن به لیست"}
            </button>
            <button className="btn-ghost" onClick={() => { setOpen(false); setSugs([]); }}>بستن</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="px-5 py-8 text-center text-sm text-zinc-400">در حال بارگذاری…</p>
      ) : items.length === 0 ? (
        <EmptyState
          icon="cart"
          title="لیست خرید خالی است"
          body="هر چیزی که باید از این تأمین‌کننده خریده شود را اینجا بنویسید تا فراموش نشود."
        />
      ) : (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {items.map((item) => (
            <div key={item.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-5 py-3">
              <div className="min-w-0 flex-1 break-words">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{item.name}</span>
                  {item.sku && <span className="font-mono text-xs text-zinc-400">{item.sku}</span>}
                  <span className={PRIORITY_FA[item.priority]?.cls ?? "badge-gray"}>
                    {PRIORITY_FA[item.priority]?.label ?? item.priority}
                  </span>
                  <span className={STATUS_FA[item.status]?.cls ?? "badge-gray"}>
                    {STATUS_FA[item.status]?.label ?? item.status}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  تعداد {faQty(item.qty)}{item.unit ? ` ${item.unit}` : ""}
                  {Number(item.est_cost) > 0 && <> · برآورد {fmtMoney(Number(item.est_cost) * Number(item.qty))}</>}
                  {item.created_by_name && <> · {item.created_by_name}</>}
                </div>
                {item.note && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{item.note}</p>}
              </div>
              {canEdit && (
                <div className="flex shrink-0 items-center gap-1">
                  {NEXT_STATUS[item.status] && (
                    <button
                      className="btn-secondary btn-sm"
                      onClick={() => setStatus(item, NEXT_STATUS[item.status], NEXT_LABEL[NEXT_STATUS[item.status]])}
                    >
                      {NEXT_LABEL[NEXT_STATUS[item.status]]}
                    </button>
                  )}
                  <button className="btn-ghost btn-sm btn-icon" aria-label="حذف قلم" onClick={() => remove(item)}>
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

