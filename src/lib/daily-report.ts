import { getDb } from "@/lib/db/schema";
import { toFaDigits } from "@/lib/format";
import { MOODS, moodByValue, type DayActivity } from "@/lib/daily-report-shared";

/**
 * گزارش پایان روز کاری کارکنان.
 *
 * ایدهٔ اصلی: کارمند لازم نیست به خاطر بیاورد امروز چه کرده — سامانه از روی
 * داده‌های واقعیِ کار (time_entries، تغییر وضعیت پذیرش‌ها، یادداشت‌ها) خلاصه‌ای
 * خودکار می‌سازد و کارمند فقط روایت، موانع و برنامهٔ فردا را اضافه می‌کند.
 *
 * توجه: ثابت‌های قابل‌استفاده در مرورگر در `daily-report-shared` هستند؛ این
 * فایل به دیتابیس وصل است و نباید در کامپوننت کلاینت import شود.
 */

export { MOODS, moodByValue };
export type { DayActivity };

const TICKET_INFO = `
  SELECT t.id, t.number,
         COALESCE(c.first_name || ' ' || c.last_name, '—') AS customer,
         COALESCE(TRIM(d.brand || ' ' || d.model), '—') AS device,
         COALESCE(s.name, '—') AS status,
         COALESCE(s.color, '#71717a') AS status_color
  FROM repair_tickets t
  LEFT JOIN customers c ON c.id = t.customer_id
  LEFT JOIN devices d ON d.id = t.device_id
  LEFT JOIN repair_statuses s ON s.id = t.status_id
`;

/**
 * خلاصهٔ خودکارِ فعالیت یک کارمند در یک روز — همه از داده‌های واقعی سامانه.
 * دستگاهی که وضعیتش آن روز جلو رفته ولی زمان‌سنج نزده، با زمان تقریبی
 * علامت‌گذاری می‌شود تا روز خالی به نظر نرسد.
 */
