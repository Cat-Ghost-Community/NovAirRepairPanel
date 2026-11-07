import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok, readJson, audit, validate, HttpError } from "@/lib/api";

export const dynamic = "force-dynamic";

/** فهرست تعرفهٔ تعمیرات — مدیر اجرت و گارانتی هر نوع دستگاه/ایراد را اینجا تعیین می‌کند */
export async function GET(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "repairs.view");
    const sp = req.nextUrl.searchParams;
    const q = (sp.get("q") ?? "").trim();
    const deviceType = (sp.get("device_type") ?? "").trim();
    const includeInactive = sp.get("include_inactive") === "1";
    const limit = Math.min(1000, Math.max(1, Number(sp.get("limit") ?? 500) || 500));

    const db = getDb();
    const where: string[] = [];
    const params: any[] = [];
    if (!includeInactive) where.push("is_active = 1");
    if (deviceType) {
      where.push("device_type = ?");
      params.push(deviceType);
    }
    if (q) {
      where.push("(title LIKE ? OR device_type LIKE ? OR COALESCE(brand,'') LIKE ? OR COALESCE(notes,'') LIKE ?)");
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    const sql = `SELECT * FROM repair_tariffs ${where.length ? "WHERE " + where.join(" AND ") : ""}
                 ORDER BY device_type, title LIMIT ${limit}`;
    const tariffs = db.prepare(sql).all(...params) as any[];
    const deviceTypes = (db.prepare("SELECT DISTINCT device_type FROM repair_tariffs WHERE is_active = 1 ORDER BY device_type").all() as any[]).map(
      (r) => String(r.device_type)
    );
    const summary = db
      .prepare(
        `SELECT COUNT(*) total,
                COALESCE(SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END),0) active,
                COALESCE(AVG(CASE WHEN is_active = 1 THEN labor_price END),0) avg_price
         FROM repair_tariffs`
      )
      .get() as any;
    return ok({ tariffs: JSON.parse(JSON.stringify(tariffs)), device_types: deviceTypes, summary: JSON.parse(JSON.stringify(summary)) });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "settings.edit");
    const b = await readJson(req);
    const deviceType = validate.maxLength(validate.required(b.device_type, "نوع دستگاه"), 60, "نوع دستگاه");
    const title = validate.maxLength(validate.required(b.title, "عنوان تعرفه"), 160, "عنوان تعرفه");
    const brand = b.brand ? validate.maxLength(b.brand, 60, "برند") : null;
    const notes = b.notes ? validate.maxLength(b.notes, 300, "یادداشت") : null;
    const laborPrice = validate.amount(b.labor_price ?? 0, "اجرت");
    const warrantyDays = Math.max(0, Math.round(Number(b.warranty_days ?? 90) || 0));
    const durationMin = b.duration_min == null || b.duration_min === "" ? null : Math.max(0, Math.round(Number(b.duration_min)));

    const db = getDb();
    const dup = db
      .prepare("SELECT id FROM repair_tariffs WHERE device_type = ? AND title = ? AND COALESCE(brand,'') = COALESCE(?,'')")
      .get(deviceType, title, brand) as any;
    if (dup) throw new HttpError(400, "تعرفه‌ای با همین عنوان برای این نوع دستگاه از قبل ثبت شده است.");

    const id = db
      .prepare(
        `INSERT INTO repair_tariffs(device_type, brand, title, labor_price, duration_min, warranty_days, notes, created_by)
         VALUES(?,?,?,?,?,?,?,?)`
      )
      .run(deviceType, brand, title, laborPrice, durationMin, warrantyDays, notes, session.user.id).lastInsertRowid as number;
    audit(session, "create", "repair_tariff", Number(id), null, { device_type: deviceType, title, labor_price: laborPrice });
    return ok({ id: Number(id) });
  } catch (e) {
    return fail(e);
  }
}
