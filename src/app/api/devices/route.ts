import { NextRequest } from "next/server";
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresOperationalHttp} from '@/lib/db/pg-operational-http';
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok, readJson, audit,validate,HttpError } from "@/lib/api";
import { addCustomerEvent } from "@/lib/repair";
import { activeBranch, BRANCH_COOKIE, recordBranchId } from "@/lib/branch";
import {atomic} from "@/lib/db/transaction";
import {insertRegisteredDevice} from '@/lib/device-registration';

export async function GET(req: NextRequest) {
  if(postgresIntegration())return postgresOperationalHttp(req,'devices');
  try {
    const session = requireSession(req);
    requirePerm(session, "devices.view");
    const customerId = req.nextUrl.searchParams.get("customer_id");
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    const db = getDb();
    const branch = activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    if (customerId) {
      return ok({ devices: db.prepare("SELECT * FROM devices WHERE customer_id = ? AND is_archived = 0 AND (? IS NULL OR id IN (SELECT device_id FROM device_branch_access WHERE branch_id=?)) ORDER BY created_at DESC LIMIT 200").all(customerId,branch,branch) as any[] });
    }
    if (q) {
      const like = `%${q}%`;
      return ok({
        devices: db
          .prepare(
            `SELECT d.*, c.first_name, c.last_name FROM devices d JOIN customers c ON c.id = d.customer_id
             WHERE (? IS NULL OR d.id IN (SELECT device_id FROM device_branch_access WHERE branch_id=?)) AND (d.model LIKE ? OR d.brand LIKE ? OR d.serial LIKE ? OR d.imei LIKE ?)
             ORDER BY d.created_at DESC LIMIT 20`
          )
          .all(branch, branch, like, like, like, like) as any[],
      });
    }
    return ok({
      devices: db
        .prepare(
          `SELECT d.*, c.first_name, c.last_name FROM devices d JOIN customers c ON c.id = d.customer_id
           WHERE (? IS NULL OR d.id IN (SELECT device_id FROM device_branch_access WHERE branch_id=?)) ORDER BY d.created_at DESC LIMIT 50`
        )
        .all(branch, branch) as any[],
    });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  if(postgresIntegration())return postgresOperationalHttp(req,'devices');
  try {
    const session = requireSession(req);
    requirePerm(session, "devices.create");
    const b = await readJson(req);
    const db = getDb();
    validate.id(b.customer_id);
    const legacyTypes:Record<string,string>={"موبایل":"mobile","لپ‌تاپ":"laptop","دسکتاپ":"desktop","تبلت":"tablet","کنسول بازی":"console","ساعت هوشمند":"smartwatch","پرینتر":"printer","تجهیزات شبکه":"network","سایر":"other"};
    const type=typeof b.type==='string'?(legacyTypes[b.type.trim()]??b.type.trim()):'';
    for(const field of ["brand","model","serial","imei","imei2"])validate.maxLength(b[field],160,"مشخصات دستگاه");
    validate.maxLength(b.notes,4000,"توضیحات دستگاه");
    return atomic(db,()=>{
    const branch = activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value).branchId;

    // duplicate detection by serial/IMEI
    const dupes: any[] = [];
    if (b.imei) dupes.push(...(db.prepare("SELECT d.id, d.brand, d.model FROM devices d JOIN customers c ON c.id=d.customer_id WHERE d.imei = ? AND (? IS NULL OR d.id IN (SELECT device_id FROM device_branch_access WHERE branch_id=?))").all(b.imei, branch, branch) as any[]));
    if (b.serial) dupes.push(...(db.prepare("SELECT d.id, d.brand, d.model FROM devices d JOIN customers c ON c.id=d.customer_id WHERE d.serial = ? AND (? IS NULL OR d.id IN (SELECT device_id FROM device_branch_access WHERE branch_id=?))").all(b.serial, branch, branch) as any[]));
    if (dupes.length > 0 && !b.force) {
      return Response.json({ duplicate: true, error: "دستگاهی با این IMEI/سریال قبلاً ثبت شده است.", duplicates: dupes }, { status: 409 });
    }

    const id=insertRegisteredDevice(db,Number(b.customer_id),type,b,branch??Number(db.prepare("SELECT branch_id FROM customers WHERE id=?").get(Number(b.customer_id))?.branch_id??recordBranchId(session,req.cookies.get(BRANCH_COOKIE)?.value)));
    audit(session, "create", "device", id, null, { brand: b.brand, model: b.model, imei: b.imei });
    addCustomerEvent(b.customer_id, "device", `Device added: ${b.brand} ${b.model}`, type, session.user.id);
    return ok({ id });
    });
  } catch (e) {
    return fail(e);
  }
}
