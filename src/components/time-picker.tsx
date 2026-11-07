"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toFaDigits } from "@/lib/format";

/**
 * انتخابگر ساعت — هم‌خانوادهٔ تقویم جلالی و دقیقاً با همان زبان بصری
 * (کارت سفید/تاریک، گردی گوشه‌دار، سلول‌های رنگی، فوتر «امروز/پاک کردن»)
 * تا با هر دو تم سایت هماهنگ باشد. مقدار ذخیره‌شده «HH:MM» است.
 */

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
const pad = (n: number) => String(n).padStart(2, "0");

function parse(v: string): { h: number; m: number } | null {
  const m = String(v ?? "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Math.min(23, Number(m[1]));
  const mi = Math.min(59, Number(m[2]));
  if (Number.isNaN(h) || Number.isNaN(mi)) return null;
  return { h, m: mi };
}

export function TimePicker({
  value,
  onChange,
  id,
  placeholder = "انتخاب ساعت…",
  clearable,
  step = 5,
}: {
  value: string; // "HH:MM"
  onChange: (hhmm: string) => void;
  id?: string;
  placeholder?: string;
  clearable?: boolean;
  step?: number;
}) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const parsed = parse(value);
  const [view, setView] = useState(() => ({ h: parsed?.h ?? 8, m: parsed?.m ?? 0 }));

  const minutes = useMemo(() => {
    const s = step > 0 ? step : 5;
    const out: number[] = [];
    for (let m = 0; m < 60; m += s) out.push(m);
    return out;
  }, [step]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open && parsed) setView({ h: parsed.h, m: parsed.m });
  }, [open, value]); // eslint-disable-line react-hooks/exhaustive-deps

  const cell = (active: boolean) =>
    `rounded-lg text-[13px] py-1.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
      active
        ? "bg-brand-600 text-white font-bold shadow-sm"
        : "hover:bg-brand-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200"
    }`;

  // اگر جا نبود، منو به بالا باز شود تا از کادر صفحه بیرون نزند
  const toggle = () => {
    if (!open && ref.current) {
      const r = ref.current.getBoundingClientRect();
      setDropUp(window.innerHeight - r.bottom < 320 && r.top > 320);
    }
    setOpen((o) => !o);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        id={id}
        onClick={toggle}
        className="input w-full text-right flex items-center justify-between gap-2"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className={parsed ? "" : "text-zinc-400"} dir="ltr">
          {parsed ? `${toFaDigits(pad(parsed.h))}:${toFaDigits(pad(parsed.m))}` : placeholder}
        </span>
        <span aria-hidden className="text-zinc-400 text-xs">🕐</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="انتخاب ساعت"
          className={`absolute z-40 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl p-3 w-[19rem] max-w-[calc(100vw-2rem)] ${
            dropUp ? "bottom-full mb-1" : "top-full mt-1"
          }`}
        >
          {/* سربرگ — ساعت و دقیقه */}
          <div className="flex items-center justify-between mb-2 gap-2">
            <span className="text-sm font-semibold tabular-nums" dir="ltr">
              {toFaDigits(pad(view.h))}:{toFaDigits(pad(view.m))}
            </span>
            <span className="text-xs text-zinc-400">ساعت و دقیقه را انتخاب کنید</span>
          </div>

          {/* ساعت */}
          <div className="mb-2">
            <div className="text-xs text-zinc-500 mb-1">ساعت</div>
            <div className="grid grid-cols-8 gap-0.5">
              {HOURS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setView((v) => ({ ...v, h }))}
                  className={`${cell(view.h === h)} aspect-square`}
                >
                  {toFaDigits(pad(h))}
                </button>
              ))}
            </div>
          </div>

          {/* دقیقه */}
          <div className="mb-1">
            <div className="text-xs text-zinc-500 mb-1">دقیقه</div>
            <div className="grid grid-cols-6 gap-0.5">
              {minutes.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setView((v) => ({ ...v, m }))}
                  className={`${cell(view.m === m)} py-1.5`}
                >
                  {toFaDigits(pad(m))}
                </button>
              ))}
            </div>
          </div>

          {/* فوتر — هم‌سبک با تقویم جلالی */}
          <div className="flex justify-between items-center mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <button
              type="button"
              className="text-xs text-brand-600 hover:underline"
              onClick={() => {
                onChange(`${pad(view.h)}:${pad(view.m)}`);
                setOpen(false);
              }}
            >
              تأیید
            </button>
            {clearable || parsed ? (
              <button
                type="button"
                className="text-xs text-red-500 hover:underline"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                پاک کردن
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}