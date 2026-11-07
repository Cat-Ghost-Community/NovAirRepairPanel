import {enforceRepairWorkflow} from '@/lib/repair-workflow';
import { requireRepairAccess } from "@/lib/repair-access";
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, fail, ok, readJson, audit, requirePerm, validate, HttpError } from "@/lib/api";
import { durableJsonResponse } from "@/lib/idempotency";
import { moveStock } from "@/lib/inventory";
import { multiplyRial, quantityValue } from "@/lib/money";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = requireSession(req);
    requirePerm(session, "repairs.parts.add");
    const { id } = await params;
    const ticketId = validate.id(id);
    const cookie = req.cookies.get("repaid_branch")?.value;
    const ticket = requireRepairAccess(session, ticketId, cookie);
    const body = await readJson(req);
    const lines = body.items === undefined ? [body] : body.items;
    if (!Array.isArray(lines) || lines.length === 0 || lines.length > 100) throw new HttpError(400, "از یک تا صد قلم معتبر انتخاب کنید.");
    const db = getDb();
    return durableJsonResponse(db, { actorId: session.user.id, branchId: Number(ticket.branch_id), operation: "repair_items",
      key: req.headers.get("idempotency-key"), payload: { ticket_id: ticketId, ...body } }, () => {
      requireRepairAccess(session, ticketId, cookie);
      enforceRepairWorkflow(session,ticketId,true,db);
      if (db.prepare("SELECT id FROM invoices WHERE ticket_id=? AND status!='cancelled' LIMIT 1").get(ticketId)) throw new HttpError(409, "برای تغییر اقلام، ابتدا فاکتور فعال را از مسیر مجاز اصلاح یا لغو کنید.");
      const ids: number[] = [];
      const insert = db.prepare("INSERT INTO ticket_items(ticket_id,kind,ref_id,name,qty,unit_price,cost,warranty_days,added_by,consumed) VALUES(?,?,?,?,?,?,?,?,?,1)");
      for (const line of lines) {
        if (!line || typeof line !== "object" || Array.isArray(line)) throw new HttpError(400, "ساختار قلم معتبر نیست.");
        const kind = line.kind ?? (line.name != null ? "labor" : "");
        if (!["part", "service", "labor"].includes(kind)) throw new HttpError(400, "نوع قلم معتبر نیست.");
        const qty = quantityValue(line.qty ?? 1);
        if (qty <= 0 || qty > 1000000) throw new HttpError(400, "تعداد قلم معتبر نیست.");
        const ref = line.ref_id == null ? null : validate.id(line.ref_id);
        let name = typeof line.name === "string" ? line.name : "";
        let cost = 0;
        let price = line.unit_price == null ? 0 : validate.amount(line.unit_price, "قیمت");
        let warranty = 0;
        if (kind !== "labor") {
          const source = kind === "part"
            ? db.prepare("SELECT name,price,avg_cost,purchase_price FROM parts WHERE id=? AND is_active=1").get(ref)
            : db.prepare("SELECT name,price,cost,warranty_days FROM services WHERE id=? AND is_active=1").get(ref);
          if (!source) throw new HttpError(404, kind === "part" ? "کالا یافت نشد." : "خدمت یافت نشد.");
          name = String(source.name);
          const referencePrice = validate.amount(source.price, "قیمت مرجع");
          if (line.unit_price != null && price !== referencePrice) requirePerm(session, "invoices.edit");
          price = line.unit_price == null ? referencePrice : price;
          cost = validate.amount(kind === "part" ? source.avg_cost ?? source.purchase_price ?? 0 : source.cost ?? 0, "بهای واحد");
          warranty = Number(source.warranty_days ?? 0);
        } else {
          name = validate.maxLength(validate.required(name, "شرح اجرت"), 200, "شرح اجرت");
          if (line.unit_price == null) throw new HttpError(400, "مبلغ اجرت را صریح وارد کنید؛ اجرت رایگان را با صفر مشخص کنید.");
          warranty = Number(line.warranty_days ?? 0);
        }
        if (!Number.isSafeInteger(warranty) || warranty < 0) throw new HttpError(400, "مدت ضمانت معتبر نیست.");
        multiplyRial(price, qty); multiplyRial(cost, qty);
        const itemId = Number(insert.run(ticketId, kind, ref, name, qty, price, cost, warranty, session.user.id).lastInsertRowid);
        if (kind === "part") moveStock({ part_id: ref!, qty: -qty, type: "repair_consumption", ref_type: "ticket_item", ref_id: itemId,
          unit_cost: cost, user_id: session.user.id, branch_id: Number(ticket.branch_id), note: `مصرف پذیرش ${ticketId}` });
        audit(session, "add", "ticket_item", itemId, null, { ticket_id: ticketId, kind, ref_id: ref, qty, unit_price: price, cost, branch_id: ticket.branch_id });
        ids.push(itemId);
      }
      return ok({ ok: true, item_ids: ids });
    });
  } catch (error) { return fail(error); }
}
