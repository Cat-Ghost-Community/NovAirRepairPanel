"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui";
import { Icon } from "@/components/icon";
import { toFaDigits } from "@/lib/format";

const FLAGS: Array<{ key: string; label: string; desc: string }> = [
  {
    key: "hide.prices",
    label: "مخفی‌کردن قیمت قطعات و اجرت‌ها از تعمیرکاران",
    desc: "تعمیرکار هنگام ثبت قطعه و خدمت، قیمت‌ها را نمی‌بیند — فقط نام و تعداد.",
  },
  {
    key: "repairs.only_assigned",
    label: "تعمیرکار فقط پذیرش‌های دست خودش را ببیند",
    desc: "مربوط به گردش کار فعلی است؛ در مسیر مدیریتی و صف آزاد، محدودیت کار روی دستگاه ارجاع‌نشده مستقل از این گزینه اعمال می‌شود.",
  },
  {
    key: "hide.costs",
    label: "مخفی‌کردن بهای تمام‌شده و حاشیه سود از غیرمدیران",
    desc: "ستون هزینه و حاشیه سود فقط برای مدیر و حسابدار نمایش داده می‌شود.",
  },
];

/** سوییچ‌های محدودیت نمایشی — به‌روزرسانی خوش‌بینانه و بازگشت خودکار در خطا */
export function AccessFlagsSection() {
  const toast = useToast();
  const [state, setState] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const load = () =>
    fetch("/api/settings/flags")
      .then((r) => r.json())
      .then((d) => {
        setState(d.flags ?? {});
        setFailed(false);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoaded(true));
  useEffect(() => {
    void load();
  }, []);

  const toggle = async (key: string) => {
    const next = !state[key];
    setState((s) => ({ ...s, [key]: next }));
    setSaving(key);
    try {
      const res = await fetch("/api/settings/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flag: key, value: next }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) throw new Error(d.error ?? "خطا در ذخیره.");
      toast(next ? "محدودیت فعال شد" : "محدودیت خاموش شد");
    } catch (e) {
      setState((s) => ({ ...s, [key]: !next }));
      toast(e instanceof Error ? e.message : "خطا در ذخیره", "error");
    } finally {
      setSaving(null);
    }
  };

  const activeCount = FLAGS.filter((f) => state[f.key]).length;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3 sm:px-5 dark:border-zinc-800/70">
        <span className={activeCount > 0 ? "badge-amber" : "badge-gray"}>
          {activeCount > 0 ? `${toFaDigits(activeCount)} محدودیت فعال` : "بدون محدودیت فعال"}
        </span>
      </div>

      {!loaded ? (
        <p className="px-5 py-8 text-center text-sm text-zinc-400">در حال بارگذاری…</p>
      ) : failed ? (
        <div className="px-5 py-6 text-center">
          <p className="text-sm text-red-600 dark:text-red-400">تنظیمات دسترسی خوانده نشد.</p>
          <button className="btn-secondary btn-sm mt-2" onClick={() => void load()}>تلاش دوباره</button>
        </div>
      ) : (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {FLAGS.map((f) => {
            const on = !!state[f.key];
            return (
              <div key={f.key} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{f.label}</span>
                    {on && <span className="badge-amber">فعال</span>}
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{f.desc}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={f.label}
                  disabled={saving === f.key}
                  onClick={() => void toggle(f.key)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-60 ${
                    on ? "bg-brand-600" : "bg-zinc-300 dark:bg-zinc-700"
                  }`}
                >
                  <span className={`absolute h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "end-0.5" : "start-0.5"}`} aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <p className="border-t border-zinc-100 px-5 py-3 text-xs text-zinc-500 dark:border-zinc-800/60 dark:text-zinc-400">
        <Icon name="shield" size={13} className="me-1 inline align-middle" />
        این محدودیت‌ها فقط نمایش را تغییر می‌دهند؛ مجوزهای دسترسی را از بخش «کارکنان» تنظیم کنید.
      </p>
    </div>
  );
}
