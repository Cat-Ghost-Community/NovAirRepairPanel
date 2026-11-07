"use client";

import { SearchableSelect } from "@/components/searchable-select";


import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui";
import { parseMoneyInput, moneyDisplayValue, toEnDigits } from "@/lib/format";

type FieldType = "text" | "number" | "money" | "percent" | "checkbox" | "currency" | "url";
type Field = { key: string; label: string; type: FieldType; hint?: string; placeholder?: string };
type Group = { id: string; title: string; desc: string; fields: Field[] };

/** گروه‌های تنظیمات — هر گروه یک بلوک قابل‌پیداکردن در ناوبری است */
const GROUPS: Group[] = [
  {
    id: "identity",
    title: "نمایه کسب‌وکار",
    desc: "نام و واحدی که در سربرگ فاکتور، برآورد و پیامک مشتری دیده می‌شود.",
    fields: [
      { key: "business_name", label: "نام کسب‌وکار", type: "text", placeholder: "مثلاً موبایل پارس" },
      { key: "currency_unit", label: "واحد پول نمایش", type: "currency", hint: "داده‌ها همیشه به ریال ذخیره می‌شوند؛ این تنظیم فقط نحوهٔ نمایش را عوض می‌کند." },
    ],
  },
  {
    id: "tax",
    title: "مالیات و عوارض",
    desc: "مبنای محاسبهٔ مالیات روی برآورد، فاکتور فروش و سفارش خرید.",
    fields: [
      { key: "vat_enabled", label: "ارزش افزوده روی اسناد محاسبه شود", type: "checkbox" },
      { key: "tax_rate", label: "نرخ ارزش افزوده (٪)", type: "percent", hint: "نرخ رایج ۹ یا ۱۰ درصد است." },
      { key: "duty_rate", label: "عوارض شهرداری (٪)", type: "percent" },
    ],
  },
  {
    id: "numbering",
    title: "شماره‌گذاری اسناد",
    desc: "پیشوند شماره‌ها؛ شماره به‌صورت خودکار و پیوسته ساخته می‌شود.",
    fields: [
      { key: "ticket_prefix", label: "پیشوند شماره پذیرش", type: "text", placeholder: "RP-" },
      { key: "invoice_prefix", label: "پیشوند شماره فاکتور", type: "text", placeholder: "INV-" },
    ],
  },
  {
    id: "defaults",
    title: "پیش‌فرض‌های کار روزمره",
    desc: "مقادیری که هنگام ثبت پذیرش و مشتری جدید خودکار پیشنهاد می‌شوند.",
    fields: [
      { key: "diagnostic_fee", label: "هزینهٔ عیب‌یابی پیش‌فرض", type: "money", hint: "اگر عیب‌یابی رایگان است، صفر بگذارید." },
      { key: "default_credit_limit", label: "سقف اعتبار پیش‌فرض مشتری", type: "money", hint: "صفر یعنی بدون محدودیت." },
      { key: "round_to", label: "رند کردن خودکار مبالغ به مضرب", type: "number", hint: "صفر = خاموش. مثلاً ۱۰۰۰ برای رند به هزار ریال." },
    ],
  },
  {
    id: "portal",
    title: "پیگیری و پورتال مشتری",
    desc: "نشانی‌هایی که در پیامک و صفحهٔ پیگیری مشتری استفاده می‌شوند.",
    fields: [
      { key: "public_base_url", label: "آدرس پایهٔ عمومی", type: "url", placeholder: "https://example.com", hint: "برای ساختن لینک پیگیری و صفحهٔ برآورد مشتری استفاده می‌شود." },
      {
        key: "postal_api_url",
        label: "وب‌سرویس رهگیری پست (اختیاری)",
        type: "url",
        placeholder: "https://api.example.com/track/{code}",
        hint: "آدرس سرویس JSON که وضعیت مرسوله را برمی‌گرداند. توکن {code} با کد رهگیری جایگزین می‌شود؛ خالی بگذارید تا سرویس پیش‌فرض پست ایران استفاده شود.",
      },
    ],
  },
];

const MONEY_KEYS = GROUPS.flatMap((g) => g.fields.filter((f) => f.type === "money").map((f) => f.key));
const PERCENT_KEYS = GROUPS.flatMap((g) => g.fields.filter((f) => f.type === "percent").map((f) => f.key));
const num = (v: unknown) => Number(toEnDigits(String(v ?? "")).replace(/[^\d.-]/g, "")) || 0;

