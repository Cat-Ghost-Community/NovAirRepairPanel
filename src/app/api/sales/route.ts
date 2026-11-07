import { NextRequest } from "next/server";
import { captureFinancialDocument } from "@/lib/accounting-events";
import { getDb, nextSeq } from "@/lib/db/schema";
import { requireSession, fail, ok, readJson, audit, requirePerm, validate, HttpError } from "@/lib/api";
import { moveStock } from "@/lib/inventory";
import { addCustomerEvent } from "@/lib/repair";
import { BRANCH_COOKIE, recordBranchId, branchWhere, activeBranch } from "@/lib/branch";
import { durableJsonResponse } from "@/lib/idempotency";
import { multiplyRial, percentRial, sumRial, quantityValue } from "@/lib/money";
import { taxRatePct } from "@/lib/finance";

export async function GET(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "sales.view");
    const db = getDb();
    const scope = branchWhere(activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value), "s");
    const sales = db
      .prepare(
        `SELECT s.*, c.first_name, c.last_name,
          (SELECT COUNT(*) FROM sale_items i WHERE i.sale_id = s.id) item_count
         FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE ${scope.sql} ORDER BY s.created_at DESC LIMIT 100`
      )
      .all(...scope.params) as any[];
    return ok({ sales });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "sales.create");
    const b = await readJson(req);
    if (b.customer_id != null) b.customer_id = validate.id(b.customer_id, "مشتری");
    const db = getDb();
    if (!Array.isArray(b.items) || b.items.length === 0) {
      return Response.json({ error: "این فروش قلمی ندارد." }, { status: 400 });
    }

    if (b.items.length > 200) throw new HttpError(400, "تعداد اقلام فروش بیش از حد مجاز است.");
    const branchId = recordBranchId(session, req.cookies.get(BRANCH_COOKIE)?.value);
    return durableJsonResponse(db, { actorId: session.user.id, branchId, operation: "pos_sale",
      key: req.headers.get("idempotency-key"), payload: b }, () => {
    if (b.expected_branch_id != null && b.expected_branch_id !== branchId) throw new HttpError(409, "شعبهٔ فروش تغییر کرده است؛ سبد را در شعبهٔ موردنظر دوباره بررسی کنید.");
    if (!["cash", "card", "transfer", "other"].includes(b.method ?? "cash")) throw new HttpError(400, "روش تسویهٔ فروش معتبر نیست؛ فروش چکی یا برخط را از مسیر تأییدشده ثبت کنید.");
    if (b.customer_id && !db.prepare("SELECT id FROM customers WHERE id=?").get(b.customer_id)) throw new HttpError(400, "مشتری فروش یافت نشد.");
    for (const item of b.items) {
      if (!item || !["part", "service", "labor"].includes(item.kind)) throw new HttpError(400, "نوع قلم فروش معتبر نیست.");
      const qty = quantityValue(item.qty);
      if (!Number.isFinite(qty) || qty <= 0 || qty > 1_000_000) throw new HttpError(400, "تعداد فروش معتبر نیست.");
      item.qty = qty;
      item.unit_price = validate.amount(item.unit_price, "قیمت فروش");
      if (item.kind === "part") {
        item.ref_id = validate.id(item.ref_id, "کالا");
        const part = db.prepare("SELECT name,price,avg_cost,purchase_price FROM parts WHERE id=?").get(Number(item.ref_id));
        if (!part) throw new HttpError(404, "کالای فروش یافت نشد.");
        if (item.unit_price !== part.price) requirePerm(session, "sales.edit");
        item.name = String(part.name);
        item.cost = Number(part.avg_cost ?? part.purchase_price ?? 0);
      } else {
        item.name = validate.maxLength(validate.required(item.name, "نام قلم"), 200, "نام قلم");
        item.cost = 0;
      }
    }
    const subtotal = sumRial(b.items.map((item: any) => multiplyRial(item.unit_price, item.qty)));
    const discount = validate.amount(b.discount ?? 0, "تخفیف");
    if (discount > subtotal) throw new HttpError(400, "تخفیف از مبلغ فروش بیشتر است.");
    if (discount > 0) requirePerm(session, "sales.edit");
    const taxRate = taxRatePct();
    const tax = percentRial(subtotal - discount, taxRate);
    const total = sumRial([subtotal - discount, tax]);
    if (b.expected_total != null && validate.amount(b.expected_total) !== total) throw new HttpError(409, "جمع فروش تغییر کرده است؛ قیمت و نرخ مالیات را تازه‌سازی کنید.");
    const number = nextSeq("sale", "SAL-");
    const saleId = db
      .prepare("INSERT INTO sales(number, customer_id, branch_id, subtotal, discount, tax, total, paid, status, user_id) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(number, b.customer_id ?? null, recordBranchId(session, req.cookies.get(BRANCH_COOKIE)?.value), subtotal, discount, tax, total, total, "completed", session.user.id).lastInsertRowid as number;

    const ins = db.prepare("INSERT INTO sale_items(sale_id, kind, ref_id, name, qty, unit_price, cost, total) VALUES(?,?,?,?,?,?,?,?)");
    for (const i of b.items) {
      const saleLine=ins.run(saleId, i.kind, i.ref_id ?? null, i.name, i.qty, i.unit_price, i.cost ?? 0, multiplyRial(i.unit_price, i.qty));
      if (i.kind === "part" && i.ref_id) {
        moveStock({
          part_id: i.ref_id, qty: -i.qty, type: "sale", ref_type: "sale", ref_id: saleId,
          source_line_id:Number(saleLine.lastInsertRowid),
          user_id: session.user.id, branch_id: recordBranchId(session, req.cookies.get(BRANCH_COOKIE)?.value) ?? undefined, note: `POS sale ${number}`,
        });
      }
    }

    if (total > 0) {
      const receipt=db.prepare("INSERT INTO payments(number, customer_id, sale_id, amount, method, branch_id, user_id) VALUES(?,?,?,?,?,?,?)")
        .run(nextSeq("payment", "PMT-"), b.customer_id ?? 0, saleId, total, b.method ?? "cash", branchId, session.user.id);
      captureFinancialDocument(db,"payment",Number(receipt.lastInsertRowid),"receipt",session.user.id,branchId);
    }

    captureFinancialDocument(db,"sale",saleId,"sale",session.user.id,branchId);
    audit(session, "create", "sale", saleId, null, { number, total, method: b.method });
    if (b.customer_id) addCustomerEvent(b.customer_id, "sale", `فروش ${number}`, `مبلغ ${total.toLocaleString("fa-IR")} ریال`, session.user.id);
    return ok({ id: saleId, number, total });
    });
  } catch (e) {
    return fail(e);
  }
}
