import { requirePageAccess } from "@/lib/page-access";
import { getDb } from "@/lib/db/schema";
import { PosClient } from "./pos-client";
import { getSessionByToken, canUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BRANCH_COOKIE, recordBranchId } from "@/lib/branch";
import { taxRatePct } from "@/lib/finance";

export const dynamic = "force-dynamic";

export default async function PosPage() {
  await requirePageAccess("/pos");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "sales.view")) redirect("/");
  const db = getDb();
  const branchId = recordBranchId(session, cookieStore.get(BRANCH_COOKIE)?.value);
  const branchName = String(db.prepare("SELECT name FROM branches WHERE id=?").get(branchId)?.name ?? "");
  const parts = db
    .prepare(
      `SELECT p.id, p.name, p.sku, p.barcode, p.price, p.wholesale_price, p.price_type, p.category, COALESCE(SUM(CASE WHEN l.id IS NOT NULL THEN s.qty ELSE 0 END),0) stock
       FROM parts p LEFT JOIN inventory_stock s ON s.part_id = p.id
       LEFT JOIN inventory_locations l ON l.id=s.location_id AND l.branch_id=?
       WHERE p.is_active = 1 GROUP BY p.id ORDER BY p.name`
    )
    .all(branchId) as any[];
  const services = db.prepare("SELECT id, name, price FROM services WHERE is_active = 1 ORDER BY name").all() as any[];
  const taxRate = taxRatePct();

  return (
    <div className="h-full overflow-y-auto">
      <PosClient key={branchId} branchId={branchId} branchName={branchName} parts={JSON.parse(JSON.stringify(parts))} services={JSON.parse(JSON.stringify(services))} taxRate={taxRate} />
    </div>
  );
}