export function dayActivity(userId: number, isoDate: string, branchId: number | null = null): DayActivity {
  const db = getDb();
  const from = `${isoDate} 00:00:00`;
  const to = `${isoDate} 23:59:59`;

  const timeRows = db
    .prepare(
      `SELECT te.ticket_id AS tid, te.minutes_active AS minutes
       FROM time_entries te
       WHERE te.user_id = ? AND te.started_at BETWEEN ? AND ? AND (:activityBranch IS NULL OR te.ticket_id IN (SELECT id FROM repair_tickets WHERE branch_id=:activityBranch))`,
    )
    .all({activityBranch:branchId},userId, from, to) as any[];

  // مجموع زمان هر پذیرش + فهرست پذیرش‌هایی که زمان‌سنج داشته‌اند
  const minutesByTicket = new Map<number, number>();
  for (const r of timeRows) {
    minutesByTicket.set(r.tid, (minutesByTicket.get(r.tid) ?? 0) + (r.minutes ?? 0));
  }

  // پذیرش‌هایی که وضعیتشان آن روز توسط این کارمند تغییر کرده
  // (LEFT JOIN چون ممکن است خود پذیرش بعداً حذف شده باشد ولی سابقه باقی مانده باشد)
  const statusRows = db
    .prepare(
      `SELECT h.ticket_id AS tid, t.number, s.name AS to_name, s.color AS to_color, h.note
       FROM repair_status_history h
       LEFT JOIN repair_tickets t ON t.id = h.ticket_id
       LEFT JOIN repair_statuses s ON s.id = h.to_status
       WHERE h.user_id = ? AND h.created_at BETWEEN ? AND ? AND (:activityBranch IS NULL OR t.branch_id=:activityBranch)
       ORDER BY h.created_at`,
    )
    .all({activityBranch:branchId},userId, from, to) as any[];

  const touched = new Set<number>(statusRows.map((r) => r.tid));
  const ids = [...new Set([...minutesByTicket.keys(), ...touched])];

  let infoById = new Map<number, any>();
  if (ids.length) {
    const rows = db
      .prepare(`${TICKET_INFO} WHERE t.id IN (${ids.map(() => "?").join(",")})`)
      .all(...ids) as any[];
    infoById = new Map(rows.map((r) => [r.id, r]));
  }

  const tickets = ids
    .map((id) => {
      const info = infoById.get(id);
      const minutes = minutesByTicket.get(id) ?? 0;
      const estimated = minutes === 0;
      return {
        number: info?.number ?? `#${id}`,
        minutes: estimated ? 45 : minutes,
        estimated,
        customer: info?.customer ?? "—",
        // سابقه‌ای که خودِ پذیرشش حذف شده — صادقانه نشانش می‌دهیم
        device: info?.device ?? "پذیرش حذف‌شده",
        status: info?.status ?? "—",
        statusColor: info?.status_color ?? "#71717a",
      };
    })
    .sort((a, b) => b.minutes - a.minutes);

  const notes = db
    .prepare(
      `SELECT t.number, n.body FROM repair_notes n
       JOIN repair_tickets t ON t.id = n.ticket_id
       WHERE n.user_id = ? AND n.created_at BETWEEN ? AND ? AND (:activityBranch IS NULL OR t.branch_id=:activityBranch)
       ORDER BY n.created_at DESC LIMIT 10`,
    )
    .all({activityBranch:branchId},userId, from, to) as any[];

  const deliveries = db
    .prepare(
      `SELECT COUNT(*) c FROM repair_status_history h
       JOIN repair_statuses s ON s.id = h.to_status
       WHERE h.user_id = ? AND h.created_at BETWEEN ? AND ?
         AND (:activityBranch IS NULL OR h.ticket_id IN (SELECT id FROM repair_tickets WHERE branch_id=:activityBranch))
         AND s.name IN ('Delivered','Ready for Pickup')`,
    )
    .get({activityBranch:branchId},userId, from, to) as any;

  const estimates = db
    .prepare(
      `SELECT COUNT(*) c FROM estimates
       WHERE created_by = ? AND created_at BETWEEN ? AND ? AND status = 'approved' AND (:activityBranch IS NULL OR COALESCE((SELECT branch_id FROM repair_tickets WHERE id=estimates.ticket_id),(SELECT branch_id FROM customers WHERE id=estimates.customer_id))=:activityBranch)`,
    )
    .get({activityBranch:branchId},userId, from, to) as any;

  const workedMinutes = timeRows.reduce((s, r) => s + (r.minutes ?? 0), 0);

  return {
    workedMinutes,
    ticketCount: tickets.length,
    tickets,
    statusChanges: statusRows.map((r) => ({
      ticket: r.number ?? `#${r.tid}`,
      to: r.to_name ?? "—",
      toColor: r.to_color ?? "#71717a",
      note: r.note ?? "",
    })),
    notes: notes.map((n) => ({ ticket: n.number, body: n.body })),
    deliveries: deliveries?.c ?? 0,
    estimatesApproved: estimates?.c ?? 0,
  };
}

/** آمار ماه + زنجیرهٔ روزهای پیوستهٔ گزارش ثبت‌شده تا امروز */
export function reportStats(userId: number, isoDates: string[], todayIso: string, branchId: number | null = null) {
  const db = getDb();
  if (!isoDates.length) {
    return { byDate: new Map<string, any>(), submitted: 0, drafts: 0, streak: 0, avgMood: 0, totalMinutes: 0 };
  }
  const rows = db
    .prepare(
      `SELECT report_date, status, mood, worked_minutes, ticket_count
       FROM daily_reports
       WHERE user_id = ? AND (:activityBranch IS NULL OR branch_id=:activityBranch) AND report_date IN (${isoDates.map(() => "?").join(",")})`,
    )
    .all({activityBranch:branchId},userId, ...isoDates) as any[];

  const byDate = new Map<string, any>(rows.map((r) => [r.report_date, r]));
  const submitted = rows.filter((r) => r.status === "submitted").length;

  // زنجیرهٔ پیوسته: امروز اگر ثبت نشده هنوز فرصت دارد، پس از دیروز شروع می‌کنیم
  const base = new Date(`${todayIso}T00:00:00Z`).getTime();
  let streak = 0;
  for (let i = 0; i < 120; i++) {
    const d = new Date(base - i * 86400000).toISOString().slice(0, 10);
    const r = byDate.get(d);
    if (r && r.status === "submitted") streak++;
    else if (i === 0) continue;
    else break;
  }

  const moods = rows.filter((r) => r.status === "submitted" && r.mood).map((r) => r.mood);
  const avgMood = moods.length ? moods.reduce((a, b) => a + b, 0) / moods.length : 0;

  return {
    byDate,
    submitted,
    drafts: rows.length - submitted,
    streak,
    avgMood,
    totalMinutes: rows.reduce((s, r) => s + (r.worked_minutes ?? 0), 0),
  };
}

