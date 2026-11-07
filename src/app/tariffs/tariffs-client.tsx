"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, useToast } from "@/components/ui";
import { Icon } from "@/components/icon";
import { Select } from "@/components/select";
import { parseMoneyInput, fmtMoney, fmtMoneyShort, moneyDisplayValue, toEnDigits, toFaDigits } from "@/lib/format";

export type Tariff = {
  id: number;
  device_type: string;
  brand: string | null;
  title: string;
  labor_price: number;
  duration_min: number | null;
  warranty_days: number | null;
  notes: string | null;
  is_active: number;
  updated_at: string | null;
};

const EMPTY_FORM = {
  id: 0,
  device_type: "",
  brand: "",
  title: "",
  labor_price: "",
  duration_min: "",
  warranty_days: "90",
  notes: "",
};

const num = (v: string) => Number(toEnDigits(String(v ?? "")).replace(/\D/g, "")) || 0;

const DEVICE_SUGGESTIONS = ["موبایل", "لپ‌تاپ", "تبلت", "کنسول بازی", "ساعت هوشمند", "هدفون", "تلویزیون", "سایر"];

/** مدیریت تعرفهٔ تعمیرات — اجرت/گارانتی/مدت هر نوع دستگاه و ایراد */
export function TariffsClient({ canManage }: { canManage: boolean }) {
  const toast = useToast();
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [deviceTypes, setDeviceTypes] = useState<string[]>([]);
  const [summary, setSummary] = useState<{ total: number; active: number; avg_price: number }>({ total: 0, active: 0, avg_price: 0 });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  const [deviceFilter, setDeviceFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (deviceFilter) params.set("device_type", deviceFilter);
      if (showInactive) params.set("include_inactive", "1");
      const res = await fetch(`/api/repair-tariffs?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error ?? "تعرفه‌ها خوانده نشد.");
      setTariffs(data.tariffs ?? []);
      setDeviceTypes(data.device_types ?? []);
      setSummary(data.summary ?? { total: 0, active: 0, avg_price: 0 });
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [q, deviceFilter, showInactive]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  /** گروه‌بندی بر اساس نوع دستگاه — با حفظ ترتیب الفبا */
  const groups = useMemo(() => {
    const map = new Map<string, Tariff[]>();
    for (const t of tariffs) map.set(t.device_type, [...(map.get(t.device_type) ?? []), t]);
    return [...map.entries()];
  }, [tariffs]);

  const save = async () => {
    if (!form.device_type.trim() || !form.title.trim()) {
      toast("نوع دستگاه و عنوان تعرفه الزامی است.", "error");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        device_type: form.device_type.trim(),
        brand: form.brand.trim(),
        title: form.title.trim(),
        labor_price: parseMoneyInput(String(form.labor_price||'0'),undefined,true),
        duration_min: form.duration_min.trim() === "" ? "" : num(form.duration_min),
        warranty_days: num(form.warranty_days),
        notes: form.notes.trim(),
      };
      const res = await fetch(form.id ? `/api/repair-tariffs/${form.id}` : "/api/repair-tariffs", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error ?? "ذخیره نشد.");
      toast(form.id ? "تعرفه ویرایش شد" : "تعرفهٔ تازه ثبت شد");
      setForm({ ...EMPTY_FORM });
      setOpen(false);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "ذخیره نشد.", "error");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (t: Tariff) => {
    const res = await fetch(`/api/repair-tariffs/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: t.is_active ? 0 : 1 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      toast(data.error ?? "تغییر وضعیت نشد.", "error");
      return;
    }
    toast(t.is_active ? "تعرفه غیرفعال شد" : "تعرفه فعال شد");
    await load();
  };

  const remove = async (t: Tariff) => {
    if (!confirm(`تعرفهٔ «${t.title}» حذف شود؟ (سابقهٔ پذیرش‌های قبلی دست‌نخورده می‌ماند)`)) return;
    const res = await fetch(`/api/repair-tariffs/${t.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      toast(data.error ?? "حذف نشد.", "error");
      return;
    }
    toast("تعرفه حذف شد");
    await load();
  };

  const startEdit = (t: Tariff) => {
    setForm({
      id: t.id,
      device_type: t.device_type,
      brand: t.brand ?? "",
      title: t.title,
      labor_price: moneyDisplayValue(Number(t.labor_price)),
      duration_min: t.duration_min == null ? "" : String(t.duration_min),
      warranty_days: String(t.warranty_days ?? 0),
      notes: t.notes ?? "",
    });
    setOpen(true);
  };

  return (
    <div className="space-y-4">
      {open && canManage && (
        <section className="card card-pad">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="section-title">{form.id ? "ویرایش تعرفه" : "تعرفهٔ تازه"}</h2>
            <button className="btn-ghost btn-sm" onClick={() => { setOpen(false); setForm({ ...EMPTY_FORM }); }}>
              بستن
            </button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label" htmlFor="tf-device">نوع دستگاه</label>
              <input
                id="tf-device"
                className="input"
                list="tf-device-list"
                value={form.device_type}
                onChange={(e) => setForm((f) => ({ ...f, device_type: e.target.value }))}
                placeholder="مثلاً موبایل"
              />
              <datalist id="tf-device-list">
                {[...new Set([...deviceTypes, ...DEVICE_SUGGESTIONS])].map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="label" htmlFor="tf-brand">برند (اختیاری)</label>
              <input id="tf-brand" className="input" value={form.brand} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} placeholder="مثلاً سامسونگ" />
            </div>
            <div>
              <label className="label" htmlFor="tf-title">عنوان تعرفه / ایراد</label>
              <input
                id="tf-title"
                className="input"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="مثلاً تعویض ال‌سی‌دی"
              />
            </div>
            <div>
              <label className="label" htmlFor="tf-price">اجرت</label>
              <input
                id="tf-price"
                className="input"
                inputMode="numeric"
                value={form.labor_price}
                onChange={(e) => setForm((f) => ({ ...f, labor_price: e.target.value }))}
                placeholder="مثلاً ۲۵۰۰۰۰"
              />
            </div>
            <div>
              <label className="label" htmlFor="tf-duration">مدت تقریبی (دقیقه)</label>
              <input
                id="tf-duration"
                className="input"
                inputMode="numeric"
                value={form.duration_min}
                onChange={(e) => setForm((f) => ({ ...f, duration_min: e.target.value }))}
                placeholder="مثلاً ۹۰"
              />
            </div>
            <div>
              <label className="label" htmlFor="tf-warranty">گارانتی (روز)</label>
              <input
                id="tf-warranty"
                className="input"
                inputMode="numeric"
                value={form.warranty_days}
                onChange={(e) => setForm((f) => ({ ...f, warranty_days: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="label" htmlFor="tf-notes">یادداشت (اختیاری)</label>
              <input
                id="tf-notes"
                className="input"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="مثلاً بهای قطعه جداگانه محاسبه می‌شود"
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-primary" onClick={save} disabled={busy}>
              {busy ? "در حال ذخیره…" : form.id ? "ذخیرهٔ تغییرات" : "افزودن به تعرفه"}
            </button>
            <button className="btn-ghost" onClick={() => { setOpen(false); setForm({ ...EMPTY_FORM }); }}>انصراف</button>
          </div>
        </section>
      )}

      <section className="card card-pad">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[11rem] flex-1">
            <label className="label" htmlFor="tf-q">جستجو</label>
            <input id="tf-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="عنوان، نوع دستگاه، برند…" />
          </div>
          <div className="w-40">
            <label className="label" htmlFor="tf-filter">نوع دستگاه</label>
            <Select
              id="tf-filter"
              value={deviceFilter}
              onChange={setDeviceFilter}
              placeholder="همه"
              options={deviceTypes.map((d) => ({ value: d, label: d }))}
            />
          </div>
          <button
            className={`${showInactive ? "btn-primary" : "btn-secondary"} btn-sm`}
            onClick={() => setShowInactive((v) => !v)}
            aria-pressed={showInactive}
          >
            نمایش غیرفعال‌ها
          </button>
          {canManage && (
            <button className="btn-primary btn-sm" onClick={() => { setForm({ ...EMPTY_FORM }); setOpen(true); }}>
              <Icon name="plus" size={15} /> تعرفهٔ تازه
            </button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="chip">{toFaDigits(summary.total)} تعرفه</span>
          <span className="chip">{toFaDigits(summary.active)} فعال</span>
          {Number(summary.avg_price) > 0 && <span className="chip">میانگین اجرت {fmtMoneyShort(summary.avg_price)}</span>}
          <span className="text-[11px]">مبالغ به ریال ثبت و بر اساس واحد پول تنظیمات نمایش داده می‌شوند.</span>
        </div>
      </section>

      {loading ? (
        <p className="card px-5 py-8 text-center text-sm text-zinc-400">در حال بارگذاری…</p>
      ) : failed ? (
        <div className="card">
          <EmptyState
            icon="triangle-alert"
            title="تعرفه‌ها خوانده نشد"
            body="ارتباط با سرور برقرار نشد — اتصال را بررسی کنید و دوباره تلاش کنید."
            action={<button className="btn-primary" onClick={() => void load()}>تلاش دوباره</button>}
          />
        </div>
      ) : tariffs.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="calculator"
            title="هنوز تعرفه‌ای ثبت نشده"
            body="برای هر نوع دستگاه و ایراد، اجرت و گارانتی ثابت تعیین کنید تا در پذیرش و برآورد با یک کلیک استفاده شود."
            action={canManage ? <button className="btn-primary" onClick={() => setOpen(true)}>افزودن تعرفه</button> : undefined}
          />
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(([device, list]) => (
            <section key={device} className="card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
                <h2 className="section-title">{device}</h2>
                <span className="chip">{toFaDigits(list.length)} تعرفه</span>
              </div>
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {list.map((t) => (
                  <div key={t.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-5 py-3">
                    <div className="min-w-0 flex-1 break-words">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{t.title}</span>
                        {t.brand && <span className="badge-gray">{t.brand}</span>}
                        {!t.is_active && <span className="badge-red">غیرفعال</span>}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                        <span>اجرت {fmtMoney(t.labor_price)}</span>
                        {t.warranty_days != null && <span>· گارانتی {toFaDigits(t.warranty_days)} روز</span>}
                        {t.duration_min != null && <span>· مدت {toFaDigits(t.duration_min)} دقیقه</span>}
                      </div>
                      {t.notes && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t.notes}</p>}
                    </div>
                    {canManage && (
                      <div className="flex shrink-0 flex-wrap items-center gap-1">
                        <button className="btn-secondary btn-sm" onClick={() => startEdit(t)}>ویرایش</button>
                        <button className="btn-ghost btn-sm" onClick={() => toggleActive(t)}>
                          {t.is_active ? "غیرفعال‌کردن" : "فعال‌کردن"}
                        </button>
                        <button className="btn-ghost btn-sm btn-icon" aria-label="حذف تعرفه" onClick={() => remove(t)}>
                          <Icon name="trash" size={15} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
