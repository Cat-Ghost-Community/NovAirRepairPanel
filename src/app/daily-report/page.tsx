import { activeBranch, BRANCH_COOKIE } from "@/lib/branch";
import { requirePageAccess } from "@/lib/page-access";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db/schema";
import { getSessionByToken } from "@/lib/auth";
import { toJalaali, toGregorian, jalaaliMonthLength, jWeekdayIndexOfMonthStart } from "@/lib/jdate";
import { monthOverview } from "@/lib/daily-report";
import { DailyReportClient } from "./daily-report-client";
import type { DayCell } from "./calendar-view";
import type { DailyReport } from "./report-sheet";

export const dynamic = "force-dynamic";

export default async function DailyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ jy?: string; jm?: string }>;
}) {
  await requirePageAccess("/daily-report");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");

  const sp = await searchParams;
  const now = new Date();
  const tj = toJalaali(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
  const requestedYear = Number(sp.jy);
  const requestedMonth = Number(sp.jm);
  const jy = Number.isInteger(requestedYear) && requestedYear >= 1200 && requestedYear <= 1600 ? requestedYear : tj.jy;
  const jm = Number.isInteger(requestedMonth) && requestedMonth >= 1 && requestedMonth <= 12 ? requestedMonth : tj.jm;

  const monthLen = jalaaliMonthLength(jy, jm);
  const firstWeekday = jWeekdayIndexOfMonthStart(jy, jm);
  const firstG = toGregorian(jy, jm, 1);
  const lastG = toGregorian(jy, jm, monthLen);
  const fromIso = `${firstG.gy}-${String(firstG.gm).padStart(2, "0")}-${String(firstG.gd).padStart(2, "0")}`;
  const toIso = `${lastG.gy}-${String(lastG.gm).padStart(2, "0")}-${String(lastG.gd).padStart(2, "0")}`;
  const pad = (n: number) => String(n).padStart(2, "0");
  const todayIso = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;

  const db = getDb();
  const userId = session.user.id;
  const branch = activeBranch(session,cookieStore.get(BRANCH_COOKIE)?.value).branchId;

  const reportRows = db
    .prepare(
      `SELECT * FROM daily_reports WHERE user_id = ? AND report_date BETWEEN ? AND ? AND (? IS NULL OR branch_id=?) ORDER BY report_date`,
    )
    .all(userId, fromIso, toIso,branch,branch) as any[];

  // ردیف‌های node:sqlite پروتوتایل null دارند و React آن‌ها را به کلاینت نمی‌پذیرد
  const plainReports = JSON.parse(JSON.stringify(reportRows)) as DailyReport[];
  const reports: Record<string, DailyReport> = {};
  for (const r of plainReports) reports[r.report_date] = r;

  const overview = monthOverview(userId, fromIso, toIso,branch);

  // خانه‌های تقویم: وضعیت گزارش + فعالیت واقعی هر روز
  const days: DayCell[] = [];
  for (let jd = 1; jd <= monthLen; jd++) {
    const g = toGregorian(jy, jm, jd);
    const iso = `${g.gy}-${String(g.gm).padStart(2, "0")}-${String(g.gd).padStart(2, "0")}`;
    const rep = reports[iso];
    const ov = overview.get(iso);
    const isFuture = iso > todayIso;
    const isToday = iso === todayIso;
    const state: DayCell["state"] = rep
      ? rep.status === "submitted"
        ? "submitted"
        : "draft"
      : isFuture
        ? "none"
        : (ov?.minutes || ov?.tickets) || (jy === tj.jy && jm === tj.jm && jd <= tj.jd)
          ? "missing"
          : "none";

    days.push({
      iso,
      jd,
      weekday: new Date(Date.UTC(g.gy, g.gm - 1, g.gd)).getUTCDay(),
      inMonth: true,
      isToday,
      isFuture,
      state,
      mood: rep?.mood ?? null,
      minutes: rep?.worked_minutes ?? ov?.minutes ?? 0,
      tickets: rep?.ticket_count ?? ov?.tickets ?? 0,
    });
  }

  // آمار ماه
  const submitted = plainReports.filter((r) => r.status === "submitted").length;
  const moods = reportRows.filter((r) => r.status === "submitted" && r.mood).map((r) => r.mood);
  const avgMood = moods.length ? moods.reduce((a: number, b: number) => a + b, 0) / moods.length : 0;

  // زنجیرهٔ پیوسته
  let streak = 0;
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const streakFrom = new Date(todayMs - 119 * 86400000).toISOString().slice(0, 10);
  const submittedDates = new Set((db.prepare(`SELECT report_date FROM daily_reports WHERE user_id=? AND status='submitted' AND report_date BETWEEN ? AND ? AND (? IS NULL OR branch_id=?)`).all(userId, streakFrom, todayIso, branch, branch) as {report_date: string}[]).map(row => row.report_date));
  for (let i = 0; i < 120; i++) {
    const iso = new Date(todayMs - i * 86400000).toISOString().slice(0, 10);
    if (submittedDates.has(iso)) streak++;
    else if (i === 0) continue;
    else break;
  }

  const monthMinutes = [...overview.values()].reduce((s, v) => s + v.minutes, 0);

  return (
    <DailyReportClient
      key={`${jy}-${jm}-${branch ?? "all"}`}
      jy={jy}
      jm={jm}
      monthLen={monthLen}
      firstWeekday={firstWeekday}
      days={days}
      reports={reports}
      stats={{
        submitted,
        drafts: plainReports.length - submitted,
        streak,
        avgMood,
        totalMinutes: monthMinutes,
      }}
      canWrite={!!session.user.id}
      todayIso={todayIso}
    />
  );
}
