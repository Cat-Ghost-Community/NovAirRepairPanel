import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok, readJson, audit, validate, HttpError } from "@/lib/api";

export const dynamic = "force-dynamic";

/** ویرایش/فعال‌سازی/حذف یک تعرفهٔ تعمیرات */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = requireSession(req);
    requirePerm(session, "settings.edit");
    const { id } = await params;
    const tariffId = Number(id);
    const db = getDb();
    const before = db.prepare("SELECT * FROM repair_tariffs WHERE id = ?").get(tariffId) as any;
    if (!before) throw new HttpError(404, "تعرفه یافت نشد.");

    const b = await readJson(req);
    const deviceType =
      b.device_type !== undefined ? validate.maxLength(validate.required(b.device_type, "نوع دستگاه"), 60, "نوع دستگاه") : before.device_type;
    const title = b.title !== undefined ? validate.maxLength(validate.required(b.title, "عنوان تعرفه"), 160, "عنوان تعرفه") : before.title;
    const brand = b.brand !== undefined ? (b.brand ? validate.maxLength(b.brand, 60, "برند") : null) : before.brand;
    const notes = b.notes !== undefined ? (b.notes ? validate.maxLength(b.notes, 300, "یادداشت") : null) : before.notes;
    const laborPrice = b.labor_price !== undefined ? validate.amount(b.labor_price, "اجرت") : Number(before.labor_price ?? 0);
    const warrantyDays =
      b.warranty_days !== undefined ? Math.max(0, Math.round(Number(b.warranty_days) || 0)) : Number(before.warranty_days ?? 0);
    const durationMin =
      b.duration_min === undefined
        ? before.duration_min
        : b.duration_min === "" || b.duration_min == null
          ? null
          : Math.max(0, Math.round(Number(b.duration_min)));
    const isActive = b.is_active === undefined ? Number(before.is_active ?? 1) : b.is_active ? 1 : 0;

    const dup = db
      .prepare("SELECT id FROM repair_tariffs WHERE device_type = ? AND title = ? AND COALESCE(brand,'') = COALESCE(?,'') AND id != ?")
      .get(deviceType, title, brand, tariffId) as any;
    if (dup) throw new HttpError(400, "تعرفه‌ای با همین عنوان برای این نوع دستگاه از قبل ثبت شده است.");

    db.prepare(
      `UPDATE repair_tariffs
       SET device_type = ?, brand = ?, title = ?, labor_price = ?, duration_min = ?, warranty_days = ?, notes = ?,
           is_active = ?, updated_by = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(deviceType, brand, title, laborPrice, durationMin, warrantyDays, notes, isActive, session.user.id, tariffId);

    audit(
      session,
      "update",
      "repair_tariff",
      tariffId,
      { title: before.title, labor_price: before.labor_price, is_active: before.is_active },
      { title, labor_price: laborPrice, is_active: isActive }
    );
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = requireSession(req);
    requirePerm(session, "settings.edit");
    const { id } = await params;
    const tariffId = Number(id);
    const db = getDb();
    const before = db.prepare("SELECT * FROM repair_tariffs WHERE id = ?").get(tariffId) as any;
    if (!before) throw new HttpError(404, "تعرفه یافت نشد.");
    db.prepare("DELETE FROM repair_tariffs WHERE id = ?").run(tariffId);
    audit(session, "delete", "repair_tariff", tariffId, { device_type: before.device_type, title: before.title, labor_price: before.labor_price }, null);
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
