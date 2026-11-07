import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok } from "@/lib/api";
import { activeBranch, BRANCH_COOKIE } from "@/lib/branch";

export const dynamic = "force-dynamic";

/** «دریافت قیمت از انبار» — قیمت مرجع کالا از دیتابیس معتبر */
export async function GET(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "inventory.view");
    const branch = activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    const id = Number(req.nextUrl.searchParams.get("id"));
    const db = getDb();
    const part = db
      .prepare(
        `SELECT p.id, p.name, p.sku, p.barcode, p.price, p.purchase_price, p.avg_cost,
                COALESCE((SELECT SUM(qty) FROM inventory_stock s JOIN inventory_locations l ON l.id=s.location_id WHERE s.part_id = p.id AND (? IS NULL OR l.branch_id=?)),0) stock
         FROM parts p WHERE p.id = ? AND p.is_active = 1`
      )
      .get(branch, branch, id) as any;
    if (!part) return Response.json({ error: "کالا یافت نشد." }, { status: 404 });
    return ok({
      id: Number(part.id),
      name: String(part.name),
      sku: part.sku ?? part.barcode ?? null,
      price: Number(part.price ?? 0),
      purchase_price: Number(part.purchase_price || part.avg_cost || 0),
      avg_cost: Number(part.avg_cost ?? 0),
      stock: Number(part.stock ?? 0),
    });
  } catch (e) {
    return fail(e);
  }
}
