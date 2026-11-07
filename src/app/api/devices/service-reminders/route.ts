import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresDeviceSupportHttp} from '@/lib/db/pg-device-support-http';
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, fail, ok, requirePerm, readJson, audit, validate, HttpError } from "@/lib/api";
import { atomic } from "@/lib/db/transaction";
import { activeBranch, BRANCH_COOKIE } from "@/lib/branch";
import {assertBranchProfileWrite} from "@/lib/branch-access";

export const dynamic = "force-dynamic";

/** یادآور سرویس دوره‌ای: دستگاه‌هایی که next_service_date آن‌ها رسیده یا نزدیک است */
export async function GET(req: NextRequest) {
  if(postgresIntegration())return postgresDeviceSupportHttp(req,'service-reminders');
  try {
    const session = requireSession(req);
    requirePerm(session, "devices.view");
    const db = getDb();
    const branch = activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    const rows = db
      .prepare(
        `SELECT d.id, d.brand, d.model, d.type, d.next_service_date, d.service_interval_days,
                c.id customer_id, c.first_name || ' ' || c.last_name customer, c.mobile,
                julianday(d.next_service_date) - julianday('now') days_left
         FROM devices d JOIN customers c ON c.id = d.customer_id
         WHERE d.next_service_date IS NOT NULL AND d.is_archived = 0
           AND (? IS NULL OR d.id IN (SELECT device_id FROM device_branch_access WHERE branch_id=?))
           AND julianday(d.next_service_date) - julianday('now') <= 7
         ORDER BY d.next_service_date LIMIT 50`
      )
      .all(branch, branch) as any[];
    // دستگاه‌های سرویس‌شده که interval دارند ولی next_service_date خالی است
    const periodic = db
      .prepare(
        `SELECT d.id, d.brand, d.model, d.service_interval_days,
                MAX(t.delivered_at) last_service
         FROM devices d JOIN repair_tickets t ON t.device_id = d.id
         WHERE d.service_interval_days IS NOT NULL AND d.next_service_date IS NULL AND t.delivered_at IS NOT NULL
           AND (? IS NULL OR t.branch_id=?)
         GROUP BY d.id LIMIT 20`
      )
      .all(branch, branch) as any[];
    return ok({ due_soon: rows, periodic_needing_schedule: periodic });
  } catch (e) {
    return fail(e);
  }
}

/** ثبت/به‌روزرسانی سرویس دوره‌ای دستگاه */
export async function POST(req: NextRequest) {
  if(postgresIntegration())return postgresDeviceSupportHttp(req,'service-reminders');
  try {
    const session = requireSession(req);
    requirePerm(session, "devices.edit");
    const b = await readJson(req);
    const db = getDb();
    const id = validate.id(b.device_id);
    assertBranchProfileWrite(db,session,req.cookies.get(BRANCH_COOKIE)?.value,"device",id);
    const date = b.next_service_date || null;
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)))) throw new HttpError(400,"تاریخ سرویس معتبر نیست.");
    const interval = b.service_interval_days == null || b.service_interval_days === "" ? null : Number(b.service_interval_days);
    if (interval != null && (!Number.isSafeInteger(interval) || interval < 1 || interval > 36500)) throw new HttpError(400,"دورهٔ سرویس باید تعداد روز صحیح و مثبت باشد.");
    return atomic(db,()=>{
    const changed = db.prepare("UPDATE devices SET next_service_date = ?, service_interval_days = ? WHERE id = ? RETURNING id").get(date,interval,id);
    if(!changed) throw new HttpError(404,"دستگاه یافت نشد.");
    audit(session, "update", "device", id, null, { next_service_date: date, service_interval_days: interval });
    return ok({ done: true });
    });
  } catch (e) {
    return fail(e);
  }
}
