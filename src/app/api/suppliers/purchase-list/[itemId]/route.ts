import { activeBranch, BRANCH_COOKIE } from "@/lib/branch";
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, fail, ok, readJson, audit, requirePerm, validate } from "@/lib/api";

const STATUSES = ["pending", "ordered", "purchased", "cancelled"];
const PRIORITIES = ["low", "normal", "urgent"];

/** تغییر وضعیت/تعداد/یادداشت یک قلم از لیست خرید تأمین‌کننده */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    const session = requireSession(req);
    requirePerm(session, "suppliers.manage");
    const { itemId } = await params;
    const id = Number(itemId);
    const db = getDb();
    const branch=activeBranch(session,req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    const row = db.prepare("SELECT * FROM supplier_purchase_items WHERE id = ?").get(id) as any;
    if (!row || (branch!=null && row.branch_id!==branch)) return Response.json({ error: "قلم لیست خرید یافت نشد." }, { status: 404 });

    const b = await readJson(req);
    const sets: string[] = [];
    const values: any[] = [];

    if (b.status !== undefined) {
      if (!STATUSES.includes(b.status)) return Response.json({ error: "وضعیت انتخاب‌شده معتبر نیست." }, { status: 400 });
      sets.push("status = ?", "done_at = ?");
      values.push(
        b.status,
        ["purchased", "cancelled"].includes(b.status) ? new Date().toISOString().slice(0, 19).replace("T", " ") : null
      );
    }
    if (b.name !== undefined) {
      sets.push("name = ?");
      values.push(validate.maxLength(validate.required(b.name, "نام کالا"), 160, "نام کالا"));
    }
    if (b.qty !== undefined) {
      sets.push("qty = ?");
      values.push(Math.max(1, Math.round(Number(b.qty) || 1)));
    }
    if (b.est_cost !== undefined) {
      sets.push("est_cost = ?");
      values.push(validate.amount(b.est_cost, "بهای تقریبی"));
    }
    if (b.priority !== undefined) {
      if (!PRIORITIES.includes(b.priority)) return Response.json({ error: "اولویت انتخاب‌شده معتبر نیست." }, { status: 400 });
      sets.push("priority = ?");
      values.push(b.priority);
    }
    if (b.note !== undefined) {
      sets.push("note = ?");
      values.push(b.note ? validate.maxLength(b.note, 300, "یادداشت") : null);
    }
    if (sets.length === 0) return Response.json({ error: "تغییری برای ذخیره وجود ندارد." }, { status: 400 });

    db.prepare(`UPDATE supplier_purchase_items SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
    audit(session, "update", "supplier_purchase_item", id, { status: row.status, qty: row.qty }, { status: b.status ?? row.status });
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    const session = requireSession(req);
    requirePerm(session, "suppliers.manage");
    const { itemId } = await params;
    const id = Number(itemId);
    const db = getDb();
    const branch=activeBranch(session,req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    const row = db.prepare("SELECT * FROM supplier_purchase_items WHERE id = ?").get(id) as any;
    if (!row || (branch!=null && row.branch_id!==branch)) return Response.json({ error: "قلم لیست خرید یافت نشد." }, { status: 404 });
    db.prepare("DELETE FROM supplier_purchase_items WHERE id = ?").run(id);
    audit(session, "delete", "supplier_purchase_item", id, { name: row.name, supplier_id: row.supplier_id }, null);
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
