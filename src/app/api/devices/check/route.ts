import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresDeviceSupportHttp} from '@/lib/db/pg-device-support-http';
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok, readJson, audit, HttpError } from "@/lib/api";
import { activeBranch, BRANCH_COOKIE,recordBranchId } from "@/lib/branch";
import {assertBranchProfileWrite} from "@/lib/branch-access";
import { atomic } from "@/lib/db/transaction";

export const dynamic = "force-dynamic";

/** بررسی سریال/IMEI: هشدار تکراری بودن + لیست سیاه دستگاه */
export async function GET(req: NextRequest) {
  if(postgresIntegration())return postgresDeviceSupportHttp(req,'check');
  try {
    const session = requireSession(req);
    requirePerm(session, "repairs.view");
    const db = getDb();
    const branch = activeBranch(session,req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    const sp = req.nextUrl.searchParams;
    const serial = (sp.get("serial") ?? "").trim();
    const imei = (sp.get("imei") ?? "").trim();

    let exists = false;
    if (serial.length >= 4) {
      exists = !!db.prepare("SELECT 1 FROM devices d JOIN customers c ON c.id=d.customer_id WHERE d.serial = ? AND (? IS NULL OR d.id IN (SELECT device_id FROM device_branch_access WHERE branch_id=?))").get(serial,branch,branch);
    }
    if (!exists && imei.length >= 8) {
      exists = !!db.prepare("SELECT 1 FROM devices d JOIN customers c ON c.id=d.customer_id WHERE (d.imei = ? OR d.imei2 = ?) AND (? IS NULL OR d.id IN (SELECT device_id FROM device_branch_access WHERE branch_id=?))").get(imei, imei,branch,branch);
    }

    let blacklisted: { serial: string; imei: string; reason: string } | null = null;
    if (serial || imei) {
      const row = db
        .prepare(`SELECT b.reason, b.serial, b.imei, d.brand, d.model FROM device_blacklist b
                  LEFT JOIN devices d ON d.id = b.device_id
                  WHERE (? IS NULL OR b.branch_id=?) AND ((b.serial IS NOT NULL AND b.serial = ?) OR (b.imei IS NOT NULL AND b.imei = ?)
                     OR (b.device_id IS NOT NULL AND d.serial = ?) OR (b.device_id IS NOT NULL AND (d.imei = ? OR d.imei2 = ?)))`)
        .get(branch,branch,serial || null, imei || null, serial || null, imei || null, imei || null) as any;
      if (row) blacklisted = { serial: row.serial ?? "", imei: row.imei ?? "", reason: row.reason ?? "—" };
    }

    return ok({ exists, blacklisted });
  } catch (e) {
    return fail(e);
  }
}

/** افزودن دستگاه به لیست سیاه */
export async function POST(req: NextRequest) {
  if(postgresIntegration())return postgresDeviceSupportHttp(req,'check');
  try {
    const session = requireSession(req);
    requirePerm(session, "devices.edit");
    const b = await readJson(req);
    const db = getDb();
    if (!b.device_id && !String(b.serial??"").trim() && !String(b.imei??"").trim()) throw new HttpError(400,"دستگاه یا سریال معتبر لازم است.");
    if(b.device_id)assertBranchProfileWrite(db,session,req.cookies.get(BRANCH_COOKIE)?.value,"device",b.device_id);
    const branch=recordBranchId(session,req.cookies.get(BRANCH_COOKIE)?.value);
    return atomic(db,()=>{
    if (b.device_id) {
      db.prepare("UPDATE devices SET is_blacklisted = 1, blacklist_reason = ? WHERE id = ?").run(b.reason ?? "لیست سیاه", b.device_id);
      db.prepare("INSERT INTO device_blacklist(device_id, serial, imei, reason, created_by,branch_id) VALUES(?,?,?,?,?,?)").run(
        b.device_id, b.serial ?? null, b.imei ?? null, b.reason ?? "لیست سیاه", session.user.id,branch
      );
    } else {
      db.prepare("INSERT INTO device_blacklist(serial, imei, reason, created_by,branch_id) VALUES(?,?,?,?,?)").run(
        b.serial ?? null, b.imei ?? null, b.reason ?? "لیست سیاه", session.user.id,branch
      );
    }
    audit(session,"create","device_blacklist",null,null,{device_id:b.device_id??null});
    return ok({ done: true });
    });
  } catch (e) {
    return fail(e);
  }
}