/**
 * نمای ماهانه: دقیقه‌های کار و تعداد دستگاه‌ها به تفکیک روز — یک کوئری سبک
 * برای رنگ‌آمیزی خانه‌های تقویم (بدون بارگذاری جزئیات هر روز).
 */
export function monthOverview(userId: number, fromIso: string, toIso: string, branchId: number | null = null) {
  const db = getDb();
  const from = `${fromIso} 00:00:00`;
  const to = `${toIso} 23:59:59`;

  const minutesRows = db
    .prepare(
      `SELECT date(started_at) AS d, SUM(COALESCE(minutes_active, 0)) AS minutes
       FROM time_entries
       WHERE user_id = ? AND started_at BETWEEN ? AND ? AND (:activityBranch IS NULL OR ticket_id IN (SELECT id FROM repair_tickets WHERE branch_id=:activityBranch))
       GROUP BY date(started_at)`,
    )
    .all({activityBranch:branchId},userId, from, to) as any[];

  // تعداد دستگاه‌های «لمس‌شده» در روز: اجتماع پذیرش‌های زمان‌سنج‌دار و وضعیت‌جلوبرده
  const ticketRows = db
    .prepare(
      `SELECT d, COUNT(DISTINCT ticket_id) AS tickets FROM (
         SELECT date(started_at) AS d, ticket_id FROM time_entries
         WHERE user_id = ? AND started_at BETWEEN ? AND ? AND (:activityBranch IS NULL OR ticket_id IN (SELECT id FROM repair_tickets WHERE branch_id=:activityBranch))
         UNION
         SELECT date(created_at) AS d, ticket_id FROM repair_status_history
         WHERE user_id = ? AND created_at BETWEEN ? AND ? AND (:activityBranch IS NULL OR ticket_id IN (SELECT id FROM repair_tickets WHERE branch_id=:activityBranch))
       ) GROUP BY d`,
    )
    .all({activityBranch:branchId},userId, from, to, userId, from, to) as any[];

  const minutes = new Map<string, number>(minutesRows.map((r) => [r.d, r.minutes ?? 0]));
  const tickets = new Map<string, number>(ticketRows.map((r) => [r.d, r.tickets ?? 0]));

  return new Map<string, { minutes: number; tickets: number }>(
    [...new Set([...minutes.keys(), ...tickets.keys()])].map((d) => [
      d,
      { minutes: minutes.get(d) ?? 0, tickets: tickets.get(d) ?? 0 },
    ]),
  );
}

/** خلاصهٔ متنیِ خودکار — قابل ویرایش توسط کارمند */
export function autoSummary(a: DayActivity): string {
  const n = (x: number) => toFaDigits(x);
  const parts: string[] = [];
  if (a.ticketCount) parts.push(`روی ${n(a.ticketCount)} دستگاه کار کردم`);
  const h = Math.floor(a.workedMinutes / 60);
  const m = a.workedMinutes % 60;
  if (h || m) {
    const timeStr = [h ? `${n(h)} ساعت` : "", m ? `${n(m)} دقیقه` : ""].filter(Boolean).join(" و ");
    parts.push(`مجموع ${timeStr} زمان کار ثبت شد`);
  }
  if (a.deliveries) parts.push(`${n(a.deliveries)} دستگاه به مرحله تحویل رسید`);
  if (a.estimatesApproved) parts.push(`${n(a.estimatesApproved)} برآورد تأیید شد`);
  return parts.length ? `${parts.join("؛ ")}.` : "";
}