export function SettingsForm({ values }: { values: Record<string, string> }) {
  const toast = useToast();
  const router = useRouter();
  // مقادیر پولی در دیتابیس ریال‌اند و در فرم بر پایهٔ واحد پول فعال نمایش داده می‌شوند
  const initial = useMemo(() => {
    const out: Record<string, string> = { currency_unit: "toman", ...values };
    for (const key of MONEY_KEYS) out[key] = moneyDisplayValue(Number(values[key] ?? 0));
    return out;
  }, [values]);
  const [form, setForm] = useState<Record<string, string>>(initial);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // پس از ذخیره و تازه‌سازی سرور، فرم با مقادیر ذخیره‌شده هم‌گام می‌شود
  useEffect(() => {
    setForm(initial);
  }, [initial]);

  const dirty = useMemo(() => Object.keys(initial).some((k) => (form[k] ?? "") !== (initial[k] ?? "")), [form, initial]);

  const errors = useMemo(() => {
    const out: Record<string, string> = {};
    if (!String(form.business_name ?? "").trim()) out.business_name = "نام کسب‌وکار نمی‌تواند خالی باشد.";
    for (const key of PERCENT_KEYS) {
      const raw = String(form[key] ?? "").trim();
      if (raw === "") continue;
      const n = num(raw);
      if (n < 0 || n > 100) out[key] = "عددی بین ۰ تا ۱۰۰ وارد کنید.";
    }
    return out;
  }, [form]);
  const hasError = Object.keys(errors).length > 0;

  const save = async () => {
    if (hasError) {
      toast("چند فیلد نیاز به اصلاح دارد.", "error");
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, string> = { ...form };
      // ورودی پولی بر پایهٔ واحد نمایش است؛ برای ذخیره به ریال تبدیل می‌شود
      for (const key of MONEY_KEYS) payload[key] = String(parseMoneyInput(String(form[key]||'0'),undefined,true));
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error ?? "ذخیره ناموفق بود.");
      toast("تنظیمات ذخیره شد");
      setSavedAt(new Date().toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" }));
      router.refresh();
    } catch (e: any) {
      toast(e.message ?? "ذخیره ناموفق بود", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
        {GROUPS.map((group) => (
          <div key={group.id} className="px-5 py-4">
            <h3 className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-200">{group.title}</h3>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{group.desc}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {group.fields.map((field) => {
                const id = `set-${field.key}`;
                const error = errors[field.key];
                const hintId = field.hint ? `${id}-hint` : undefined;
                const errId = error ? `${id}-err` : undefined;
                const described = [hintId, errId].filter(Boolean).join(" ") || undefined;
                return (
                  <div key={field.key} className={field.key === "postal_api_url" ? "sm:col-span-2" : undefined}>
                    {field.type === "checkbox" ? (
                      <label className="flex min-h-9 cursor-pointer items-center gap-2 py-2 text-[13px]" htmlFor={id}>
                        <input
                          id={id}
                          type="checkbox"
                          className="h-4 w-4 accent-brand-600"
                          checked={form[field.key] !== "0"}
                          onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.checked ? "1" : "0" }))}
                        />
                        {field.label}
                      </label>
                    ) : (
                      <>
                        <label className="label" htmlFor={id}>{field.label}</label>
                        {field.type === "currency" ? (
                          <SearchableSelect
                            id={id}
                            className="input"
                            value={form[field.key] ?? "toman"}
                            aria-describedby={described}
                            onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
                          >
                            <option value="toman">تومان</option>
                            <option value="rial">ریال</option>
                          </SearchableSelect>
                        ) : (
                          <input
                            id={id}
                            className={`input ${error ? "border-red-400 focus:border-red-500 focus:ring-red-500/20" : ""}`}
                            type={field.type === "text" ? "text" : field.type === "url" ? "url" : "text"}
                            inputMode={field.type === "money" || field.type === "percent" || field.type === "number" ? "numeric" : undefined}
                            dir={field.type === "money" || field.type === "percent" || field.type === "number" || field.type === "url" ? "ltr" : undefined}
                            placeholder={field.placeholder}
                            aria-invalid={error ? true : undefined}
                            aria-describedby={described}
                            value={form[field.key] ?? ""}
                            onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
                          />
                        )}
                      </>
                    )}
                    {error ? (
                      <p id={errId} className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
                    ) : (
                      field.hint && <p id={hintId} className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{field.hint}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-5 dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="flex flex-wrap items-center gap-2">
          {dirty ? <span className="badge-amber">تغییرات ذخیره‌نشده</span> : <span className="badge-green">به‌روز</span>}
          {savedAt && !dirty && <span className="text-xs text-zinc-400">آخرین ذخیره: {savedAt}</span>}
          <span className="text-xs text-zinc-500 dark:text-zinc-400">مبالغ به ریال ذخیره و بر پایهٔ واحد پول نمایش داده می‌شوند.</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary btn-sm" onClick={() => setForm(initial)} disabled={!dirty || busy}>
            بازگردانی
          </button>
          <button className="btn-primary btn-sm" onClick={save} disabled={busy || hasError || !dirty}>
            {busy ? "در حال ذخیره…" : "ذخیره تنظیمات"}
          </button>
        </div>
      </div>
    </>
  );
}
