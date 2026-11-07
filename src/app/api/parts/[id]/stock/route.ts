import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, fail, ok, readJson, audit, requirePerm, validate, HttpError } from "@/lib/api";
import { moveStock, MovementType } from "@/lib/inventory";
import { activeBranch, BRANCH_COOKIE, recordBranchId } from "@/lib/branch";
import { durableJsonResponse } from "@/lib/idempotency";
import { quantityValue } from "@/lib/money";

const ALLOWED: MovementType[] = ["purchase", "adjustment", "damage", "loss", "supplier_return", "warranty_return"];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = requireSession(req);
    requirePerm(session, "inventory.edit");
    const { id } = await params;
    const partId = validate.id(id, "کالا");
    const b = await readJson(req);
    const db = getDb();
    const type = (b.type ?? "adjustment") as MovementType;
    if (!ALLOWED.includes(type)) throw new HttpError(400, "نوع گردش معتبر نیست؛ انتقال باید از ابزار انتقالِ دوطرفه انجام شود.");
    let qty = quantityValue(b.qty ?? 0, true);
    if (["damage", "loss", "supplier_return"].includes(type) && qty > 0) qty = -qty;
    if (type === "purchase" && qty < 0) qty = -qty;
    if (qty === 0) return Response.json({ error: "تعداد نمی‌تواند صفر باشد." }, { status: 400 });
    const cookie = req.cookies.get(BRANCH_COOKIE)?.value;
    const scope = activeBranch(session, cookie);
    let branchId = recordBranchId(session, cookie);
    if (b.location_id != null) {
      b.location_id = validate.id(b.location_id, "انبار");
      const location = db.prepare("SELECT branch_id FROM inventory_locations WHERE id=?").get(b.location_id) as { branch_id: number | null } | undefined;
      if (!location || location.branch_id == null || (!scope.all && location.branch_id !== scope.branchId)) throw new HttpError(404, "انبار مجاز یافت نشد.");
      branchId = location.branch_id;
    }
    return durableJsonResponse(db, { actorId: session.user.id, branchId, operation: "stock_movement",
      key: req.headers.get("idempotency-key"), payload: { part_id: partId, ...b } }, () => {
    if (!db.prepare("SELECT id FROM parts WHERE id=? AND is_active=1").get(partId)) throw new HttpError(404, "کالا یافت نشد.");
    const cost = b.unit_cost == null ? undefined : validate.amount(b.unit_cost, "بهای واحد");
    if (type === "purchase" && cost == null) throw new HttpError(400, "بهای واقعی واحدِ کالای دریافتی را وارد کنید.");
    moveStock({
      part_id: partId,
      location_id: b.location_id ?? null,
      qty,
      type,
      unit_cost: cost,
      note: b.note ?? null,
      user_id: session.user.id,
      branch_id: branchId,
    });
    audit(session, "stock_" + (qty > 0 ? "in" : "out"), "part", partId, null, { type, qty, note: b.note, branch_id: branchId, unit_cost: cost });
    return ok({ ok: true });
    });
  } catch (e: any) {
    if (e?.name === "InventoryError" || e instanceof RangeError) {
      const msg = /Not enough stock/.test(e.message ?? "")
        ? "موجودی کافی نیست — ابتدا از بخش خرید، کالا را به انبار اضافه کنید."
        : /No inventory location/.test(e.message ?? "")
          ? "هیچ انبار پیش‌فرضی تعریف نشده است — از تنظیمات انبار اضافه کنید."
          : e.message;
      return Response.json({ error: msg }, { status: 400 });
    }
    return fail(e);
  }
}
