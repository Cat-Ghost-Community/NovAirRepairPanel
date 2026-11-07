import { getDb } from "@/lib/db/schema";
import { plainRows } from "@/lib/format";
import type { WorkLogRow } from "@/lib/worklog-shared";

/**
 * گزارش کار تعمیرکار روی یک دستگاهِ پذیرش‌شده — «لحظه‌به‌لحظه».
 *
 * هر سه چیزی که هنگام کار روی دستگاه ثبت میشود در یک خط زمانی میآید:
 * زمان‌سنج (start/stop و ثبت دستی با یادداشت)، تغییر وضعیت پذیرش با یادداشت
 * آن، و شرح کارهایی که تعمیرکار روی پذیرش مینویسد. یعنی «چه کسی، چه ساعتی،
 * چه روزی و چه نوشته» — همان چیزی که برای نظارت لازم است.
 *
 * این ماژول به دیتابیس وصل است (node:sqlite) و نباید در کامپوننت کلاینت
 * import شود؛ بخش قابل استفادهٔ کلاینت در `worklog-shared.ts` است.
 */

const MAX_ROWS = 200;

/**
 * خط زمانی کار یک پذیرش، جدیدترین اول.
 * یادداشت‌های «خصوصی» فقط برای نویسنده‌اش و مدیران — دقیقاً مثل تب یادداشت‌ها.
 */
export function ticketWorkLog(ticketId: number, viewer: { id: number; privileged: boolean }): WorkLogRow[] {
  const db = getDb();
  const sql = `WITH ev AS (
    SELECT 'time' AS kind, te.id AS row_id, te.started_at AS ts, te.user_id AS user_id,
           te.minutes_active AS minutes, te.is_manual AS is_manual,
           CASE WHEN te.ended_at IS NULL THEN 1 ELSE 0 END AS running,
           NULL AS status_name, NULL AS status_color, te.note AS body
    FROM time_entries te WHERE te.ticket_id = ?
    UNION ALL
    SELECT 'status', h.id, h.created_at, h.user_id, NULL, NULL, 0, s.name, s.color, h.note
    FROM repair_status_history h
    LEFT JOIN repair_statuses s ON s.id = h.to_status
    WHERE h.ticket_id = ?
    UNION ALL
    SELECT 'note', n.id, n.created_at, n.user_id, NULL, NULL, 0, NULL, NULL, n.body
    FROM repair_notes n
    WHERE n.ticket_id = ? AND (n.kind != 'private' OR n.user_id = ?${viewer.privileged ? " OR n.kind = 'private'" : ""})
  )
  SELECT ev.*, u.name AS user_name, u.avatar_color AS user_color
  FROM ev
  LEFT JOIN users u ON u.id = ev.user_id
  ORDER BY ev.ts DESC, ev.row_id DESC
  LIMIT ?`;
  const rows = db.prepare(sql).all(ticketId, ticketId, ticketId, viewer.id, MAX_ROWS) as any[];
  // رکوردهای node:sqlite پروتوتایل null دارند و React آن‌ها را به کلاینت نمی‌پذیرد
  return plainRows(rows) as WorkLogRow[];
}
