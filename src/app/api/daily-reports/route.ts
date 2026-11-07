import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, fail, ok, readJson, audit, HttpError } from "@/lib/api";
import { canUser } from "@/lib/auth";
import { dayActivity, reportStats, autoSummary } from "@/lib/daily-report";
import { signatureValidationError } from "@/lib/signature-validation";
import { assertBranchResource } from "@/lib/branch-access";
import { activeBranch, BRANCH_COOKIE, canSwitchBranch } from "@/lib/branch";
import { atomic } from "@/lib/db/transaction";
import {archiveDailyReport} from '@/lib/daily-report-evidence';
import {parseDate} from '@/lib/format';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** GET — گزارش‌های یک کارمند در یک بازه + آمار ماه */
export async function GET(req: NextRequest) {
  try {
    const session = requireSession(req);
    const sp = req.nextUrl.searchParams;
    const targetId = Number(sp.get("user_id") || session.user.id);
    // فقط مدیریت می‌تواند گزارش کارمند دیگر را ببیند
    if (targetId !== session.user.id && !canUser(session, "team.view")) {
      throw new HttpError(403, "فقط مدیر می‌تواند گزارش سایر کارکنان را ببیند.");
    }

    const db = getDb();
    const branch = activeBranch(session,req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    assertBranchResource(db, session, req.cookies.get(BRANCH_COOKIE)?.value, "user", targetId);
    if (!canSwitchBranch(session.user.role) && canSwitchBranch(String(db.prepare("SELECT role FROM users WHERE id=?").get(targetId)?.role))) throw new HttpError(404,"گزارش کاربر در شعبهٔ مجاز یافت نشد.");

    const historyDate=sp.get('history');
    if(historyDate){
      if(!DATE_RE.test(historyDate)||!parseDate(historyDate))throw new HttpError(400,'تاریخ سابقه معتبر نیست.');
      const before=Number(sp.get('before_revision')??Number.MAX_SAFE_INTEGER);
      if(!Number.isSafeInteger(before)||before<0)throw new HttpError(400,'صفحهٔ سابقه معتبر نیست.');
      const report=db.prepare('SELECT id FROM daily_reports WHERE user_id=? AND report_date=? AND (? IS NULL OR branch_id=?)').get(targetId,historyDate,branch,branch);
      if(!report)throw new HttpError(404,'گزارش در شعبهٔ مجاز یافت نشد.');
      const rows=db.prepare('SELECT revision,snapshot_json,reason,created_at FROM daily_report_versions WHERE report_id=? AND revision<? ORDER BY revision DESC LIMIT 6').all(report.id,before);
      return ok({versions:rows.slice(0,5).map(row=>({revision:row.revision,snapshot:JSON.parse(String(row.snapshot_json)),reason:row.reason,created_at:row.created_at})),next:rows.length>5?rows[4].revision:null});
    }

    // جزئیاتِ یک روز مشخص (برای پنل فعالیت) — بدون نیاز به بازهٔ ماه
    const wantActivity = sp.get("activity");
    if (wantActivity) {
      if (!DATE_RE.test(wantActivity)||!parseDate(wantActivity)) throw new HttpError(400, "تاریخ نامعتبر است.");
      const act = dayActivity(targetId, wantActivity,branch);
      const one = db
        .prepare(`SELECT * FROM daily_reports WHERE user_id = ? AND report_date = ? AND (? IS NULL OR branch_id=?)`)
        .get(targetId, wantActivity,branch,branch) as any;
      return ok({ report: one ?? null, activity: act, autoSummary: autoSummary(act) });
    }

    const from = sp.get("from") ?? "";
    const to = sp.get("to") ?? "";
    if (!DATE_RE.test(from) || !DATE_RE.test(to)||!parseDate(from)||!parseDate(to)||from>to||Date.parse(to)-Date.parse(from)>62*86400000) {
      throw new HttpError(400, "بازهٔ تاریخ نامعتبر است.");
    }

    const rows = db
      .prepare(
        `SELECT * FROM daily_reports
         WHERE user_id = ? AND report_date BETWEEN ? AND ? AND (? IS NULL OR branch_id=?)
         ORDER BY report_date`,
      )
      .all(targetId, from, to,branch,branch) as any[];

    const isoDates: string[] = [];
    for (let d = new Date(`${from}T00:00:00Z`).getTime(); ; d += 86400000) {
      const iso = new Date(d).toISOString().slice(0, 10);
      isoDates.push(iso);
      if (iso >= to) break;
      if (isoDates.length > 62) break;
    }
    const today = new Date().toISOString().slice(0, 10);

    const stats = reportStats(targetId, isoDates, today,branch);

    const user = db
      .prepare(`SELECT id, name, role, avatar_color FROM users WHERE id = ?`)
      .get(targetId) as any;

    return ok({
      reports: rows,
      stats: {
        submitted: stats.submitted,
        drafts: stats.drafts,
        streak: stats.streak,
        avgMood: stats.avgMood,
        totalMinutes: stats.totalMinutes,
      },
      days: isoDates,
      today,
      user: user ?? null,
      canWrite: targetId === session.user.id,
      canReview: targetId !== session.user.id && canUser(session, "team.view"),
    });
  } catch (e) {
    return fail(e);
  }
}

/** POST — ثبت/به‌روزرسانی گزارش روز (ذخیرهٔ پیش‌نویس یا ثبت نهایی) */
export async function POST(req: NextRequest) {
  try {
    const session = requireSession(req);
    const b = await readJson(req);
    const date = String(b.report_date ?? "");
    if (!DATE_RE.test(date)||!parseDate(date)) throw new HttpError(400, "تاریخ گزارش نامعتبر است.");

    const status = b.status === "submitted" ? "submitted" : "draft";
    if(b.status!=null&&!['submitted','draft'].includes(b.status))throw new HttpError(400,'وضعیت گزارش معتبر نیست.');
    const mood = Number(b.mood ?? 3);
    if(!Number.isSafeInteger(mood)||mood<1||mood>5)throw new HttpError(400,'حال‌وهوای گزارش باید بین یک تا پنج باشد.');
    const targetId = b.user_id ? Number(b.user_id) : session.user.id;
    if (targetId !== session.user.id) {
      throw new HttpError(403, "گزارش و امضا فقط توسط خود کارمند ثبت می‌شود؛ مدیر می‌تواند گزارش را بررسی کند.");
    }

    const db = getDb();
    const branch = activeBranch(session,req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    assertBranchResource(db, session, req.cookies.get(BRANCH_COOKIE)?.value, "user", targetId);
    if (!canSwitchBranch(session.user.role) && canSwitchBranch(String(db.prepare("SELECT role FROM users WHERE id=?").get(targetId)?.role))) throw new HttpError(404,"گزارش کاربر در شعبهٔ مجاز یافت نشد.");
    return atomic(db,()=>{

    if (status === "submitted") {
      const summary = String(b.summary ?? "").trim();
      if (summary.length < 10) {
        throw new HttpError(400, "برای ثبت نهایی، خلاصهٔ روز را کمی کامل‌تر بنویسید (حداقل ۱۰ کاراکتر).");
      }
    }

    // آمار واقعیِ روز از داده‌های سامانه محاسبه و همراه گزارش ذخیره می‌شود
    const act = dayActivity(targetId, date,branch);
    const snapshot = JSON.stringify(act.tickets);

    const existing = db
      .prepare(`SELECT * FROM daily_reports WHERE user_id = ? AND report_date = ?`)
      .get(targetId, date) as any;

    if(existing && branch!=null && existing.branch_id!==branch) throw new HttpError(409,"این گزارش متعلق به شعبهٔ فعلی نیست یا انتساب تاریخی آن نیازمند بررسی مدیر شرکت است.");

    const sig = b.signature_data ? String(b.signature_data) : null;
    if(existing&&(!Number.isSafeInteger(b.revision)||b.revision!==existing.revision))throw new HttpError(409,'نسخهٔ گزارش تغییر کرده است؛ صفحه را تازه کنید و تغییرات را دوباره بررسی کنید.');
    const protectedEvidence=existing&&(existing.status==='submitted'||existing.signature_data);
    if(protectedEvidence){
      if(status!=='submitted')throw new HttpError(409,'گزارش امضاشده یا نهایی به پیش‌نویس برنمی‌گردد؛ اصلاح را با امضای تازه ثبت کنید.');
      if(b.resign!==true||!sig||sig===existing.signature_data)throw new HttpError(409,'اصلاح گزارش نهایی به تأیید و امضای تازهٔ خود کارمند نیاز دارد.');
      if(typeof b.correction_reason!=='string'||b.correction_reason.trim().length<10||b.correction_reason.length>1000)throw new HttpError(400,'دلیل اصلاح گزارش را وارد کنید (حداقل ۱۰ نویسه).');
    }
    // Existing evidence is retained byte-for-byte. Only new/replacement images are validated.
    const signatureError=sig&&existing?.signature_data===sig?null:signatureValidationError(sig);
    if(signatureError)throw new HttpError(400,signatureError);
    const hasSigCol = sig;

    if (existing) {
      archiveDailyReport(db,existing,session.user.id,'حفظ نسخهٔ اصلی پیش از اصلاح توسط نویسنده');
      db.prepare(
        `UPDATE daily_reports SET
           summary = ?, achievements = ?, blockers = ?, tomorrow = ?, mood = ?,
           worked_minutes = ?, ticket_count = ?, tickets_json = ?,
           shift_start = ?, shift_end = ?, signature_data = COALESCE(?, signature_data),
           status = ?, submitted_at = CASE WHEN ? = 'submitted' THEN datetime('now') ELSE submitted_at END,
           updated_at = datetime('now'), revision=revision+1
         WHERE id = ?`,
      ).run(
        String(b.summary ?? ""),
        String(b.achievements ?? ""),
        String(b.blockers ?? ""),
        String(b.tomorrow ?? ""),
        mood,
        act.workedMinutes,
        act.ticketCount,
        snapshot,
        String(b.shift_start ?? ""),
        String(b.shift_end ?? ""),
        hasSigCol,
        status,
        status,
        existing.id,
      );
    } else {
      db.prepare(
        `INSERT INTO daily_reports
           (user_id, report_date, summary, achievements, blockers, tomorrow, mood,
            worked_minutes, ticket_count, tickets_json, shift_start, shift_end,
            signature_data, status, submitted_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, CASE WHEN ? = 'submitted' THEN datetime('now') ELSE NULL END)`,
      ).run(
        targetId,
        date,
        String(b.summary ?? ""),
        String(b.achievements ?? ""),
        String(b.blockers ?? ""),
        String(b.tomorrow ?? ""),
        mood,
        act.workedMinutes,
        act.ticketCount,
        snapshot,
        String(b.shift_start ?? ""),
        String(b.shift_end ?? ""),
        hasSigCol,
        status,
        status,
      );
    }

    const saved = db.prepare(`SELECT * FROM daily_reports WHERE user_id = ? AND report_date = ?`).get(targetId,date) as Record<string,unknown>;
    archiveDailyReport(db,saved,session.user.id,protectedEvidence?String(b.correction_reason).trim():'ثبت توسط نویسندهٔ گزارش');
    audit(
      session,
      status === "submitted" ? "submit" : "update",
      "daily_report",
      Number(saved.id),
      existing?{report_date:date,revision:existing.revision,status:existing.status}:null,
      { status, mood,revision:saved.revision,reason:protectedEvidence?b.correction_reason:null },
    );

    return ok({ report: saved, activity: act, autoSummary: autoSummary(act) });
    });
  } catch (e) {
    return fail(e);
  }
}
