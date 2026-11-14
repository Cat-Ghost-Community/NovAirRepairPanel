"use client";
import {printWhenReady} from '@/lib/print-ready';

import { useMemo, useState } from "react";
import { Avatar } from "@/components/ui";
import { Icon } from "@/components/icon";
import { Select } from "@/components/select";
import { fmtDate, timeAgo, toFaDigits } from "@/lib/format";
import { statusFa } from "@/lib/status-fa";
import {
  KIND_LABEL,
  describeEntry,
  groupByDay,
  hhmm,
  humanMinutes,
  weekdayName,
  type WorkLogKind,
  type WorkLogRow,
} from "@/lib/worklog-shared";
import { LiveElapsed } from "./time-tracker";

/**
 * گزارش کار تعمیرکار روی یک دستگاه — داخلی و برای نظارت.
 * مشتری این بخش را نمی‌بیند (فقط در صفحهٔ پذیرش رندر می‌شود، نه در پورتال پیگیری).
 *
 * همه‌چیز از ردیف‌های آمادهٔ سرور ساخته می‌شود؛ فیلترها در همین کامپوننت اعمال
 * می‌شوند تا جابه‌جایی فیلتر نیازی به درخواست تازه نداشته باشد.
 */
export function WorkLogPanel({ rows, ticketNumber }: { rows: WorkLogRow[]; ticketNumber?: string }) {
  const [tech, setTech] = useState("");
  const [kind, setKind] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const techs = useMemo(
    () => Array.from(new Set(rows.map((r) => r.user_name).filter((n): n is string => !!n))).sort((a, b) => a.localeCompare(b, "fa")),
    [rows]
  );

  const filtered = useMemo(() => {
    const needle = q.trim();
    return rows.filter((r) => {
      if (tech && r.user_name !== tech) return false;
      if (kind && r.kind !== (kind as WorkLogKind)) return false;
      const day = String(r.ts ?? "").slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (needle) {
        const text = `${describeEntry(r, r.status_name ? statusFa(r.status_name) : null)} ${r.user_name ?? ""}`;
        if (!text.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, tech, kind, from, to, q]);

  const totalMinutes = filtered.reduce((s, r) => s + (r.kind === "time" ? r.minutes ?? 0 : 0), 0);
  const techCount = new Set(filtered.map((r) => r.user_name).filter(Boolean)).size;
  const noteCount = filtered.filter((r) => r.kind === "note").length;
  const runningCount = filtered.filter((r) => r.kind === "time" && r.running).length;
  const dayGroups = groupByDay(filtered, (r) => fmtDate(r.ts));
  const hasFilter = !!(tech || kind || from || to || q.trim());
  const byTech = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered) {
      if (r.kind !== "time" || !r.user_name) continue;
      map.set(r.user_name, (map.get(r.user_name) ?? 0) + (r.minutes ?? 0));
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const clearAll = () => {
    setTech("");
    setKind("");
    setFrom("");
    setTo("");
    setQ("");
  };

  /** خروجی CSV سازگار با Excel — بدون وابستگی جدید (BOM برای نمایش صحیح فارسی) */
  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["تاریخ", "ساعت", "نوع", "تعمیرکار", "شرح", "مدت (دقیقه)"];
    const lines = [head.map(esc).join(",")];
    for (const r of filtered) {
      lines.push(
        [
          fmtDate(r.ts),
          hhmm(r.ts),
          KIND_LABEL[r.kind] + (r.kind === "time" && r.is_manual ? " (دستی)" : ""),
          r.user_name ?? "—",
          describeEntry(r, r.status_name ? statusFa(r.status_name) : null),
          r.kind === "time" ? (r.minutes ?? 0) : "",
        ]
          .map(esc)
          .join(",")
      );
    }
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `گزارش-کار-${ticketNumber ?? "پذیرش"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="card card-pad space-y-4 print-area document-sheet">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="section-title">گزارش کار تعمیرکار</h3>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            چه کسی، چه روزی، چه ساعتی و چه کاری روی این دستگاه انجام داده است.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 no-print">
          <span className="badge-gray">گزارش داخلی — مشتری نمی‌بیند</span>
          <button type="button" className="btn-secondary btn-sm" onClick={exportCsv} disabled={filtered.length === 0}>
            <Icon name="excel" size={14} /> خروجی اکسل
          </button>
          <button type="button" className="btn-secondary btn-sm" onClick={() => void printWhenReady()} disabled={filtered.length === 0}>
            <Icon name="printer" size={14} /> چاپ
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-zinc-400">
          هنوز فعالیتی برای این دستگاه ثبت نشده — با شروع زمان‌سنج یا نوشتن شرح کار، اینجا ثبت می‌شود.
        </p>
      ) : (
        <>
          {/* خلاصه */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <SummaryCard icon="timer" label="کار ثبت‌شده" value={humanMinutes(totalMinutes)} />
            <SummaryCard icon="users" label="تعمیرکار" value={`${toFaDigits(techCount)} نفر`} />
            <SummaryCard icon="list" label="رخداد" value={`${toFaDigits(filtered.length)} مورد`} />
            <SummaryCard
              icon="notebook-pen"
              label={runningCount > 0 ? "در حال کار" : "آخرین فعالیت"}
              value={runningCount > 0 ? `${toFaDigits(runningCount)} زمان‌سنج باز` : timeAgo(filtered[0]?.ts)}
              tone={runningCount > 0 ? "text-emerald-600 dark:text-emerald-400" : undefined}
            />
          </div>

          {/* نوار فیلتر */}
          <div className="filter-bar !-mx-0 !mb-0 !px-0 no-print">
            <label className="filter-field">
              <span className="filter-label">تعمیرکار</span>
              <Select
                size="sm"
                value={tech}
                onChange={setTech}
                placeholder="همه تعمیرکاران"
                options={techs.map((t) => ({ value: t, label: t }))}
              />
            </label>
            <label className="filter-field">
              <span className="filter-label">نوع رخداد</span>
              <Select
                size="sm"
                value={kind}
                onChange={setKind}
                placeholder="همه انواع"
                options={[
                  { value: "time", label: KIND_LABEL.time },
                  { value: "status", label: KIND_LABEL.status },
                  { value: "note", label: KIND_LABEL.note },
                ]}
              />
            </label>
            <label className="filter-field">
              <span className="filter-label">از تاریخ</span>
              <input className="input num !py-1.5 !text-[13px]" type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="filter-field">
              <span className="filter-label">تا تاریخ</span>
              <input className="input num !py-1.5 !text-[13px]" type="date" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <label className="filter-field">
              <span className="filter-label">جستجو در متن</span>
              <input className="input !py-1.5 !text-[13px]" value={q} onChange={(e) => setQ(e.target.value)} placeholder="مثلاً «فلت شارژ»" />
            </label>
            {hasFilter && (
              <div className="flex items-end pb-0.5">
                <button type="button" className="btn-ghost btn-sm" onClick={clearAll}>
                  پاک‌کردن فیلترها
                </button>
              </div>
            )}
          </div>

          {/* سهم تعمیرکاران از زمان کار */}
          {byTech.length > 1 && (
            <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="mb-2 text-[13px] font-medium">زمان کار به تفکیک تعمیرکار</div>
              <div className="space-y-1.5">
                {byTech.map(([name, mins]) => {
                  const pct = totalMinutes > 0 ? Math.round((mins / totalMinutes) * 100) : 0;
                  return (
                    <div key={name} className="flex items-center gap-2 text-[12px]">
                      <span className="w-28 shrink-0 truncate">{name}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <span className="block h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="w-24 shrink-0 text-left tabular-nums text-zinc-500">
                        {humanMinutes(mins)} ({toFaDigits(pct)}٪)
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* رخدادها به تفکیک روز */}
          {filtered.length === 0 ? (
            <p className="text-sm text-zinc-400">با این فیلترها رخدادی پیدا نشد — فیلترها را پاک کنید.</p>
          ) : (
            <div className="space-y-3">
              {dayGroups.map((g) => {
                const dayMinutes = g.rows.reduce((s, r) => s + (r.kind === "time" ? r.minutes ?? 0 : 0), 0);
                const isCollapsed = !!collapsed[g.key];
                return (
                  <div key={g.key} className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
                    <button
                      type="button"
                      onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}
                      aria-expanded={!isCollapsed}
                      className="flex w-full items-center justify-between gap-2 border-b border-zinc-200 bg-zinc-50/70 px-3 py-2 text-right dark:border-zinc-800 dark:bg-zinc-800/40"
                    >
                      <span className="text-xs font-semibold">
                        {weekdayName(g.rows[0].ts)} {g.key}
                      </span>
                      <span className="flex items-center gap-2 text-xs text-zinc-400">
                        {dayMinutes > 0 && <span className="badge-blue">⏱ {humanMinutes(dayMinutes)}</span>}
                        <span>{toFaDigits(g.rows.length)} رخداد</span>
                        <Icon name={isCollapsed ? "chevron-down" : "chevron-up"} size={13} />
                      </span>
                    </button>
                    {!isCollapsed && (
                      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                        {g.rows.map((e) => (
                          <li key={`${e.kind}-${e.row_id}`} className="flex items-start gap-3 px-3 py-2">
                            <span className="w-11 shrink-0 pt-0.5 text-left text-xs tabular-nums text-zinc-400">{hhmm(e.ts)}</span>
                            <span
                              className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-medium"
                              style={
                                e.kind === "status" && e.status_color
                                  ? { color: e.status_color, backgroundColor: e.status_color + "1a" }
                                  : undefined
                              }
                            >
                              {KIND_LABEL[e.kind]}
                              {e.kind === "time" && e.is_manual ? " دستی" : ""}
                            </span>
                            <div className="min-w-0 flex-1">
                              {e.user_name && (
                                <div className="mb-0.5 inline-flex items-center gap-1.5 text-xs text-zinc-500">
                                  <Avatar name={e.user_name} color={e.user_color} size={16} />
                                  {e.user_name}
                                </div>
                              )}
                              <p className="text-[13px] text-zinc-700 dark:text-zinc-200">
                                {describeEntry(e, e.status_name ? statusFa(e.status_name) : null)}
                              </p>
                            </div>
                            {e.kind === "time" &&
                              (e.running ? (
                                <LiveElapsed startedAt={e.ts} />
                              ) : (
                                <span className="shrink-0 pt-0.5 text-xs tabular-nums text-zinc-400">{humanMinutes(e.minutes)}</span>
                              ))}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {noteCount > 0 && (
            <p className="text-xs text-zinc-400">
              {toFaDigits(noteCount)} شرح کار در این گزارش هست — یادداشت‌های خصوصی فقط برای نویسنده و مدیران نمایش داده می‌شوند.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function SummaryCard({ icon, label, value, tone }: { icon: string; label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
      <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
        <Icon name={icon} size={12} className="opacity-60" />
        {label}
      </div>
      <div className={`mt-1 text-[15px] font-semibold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}
