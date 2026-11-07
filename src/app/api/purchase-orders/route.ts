import { NextRequest } from "next/server";
import { getDb, nextSeq } from "@/lib/db/schema";
import { requireSession, fail, ok, readJson, audit, requirePerm, validate, HttpError } from "@/lib/api";
import { durableJsonResponse } from "@/lib/idempotency";
import { multiplyRial, percentRial, sumRial, quantityValue } from "@/lib/money";
import { taxRatePct } from "@/lib/finance";
import { recordBranchId, activeBranch, branchWhere, BRANCH_COOKIE } from "@/lib/branch";
import { parseDate } from "@/lib/format";
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresFinancialRequest} from '@/lib/db/pg-financial-http';
import {postgresCreatePurchaseOrder,postgresPurchaseOrders} from '@/lib/db/pg-purchasing';
import {postgresFailure} from '@/lib/db/pg-http';
import {readRequestJson} from '@/lib/request-json';

export async function GET(req: NextRequest) {
  if(postgresIntegration()){
    try{const {database,schema,token,branchId}=await postgresFinancialRequest(req,'purchasing.view');return Response.json(await postgresPurchaseOrders(database,schema,token,branchId,Number(req.nextUrl.searchParams.get('page')??1),Number(req.nextUrl.searchParams.get('size')??50)),{headers:{'Cache-Control':'no-store'}});}catch(error){return postgresFailure(error);}
  }
  try {
    const session = requireSession(req);
    requirePerm(session, "purchasing.view");
    const db = getDb();
    const scope = branchWhere(activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value), "po");
    const pos = db
      .prepare(
        `SELECT po.*, s.name supplier_name,
          (SELECT COUNT(*) FROM purchase_order_items i WHERE i.po_id = po.id) item_count
         FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE ${scope.sql} ORDER BY po.created_at DESC LIMIT 100`
      )
      .all(...scope.params) as any[];
    return ok({ purchase_orders: pos });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  if(postgresIntegration()){
    try{const {database,schema,token,branchId,scope}=await postgresFinancialRequest(req,'purchasing.manage');const branch=branchId??scope.session.user.branch_id;if(branch==null)throw new HttpError(409,'شعبهٔ خرید مشخص نیست.');return Response.json(await postgresCreatePurchaseOrder(database,schema,token,branch,req.headers.get('idempotency-key'),await readRequestJson(req)));}catch(error){return postgresFailure(error);}
  }
  try {
    const session = requireSession(req);
    requirePerm(session, "purchasing.manage");
    const b = await readJson(req);
    const db = getDb();
    if (!b.supplier_id || !Array.isArray(b.items) || b.items.length === 0) {
      return Response.json({ error: "تأمین‌کننده و حداقل یک قلم کالا الزامی است." }, { status: 400 });
    }
    if (b.items.length > 200) throw new HttpError(400, "تعداد اقلام خرید بیش از حد مجاز است.");
    b.supplier_id = validate.id(b.supplier_id, "تأمین‌کننده");
    for (const item of b.items) {
      if (!item) throw new HttpError(400, "قلم خرید معتبر نیست.");
      item.qty = quantityValue(item.qty);
      if (item.part_id != null) item.part_id = validate.id(item.part_id, "کالا");
      if (item.qty <= 0 || item.qty > 1000000) throw new HttpError(400, "تعداد خرید معتبر نیست.");
      item.unit_cost = validate.amount(item.unit_cost, "بهای خرید");
      item.name = validate.maxLength(validate.required(item.name, "نام کالا"), 200, "نام کالا");
    }
    const itemsTotal = sumRial(b.items.map((i: any) => multiplyRial(i.unit_cost, i.qty)));
    const discount = validate.amount(b.discount ?? 0, "تخفیف");
    const shipping = validate.amount(b.shipping ?? 0, "هزینه حمل");
    if (discount > itemsTotal) throw new HttpError(400, "تخفیف از مبلغ خرید بیشتر است.");
    if (b.expected_date != null && (!/^\d{4}-\d{2}-\d{2}$/.test(b.expected_date) || !parseDate(b.expected_date))) throw new HttpError(400, "تاریخ تحویل مورد انتظار معتبر نیست.");
    const branchId = recordBranchId(session, req.cookies.get(BRANCH_COOKIE)?.value);
    return durableJsonResponse(db, { actorId: session.user.id, branchId, operation: "purchase_order_create",
      key: req.headers.get("idempotency-key"), payload: b }, () => {
    if (!db.prepare("SELECT id FROM suppliers WHERE id=?").get(b.supplier_id)) throw new HttpError(400, "تأمین‌کننده یافت نشد.");
    const tax = percentRial(itemsTotal - discount, taxRatePct());
    const total = sumRial([itemsTotal - discount, tax, shipping]);
    if (b.expected_total != null && validate.amount(b.expected_total) !== total) throw new HttpError(409, "جمع سفارش تغییر کرده است؛ نرخ مالیات و مبلغ‌ها را تازه‌سازی کنید.");
    const number = nextSeq("po", "PO-");
    const id = db
      .prepare(
        `INSERT INTO purchase_orders(number, supplier_id, branch_id, date, expected_date, status, items_total, discount, tax, shipping, total, notes, created_by)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        number, b.supplier_id, recordBranchId(session, req.cookies.get("repaid_branch")?.value), new Date().toISOString().slice(0, 10), b.expected_date ?? null,
        b.send ? "sent" : "draft", itemsTotal, discount, tax, shipping, total, b.notes ?? null, session.user.id
      ).lastInsertRowid as number;
    const ins = db.prepare("INSERT INTO purchase_order_items(po_id, part_id, name, qty, unit_cost, total) VALUES(?,?,?,?,?,?)");
    for (const i of b.items) {
      if (i.part_id && !db.prepare("SELECT id FROM parts WHERE id=? AND is_active=1").get(i.part_id)) throw new HttpError(400, "کالای سفارش یافت نشد.");
      ins.run(id, i.part_id ?? null, i.name, i.qty, i.unit_cost, multiplyRial(i.unit_cost, i.qty));
    }
    audit(session, "create", "purchase_order", id, null, { number, total });
    return ok({ id, number });
    });
  } catch (e) {
    return fail(e);
  }
}
