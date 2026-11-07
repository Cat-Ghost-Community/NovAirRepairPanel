import { NextRequest } from "next/server";
import { getDb, nextSeq } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok, readJson, audit, validate, HttpError } from "@/lib/api";
import { recordBranchId, BRANCH_COOKIE } from "@/lib/branch";
import { durableJsonResponse } from "@/lib/idempotency";
import { quantityValue,quantityMicro } from "@/lib/money";
import { moveStock } from "@/lib/inventory";

/** لیست/جستجوی کالا — برای فرم سفارش خرید و انتخاب سریع */
export async function GET(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "inventory.view");
    const sp = req.nextUrl.searchParams;
    const q = (sp.get("q") ?? "").trim();
    const requested = Number(sp.get("limit") ?? 100);
    const limit = Number.isSafeInteger(requested) ? Math.min(200, Math.max(1, requested)) : 100;
    const db = getDb();
    const rows = q
      ? db
          .prepare(
            `SELECT id, sku, barcode, name, unit, price, purchase_price, min_stock, reorder_point, track_serial, category
             FROM parts
             WHERE is_active=1 AND (name LIKE ? OR sku LIKE ? OR barcode LIKE ? OR category LIKE ?)
             ORDER BY name LIMIT ?`
          )
          .all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, limit)
      : db
          .prepare(
            `SELECT id, sku, barcode, name, unit, price, purchase_price, min_stock, reorder_point, track_serial, category
             FROM parts WHERE is_active=1 ORDER BY name LIMIT ?`
          )
          .all(limit);
    return ok({ parts: rows });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "inventory.edit");
    const b = await readJson(req);
    const db = getDb();
    const branchId = recordBranchId(session, req.cookies.get(BRANCH_COOKIE)?.value);
    return durableJsonResponse(db, { actorId: session.user.id, branchId, scope: "business", operation: "part_create",
      key: req.headers.get("idempotency-key"), payload: b }, () => {
    if (typeof b.name !== "string") throw new HttpError(400, "نام کالا باید متن معتبر باشد.");
    const name = validate.maxLength(validate.required(b.name, "نام کالا"), 200, "نام کالا");
    const cost = validate.amount(b.purchase_price ?? 0, "بهای خرید");
    const price = validate.amount(b.price ?? 0, "قیمت فروش");
    const opening = quantityValue(b.opening_qty === undefined ? 0 : b.opening_qty);
    const precision=b.quantity_precision??6;
    if(!Number.isInteger(precision)||precision<0||precision>6)throw new HttpError(400,'دقت تعداد باید عدد صحیح بین صفر تا شش باشد.');
    quantityMicro(opening,precision);
    if (opening < 0) throw new HttpError(400, "موجودی افتتاحیه نمی‌تواند منفی باشد.");
    if (opening > 0 && b.purchase_price == null) throw new HttpError(400, "بهای واحد افتتاحیه الزامی است.");
    const minimum = quantityValue(b.min_stock ?? 0);
    const reorder = b.reorder_point == null ? null : quantityValue(b.reorder_point);
    const supplierId = b.preferred_supplier_id == null || b.preferred_supplier_id === "" ? null : validate.id(b.preferred_supplier_id, "تأمین‌کننده");
    if (supplierId != null && !db.prepare("SELECT id FROM suppliers WHERE id=?").get(supplierId)) throw new HttpError(400, "تأمین‌کننده یافت نشد.");
    if (b.sku != null && typeof b.sku !== "string") throw new HttpError(400, "کد کالا باید متن معتبر باشد.");
    const sku = b.sku ? validate.maxLength(String(b.sku), 64, "کد کالا") : nextSeq("part", "PRT-");
    const dupe = db.prepare("SELECT id FROM parts WHERE sku = ?").get(sku);
    if (dupe) return Response.json({ error: "کالایی با این کد قبلاً ثبت شده است." }, { status: 409 });

    const id = db
      .prepare(
        `INSERT INTO parts(sku, barcode, name, category, brand, compatibility, description, unit, purchase_price, price, min_stock, reorder_point, preferred_supplier_id, location, shelf, bin, track_serial, warranty_days,avg_cost,quantity_precision)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        sku, b.barcode ?? null, name, b.category ?? null,
        b.brand ?? null, b.compatibility ?? null, b.description ?? null, b.unit ?? "pcs",
        cost, price,
        minimum, reorder, supplierId,
        b.location ?? "انبار", b.shelf ?? null, b.bin ?? null, b.track_serial ? 1 : 0, b.warranty_days ?? 0, cost,precision
      ).lastInsertRowid as number;
    if (opening > 0) moveStock({ part_id: id, qty: opening, type: "adjustment", unit_cost: cost, branch_id: branchId,
      user_id: session.user.id, ref_type: "part_opening", ref_id: id, note: "افتتاحیهٔ صریح کالا" });
    audit(session, "create", "part", id, null, { name, sku, purchase_price: cost, price, opening_qty: opening, branch_id: branchId,quantity_precision:precision });
    return ok({ id });
    });
  } catch (e) {
    return fail(e);
  }
}
