import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok } from "@/lib/api";
import { activeBranch, BRANCH_COOKIE } from "@/lib/branch";

export async function GET(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "inventory.view");
    const branch = activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    const db = getDb();
    let sql = `SELECT p.id, p.name, p.sku, p.barcode, p.price, p.category, COALESCE(SUM(s.qty),0) stock
      FROM parts p LEFT JOIN inventory_stock s ON s.part_id = p.id AND (? IS NULL OR s.location_id IN (SELECT id FROM inventory_locations WHERE branch_id=?)) WHERE p.is_active = 1`;
    const params: any[] = [branch, branch];
    if (q) {
      sql += " AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode = ?)";
      params.push(`%${q}%`, `%${q}%`, q);
    }
    sql += " GROUP BY p.id ORDER BY p.name LIMIT 50";
    return ok({ parts: db.prepare(sql).all(...params) as any[] });
  } catch (e) {
    return fail(e);
  }
}
