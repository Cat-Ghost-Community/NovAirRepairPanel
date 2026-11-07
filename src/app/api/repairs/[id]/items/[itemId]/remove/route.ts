import { requireRepairAccess } from "@/lib/repair-access";
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, fail, ok, auditRecord, requirePerm,HttpError,readJson } from "@/lib/api";
import { atomic } from "@/lib/db/transaction";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const session = requireSession(req);
    requirePerm(session, "repairs.parts.add");
    await readJson(req);
    const { id, itemId } = await params;
    requireRepairAccess(session, Number(id), req.cookies.get("repaid_branch")?.value);
    const db = getDb();
    return atomic(db, () => {
    requireRepairAccess(session,Number(id),req.cookies.get('repaid_branch')?.value);
    const item = db.prepare("SELECT * FROM ticket_items WHERE id = ? AND ticket_id = ?").get(Number(itemId), Number(id)) as any;
    if (!item) return Response.json({ error: "قلم یافت نشد." }, { status: 404 });
    if (item.consumed) return Response.json({ error: "این قلم قبلاً مصرف و فاکتور شده است." }, { status: 400 });
    const ticket=db.prepare('SELECT t.branch_id,s.name FROM repair_tickets t JOIN repair_statuses s ON s.id=t.status_id WHERE t.id=?').get(Number(id))!;
    if(ticket.name==='Cancelled'||db.prepare("SELECT id FROM invoices WHERE ticket_id=? AND status!='draft' LIMIT 1").get(Number(id)))throw new HttpError(409,'حفظ سابقهٔ پذیرش لغوشده یا صورتحساب‌شده الزامی است؛ اصلاح مستند لازم است.');
    if(item.kind==='part'&&db.prepare("SELECT id FROM inventory_movements WHERE part_id=? AND qty<0 AND ((ref_type='ticket_item' AND ref_id=?) OR (ref_type='ticket' AND ref_id=?)) LIMIT 1").get(item.ref_id,Number(itemId),Number(id)))throw new HttpError(409,'خروج واقعی یا سابقهٔ مبهم قطعه وجود دارد؛ برگشت فیزیکی و رسید مستقل لازم است.');
    // Removing an unconsumed quote line is not a physical receipt or stock return.
    db.prepare("DELETE FROM ticket_items WHERE id = ?").run(Number(itemId));
    auditRecord(db,session,"remove","ticket_item",Number(itemId),item,{ticket_id:Number(id),branch_id:ticket.branch_id,physical_stock_changed:false});
    return ok({ ok: true });
    });
  } catch (e) {
    return fail(e);
  }
}
