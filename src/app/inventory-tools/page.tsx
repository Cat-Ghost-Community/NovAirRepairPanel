import { requirePageAccess } from "@/lib/page-access";
import { getDb } from "@/lib/db/schema";
import { getSessionByToken, canUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { plainRows } from "@/lib/format";
import ToolsClient from "./tools-client";
import { activeBranch, BRANCH_COOKIE } from "@/lib/branch";

export const dynamic = "force-dynamic";

export default async function InventoryToolsPage() {
  await requirePageAccess("/inventory-tools");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "inventory.edit")) redirect("/");
  const db = getDb();
  const scope = activeBranch(session, cookieStore.get(BRANCH_COOKIE)?.value);
  const locations = plainRows(db.prepare("SELECT id, name, is_default FROM inventory_locations WHERE (@branch IS NULL OR branch_id=@branch) ORDER BY id").all({ branch: scope.branchId }) as any[]);
  const categories = plainRows(
    db.prepare("SELECT DISTINCT category FROM parts WHERE category IS NOT NULL AND is_active = 1 ORDER BY category").all() as any[]
  );
  const parts = plainRows(
    db.prepare(`SELECT p.id,p.name,p.quantity_precision,COALESCE(SUM(CASE WHEN @branch IS NULL OR l.branch_id=@branch THEN MAX(0,s.qty-s.reserved) ELSE 0 END),0) stock
                FROM parts p LEFT JOIN inventory_stock s ON s.part_id=p.id LEFT JOIN inventory_locations l ON l.id=s.location_id
                WHERE p.is_active=1 GROUP BY p.id ORDER BY p.name LIMIT 300`).all({ branch: scope.branchId }) as any[]
  );
  return <ToolsClient locations={locations} categories={categories.map((c: any) => c.category)} parts={parts} />;
}
