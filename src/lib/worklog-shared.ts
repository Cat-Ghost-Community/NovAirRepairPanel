/**
 * گزارش کار تعمیرکار روی یک دستگاه — بخش «کلاینت‌پسند».
 *
 * این فایل هیچ وابستگی‌ای به دیتابیس ندارد تا در کامپوننت‌های کلاینت صفحهٔ
 * پذیرش قابل استفاده باشد و در تست واحد هم بدون دیتابیس قابل آزمایش باشد.
 * کوئری‌های دیتابیسی در `worklog.ts` هستند.
 */

export type WorkLogKind = "time" | "status" | "note";

import { WEEK_DAYS } from "@/lib/format";

/** نام روز هفته از ستون زمان (۰=یکشنبه در UTC → نام فارسی) */
export function weekdayName(ts: string): string {
  const d = new Date(String(ts ?? "").replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return "";
  return WEEK_DAYS[(d.getUTCDay() + 1) % 7];
}

export type WorkLogRow = {
  kind: WorkLogKind;
  row_id: number;
  ts: string;
  user_name: string | null;
  user_color: string | null;
  status_name: string | null;
  status_color: string | null;
  minutes: number | null;
  is_manual: number | null;
  /** ۱ یعنی زمان‌سنج هنوز باز است */
  running: number;
  body: string | null;
};

export const KIND_LABEL: Record<WorkLogKind, string> = {
  time: "زمان‌سنج",
  status: "وضعیت",
  note: "یادداشت",
};

/** «۱ ساعت و ۵ دقیقه» با ارقام فارسی */
export function humanMinutes(minutes: number | null | undefined): string {
  const fa = (n: number) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${fa(m)} دقیقه`;
  if (!m) return `${fa(h)} ساعت`;
  return `${fa(h)} ساعت و ${fa(m)} دقیقه`;
}

/** ساعت «۲۰:۰۸» از ستون زمان — همان ساعتی که fmtDateTime هم نشان میدهد */
export function hhmm(ts: string): string {
  const s = String(ts ?? "");
  const m = s.match(/(\d{2}:\d{2})/);
  return m ? m[1].replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]) : "—";
}

/**
 * متنی که در ردیف گزارش میآید: هرچه تعمیرکار نوشته، وگرنه شرح خودکار رخداد.
 * `statusName` از قبل فارسی‌شده داده میشود تا این ماژول به ترجمه‌وضعیت‌ها وابسته نشود.
 */
export function describeEntry(row: WorkLogRow, statusName?: string | null): string {
  const body = (row.body ?? "").trim();
  if (body) return body;
  if (row.kind === "status") return `وضعیت دستگاه به «${statusName ?? "—"}» تغییر کرد`;
  if (row.kind === "time") return "روی این دستگاه کار کرد (بدون یادداشت)";
  return "یادداشت بدون متن";
}

/**
 * گروه‌بندی ردیف‌ها بر اساس روز (کلید از بیرون داده میشود تا تاریخ‌سازی
 * در لایهٔ نمایش بماند). ترتیب گروه‌ها و ردیف‌ها دست‌نخورده میماند.
 */
export function groupByDay<T>(rows: T[], keyOf: (row: T) => string): Array<{ key: string; rows: T[] }> {
  const groups: Array<{ key: string; rows: T[] }> = [];
  for (const row of rows) {
    const key = keyOf(row);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.rows.push(row);
    else groups.push({ key, rows: [row] });
  }
  return groups;
}
