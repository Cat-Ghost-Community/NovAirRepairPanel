"use client";

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ui";
import { SignaturePad, SignatureView } from "@/components/signature-pad";
import { TimePicker } from "@/components/time-picker";
import { toFaDigits } from "@/lib/format";
import { statusFa } from "@/lib/status-fa";
import { J_MONTHS } from "@/lib/jdate";
import { MoodPicker } from "./calendar-view";
import {ReportHistory} from './report-history';
import type { DayActivity } from "@/lib/daily-report-shared";

export type DailyReport = {
  id: number;
  user_id?:number;
  report_date: string;
  summary: string;
  achievements: string;
  blockers: string;
  tomorrow: string;
  mood: number;
  worked_minutes: number;
  ticket_count: number;
  tickets_json: string;
  shift_start: string;
  shift_end: string;
  signature_data: string | null;
  status: string;
  submitted_at: string | null;
  updated_at?: string;
  revision?: number;
};

const fmtHM = (m: number) => {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return [h ? `${toFaDigits(h)} ساعت` : "", mm ? `${toFaDigits(mm)} دقیقه` : ""]
    .filter(Boolean)
    .join(" و ") || "—";
};

/** میان‌برهای پرکاربرد شیفت */
const SHIFT_PRESETS = [
  { label: "صبح", emoji: "🌅", start: "08:00", end: "17:00" },
  { label: "عصر", emoji: "🌇", start: "13:00", end: "22:00" },
  { label: "شب", emoji: "🌙", start: "22:00", end: "07:00" },
  { label: "نیمه‌وقت", emoji: "⏱", start: "09:00", end: "14:00" },
];

/** مدت شیفت از روی ساعت شروع و پایان — «تا» یعنی نصفه‌شب */
function shiftLength(start: string, end: string): string {
  const s = /^(\d{1,2}):(\d{2})$/.exec(start ?? "");
  const e = /^(\d{1,2}):(\d{2})$/.exec(end ?? "");
  if (!s || !e) return "";
  const mins = (Number(e[1]) * 60 + Number(e[2])) - (Number(s[1]) * 60 + Number(s[2]));
  const total = mins > 0 ? mins : mins + 24 * 60; // شیفتی که از شب گذشته
  const h = Math.floor(total / 60);
  const m = total % 60;
  return [h ? `${toFaDigits(h)} ساعت` : "", m ? `${toFaDigits(m)} دقیقه` : ""].filter(Boolean).join(" و ");
}

/**
 * «پنل فعالیت» — مهم‌ترین بخش: کارهایی که کارمند *واقعاً* انجام داده،
 * خودکار از زمان‌سنج‌ها و تغییر وضعیت‌های پذیش استخراج می‌شود.
 */
