import { NextRequest } from "next/server";
import { getDb, nextSeq } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok, readJson, audit, HttpError, validate } from "@/lib/api";
import { activeBranch, BRANCH_COOKIE, recordBranchId } from "@/lib/branch";
import { durableJsonResponse } from "@/lib/idempotency";
import { quantityValue, adjustRialByPercent, rial } from "@/lib/money";
import { moveStock } from "@/lib/inventory";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "inventory.edit");
    const body = await readJson(req);
    const db = getDb();
    const cookie = req.cookies.get(BRANCH_COOKIE)?.value;
    if (body.action === "transfer") {
      body.part_id = validate.id(body.part_id, "کالا");
      body.from_location = validate.id(body.from_location, "انبار مبدأ");
      body.to_location = validate.id(body.to_location, "انبار مقصد");
      const scope = activeBranch(session, cookie);
      const locations = db.prepare("SELECT id,branch_id FROM inventory_locations WHERE id IN (?,?)").all(body.from_location ?? null, body.to_location ?? null);
      if (locations.length !== 2 || locations.some(location => location.branch_id == null || (!scope.all && location.branch_id !== scope.branchId))) throw new HttpError(404, "انبار مجاز یافت نشد.");
    }
    const operationBranch=body.action==='transfer'?Number(db.prepare('SELECT branch_id FROM inventory_locations WHERE id=?').get(body.from_location)!.branch_id):recordBranchId(session,cookie);
    return durableJsonResponse(db, { actorId: session.user.id, branchId: operationBranch, scope: "business",
      operation: "inventory_tools", key: req.headers.get("idempotency-key"), payload: body }, () => {
      if (body.action === "bulk_price") {
        const percent = quantityValue(body.percent);
        const direction = body.direction ?? "up";
        const field = body.field ?? "price";
        if (!Number.isFinite(percent) || percent <= 0 || percent > 200 || !["up", "down"].includes(direction)
          || (direction === "down" && percent > 100) || !["price", "purchase_price"].includes(field)) throw new HttpError(400, "درصد، جهت یا نوع قیمت معتبر نیست.");
        const selected = { category: body.category || null };
        const count = Number(db.prepare("SELECT COUNT(*) count FROM parts WHERE is_active=1 AND (@category IS NULL OR category=@category)").get(selected)?.count);
        if (count > 20000) throw new HttpError(413, "تغییر بیش از بیست هزار کالا باید در دسته‌های کوچک‌تر انجام شود؛ دسته‌بندی انتخاب کنید.");
        const update = db.prepare(`UPDATE parts SET ${field}=? WHERE id=?`);
        let last = 0;
        let affected = 0;
        for (;;) {
          const rows = db.prepare(`SELECT id,${field} price FROM parts WHERE is_active=1 AND id>@last AND (@category IS NULL OR category=@category) ORDER BY id LIMIT 500`)
            .all({ ...selected, last }) as { id: number; price: number }[];
          if (!rows.length) break;
          for (const row of rows) {
            const old = rial(row.price);
            const price = adjustRialByPercent(old, percent, direction);
            update.run(price, row.id);
            audit(session, "bulk_price_item", "part", row.id, { [field]: old }, { [field]: price, operation_key: req.headers.get("idempotency-key") });
            affected++;
          }
          last = rows[rows.length - 1].id;
        }
        audit(session, "bulk_price", "parts", null, null, { percent, direction, field, category: selected.category, affected });
        return ok({ affected });
      }
      if (body.action !== "transfer") throw new HttpError(400, "عملیات انبار معتبر نیست.");
      const quantity = quantityValue(body.qty);
      if (quantity <= 0) throw new HttpError(400, "تعداد انتقال باید بیشتر از صفر باشد.");
      const from = db.prepare("SELECT id,branch_id FROM inventory_locations WHERE id=?").get(body.from_location) as { id: number; branch_id: number } | undefined;
      const to = db.prepare("SELECT id,branch_id FROM inventory_locations WHERE id=?").get(body.to_location) as { id: number; branch_id: number } | undefined;
      const scope = activeBranch(session, cookie);
      if (!from || !to || from.branch_id == null || to.branch_id == null || (!scope.all && (from.branch_id !== scope.branchId || to.branch_id !== scope.branchId))) throw new HttpError(404, "انبار مجاز یافت نشد؛ شعبهٔ انبار را بررسی کنید.");
      if (from.id === to.id) throw new HttpError(400, "انبار مبدأ و مقصد باید متفاوت باشند.");
      const part = db.prepare("SELECT id,avg_cost FROM parts WHERE id=? AND is_active=1").get(body.part_id) as { id: number; avg_cost: number } | undefined;
      if (!part) throw new HttpError(404, "کالا یافت نشد.");
      const number = nextSeq("inventory_transfer", "TRF-");
      const id = Number(db.prepare("INSERT INTO inventory_transfers(number,part_id,from_location,to_location,qty,branch_id,to_branch_id,user_id) VALUES(?,?,?,?,?,?,?,?)")
        .run(number, part.id, from.id, to.id, quantity, from.branch_id, to.branch_id, session.user.id).lastInsertRowid);
      const outgoing=moveStock({part_id:part.id,location_id:from.id,branch_id:from.branch_id,qty:-quantity,type:'transfer_out',unit_cost:rial(part.avg_cost),ref_type:'inventory_transfer',ref_id:id,user_id:session.user.id,note:number});
      moveStock({part_id:part.id,location_id:to.id,branch_id:to.branch_id,qty:quantity,type:'transfer_in',unit_cost:rial(part.avg_cost),extended_cost:outgoing.valued?outgoing.cost:undefined,ref_type:'inventory_transfer',ref_id:id,user_id:session.user.id,note:number});
      audit(session, "transfer", "inventory_transfer", id, null, { number, from: from.id, to: to.id, qty: quantity, branch_id: from.branch_id, to_branch_id: to.branch_id });
      return ok({ done: true, id, number });
    });
  } catch (error) { return fail(error); }
}
