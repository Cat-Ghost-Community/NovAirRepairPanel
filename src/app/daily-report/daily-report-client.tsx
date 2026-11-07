"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui";
import { toFaDigits } from "@/lib/format";
import { J_MONTHS } from "@/lib/jdate";
import { moodByValue, type DayActivity } from "@/lib/daily-report-shared";
import { ReportCalendar, type DayCell } from "./calendar-view";
import { ReportSheet, type DailyReport } from "./report-sheet";

const WEEKDAY_LONG = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];
/** ایندکس روز هفتهٔ میلادی (۰ = یکشنبه) → نام فارسی با شروع از شنبه */
const weekdayOfIndex = (i: number) => WEEKDAY_LONG[(i + 1) % 7];

export function DailyReportClient({
  jy,
  jm,
  monthLen,
  firstWeekday,
  days,
  reports,
  stats,
  canWrite,
  todayIso,
}: {
  jy: number;
  jm: number;
  monthLen: number;
  firstWeekday: number;
  days: DayCell[];
  reports: Record<string, DailyReport>;
  stats: { submitted: number; drafts: number; streak: number; avgMood: number; totalMinutes: number };
  canWrite: boolean;
  todayIso: string;
}) {
  const router = useRouter();
  const request = useRef<AbortController | null>(null);
  const dirty = useRef(false);
  const [pending, setPending] = useState<{date?: string | null; href?: string} | null>(null);
  const [selected, setSelected] = useState<string | null>(
    days.find((d) => d.isToday)?.iso ?? null,
  );
  const [act, setAct] = useState<DayActivity | null>(null);
  const [autoSum, setAutoSum] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changeDay = (date: string | null) => {
    if (date === selected) return;
    if (dirty.current) return setPending({date});
    setAct(null); setAutoSum(""); setSelected(date);
  };

  const reportMap = new Map(days.map((d) => [d.iso, d]));

  const loadActivity = useCallback(async (iso: string) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/daily-reports?activity=${iso}`, {signal: controller.signal});
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "بارگذاری فعالیت روز ناموفق بود.");
      if (!controller.signal.aborted) {
        setAct(data.activity ?? null);
        setAutoSum(data.autoSummary ?? "");
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "بارگذاری فعالیت روز ناموفق بود.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selected) loadActivity(selected);
    else {
      setAct(null);
      setAutoSum("");
    }
    return () => request.current?.abort();
  }, [selected, loadActivity]);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty.current) event.preventDefault(); };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);

  const refresh = useCallback(() => {
    router.refresh();
    if (selected) loadActivity(selected);
  }, [router, selected, loadActivity]);

  const sel = selected ? reportMap.get(selected) : null;
  const selReport = selected ? reports[selected] ?? null : null;

  const prevM = jm === 1 ? { jy: jy - 1, jm: 12 } : { jy, jm: jm - 1 };
  const nextM = jm === 12 ? { jy: jy + 1, jm: 1 } : { jy, jm: jm + 1 };

  const completion = days.filter((d) => !d.isFuture).length
    ? Math.round((stats.submitted / Math.max(1, days.filter((d) => !d.isFuture).length)) * 100)
    : 0;
  const mood = stats.avgMood ? moodByValue(Math.round(stats.avgMood)) : null;
  const hrs = Math.floor(stats.totalMinutes / 60);
  const mins = stats.totalMinutes % 60;

  return (
    <div className="mx-auto max-w-6xl px-3 sm:px-5 lg:px-6 py-4 sm:py-6 space-y-4 sm:space-y-5">
      {/* سربرگ */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-bold tracking-tight">گزارش پایان روز کاری</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            هر روزِ کاری را انتخاب کنید و گزارش آن روز را بنویسید — کارهای انجام‌شده خودکار پر می‌شود.
          </p>
        </div>
        <div className="flex w-full min-w-0 items-center justify-between gap-1 sm:w-auto">
          <a className="btn-secondary btn-sm" onClick={e => { if (dirty.current) { e.preventDefault(); setPending({href:e.currentTarget.href}); } }} href={`/daily-report?jy=${prevM.jy}&jm=${prevM.jm}`}>→ ماه قبل</a>
          <span className="font-semibold text-[15px] px-2 whitespace-nowrap">
            {J_MONTHS[jm - 1]} {toFaDigits(jy)}
          </span>
          <a className="btn-secondary btn-sm" onClick={e => { if (dirty.current) { e.preventDefault(); setPending({href:e.currentTarget.href}); } }} href={`/daily-report?jy=${nextM.jy}&jm=${nextM.jm}`}>ماه بعد ←</a>
        </div>
      </div>

      {/* کارت‌های آماری */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <div className="card min-w-0 p-3 sm:p-4 flex flex-wrap items-center gap-2">
          {/* حلقهٔ پیشرفت ماه */}
          <div
            className="relative w-12 h-12 shrink-0 rounded-full"
            style={{
              background: `conic-gradient(#10b981 ${completion * 3.6}deg, #e4e4e7 ${completion * 3.6}deg)`,
            }}
          >
            <div className="absolute inset-[5px] bg-white dark:bg-zinc-900 rounded-full grid place-items-center text-xs font-bold text-emerald-600">
              {toFaDigits(completion)}٪
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-xs text-zinc-500">تکمیل ماه</div>
            <div className="text-sm font-bold">{toFaDigits(stats.submitted)} روز ثبت‌شده</div>
          </div>
        </div>

        <div className="card card-pad">
          <div className="text-xs text-zinc-500">زنجیرهٔ پیوسته</div>
          <div className="text-sm font-bold mt-0.5">
            🔥 {toFaDigits(stats.streak)} روز
          </div>
          <div className="text-[11px] text-zinc-400 mt-0.5">بدون وقفه</div>
        </div>

        <div className="card card-pad">
          <div className="text-xs text-zinc-500">ساعت ثبت‌شده</div>
          <div className="text-sm font-bold mt-0.5 tabular-nums">
            {toFaDigits(hrs)}:{toFaDigits(String(mins).padStart(2, "0"))}
          </div>
          <div className="text-[11px] text-zinc-400 mt-0.5">ساعت و دقیقه</div>
        </div>

        <div className="card card-pad">
          <div className="text-xs text-zinc-500">میانگین حال‌وهوا</div>
          <div className="text-sm font-bold mt-0.5">
            {mood ? `${mood.emoji} ${toFaDigits(stats.avgMood.toFixed(1))}` : "—"}
          </div>
          <div className="text-[11px] text-zinc-400 mt-0.5">{mood?.label}</div>
        </div>
      </div>

      {/* تقویم + برگهٔ گزارش */}
      <div className="grid min-w-0 gap-4 items-start xl:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]">
        <div className="min-w-0 xl:sticky xl:top-4">
          <h2 className="mb-2 text-sm font-semibold">تقویم گزارش‌ها <span className="text-xs font-normal text-zinc-500">· روز موردنظر را انتخاب کنید</span></h2>
          <ReportCalendar
            jy={jy}
            jm={jm}
            monthLen={monthLen}
            firstWeekday={firstWeekday}
            days={days}
            selected={selected}
            onSelect={changeDay}
          />
        </div>

        <div className="min-w-0" aria-busy={loading}>
          {sel && selected ? (
            error ? <div className="card p-5" role="alert"><p className="text-sm text-red-600 dark:text-red-400">{error}</p><button className="btn-secondary mt-3" onClick={() => void loadActivity(selected)}>تلاش دوباره</button></div> : loading && !act ? (
              <div className="card card-pad text-center text-sm text-zinc-400 py-10">
                در حال بارگذاری فعالیت این روز…
              </div>
            ) : (
              <ReportSheet
                key={selected}
                iso={sel.iso}
                jd={sel.jd}
                jm={jm}
                jy={jy}
                weekday={weekdayOfIndex(sel.weekday)}
                isToday={sel.isToday}
                isFuture={sel.isFuture}
                report={selReport}
                act={act}
                autoSummary={autoSum}
                canWrite={canWrite}
                onDirty={() => { dirty.current = true; }}
                onSaved={() => { dirty.current = false; refresh(); }}
                onClose={() => changeDay(null)}
              />
            )
          ) : (
            <div className="card card-pad text-center py-14">
              <div className="text-3xl mb-2">📓</div>
              <p className="text-sm text-zinc-600 dark:text-zinc-300 font-medium">
                یک روز از تقویم را انتخاب کنید
              </p>
              <p className="text-xs text-zinc-400 mt-1">
                با انتخاب هر روز، کارهایی که واقعاً روی سامانه انجام داده‌اید خودکار نمایش داده می‌شود.
              </p>
            </div>
          )}
        </div>
      </div>
      <Modal open={pending !== null} onClose={() => setPending(null)} title="تغییرات گزارش ذخیره نشده است">
        <p className="text-sm leading-7 text-zinc-500">برای نگه‌داشتن نوشته‌ها، به گزارش برگردید و پیش‌نویس را ذخیره کنید. ادامه دادن، تغییرات ذخیره‌نشده را کنار می‌گذارد.</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2"><button className="btn-secondary" onClick={() => setPending(null)}>بازگشت به گزارش</button><button className="btn-primary" onClick={() => {
          dirty.current = false;
          if (pending?.href) router.push(pending.href);
          else { setAct(null); setAutoSum(""); setSelected(pending?.date ?? null); }
          setPending(null);
        }}>ادامه بدون ذخیره</button></div>
      </Modal>
    </div>
  );
}
