"use client";

import { SearchableSelect } from "@/components/searchable-select";
import {Icon} from '@/components/icon';


import { useRouter } from "next/navigation";

export type SelectOption = { value: string; label: string };

/**
 * دراپ‌دان مشترک با جستجوی فارسی، انتخاب صفحه‌کلید و کنترل بومی پشتیبان فرم.
 * هیچ وابستگی جدیدی لازم نیست.
 */
export function Select({
  value,
  onChange,
  options,
  ariaLabel,
  label,
  name,
  placeholder,
  disabled,
  size = "md",
  className = "",
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  ariaLabel?: string;
  label?: string;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
  id?: string;
}) {
  const field = (
    <span className="select-wrap">
      <SearchableSelect
        id={id}
        name={name}
        aria-label={ariaLabel ?? label}
        className={`select ${size === "sm" ? "select-sm" : ""} ${className}`}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </SearchableSelect>
    </span>
  );
  if (!label) return field;
  return (
    <label className="block">
      <span className="label">{label}</span>
      {field}
    </label>
  );
}

/**
 * دراپ‌دان جستجوپذیر غیرکنترلی برای نوار فیلتر؛ مقدار با فرم GET ارسال می‌شود.
 */
export function NativeSelect({
  name,
  defaultValue = "",
  options,
  placeholder,
  ariaLabel,
  size = "md",
  className = "",
}: {
  name: string;
  defaultValue?: string;
  options: SelectOption[];
  placeholder?: string;
  ariaLabel?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span className="select-wrap">
      <SearchableSelect
        name={name}
        aria-label={ariaLabel}
        defaultValue={defaultValue}
        className={`select ${size === "sm" ? "select-sm" : ""} ${className}`}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </SearchableSelect>
    </span>
  );
}

/** انتخابگر شعبه در نوار بالا — فقط برای مدیران قابل تغییر است */
export function BranchSelect({ branches, value, onChange,pending=false }: { branches: Array<{ id: number; name: string }>; value: string; onChange: (v: string) => void;pending?:boolean }) {
  return (
    <SearchableSelect
      aria-label="انتخاب شعبه"
      aria-busy={pending}
      disabled={pending}
      triggerCaption={pending?'در حال تغییر شعبه…':value==='all'?'نمای یکپارچهٔ شرکت':'شعبهٔ فعال'}
      triggerAdornment={<span className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-100 text-brand-600 min-[375px]:flex dark:bg-brand-900/50 dark:text-brand-300"><Icon name={pending?'refresh':'branch'} size={15} className={pending?'animate-spin':''}/></span>}
      className="search-select-trigger h-10 w-[6.5rem] gap-1.5 rounded-xl border border-brand-200 bg-brand-50/60 px-2 text-xs font-semibold text-brand-800 shadow-sm transition hover:border-brand-400 hover:bg-brand-100/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-wait disabled:opacity-70 min-[375px]:w-[8.5rem] sm:w-44 dark:border-brand-800 dark:bg-brand-950/30 dark:text-brand-200 dark:hover:border-brand-600 dark:hover:bg-brand-900/40"
      value={value}
      onChange={e=>onChange(e.target.value)}
    ><option value="all">همه شعب</option>{branches.map(b=><option key={b.id} value={String(b.id)}>{b.name}</option>)}</SearchableSelect>
  );
}

/**
 * نوار فیلتر مشترک همهٔ فهرست‌ها.
 * بدون جاوااسکریپت هم کار می‌کند: یک فرم GET که پارامترها را در نشانی می‌نویسد؛
 * تغییر هر select خودکار فرم را ارسال می‌کند و متن‌ها با دکمهٔ «اعمال».
 */
export function FilterForm({
  action,
  children,
  className = "",
}: {
  action: string;
  children: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  return (
    <form
      action={action}
      method="get"
      className={`filter-bar ${className}`}
      onChange={(e) => {
        const el = e.target as HTMLElement;
        if (el.tagName === "SELECT") e.currentTarget.requestSubmit();
        else if (el.getAttribute("type") === "date" || el.getAttribute("type") === "month") e.currentTarget.requestSubmit();
      }}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const params = new URLSearchParams();
        for (const [k, v] of fd.entries()) {
          const s = String(v).trim();
          if (s) params.set(k, s);
        }
        const qs = params.toString();
        router.push(qs ? `${action}?${qs}` : action);
      }}
    >
      {children}
      <div className="flex items-end gap-1.5 pb-0.5">
        <button type="submit" className="btn-secondary btn-sm">
          اعمال
        </button>
        <a href={action} className="btn-ghost btn-sm" title="پاک‌کردن فیلترها">
          پاک‌کردن
        </a>
      </div>
    </form>
  );
}

/** یک فیلد فیلتر با برچسب کوچک — برای استفاده داخل FilterForm */
export function FilterField({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`filter-field ${className}`}>
      <span className="filter-label">{label}</span>
      {children}
    </label>
  );
}
