"use client";

import { useEffect, useMemo, useState } from "react";
import { useToast, EmptyState } from "@/components/ui";
import { Icon } from "@/components/icon";
import { Select } from "@/components/select";
import { fmtMoney, moneyDisplayValue, toFaDigits, parseMoneyInput } from "@/lib/format";

type Service = {
  id: number;
  name: string;
  category: string | null;
  description: string | null;
  price: number;
  cost: number | null;
  duration_min: number | null;
  warranty_days: number | null;
};

const EMPTY = { id: 0, name: "", category: "عمومی", price: "", cost: "", duration_min: "", warranty_days: "90", description: "" };
const CATEGORIES = ["عمومی", "تعمیر", "قطعه‌کاری", "نرم‌افزار", "سخت‌افزار", "نصب و راه‌اندازی", "مشاوره"];

/**
 * مدیریت خدمات — این فهرست در برآورد و فاکتور استفاده می‌شود و قبلاً فقط
 * خواندنی بود. اکنون افزودن/ویرایش/حذف با اعتبارسنجی و پیام فارسی دارد.
 */
export function ServicesManager({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...EMPTY });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

  const load = () => {
    fetch("/api/services")
      .then((r) => r.json())
      .then((d) => setServices(d.services ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const grouped = useMemo(() => {
    const needle = q.trim();
    const list = needle ? services.filter((s) => s.name.includes(needle) || (s.category ?? "").includes(needle)) : services;
    const map = new Map<string, Service[]>();
    for (const s of list) {
      const key = s.category ?? "بدون دسته";
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return [...map.entries()];
  }, [services, q]);

  const save = async () => {
    if (!form.name.trim()) {
      toast("نام خدمت الزامی است.", "error");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        id: form.id || undefined,
        name: form.name.trim(),
        category: form.category,
        price: parseMoneyInput(String(form.price||'0'),undefined,true),
        cost: parseMoneyInput(String(form.cost||'0'),undefined,true),
        duration_min: form.duration_min,
        warranty_days: form.warranty_days,
        description: form.description,
      };
      const res = await fetch("/api/services", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error ?? "ذخیره نشد.");
      toast(form.id ? "خدمت ویرایش شد" : "خدمت اضافه شد");
      setForm({ ...EMPTY });
      setOpen(false);
      load();
    } catch (e: any) {
      toast(e.message ?? "ذخیره نشد.", "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: Service) => {
    if (!confirm(`خدمت «${s.name}» حذف شود؟`)) return;
    const res = await fetch("/api/services", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: s.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      toast("خدمت حذف شد");
      load();
    } else {
      toast(data.error ?? "حذف نشد.", "error");
    }
  };

  const startEdit = (s: Service) => {
    setForm({
      id: s.id,
      name: s.name,
      category: s.category ?? "عمومی",
      price: toFaDigits(moneyDisplayValue(s.price)),
      cost: s.cost ? toFaDigits(moneyDisplayValue(s.cost)) : "",
      duration_min: s.duration_min == null ? "" : String(s.duration_min),
      warranty_days: String(s.warranty_days ?? 90),
      description: s.description ?? "",
    });
    setOpen(true);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3 sm:px-5 dark:border-zinc-800/70">
        <span className="chip">{toFaDigits(services.length)} خدمت در فهرست</span>
        <div className="flex items-center gap-1.5">
          <input className="input !py-1.5 !text-[13px] w-40" value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو…" aria-label="جستجوی خدمت" />
          {canEdit && !open && (
            <button className="btn-primary btn-sm" onClick={() => { setForm({ ...EMPTY }); setOpen(true); }}>
              + خدمت جدید
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="mb-3 space-y-2 rounded-lg border border-brand-300 bg-brand-50/40 p-3 dark:border-brand-700 dark:bg-brand-500/5">
          <div className="text-[13px] font-semibold">{form.id ? `ویرایش «${form.name}»` : "خدمت جدید"}</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block">
              <span className="label">نام خدمت *</span>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="block">
              <span className="label">دسته</span>
              <Select value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
            </label>
            <label className="block">
              <span className="label">اجرت (واحد پول فعال)</span>
              <input className="input num" dir="ltr" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="۰" />
            </label>
            <label className="block">
              <span className="label">بهای تمام‌شده</span>
              <input className="input num" dir="ltr" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} placeholder="۰" />
            </label>
            <label className="block">
              <span className="label">مدت تقریبی (دقیقه)</span>
              <input className="input num" dir="ltr" value={form.duration_min} onChange={(e) => setForm({ ...form, duration_min: e.target.value })} placeholder="اختیاری" />
            </label>
            <label className="block">
              <span className="label">گارانتی (روز)</span>
              <input className="input num" dir="ltr" value={form.warranty_days} onChange={(e) => setForm({ ...form, warranty_days: e.target.value })} />
            </label>
            <label className="block sm:col-span-2 lg:col-span-3">
              <span className="label">توضیح</span>
              <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="اختیاری" />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary btn-sm" onClick={() => { setOpen(false); setForm({ ...EMPTY }); }} disabled={busy}>انصراف</button>
            <button className="btn-primary btn-sm" onClick={save} disabled={busy}>{busy ? "در حال ذخیره…" : "ذخیره"}</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-zinc-400">در حال بارگذاری…</p>
      ) : services.length === 0 ? (
        <EmptyState icon="clipboard" title="خدمتی ثبت نشده" body="با افزودن خدمت، هنگام ثبت قطعه و اجرت در پذیرش قابل انتخاب می‌شود." />
      ) : (
        <div className="space-y-3">
          {grouped.map(([category, list]) => (
            <div key={category}>
              <div className="mb-1.5 text-xs font-semibold text-zinc-400">{category} · {toFaDigits(list.length)} خدمت</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {list.map((s) => (
                  <div key={s.id} className="flex items-start justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{s.name}</div>
                      <div className="mt-0.5 text-xs text-zinc-400">
                        {s.duration_min ? `${toFaDigits(s.duration_min)} دقیقه` : "بدون زمان تقریبی"}
                        {s.warranty_days ? ` · گارانتی ${toFaDigits(s.warranty_days)} روز` : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="text-[13px] font-medium">{fmtMoney(s.price)}</span>
                      {canEdit && (
                        <>
                          <button className="btn-ghost btn-sm" onClick={() => startEdit(s)} aria-label={`ویرایش ${s.name}`}>
                            <Icon name="pencil" size={14} />
                          </button>
                          <button className="btn-ghost btn-sm text-red-600 dark:text-red-400" onClick={() => remove(s)} aria-label={`حذف ${s.name}`}>
                            <Icon name="trash" size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
