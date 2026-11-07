import { requirePageAccess } from "@/lib/page-access";
import { getDb } from "@/lib/db/schema";
import { toFaDigits } from "@/lib/format";
import { SerialsClient } from "./serials-client";
import { getSessionByToken, canUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {activeBranch,BRANCH_COOKIE} from "@/lib/branch";

export const dynamic = "force-dynamic";

const STATUS_FA: Record<string, string> = { in_stock: "در انبار", sold: "فروخته‌شده", in_repair: "در تعمیر", returned: "مرجوعی" };

export default async function SerialsPage() {
  await requirePageAccess("/serials");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "inventory.view")) redirect("/");
  const db = getDb();
  const branch=activeBranch(session,cookieStore.get(BRANCH_COOKIE)?.value).branchId;
  const parts = db.prepare("SELECT id, name, sku AS part_code FROM parts WHERE track_serial = 1 ORDER BY name LIMIT 500").all() as any[];
  const locations = db.prepare("SELECT id, name FROM inventory_locations WHERE (? IS NULL OR branch_id=?) ORDER BY name").all(branch,branch) as any[];
  const suppliers = db.prepare("SELECT id, name FROM suppliers ORDER BY name").all() as any[];
  const total = db.prepare(`SELECT COUNT(*) c FROM serialized_parts s LEFT JOIN inventory_locations l ON l.id=s.location_id LEFT JOIN repair_tickets t ON t.id=s.ticket_id LEFT JOIN sales sale ON sale.id=s.sale_id WHERE (? IS NULL OR COALESCE(l.branch_id,t.branch_id,sale.branch_id)=?)`).get(branch,branch) as any;

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">کالای سریال‌دار</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          {total.c > 0 ? `${toFaDigits(total.c)} سریال ثبت‌شده — رهگیری از خرید تا فروش` : "ثبت سریال گوشی، لپ‌تاپ و کالای ارزشمند برای رهگیری کامل"}
        </p>
      </div>
      <SerialsClient
        key={branch??'all'}
        canEdit={canUser(session,'inventory.edit')}
        parts={JSON.parse(JSON.stringify(parts))}
        locations={JSON.parse(JSON.stringify(locations))}
        suppliers={JSON.parse(JSON.stringify(suppliers))}
      />
    </div>
  );
}
