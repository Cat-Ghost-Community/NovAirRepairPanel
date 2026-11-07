import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresDeviceSupportHttp} from '@/lib/db/pg-device-support-http';
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok, audit } from "@/lib/api";
import { activeBranch, BRANCH_COOKIE } from "@/lib/branch";
import {atomic} from "@/lib/db/transaction";
import {assertBranchProfileWrite} from "@/lib/branch-access";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if(postgresIntegration())return postgresDeviceSupportHttp(req,'blacklist');
  try {
    const session = requireSession(req);
    requirePerm(session, "devices.view");
    const db = getDb();
    const branch = activeBranch(session,req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    const entries = db.prepare("SELECT id, serial, imei, reason, created_at FROM device_blacklist WHERE (? IS NULL OR branch_id=?) ORDER BY created_at DESC LIMIT 200").all(branch,branch) as any[];
    return ok({ entries });
  } catch (e) {
    return fail(e);
  }
}

/** حذف اشتباه از لیست سیاه (اگر دستگاهی به‌اشتباه ثبت شده باشد) */
export async function DELETE(req: NextRequest) {
  if(postgresIntegration())return postgresDeviceSupportHttp(req,'blacklist');
  try {
    const session = requireSession(req);
    requirePerm(session, "devices.edit");
    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!id) return Response.json({ error: "قلم لیست سیاه مشخص نشده است." }, { status: 400 });
    const db = getDb();
    return atomic(db,()=>{
    const before = db.prepare("SELECT * FROM device_blacklist WHERE id = ?").get(id) as any;
    const branch = activeBranch(session,req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    if (!before || (branch!=null && before.branch_id!==branch)) return Response.json({ error: "قلم لیست سیاه یافت نشد." }, { status: 404 });
    if(before.device_id)assertBranchProfileWrite(db,session,req.cookies.get(BRANCH_COOKIE)?.value,"device",before.device_id);
    db.prepare("DELETE FROM device_blacklist WHERE id = ?").run(id);
    if (before.device_id) {
      const remaining=db.prepare("SELECT reason FROM device_blacklist WHERE device_id=? ORDER BY id DESC LIMIT 1").get(before.device_id);
      db.prepare("UPDATE devices SET is_blacklisted = ?, blacklist_reason = ? WHERE id = ?").run(remaining?1:0,remaining?.reason??null,before.device_id);
    }
    audit(session, "delete", "device_blacklist", id, { serial: before.serial, imei: before.imei, reason: before.reason }, null);
    return ok({ ok: true });
    });
  } catch (e) {
    return fail(e);
  }
}
