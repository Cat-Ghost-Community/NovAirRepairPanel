import {repairReadAssignedOnly} from '@/lib/repair-workflow';
import { requirePageAccess } from "@/lib/page-access";
import { getDb } from "@/lib/db/schema";
import { getSessionByToken, canUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { plainRows } from "@/lib/format";
import LabelsClient from "./labels-client";
import {activeBranch,BRANCH_COOKIE} from "@/lib/branch";

export const dynamic = "force-dynamic";

export default async function LabelsPage() {
  await requirePageAccess("/labels");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "inventory.view")) redirect("/");
  const store = await cookies();
  const db = getDb();
  const branch=activeBranch(session,cookieStore.get(BRANCH_COOKIE)?.value).branchId;
  const parts = plainRows(db.prepare("SELECT id, name, barcode, price FROM parts WHERE is_active = 1 ORDER BY name LIMIT 200").all() as any[]);
  const recentTickets = plainRows(
    db.prepare(`SELECT t.id, t.number, c.first_name || ' ' || c.last_name customer, d.brand || ' ' || d.model device
              FROM repair_tickets t JOIN customers c ON c.id = t.customer_id JOIN devices d ON d.id = t.device_id
              WHERE (? IS NULL OR t.branch_id=?) AND (?=0 OR t.technician_id=? OR t.technician2_id=?) ORDER BY t.created_at DESC LIMIT 30`).all(branch,branch,repairReadAssignedOnly(session)?1:0,session.user.id,session.user.id) as any[]
  );
  return <LabelsClient parts={parts} tickets={recentTickets} />;
}
