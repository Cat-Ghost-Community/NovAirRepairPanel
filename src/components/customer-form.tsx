"use client";

import { SearchableSelect } from "@/components/searchable-select";


import { useState } from "react";
import { toEnDigits } from "@/lib/format";
import { CUSTOMER_TYPES, CUSTOMER_TYPE_FA } from "@/lib/customer-type";

const REFERRAL_SOURCES = ["حضوری", "معرف", "اینستاگرام", "تلگرام", "تبلیغات محیطی", "جستجوی گوگل", "سایت", "تلفن زرد", "مشتری قبلی", "سایر"];

/** اعتبارسنجی کد ملی ایران */
export function isValidNationalId(input: string): boolean {
  const code = toEnDigits(input).trim();
  if (!/^\d{10}$/.test(code)) return false;
  if (/^(\d)\1{9}$/.test(code)) return false;
  const check = Number(code[9]);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(code[i]) * (10 - i);
  const rem = sum % 11;
  return rem < 2 ? check === rem : check === 11 - rem;
}

export const EMPTY_CUSTOMER_FORM = {
  first_name: "", last_name: "", mobile: "", email: "", company: "", address: "", city: "تهران",
  notes: "", national_id: "", job: "", referral_source: "حضوری", nickname: "", postal_code: "",
  customer_type: "new", organization_name: "",
};

/**
 * فرم کامل مشتری — مشترک بین «مشتری جدید» و مرحله اول پذیرش.
 * حالت inline (پذیرش): بدون دکمه ذخیره مستقل؛ فرم پذیرش خودش داده‌ها را همراه پذیرش ثبت می‌کند.
 * حالت page (صفحه مشتری جدید): دکمه ذخیره + تشخیص تکراری + ریدایرکت.
 */
export function CustomerForm({
  form,
  onChange,
  mode = "page",
}: {
  form: any;
  onChange: (form: any) => void;
  mode?: "page" | "inline";
}) {
  const [nidTouched, setNidTouched] = useState(false);

  const nid = toEnDigits(form.national_id ?? "").trim();
  const nidValid = nid === "" || isValidNationalId(nid);
  const showNidError = nidTouched && !nidValid;

  const set = (patch: any) => onChange({ ...form, ...patch });

  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <div><label className="label" htmlFor="fn">نام *</label><input id="fn" className="input" value={form.first_name} onChange={(e) => set({ first_name: e.target.value })} /></div>
      <div><label className="label" htmlFor="ln">نام خانوادگی</label><input id="ln" className="input" value={form.last_name} onChange={(e) => set({ last_name: e.target.value })} /></div>
      <div><label className="label" htmlFor="mob">موبایل *</label><input id="mob" className="input" dir="ltr" placeholder="۰۹۱۲۳۴۵۶۷۸۹" value={form.mobile} onChange={(e) => set({ mobile: e.target.value })} /></div>
      <div>
        <label className="label" htmlFor="nid">کد ملی</label>
        <input
          id="nid" className={`input ${showNidError ? "!border-red-500" : nid && nidValid ? "!border-emerald-500" : ""}`} dir="ltr" maxLength={10}
          value={form.national_id}
          onChange={(e) => set({ national_id: toEnDigits(e.target.value).replace(/\D/g, "").slice(0, 10) })}
          onBlur={() => setNidTouched(true)}
        />
        {showNidError && <p className="text-xs text-red-600 mt-1">کد ملی ۱۰ رقمی معتبر نیست</p>}
        {nid !== "" && nidValid && <p className="text-xs text-emerald-600 mt-1">معتبر</p>}
      </div>
      <div><label className="label" htmlFor="nick">نام مستعار (صدا زدن سریع)</label><input id="nick" className="input" placeholder="مثلاً آقای رضایی" value={form.nickname} onChange={(e) => set({ nickname: e.target.value })} /></div>
      <div><label className="label" htmlFor="job">شغل</label><input id="job" className="input" value={form.job} onChange={(e) => set({ job: e.target.value })} /></div>
      <div>
        <label className="label" htmlFor="src">طریقه آشنایی</label>
        <SearchableSelect id="src" className="input" value={form.referral_source} onChange={(e) => set({ referral_source: e.target.value })}>
          {REFERRAL_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </SearchableSelect>
      </div>
      <div><label className="label" htmlFor="em">ایمیل</label><input id="em" type="email" dir="ltr" className="input" value={form.email} onChange={(e) => set({ email: e.target.value })} /></div>
      <div><label className="label" htmlFor="co">شرکت (اختیاری)</label><input id="co" className="input" value={form.company} onChange={(e) => set({ company: e.target.value })} /></div>
      <div><label className="label" htmlFor="city">شهر</label><input id="city" className="input" value={form.city} onChange={(e) => set({ city: e.target.value })} /></div>
      <div>
        <label className="label" htmlFor="postal">کد پستی</label>
        <input id="postal" className="input" dir="ltr" maxLength={10} inputMode="numeric"
          value={form.postal_code} onChange={(e) => set({ postal_code: toEnDigits(e.target.value).replace(/\D/g, "").slice(0, 10) })} />
      </div>
      <div className="sm:col-span-2 rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-2.5">
        <label className="label !mb-0" htmlFor="ctype">نوع مشتری</label>
        <p className="text-xs text-zinc-500 mt-0.5 mb-2">مشتری تازه‌کار است، قدیمی، همکار تعمیرگاه، یا از طرف شرکت/سازمان؟</p>
        <div id="ctype" className="flex flex-wrap gap-1.5">
          {CUSTOMER_TYPES.map((t) => (
            <button
              key={t} type="button"
              onClick={() => set({ customer_type: t })}
              className={`rounded-full px-3 py-1.5 text-[13px] font-medium border transition-colors ${
                form.customer_type === t
                  ? "bg-brand-600 text-white border-brand-600"
                  : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-brand-400"
              }`}
            >
              {CUSTOMER_TYPE_FA[t]}
            </button>
          ))}
        </div>
      </div>
      {form.customer_type === "organization" && (
        <div className="sm:col-span-2"><label className="label" htmlFor="org">نام شرکت / سازمان *</label><input id="org" className="input" value={form.organization_name} onChange={(e) => set({ organization_name: e.target.value })} /></div>
      )}
      <div className="sm:col-span-2"><label className="label" htmlFor="addr">نشانی</label><input id="addr" className="input" value={form.address} onChange={(e) => set({ address: e.target.value })} /></div>
      <div className="sm:col-span-2"><label className="label" htmlFor="notes">یادداشت‌ها</label><textarea id="notes" className="input min-h-16" value={form.notes} onChange={(e) => set({ notes: e.target.value })} /></div>
      {mode === "inline" && nid !== "" && !nidValid && (
        <p className="sm:col-span-2 text-xs text-amber-600">کد ملی نامعتبر است — می‌توانید ادامه دهید یا فیلد را خالی کنید.</p>
      )}
    </div>
  );
}
