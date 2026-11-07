"use client";

import { useMemo } from "react";
import { toFaDigits } from "@/lib/format";
import { MOODS, moodByValue } from "@/lib/daily-report-shared";
import { J_MONTHS } from "@/lib/jdate";

export type DayCell = {
  iso: string;
  jd: number;
  weekday: number;
  inMonth: boolean;
  isToday: boolean;
  isFuture: boolean;
  /** وضعیت گزارش: submitted | draft | missing | none */
  state: "submitted" | "draft" | "missing" | "none";
  mood: number | null;
  minutes: number;
  tickets: number;
};

const WEEKDAYS = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

/** نوار رنگیِ روز بر اساس نسبت زمان کار به یک روز کامل (۸ ساعت) */
function DayBar({ minutes, tickets }: { minutes: number; tickets: number }) {
  const pct = Math.max(6, Math.min(100, (minutes / 480) * 100));
  const hue = minutes === 0 ? (tickets > 0 ? "#f59e0b" : "#e4e4e7") : minutes >= 480 ? "#10b981" : "#38bdf8";
  return (
    <div className="mt-1.5 h-1.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, background: hue }}
      />
    </div>
  );
}

export function ReportCalendar({
  jy,
  jm,
  monthLen,
  firstWeekday,
  days,
  selected,
  onSelect,
}: {
  jy: number;
  jm: number;
  monthLen: number;
  firstWeekday: number;
  days: DayCell[];
  selected: string | null;
  onSelect: (iso: string) => void;
}) {
  const byIso = useMemo(() => new Map(days.map((d) => [d.iso, d])), [days]);

  const cells: Array<{ iso: string; jd: number } | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...days,
  ];
  // ردیف‌های کامل هفته تا ارتفاع تقویم یکنواخت بماند
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="card min-w-0 p-3 sm:p-4">
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5 mb-2 text-center text-[11px] sm:text-xs font-semibold text-zinc-400">
        {WEEKDAYS.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {cells.map((c, i) => {
          if (!c) return <div key={`e${i}`} className="min-h-[44px] sm:min-h-[58px]" />;
          const d = byIso.get(c.iso);
          const isSel = selected === c.iso;
          const mood = d?.mood ? moodByValue(d.mood) : null;

          return (
            <button
              key={c.iso}
              onClick={() => onSelect(c.iso)}
              aria-label={`${toFaDigits(c.jd)} ${J_MONTHS[jm-1]} ${toFaDigits(jy)}`}
              aria-pressed={isSel}
              aria-current={d?.isToday ? "date" : undefined}
              title={`${toFaDigits(c.jd)} — ${d?.state === "submitted" ? "ثبت شده" : d?.state === "draft" ? "پیش‌نویس" : d?.isFuture ? "آینده" : "ثبت نشده"}${d?.tickets ? ` · ${toFaDigits(d.tickets)} دستگاه` : ""}${d?.minutes ? ` · ${toFaDigits(Math.round(d.minutes / 60 * 10) / 10)} ساعت` : ""}`}
              className={`relative min-w-0 min-h-[44px] sm:min-h-[58px] overflow-hidden rounded-lg border p-1 sm:p-1.5 text-right align-top transition
                focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500
                ${isSel
                  ? "border-brand-500 ring-2 ring-brand-400 bg-brand-50/60 dark:bg-brand-500/10"
                  : "border-zinc-200 dark:border-zinc-800 hover:border-brand-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"}
                ${d?.isFuture ? "opacity-40" : ""}`}
            >
              {/* شمارهٔ روز */}
              <div className="flex items-center justify-between gap-0.5">
                <span className={`text-xs sm:text-[13px] ${d?.isToday ? "font-bold text-brand-600" : "text-zinc-500"}`}>
                  {toFaDigits(c.jd)}
                </span>
                {d?.isToday && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" title="امروز" />
                )}
              </div>

              {/* چهرهٔ حال‌وهوا */}
              {mood && (
                <div className="text-[13px] sm:text-base leading-none mt-0.5" aria-hidden>
                  {mood.emoji}
                </div>
              )}

              {/* نوار فعالیت */}
              <DayBar minutes={d?.minutes ?? 0} tickets={d?.tickets ?? 0} />

              {/* نشان وضعیت */}
              <div className="flex items-center gap-1 mt-1">
                {d?.state === "submitted" && (
                  <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-emerald-500" title="ثبت شده" />
                )}
                {d?.state === "draft" && (
                  <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-amber-500" title="پیش‌نویس" />
                )}
                {d?.state === "missing" && (
                  <span className="w-1.5 h-1.5 shrink-0 rounded-full border border-dashed border-red-400" title="ثبت نشده" />
                )}
                {(d?.tickets ?? 0) > 0 && (
                  <span className="mr-auto hidden text-[11px] tabular-nums text-zinc-400 2xl:inline">
                    {toFaDigits(d!.tickets)}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* راهنما */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-800 text-[11px] sm:text-xs text-zinc-500">
        <span className="flex items-center gap-1">
          <i className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> ثبت‌شده
        </span>
        <span className="flex items-center gap-1">
          <i className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> پیش‌نویس
        </span>
        <span className="flex items-center gap-1">
          <i className="w-2 h-2 rounded-full border border-dashed border-red-400 inline-block" /> ثبت‌نشده
        </span>
        <span className="flex items-center gap-1">
          <i className="w-6 h-1.5 rounded-full bg-sky-400 inline-block" /> میزان کار روز
        </span>
      </div>
    </div>
  );
}

export function MoodPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="grid grid-cols-5 gap-1 sm:gap-2">
      {MOODS.map((m) => (
        <button
          key={m.value}
          type="button"
          onClick={() => onChange(m.value)}
          aria-pressed={value === m.value}
          className={`flex flex-col items-center justify-center gap-0.5 rounded-xl border px-1 sm:px-3 py-1.5 sm:py-2 transition min-w-0
            focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500
            ${value === m.value
              ? `border-brand-500 ring-2 ${m.ring} bg-brand-50/60 dark:bg-brand-500/10`
              : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300"}`}
        >
          <span className="text-base sm:text-xl leading-none">{m.emoji}</span>
          <span className="text-[10px] sm:text-xs text-zinc-500 truncate w-full text-center leading-tight">
            {m.label}
          </span>
        </button>
      ))}
    </div>
  );
}
