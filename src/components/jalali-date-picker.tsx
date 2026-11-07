"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toJalaali, toGregorian, jalaaliMonthLength, jWeekdayIndexOfMonthStart, todayJ, todayISODate, J_MONTHS } from "@/lib/jdate";
import { toFaDigits } from "@/lib/format";

const WEEKDAYS = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

/** نرمال‌سازی مقدار ورودی: فقط بخش تاریخ ISO (۱۲ کاراکتر اول yyyy-mm-dd) — ساعت و datetime را می‌ریزد */
function toISODate(v: string): string {
  if (!v) return "";
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

/** تقویم جلالی کلیک‌پذیر — مقدار ذخیره‌شده ISO (yyyy-mm-dd میلادی) است */
export function JalaliDatePicker({
  value,
  onChange,
  id,
  placeholder = "انتخاب تاریخ…",
  clearable,
}: {
  value: string; // ISO
  onChange: (iso: string) => void;
  id?: string;
  placeholder?: string;
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isoValue = toISODate(value);
  const [view, setView] = useState(() => {
    if (isoValue) {
      const [gy, gm, gd] = isoValue.split("-").map(Number);
      return toJalaali(gy, gm, gd);
    }
    return todayJ();
  });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [open]);

  const days = useMemo(() => {
    const len = jalaaliMonthLength(view.jy, view.jm);
    const startIdx = jWeekdayIndexOfMonthStart(view.jy, view.jm);
    const cells: Array<{ jd: number } | null> = Array(startIdx).fill(null);
    for (let d = 1; d <= len; d++) cells.push({ jd: d });
    return cells;
  }, [view]);

  const today = todayJ();
  const todayIso = todayISODate();

  const pick = (jd: number) => {
    const g = toGregorian(view.jy, view.jm, jd);
    const iso = `${g.gy}-${String(g.gm).padStart(2, "0")}-${String(g.gd).padStart(2, "0")}`;
    onChange(iso === value ? "" : iso); // کلیک دوباره = پاک کردن
  };

  const moveMonth = (delta: number) => {
    setView((v) => {
      let jm = v.jm + delta;
      let jy = v.jy;
      if (jm > 12) { jm = 1; jy++; }
      if (jm < 1) { jm = 12; jy--; }
      return { jy, jm, jd: 1 };
    });
  };

  // نمایش مقدار انتخاب‌شده به شمسی
  const display = isoValue
    ? (() => {
        const [gy, gm, gd] = isoValue.split("-").map(Number);
        const j = toJalaali(gy, gm, gd);
        return `${toFaDigits(String(j.jy))}/${toFaDigits(String(j.jm).padStart(2, "۰"))}/${toFaDigits(String(j.jd).padStart(2, "۰"))}`;
      })()
    : "";

  return (
    <div className="relative" ref={ref}>
      <button type="button" id={id} onClick={() => setOpen((o) => !o)} className="input w-full text-right flex items-center justify-between">
        <span className={display ? "" : "text-zinc-400"}>{display || placeholder}</span>
        <span aria-hidden className="text-zinc-400"></span>
      </button>
      {open && (
        <div className="absolute z-40 mt-1 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl p-3 w-72">
          <div className="flex items-center justify-between mb-2">
            <button type="button" className="btn-secondary btn-sm px-2" onClick={() => moveMonth(1)} aria-label="ماه بعد">›</button>
            <div className="text-sm font-semibold">{J_MONTHS[view.jm - 1]} {toFaDigits(String(view.jy))}</div>
            <button type="button" className="btn-secondary btn-sm px-2" onClick={() => moveMonth(-1)} aria-label="ماه قبل">‹</button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-xs text-zinc-400 mb-1">
            {WEEKDAYS.map((w) => <div key={w}>{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {days.map((c, i) =>
              c === null ? (
                <div key={`x${i}`} />
              ) : (
                <button
                  key={c.jd}
                  type="button"
                  onClick={() => pick(c.jd)}
                  className={`h-8 rounded-lg text-[13px] transition ${
                    isoValue && (() => {
                      const [gy, gm, gd] = isoValue.split("-").map(Number);
                      const j = toJalaali(gy, gm, gd);
                      return j.jy === view.jy && j.jm === view.jm && j.jd === c.jd;
                    })()
                      ? "bg-brand-600 text-white font-bold"
                      : `${todayIso === value && false ? "" : ""} hover:bg-brand-50 dark:hover:bg-zinc-800 ${today.jy === view.jy && today.jm === view.jm && today.jd === c.jd ? "border border-brand-400 text-brand-600 font-bold" : ""}`
                  }`}
                >
                  {toFaDigits(String(c.jd))}
                </button>
              )
            )}
          </div>
          <div className="flex justify-between mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <button type="button" className="text-xs text-brand-600 hover:underline" onClick={() => { onChange(todayIso); setOpen(false); }}>امروز</button>
            {(clearable || isoValue) && <button type="button" className="text-xs text-red-500 hover:underline" onClick={() => { onChange(""); setOpen(false); }}>پاک کردن</button>}
          </div>
        </div>
      )}
    </div>
  );
}
