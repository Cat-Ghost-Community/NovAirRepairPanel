import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok, readJson, audit, HttpError } from "@/lib/api";

export const dynamic = "force-dynamic";

/** فهرست خدمات — همین خدمات در برآورد و فاکتور استفاده می‌شوند */
export async function GET(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "settings.view");
    const db = getDb();
    const services = db.prepare("SELECT * FROM services WHERE COALESCE(is_active,1) = 1 ORDER BY category, name").all() as any[];
    return ok({ services });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "settings.edit");
    const b = await readJson(req);
    const name = String(b.name ?? "").trim();
    if (!name) throw new HttpError(400, "نام خدمت الزامی است.");
    const price = Math.max(0, Math.round(Number(b.price ?? 0) || 0));
    const db = getDb();
    const dup = db.prepare("SELECT id FROM services WHERE name = ?").get(name) as any;
    if (dup) throw new HttpError(400, "خدمتی با همین نام وجود دارد.");
    const id = db
      .prepare("INSERT INTO services(name, category, price, cost, duration_min, warranty_days, description) VALUES(?,?,?,?,?,?,?)")
      .run(
        name,
        b.category ?? "عمومی",
        price,
        Math.max(0, Math.round(Number(b.cost ?? 0) || 0)),
        b.duration_min == null || b.duration_min === "" ? null : Math.max(0, Math.round(Number(b.duration_min))),
        Math.max(0, Math.round(Number(b.warranty_days ?? 90) || 0)),
        b.description ?? null
      ).lastInsertRowid as number;
    audit(session, "create", "service", id, null, { name, price });
    return ok({ id });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "settings.edit");
    const b = await readJson(req);
    const id = Number(b.id);
    if (!id) throw new HttpError(400, "خدمت مشخص نشده است.");
    const db = getDb();
    const before = db.prepare("SELECT * FROM services WHERE id = ?").get(id) as any;
    if (!before) throw new HttpError(404, "خدمت یافت نشد.");
    const name = b.name !== undefined ? String(b.name).trim() : before.name;
    if (!name) throw new HttpError(400, "نام خدمت الزامی است.");
    const price = b.price !== undefined ? Math.max(0, Math.round(Number(b.price) || 0)) : before.price;
    const cost = b.cost !== undefined ? Math.max(0, Math.round(Number(b.cost) || 0)) : before.cost;
    const duration = b.duration_min !== undefined ? (b.duration_min === "" ? null : Math.max(0, Math.round(Number(b.duration_min)))) : before.duration_min;
    const warranty = b.warranty_days !== undefined ? Math.max(0, Math.round(Number(b.warranty_days) || 0)) : before.warranty_days;
    db.prepare("UPDATE services SET name = ?, category = ?, price = ?, cost = ?, duration_min = ?, warranty_days = ?, description = ? WHERE id = ?")
      .run(name, b.category ?? before.category, price, cost, duration, warranty, b.description ?? before.description, id);
    audit(session, "edit", "service", id, before, { name, price });
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "settings.edit");
    const b = await readJson(req);
    const id = Number(b.id);
    if (!id) throw new HttpError(400, "خدمت مشخص نشده است.");
    const db = getDb();
    const used = db.prepare("SELECT COUNT(*) c FROM ticket_items WHERE kind = 'service' AND ref_id = ?").get(id) as any;
    if (Number(used?.c ?? 0) > 0) {
      throw new HttpError(400, "این خدمت در پذیرش‌های ثبت‌شده استفاده شده — برای حفظ سابقه حذف نمی‌شود.");
    }
    db.prepare("DELETE FROM services WHERE id = ?").run(id);
    audit(session, "delete", "service", id, null, null);
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