function ActivityPanel({ act }: { act: DayActivity }) {
  if (!act) return null;
  const empty = !act.ticketCount && !act.workedMinutes && !act.notes.length && !act.deliveries;
  if (empty) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-4 text-center">
        <div className="text-2xl mb-1">🌙</div>
        <p className="text-sm text-zinc-500">امروز هیچ فعالیتی روی سامانه ثبت نشده.</p>
        <p className="text-xs text-zinc-400 mt-1">
          اگر کاری انجام داده‌اید که در سامونه ثبت نمی‌شود، در بخش «خلاصهٔ روز» بنویسید.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-800">
        <span className="text-sm">📊</span>
        <h4 className="text-sm font-semibold">کارهایی که سامانه برای شما ثبت کرده</h4>
        <span className="text-[11px] text-zinc-400 mr-auto">خودکار — قابل ویرایش نیست</span>
      </div>

      <div className="p-3 space-y-2.5">
        {act.tickets.length > 0 && (
          <div className="space-y-1.5">
            {act.tickets.map((t, i) => (
              <div
                key={`${t.number}-${i}`}
                className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 text-sm"
              >
                <span
                  className="w-1.5 h-6 rounded-full shrink-0"
                  style={{ background: t.statusColor }}
                  aria-hidden
                />
                <span className="font-mono text-xs shrink-0">{t.number}</span>
                <span className="flex-1 min-w-0 truncate text-zinc-600 dark:text-zinc-300">{t.device}</span>
                <span className="text-[11px] text-zinc-400 shrink-0">{statusFa(t.status)}</span>
                <span
                  className={`text-xs shrink-0 tabular-nums ${t.estimated ? "text-amber-500" : "text-zinc-500"}`}
                >
                  {t.estimated ? "~۴۵د" : fmtHM(t.minutes)}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-1.5 text-xs">
          {act.workedMinutes > 0 && (
            <span className="chip">⏱ زمان‌سنج: {fmtHM(act.workedMinutes)}</span>
          )}
          {act.deliveries > 0 && (
            <span className="chip">📦 تحویل/آماده‌تحویل: {toFaDigits(act.deliveries)}</span>
          )}
          {act.estimatesApproved > 0 && (
            <span className="chip">✅ برآورد تأییدشده: {toFaDigits(act.estimatesApproved)}</span>
          )}
        </div>

        {act.notes.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs text-zinc-500">یادداشت‌های ثبت‌شده در پرونده‌ها:</div>
            {act.notes.map((n, i) => (
              <div key={i} className="text-xs text-zinc-600 dark:text-zinc-300 leading-5">
                • <span className="font-mono">{n.ticket}</span> — {n.body}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ReportSheet({
  iso,
  jd,
  jm,
  jy,
  weekday,
  isToday,
  isFuture,
  report,
  act,
  autoSummary,
  canWrite,
  onSaved,
  onClose,
  onDirty,
}: {
  /** تاریخ میلادی — از سرور محاسبه شده تا هرگز تبدیل تاریخ در کلاینت انجام نشود */
  iso: string;
  jd: number;
  jm: number;
  jy: number;
  weekday: string;
  isToday: boolean;
  isFuture: boolean;
  report: DailyReport | null;
  act: DayActivity | null;
  autoSummary: string;
  canWrite: boolean;
  onSaved: () => void;
  onClose: () => void;
  onDirty: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    summary: report?.summary ?? "",
    achievements: report?.achievements ?? "",
    blockers: report?.blockers ?? "",
    tomorrow: report?.tomorrow ?? "",
    mood: report?.mood ?? 3,
    shift_start: report?.shift_start ?? "",
    shift_end: report?.shift_end ?? "",
  });
  const [sig, setSig] = useState<string | null>(report?.signature_data ?? null);
  const [busy, setBusy] = useState(false);
  const [signatureDrawing,setSignatureDrawing]=useState(false);
  const [correcting,setCorrecting]=useState(false),[correctionReason,setCorrectionReason]=useState('');
  const [applied, setApplied] = useState(!!report?.summary);

  useEffect(() => {
    setForm({
      summary: report?.summary ?? "",
      achievements: report?.achievements ?? "",
      blockers: report?.blockers ?? "",
      tomorrow: report?.tomorrow ?? "",
      mood: report?.mood ?? 3,
      shift_start: report?.shift_start ?? "",
      shift_end: report?.shift_end ?? "",
    });
    setSig(report?.signature_data ?? null);
    setApplied(!!report?.summary);
    setCorrecting(false);setCorrectionReason('');
  }, [report?.id, report?.updated_at,report?.revision,report?.summary,report?.achievements,report?.blockers,report?.tomorrow,report?.mood,report?.shift_start,report?.shift_end,report?.signature_data]);

  const set = (k: keyof typeof form, v: string | number) => { onDirty(); setForm((f) => ({ ...f, [k]: v })); };

  const shiftDuration = useMemo(
    () => shiftLength(form.shift_start, form.shift_end),
    [form.shift_start, form.shift_end],
  );

  const protectedEvidence=!!report&&(report.status==='submitted'||!!report.signature_data);
  const readOnly = !canWrite || isFuture || (protectedEvidence&&!correcting);

  const save = async (status: "draft" | "submitted") => {
    if(busy||readOnly)return;
    setBusy(true);
    try {
      const res = await fetch("/api/daily-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          report_date: report?.report_date ?? iso,
          signature_data: correcting?sig:report?.signature_data ? undefined : sig,
          revision:report?.revision??0,resign:correcting,correction_reason:correctionReason,
          status,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "ذخیره ناموفق بود");
      toast(status === "submitted" ? "گزارش روز ثبت شد ✅" : "پیش‌نویس ذخیره شد");
      onSaved();
    } catch (e: any) {
      toast(e.message ?? "ذخیره ناموفق بود", "error");
    } finally {
      setBusy(false);
    }
  };

  const statusBadge = report?.status === "submitted"
    ? <span className="chip bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30">ثبت‌شده</span>
    : report
      ? <span className="chip bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/30">پیش‌نویس</span>
      : null;

  return (
    <div className="card card-pad space-y-4">
      {/* سربرگ */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold tracking-tight">
            {isToday ? "گزارش پایان امروز" : `گزارش ${weekday} ${toFaDigits(jd)} ${J_MONTHS[jm - 1]}`}
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            {toFaDigits(jd)} {J_MONTHS[jm - 1]} {toFaDigits(jy)} · {weekday}
            {isToday && <span className="text-brand-600"> · امروز</span>}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {statusBadge}
          <button className="btn-secondary btn-sm" disabled={busy||signatureDrawing} onClick={onClose}>بستن</button>
        </div>
      </div>

      {isFuture && (
        <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-3 text-sm text-zinc-500">
          این روز هنوز نرسیده است — گزارش آن بعداً قابل ثبت است.
        </div>
      )}

      {/* خلاصهٔ خودکار */}
      <ActivityPanel act={act!} />

      {autoSummary && !applied && !readOnly && (
        <button
          type="button"
          onClick={() => {
            set("summary", autoSummary);
            setApplied(true);
          }}
          className="w-full text-right rounded-xl border border-dashed border-brand-400 bg-brand-50/50 dark:bg-brand-500/10 px-3 py-2.5 text-sm hover:bg-brand-50 dark:hover:bg-brand-500/20 transition"
        >
          <span className="text-xs text-zinc-500 block mb-1">💡 خلاصهٔ خودکار را در قسمت زیر قرار می‌دهد — بزنید تا بنشیند:</span>
          <span>{autoSummary}</span>
        </button>
      )}

      {/* خلاصهٔ روز */}
      <div>
        <label className="label" htmlFor="dr-summary">خلاصهٔ روز کاری</label>
        <textarea
          id="dr-summary"
          className="input min-h-[84px]"
          placeholder="امروز چه کار کردید؟ می‌توانید از خلاصهٔ خودکار بالا شروع کنید…"
          value={form.summary}
          disabled={readOnly}
          onChange={(e) => set("summary", e.target.value)}
        />
        <p className="text-xs text-zinc-400 mt-1">
          برای ثبت نهایی حداقل ۱۰ کاراکتر لازم است.
        </p>
      </div>

      {/* حال‌وهوا + ساعت کاری */}
      <div className="grid gap-5 2xl:grid-cols-2">
        <div>
          <label className="label">حال‌وهوای امروز</label>
          <MoodPicker value={form.mood} onChange={(v) => !readOnly && set("mood", v)} />
        </div>
        <div>
          <label className="label">ساعت شروع و پایان شیفت</label>

          {/* میان‌برهای شیفت — انتخاب سریع رایج‌ترین حالت‌ها */}
          {!readOnly && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {SHIFT_PRESETS.map((p) => {
                const active = form.shift_start === p.start && form.shift_end === p.end;
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => { onDirty(); setForm((f) => ({ ...f, shift_start: p.start, shift_end: p.end })); }}
                    className={`min-h-8 rounded-lg border px-2.5 py-1 text-xs transition
                      focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500
                      ${
                        active
                          ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300 font-medium"
                          : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                      }`}
                  >
                    {p.emoji} {p.label}
                  </button>
                );
              })}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="block text-xs text-zinc-500 mb-1">شروع</span>
              <TimePicker
                id="dr-shift-start"
                value={form.shift_start}
                onChange={(v) => set("shift_start", v)}
                placeholder="مثلاً ۰۸:۳۰"
                clearable
              />
            </div>
            <div>
              <span className="block text-xs text-zinc-500 mb-1">پایان</span>
              <TimePicker
                id="dr-shift-end"
                value={form.shift_end}
                onChange={(v) => set("shift_end", v)}
                placeholder="مثلاً ۱۷:۰۰"
                clearable
              />
            </div>
          </div>

          {shiftDuration && (
            <p className="text-xs text-zinc-500 mt-1.5">
              مدت شیفت: <span className="font-medium text-zinc-700 dark:text-zinc-300">{shiftDuration}</span>
              {act && act.workedMinutes > 0 && (
                <span className="text-zinc-400"> · زمان‌سنج سامانه: {fmtHM(act.workedMinutes)}</span>
              )}
            </p>
          )}
        </div>
      </div>

      {/* روایت */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="dr-ach">دستاوردها و نکات مهم</label>
          <textarea
            id="dr-ach"
            className="input min-h-[70px]"
            placeholder="چه چیزی خوب پیش رفت؟"
            value={form.achievements}
            disabled={readOnly}
            onChange={(e) => set("achievements", e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="dr-blk">مشکلات و موانع</label>
          <textarea
            id="dr-blk"
            className="input min-h-[70px]"
            placeholder="چه چیزی جلوی کار را گرفت؟"
            value={form.blockers}
            disabled={readOnly}
            onChange={(e) => set("blockers", e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="dr-tmr">برنامهٔ فردا</label>
        <textarea
          id="dr-tmr"
          className="input min-h-[60px]"
          placeholder="فردا روی چه چیزی کار می‌کنید؟"
          value={form.tomorrow}
          disabled={readOnly}
          onChange={(e) => set("tomorrow", e.target.value)}
        />
      </div>

      {/* امضا */}
      <div>
        {protectedEvidence&&<div className="mb-3 rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm dark:border-brand-800 dark:bg-brand-950/30"><p>نسخهٔ ثبت‌شده محفوظ است. اصلاح فقط توسط خود کارمند، با دلیل و امضای تازه ثبت می‌شود؛ نسخهٔ قبلی حذف نمی‌شود.</p>{canWrite&&!isFuture&&!correcting&&<button className="btn-secondary mt-2" onClick={()=>{setCorrecting(true);setSig(null);onDirty();}}>ثبت اصلاحیه</button>}</div>}
        {correcting&&<label className="mb-3 block"><span className="label">دلیل اصلاح گزارش</span><textarea className="input" minLength={10} maxLength={1000} value={correctionReason} disabled={busy} onChange={e=>{setCorrectionReason(e.target.value);onDirty();}} placeholder="چه چیزی و به چه دلیل اصلاح می‌شود؟" /></label>}
        {(report?.signature_data||readOnly)&&<p className="label">امضای پایان روز (اختیاری)</p>}
        {report?.signature_data&&!correcting ? (
          <SignatureView dataUrl={report.signature_data} alt="امضای گزارش پایان روز" signedAt={iso} />
        ) : readOnly ? (
          <p className="text-xs text-zinc-400">امضایی برای این روز ثبت نشده است.</p>
        ) : (
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-2">
            <SignaturePad onChange={value => { if(value!==sig)onDirty(); setSig(value); }} onDrawingChange={setSignatureDrawing} disabled={busy} label={correcting?'امضای تازهٔ اصلاحیه (الزامی)':'امضای گزارش پایان روز (اختیاری)'} />
          </div>
        )}
      </div>

      {/* اقدام‌ها */}
      {report&&<ReportHistory report={report}/>}
      {!readOnly && (
        <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-zinc-200 dark:border-zinc-800">
          {!protectedEvidence&&<button className="btn-secondary" disabled={busy||signatureDrawing} onClick={() => save("draft")}>
            ذخیره پیش‌نویس
          </button>}
          <button className="btn-primary" disabled={busy||signatureDrawing||(correcting&&(!sig||correctionReason.trim().length<10))} onClick={() => save("submitted")}>
            {busy ? "در حال ثبت…" : "ثبت نهایی گزارش"}
          </button>
        </div>
      )}
    </div>
  );
}
