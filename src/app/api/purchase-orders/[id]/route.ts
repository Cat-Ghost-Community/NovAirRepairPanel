import { NextRequest } from "next/server";
import { getDb, nextSeq } from "@/lib/db/schema";
import { requireSession, fail, ok, readJson, audit, requirePerm, HttpError } from "@/lib/api";
import { moveStock } from "@/lib/inventory";
import { durableJsonResponse } from "@/lib/idempotency";
import { activeBranch } from "@/lib/branch";
import { addQuantity, quantityValue } from "@/lib/money";
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresFinancialRequest} from '@/lib/db/pg-financial-http';
import {postgresPurchaseAction} from '@/lib/db/pg-purchasing';
import {postgresFailure} from '@/lib/db/pg-http';
import {readRequestJson} from '@/lib/request-json';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if(postgresIntegration()){
    try{const {database,schema,token,branchId}=await postgresFinancialRequest(req,'purchasing.manage');const {id}=await params;return Response.json(await postgresPurchaseAction(database,schema,token,branchId,Number(id),req.headers.get('idempotency-key'),await readRequestJson(req)));}catch(error){return postgresFailure(error);}
  }
  try {
    const session = requireSession(req);
    requirePerm(session, "purchasing.manage");
    const { id } = await params;
    const poId = Number(id);
    const b = await readJson(req);
    const db = getDb();
    const source = db.prepare("SELECT branch_id FROM purchase_orders WHERE id=?").get(poId) as { branch_id: number } | undefined;
    const branch = activeBranch(session, req.cookies.get("repaid_branch")?.value);
    if (!source || (!branch.all && source.branch_id !== branch.branchId)) throw new HttpError(404, "سفارش خرید یافت نشد.");
    return durableJsonResponse(db, { actorId: session.user.id, branchId: source.branch_id, operation: "purchase_order_action",
      key: req.headers.get("idempotency-key"), payload: { po_id: poId, ...b } }, () => {
    const po = db.prepare("SELECT * FROM purchase_orders WHERE id = ?").get(poId) as any;
    if (!po) return Response.json({ error: "سفارش خرید یافت نشد." }, { status: 404 });
    const scope = activeBranch(session, req.cookies.get("repaid_branch")?.value);
    if (!scope.all && po.branch_id !== scope.branchId) throw new HttpError(404, "سفارش خرید یافت نشد.");

    if (b.action === "send") {
      if (po.status === "sent") return ok({ ok: true, already: true });
      if (po.status !== "draft") throw new HttpError(409, "فقط پیش‌نویس سفارش قابل ارسال است.");
      db.prepare("UPDATE purchase_orders SET status = 'sent' WHERE id = ?").run(poId);
      audit(session, "send", "purchase_order", poId, { status: po.status }, { status: "sent" });
      return ok({ ok: true });
    }

    if (b.action === "cancel") {
      if (["partially_received", "received"].includes(po.status)) throw new HttpError(409, "سفارش دارای رسید کالا را نمی‌توان لغو کرد. ابتدا فرایند برگشت به تأمین‌کننده را انجام دهید.");
      db.prepare("UPDATE purchase_orders SET status = 'cancelled' WHERE id = ?").run(poId);
      audit(session, "cancel", "purchase_order", poId, { status: po.status }, { status: "cancelled" });
      return ok({ ok: true });
    }

    if (b.action === "receive") {
      if (!["draft", "sent", "partially_received"].includes(po.status)) {
        return Response.json({ error: "امکان دریافت کالا برای این سفارش دیگر وجود ندارد." }, { status: 400 });
      }
      const items: Array<{ item_id: number; qty: number }> = b.items ?? [];
      if (!Array.isArray(items) || items.length === 0 || items.length > 200) return Response.json({ error: "اقلام دریافتی معتبر نیستند." }, { status: 400 });
      const rows = db.prepare("SELECT * FROM purchase_order_items WHERE po_id=? LIMIT 2000").all(poId);
      const byId = new Map(rows.map(row => [Number(row.id), row]));
      const seen = new Set<number>();
      for (const entry of items) {
        const row = byId.get(Number(entry.item_id));
        if (!row || seen.has(Number(entry.item_id))) throw new HttpError(400, "قلم دریافتی نامعتبر یا تکراری است.");
        seen.add(Number(entry.item_id));
        entry.qty = quantityValue(entry.qty);
        if (entry.qty > addQuantity(Number(row.qty), -Number(row.received_qty))) throw new HttpError(409, "تعداد دریافتی از مانده سفارش بیشتر است. صفحه را تازه‌سازی کنید.");
      }
      if (!items.some(entry => Number(entry.qty) > 0)) throw new HttpError(400, "حداقل یک قلم باید دریافت شود.");

      const recvNumber = nextSeq("goods_receipt", "GR-");
      const receiptId = db.prepare("INSERT INTO goods_receipts(po_id, number, received_by, notes) VALUES(?,?,?,?)")
        .run(poId, recvNumber, session.user.id, b.notes ?? null).lastInsertRowid as number;

      let anyReceived = false;
      for (const it of items) {
        const item = byId.get(Number(it.item_id))!;
        const qty = Number(it.qty);
        if (qty === 0) continue;
        anyReceived = true;
        db.prepare("UPDATE purchase_order_items SET received_qty = ? WHERE id = ?").run(addQuantity(Number(item.received_qty), qty), it.item_id);
        if (item.part_id) {
          moveStock({
            part_id: Number(item.part_id),
            qty,
            type: "purchase",
            ref_type: "goods_receipt",
            ref_id: receiptId,
            source_line_id:Number(item.id),
            unit_cost: Number(item.unit_cost),
            user_id: session.user.id,
            branch_id: po.branch_id == null ? undefined : Number(po.branch_id),
            note: `دریافت روی ${po.number} (${recvNumber})`,
          });
        }
      }
      if (!anyReceived) return Response.json({ error: "همه اقلام این سفارش دریافت شده است." }, { status: 400 });

      // update PO status
      const remaining = (db.prepare(
        "SELECT COALESCE(SUM(qty - received_qty),0) v FROM purchase_order_items WHERE po_id = ?"
      ).get(poId) as any).v;
      db.prepare("UPDATE purchase_orders SET status = ? WHERE id = ?").run(remaining === 0 ? "received" : "partially_received", poId);
      audit(session, "receive", "purchase_order", poId, null, { receipt: recvNumber });
      return ok({ ok: true, received: recvNumber });
    }

    return Response.json({ error: "عملیات نامشخص." }, { status: 400 });
    });
  } catch (e) {
    return fail(e);
  }
}
