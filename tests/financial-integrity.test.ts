import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { NextRequest } from "next/server";
import { DatabaseSync } from "node:sqlite";
import { multiplyRial, percentRial, rial, sumRial, roundRial } from "../src/lib/money";
import { fmtMoney, moneyDisplayValue } from "../src/lib/format";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "repaid-financial-"));
process.env.REPAID_DATA_DIR = directory;
let db: ReturnType<typeof import("../src/lib/db/schema").getDb>;
let ownerToken: string;
let staffToken: string;
let sequence = 0;
const key = () => `financial-test-${++sequence}`;
function request(url: string, body?: unknown, operationKey: string | null = key(), token = ownerToken, branch?: string) {
  return new NextRequest(`http://app.test${url}`, { method: body === undefined ? "GET" : "POST",
    headers: { origin: "http://app.test", "content-type": "application/json", cookie: `repaid_session=${token}${branch ? `; repaid_branch=${branch}` : ""}`,
      ...(operationKey ? { "idempotency-key": operationKey } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
}
function invoice(total = 1000, branch = 1, type = "sale") {
  return Number(db.prepare("INSERT INTO invoices(number,type,customer_id,supplier_id,branch_id,status,total) VALUES(?,?,1,1,?,'issued',?)")
    .run(`FIN-${++sequence}`, type, branch, total).lastInsertRowid);
}
function state(id: number) { return db.prepare("SELECT paid,status FROM invoices WHERE id=?").get(id); }
function scalar(sql: string, ...args: number[]) { return Object.values(db.prepare(sql).get(...args)!)[0]; }

before(async () => {
  const { getDb } = await import("../src/lib/db/schema");
  const { createSession } = await import("../src/lib/auth");
  db = getDb();
  db.exec(`INSERT INTO branches(id,name,code) VALUES(1,'یک','B1'),(2,'دو','B2');
    INSERT INTO users(id,name,email,password_hash,role,branch_id) VALUES(1,'مالک','owner@test','unused','owner',1),(2,'حسابدار','staff@test','unused','accountant',2);
    INSERT INTO customers(id,first_name,branch_id) VALUES(1,'مشتری',1);
    INSERT INTO suppliers(id,name) VALUES(1,'تأمین‌کننده');
    INSERT INTO bank_accounts(id,name,current_balance) VALUES(1,'بانک آزمون',10000),(2,'مقصد آزمون',0);
    INSERT INTO settings(key,value) VALUES('tax_rate','0'),('vat_enabled','0'),('duty_rate','0'),('round_to','0');`);
  ownerToken = createSession(1);
  staffToken = createSession(2);
});
after(() => { db?.close(); fs.rmSync(directory, { recursive: true, force: true }); });

describe("exact canonical IRR", () => {
  it("rounds decimal products and percentages independently of binary floats", () => {
    assert.equal(multiplyRial(100, "0.145"), 15); // JS Math.round(0.145*100) is 14.
    assert.equal(percentRial(10000, "0.145"), 15);
    assert.equal(multiplyRial(5, "0.1"), 1);
    assert.equal(sumRial([1000, 150, 25]), 1175);
    assert.equal(roundRial(1250, 500), 1500);
    assert.equal(fmtMoney(1, "toman"), "۰.۱ تومان");
    assert.equal(fmtMoney(-1, "toman"), "-۰.۱ تومان");
    assert.equal(moneyDisplayValue(9007199254740987, "toman"), "900719925474098.7");
  });
  it("rejects fractional rials, invalid inputs and unsafe totals", () => {
    for (const amount of [0.5, "1.2", -1, NaN, Infinity, "", "1e3", Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => rial(amount));
    assert.throws(() => multiplyRial(Number.MAX_SAFE_INTEGER, 2));
    assert.throws(() => sumRial([Number.MAX_SAFE_INTEGER, 1]));
    assert.throws(() => percentRial(100, -1));
    assert.equal(rial("0"), 0);
  });
});

describe("authoritative payments, instruments and receipts", () => {
  it("retries a guest POS sale without duplicating stock or cash", async () => {
    const { POST } = await import("../src/app/api/sales/route");
    db.prepare("INSERT INTO inventory_locations(name,branch_id,is_default) VALUES('انبار عملیات',1,1)").run();
    const part = Number(db.prepare("INSERT INTO parts(name,price,purchase_price,avg_cost) VALUES('قطعه صندوق',1000,100,100)").run().lastInsertRowid);
    const { moveStock, getTotalQty } = await import("../src/lib/inventory");
    moveStock({ part_id: part, qty: 10, type: "purchase", unit_cost: 100, branch_id: 1 });
    const operationKey = key();
    const body = { method: "cash", items: [{ kind: "part", ref_id: part, qty: 2, unit_price: 1000 }] };
    const first = await POST(request("/api/sales", body, operationKey));
    assert.equal(first.status, 200);
    const sale = await first.json();
    assert.equal(sale.total, 2000);
    assert.equal(getTotalQty(part), 8);
    assert.deepEqual(await (await POST(request("/api/sales", body, operationKey))).json(), sale);
    assert.equal(getTotalQty(part), 8);
    assert.equal(scalar("SELECT COUNT(*) n FROM payments WHERE sale_id=?", sale.id), 1);
    assert.equal(scalar("SELECT amount FROM payments WHERE sale_id=?", sale.id), 2000);
    assert.equal((await POST(request("/api/sales", { ...body, discount: 10 }, operationKey))).status, 409);
  });

  it("receives partial purchases once, then invoices without a second stock increase", async () => {
    const { POST: create } = await import("../src/app/api/purchase-orders/route");
    const { POST: change } = await import("../src/app/api/purchase-orders/[id]/route");
    const { createInvoice } = await import("../src/lib/invoice");
    const { getSessionByToken } = await import("../src/lib/auth");
    const { getTotalQty } = await import("../src/lib/inventory");
    const part = Number(db.prepare("INSERT INTO parts(name,price,purchase_price,avg_cost) VALUES('قطعه خرید',200,100,100)").run().lastInsertRowid);
    const identity = key();
    const body = { supplier_id: 1, send: true, items: [{ part_id: part, name: "قطعه خرید", qty: 5, unit_cost: 100 }] };
    const created = await create(request("/api/purchase-orders", body, identity));
    assert.equal(created.status, 200);
    const po = await created.json();
    assert.deepEqual(await (await create(request("/api/purchase-orders", body, identity))).json(), po);
    const item = Number(scalar("SELECT id FROM purchase_order_items WHERE po_id=?", po.id));
    const action = (payload: unknown, id = key()) => change(request(`/api/purchase-orders/${po.id}`, payload, id), { params: Promise.resolve({ id: String(po.id) }) });
    const partialKey = key();
    const partial = { action: "receive", items: [{ item_id: item, qty: 2 }] };
    const receipt = await action(partial, partialKey);
    assert.equal(receipt.status, 200);
    const recorded = await receipt.json();
    assert.deepEqual(await (await action(partial, partialKey)).json(), recorded);
    assert.equal(getTotalQty(part), 2);
    assert.equal((await action({ action: "receive", items: [{ item_id: item, qty: 4 }] })).status, 409);
    assert.equal(getTotalQty(part), 2);
    assert.equal(scalar("SELECT COUNT(*) n FROM goods_receipts WHERE po_id=?", po.id), 1);
    assert.equal((await action({ action: "receive", items: [{ item_id: item, qty: 3 }] })).status, 200);
    assert.equal(getTotalQty(part), 5);
    const invoice = createInvoice(getSessionByToken(ownerToken)!, { type: "purchase", purchase_order_id: po.id, confirm: true, client_key: key() });
    assert.equal(invoice.total, 500);
    assert.equal(getTotalQty(part), 5);
  });

  it("rejects a branch's attempt to consume another location's stock", async () => {
    const { moveStock, getTotalQty } = await import("../src/lib/inventory");
    const part = Number(db.prepare("INSERT INTO parts(name,price,purchase_price,avg_cost) VALUES('محدوده انبار',100,50,50)").run().lastInsertRowid);
    const location = Number(scalar("SELECT id FROM inventory_locations WHERE branch_id=1 LIMIT 1"));
    moveStock({ part_id: part, qty: 2, type: "purchase", unit_cost: 50, branch_id: 1, location_id: location });
    assert.throws(() => moveStock({ part_id: part, qty: -1, type: "sale", branch_id: 2, location_id: location }), /شعبه/);
    assert.equal(getTotalQty(part), 2);
  });

  it("values fractional and zero-cost receipts without binary drift or replacing zero cost", async () => {
    const { moveStock, getTotalQty } = await import("../src/lib/inventory");
    const part = Number(db.prepare("INSERT INTO parts(name,price,purchase_price,avg_cost) VALUES('بهای دقیق',100,100,0)").run().lastInsertRowid);
    moveStock({ part_id: part, qty: 0.1, type: "purchase", unit_cost: 100, branch_id: 1 });
    moveStock({ part_id: part, qty: 0.2, type: "purchase", unit_cost: 400, branch_id: 1 });
    assert.equal(getTotalQty(part), 0.3);
    assert.equal(scalar("SELECT avg_cost FROM parts WHERE id=?", part), 300);
    const free = Number(db.prepare("INSERT INTO parts(name,price,purchase_price,avg_cost) VALUES('رایگان',100,100,0)").run().lastInsertRowid);
    moveStock({ part_id: free, qty: 1, type: "purchase", unit_cost: 0, branch_id: 1 });
    moveStock({ part_id: free, qty: 1, type: "purchase", unit_cost: 100, branch_id: 1 });
    assert.equal(scalar("SELECT avg_cost FROM parts WHERE id=?", free), 50);
    const { durableJsonResponse } = await import("../src/lib/idempotency");
    const before = scalar("SELECT COUNT(*) n FROM expenses");
    const response = durableJsonResponse(db, { actorId: 1, branchId: 1, operation: "rollback-error-response", key: key(), payload: {} }, () => {
      db.prepare("INSERT INTO expenses(category,amount,branch_id) VALUES('رد عملیات',1,1)").run();
      return Response.json({ error: "رد شد" }, { status: 400 });
    });
    assert.equal(response.status, 400);
    assert.equal(scalar("SELECT COUNT(*) n FROM expenses"), before);
  });

  it("creates a canonical catalogue item and opening stock atomically with a durable identity", async () => {
    const { POST } = await import("../src/app/api/parts/route");
    const { getTotalQty } = await import("../src/lib/inventory");
    const body = { name: "افتتاحیه معتبر", sku: key(), purchase_price: 1230, price: 2000, opening_qty: 2 };
    const identity = key();
    const created = await POST(request("/api/parts", body, identity));
    assert.equal(created.status, 200);
    const part = await created.json();
    assert.equal(scalar("SELECT purchase_price FROM parts WHERE id=?", part.id), 1230);
    assert.equal(scalar("SELECT price FROM parts WHERE id=?", part.id), 2000);
    assert.equal(scalar("SELECT avg_cost FROM parts WHERE id=?", part.id), 1230);
    assert.equal(getTotalQty(part.id), 2);
    assert.deepEqual(await (await POST(request("/api/parts", body, identity))).json(), part);
    assert.equal(getTotalQty(part.id), 2);
    const before = scalar("SELECT COUNT(*) n FROM parts");
    const failed = await POST(request("/api/parts", { ...body, sku: key() }, key(), ownerToken, "2"));
    assert.equal(failed.status, 400); // Branch two deliberately has no location yet.
    assert.equal(scalar("SELECT COUNT(*) n FROM parts"), before);
  });

  it("transfers two stock legs once, protects reservations and rolls back a failed second leg", async () => {
    const { POST } = await import("../src/app/api/inventory/tools/route");
    const { moveStock, getTotalQty, consumePartForTicket } = await import("../src/lib/inventory");
    const { createSession } = await import("../src/lib/auth");
    db.exec("INSERT INTO users(id,name,email,password_hash,role,branch_id) VALUES(3,'انباردار','stock@test','unused','inventory',2)");
    const stockToken = createSession(3);
    const from = Number(scalar("SELECT id FROM inventory_locations WHERE branch_id=1 LIMIT 1"));
    const to = Number(db.prepare("INSERT INTO inventory_locations(name,branch_id) VALUES('انبار دوم',2)").run().lastInsertRowid);
    const part = Number(db.prepare("INSERT INTO parts(name,price,purchase_price,avg_cost) VALUES('انتقال معتبر',200,100,100)").run().lastInsertRowid);
    moveStock({ part_id: part, qty: 10, type: "purchase", unit_cost: 100, branch_id: 1, location_id: from });
    db.prepare("UPDATE inventory_stock SET reserved=5 WHERE part_id=? AND location_id=?").run(part, from);
    const body = { action: "transfer", part_id: part, from_location: from, to_location: to, qty: 3 };
    assert.equal((await POST(request("/api/inventory/tools", { ...body, qty: 6 }))).status, 400);
    assert.equal((await POST(request("/api/inventory/tools", body, key(), stockToken))).status, 404);
    const identity = key();
    const first = await POST(request("/api/inventory/tools", body, identity));
    assert.equal(first.status, 200);
    const transfer = await first.json();
    assert.deepEqual(await (await POST(request("/api/inventory/tools", body, identity))).json(), transfer);
    assert.equal(scalar("SELECT qty FROM inventory_stock WHERE part_id=? AND location_id=?", part, from), 7);
    assert.equal(scalar("SELECT qty FROM inventory_stock WHERE part_id=? AND location_id=?", part, to), 3);
    assert.equal(getTotalQty(part), 10);
    assert.equal(scalar("SELECT COUNT(*) n FROM inventory_movements WHERE ref_type='inventory_transfer' AND ref_id=?", transfer.id), 2);
    assert.equal((await POST(request("/api/inventory/tools", body, identity, ownerToken, "1"))).status, 404);
    db.exec("CREATE TRIGGER fail_transfer_stock BEFORE INSERT ON inventory_movements WHEN NEW.type='transfer_in' BEGIN SELECT RAISE(ABORT,'interrupted stock transfer'); END");
    try { assert.equal((await POST(request("/api/inventory/tools", { ...body, qty: 1 }))).status, 500); }
    finally { db.exec("DROP TRIGGER fail_transfer_stock"); }
    assert.equal(scalar("SELECT qty FROM inventory_stock WHERE part_id=? AND location_id=?", part, from), 7);
    assert.equal(scalar("SELECT qty FROM inventory_stock WHERE part_id=? AND location_id=?", part, to), 3);
    assert.equal(scalar("SELECT COUNT(*) n FROM inventory_transfers WHERE part_id=?", part), 1);
    db.prepare("UPDATE inventory_stock SET reserved=1 WHERE part_id=? AND location_id=?").run(part, to);
    const device = Number(db.prepare("INSERT INTO devices(customer_id,type) VALUES(1,'mobile')").run().lastInsertRowid);
    const status = Number(db.prepare("INSERT INTO repair_statuses(name) VALUES('Reserved Test')").run().lastInsertRowid);
    const ticket = Number(db.prepare("INSERT INTO repair_tickets(number,branch_id,customer_id,device_id,status_id) VALUES(?,1,1,?,?)").run(key(), device, status).lastInsertRowid);
    consumePartForTicket({ part_id: part, qty: 2, ticket_id: ticket, user_id: 1, branch_id: 1, location_id: from, unit_cost: 100 });
    // The aggregate reservation predates this ticket; its ownership cannot be guessed.
    assert.equal(scalar("SELECT reserved FROM inventory_stock WHERE part_id=? AND location_id=?", part, from), 5);
    assert.equal(scalar("SELECT qty FROM inventory_stock WHERE part_id=? AND location_id=?",part,from),5);
    assert.throws(()=>consumePartForTicket({part_id:part,qty:1,ticket_id:ticket,user_id:1,branch_id:1,location_id:from,unit_cost:100}),/رزرو/);
    assert.equal(scalar("SELECT reserved FROM inventory_stock WHERE part_id=? AND location_id=?", part, to), 1);
  });

  it("keeps manual stock mutations scoped and idempotent and rejects unpaired transfers", async () => {
    const { POST } = await import("../src/app/api/parts/[id]/stock/route");
    const { moveStock, getTotalQty } = await import("../src/lib/inventory");
    const part = Number(db.prepare("INSERT INTO parts(name,price,purchase_price,avg_cost) VALUES('اصلاح معتبر',200,100,100)").run().lastInsertRowid);
    moveStock({ part_id: part, qty: 5, type: "purchase", unit_cost: 100, branch_id: 1 });
    const identity = key();
    const context = { params: Promise.resolve({ id: String(part) }) };
    const body = { type: "damage", qty: 1, note: "آسیب ثبت‌شده" };
    assert.equal((await POST(request(`/api/parts/${part}/stock`, body, identity), context)).status, 200);
    assert.equal((await POST(request(`/api/parts/${part}/stock`, body, identity), context)).status, 200);
    assert.equal(getTotalQty(part), 4);
    assert.equal((await POST(request(`/api/parts/${part}/stock`, { type: "transfer_out", qty: 1 }), context)).status, 400);
    const from = Number(scalar("SELECT id FROM inventory_locations WHERE branch_id=1 LIMIT 1"));
    assert.equal((await POST(request(`/api/parts/${part}/stock`, { ...body, location_id: from }, key(), ownerToken, "2"), context)).status, 404);
  });

  it("changes catalogue prices with exact half-up arithmetic and never repeats the bulk operation", async () => {
    const { POST } = await import("../src/app/api/inventory/tools/route");
    const category = key();
    db.prepare("INSERT INTO parts(name,price,category) VALUES('یک',1,?),('سه',3,?)").run(category, category);
    const identity = key();
    const body = { action: "bulk_price", percent: 50, direction: "down", field: "price", category };
    const first = await POST(request("/api/inventory/tools", body, identity));
    assert.equal(first.status, 200);
    assert.equal((await first.json()).affected, 2);
    assert.equal((await POST(request("/api/inventory/tools", body, identity))).status, 200);
    assert.deepEqual(db.prepare("SELECT price FROM parts WHERE category=? ORDER BY id").all(category).map(row => row.price), [1, 2]);
    assert.equal((await POST(request("/api/inventory/tools", { ...body, percent: 150 }))).status, 400);
    assert.deepEqual(db.prepare("SELECT price FROM parts WHERE category=? ORDER BY id").all(category).map(row => row.price), [1, 2]);
  });

  it("preserves POS source amounts when tax settings and invoice rounding later change", async () => {
    const { createInvoice, updateDraftInvoice } = await import("../src/lib/invoice");
    const { getSessionByToken } = await import("../src/lib/auth");
    const session = getSessionByToken(ownerToken)!;
    const sale = Number(db.prepare("INSERT INTO sales(number,customer_id,branch_id,subtotal,discount,tax,total,status) VALUES(?,1,1,1000,100,90,990,'credit')").run(key()).lastInsertRowid);
    db.prepare("INSERT INTO sale_items(sale_id,kind,name,qty,unit_price,cost,total) VALUES(?,'service','خدمت مرجع',1,1000,0,1000)").run(sale);
    db.exec("UPDATE settings SET value='1' WHERE key='vat_enabled'; UPDATE settings SET value='30' WHERE key='tax_rate'; UPDATE settings SET value='1000' WHERE key='round_to'");
    try {
      const result = createInvoice(session, { type: "sale", sale_id: sale, client_key: key() });
      assert.equal(result.total, 990);
      assert.equal(scalar("SELECT tax FROM invoices WHERE id=?", result.id), 90);
      assert.equal(scalar("SELECT discount FROM invoices WHERE id=?", result.id), 100);
      assert.throws(() => updateDraftInvoice(session, result.id, { items: [{ kind: "service", name: "تغییر غیرمجاز", qty: 1, unit_price: 2000 }] }), /سند مبدأ/);
      updateDraftInvoice(session, result.id, { notes: "اصلاح شرح" });
      assert.equal(scalar("SELECT total FROM invoices WHERE id=?", result.id), 990);
    } finally { db.exec("UPDATE settings SET value='0' WHERE key IN ('vat_enabled','tax_rate','round_to')"); }
  });

  it("carries fully received PO shipping, discount and historical tax into its invoice exactly once", async () => {
    const { createInvoice } = await import("../src/lib/invoice");
    const { getSessionByToken } = await import("../src/lib/auth");
    const po = Number(db.prepare("INSERT INTO purchase_orders(number,supplier_id,branch_id,status,items_total,discount,tax,shipping,total) VALUES(?,1,1,'received',1000,100,90,200,1190)").run(key()).lastInsertRowid);
    db.prepare("INSERT INTO purchase_order_items(po_id,name,qty,received_qty,unit_cost,total) VALUES(?,'کالای دریافت‌شده',1,1,1000,1000)").run(po);
    const result = createInvoice(getSessionByToken(ownerToken)!, { type: "purchase", purchase_order_id: po, client_key: key(), confirm: true });
    assert.equal(result.total, 1190);
    assert.equal(scalar("SELECT subtotal FROM invoices WHERE id=?", result.id), 1200);
    assert.equal(scalar("SELECT discount FROM invoices WHERE id=?", result.id), 100);
    assert.equal(scalar("SELECT tax FROM invoices WHERE id=?", result.id), 90);
    assert.equal(scalar("SELECT unit_price FROM invoice_items WHERE invoice_id=? AND kind='fee'", result.id), 200);
    assert.equal(scalar("SELECT COUNT(*) n FROM inventory_movements WHERE ref_type='invoice' AND ref_id=?", result.id), 0);
  });

  it("never bills unreceived PO lines or guesses partial freight and tax allocation", async () => {
    const { purchaseInvoiceSource } = await import("../src/lib/invoice-source");
    const po = Number(db.prepare("INSERT INTO purchase_orders(number,supplier_id,branch_id,status,items_total,discount,tax,shipping,total) VALUES(?,1,1,'partially_received',1500,0,0,0,1500)").run(key()).lastInsertRowid);
    db.prepare("INSERT INTO purchase_order_items(po_id,name,qty,received_qty,unit_cost,total) VALUES(?,'بخشی دریافت‌شده',10,2,100,1000),(?,'دریافت‌نشده',5,0,100,500)").run(po, po);
    const source = { id: po, status: "partially_received", items_total: 1500, discount: 0, tax: 0, shipping: 0, total: 1500 };
    const snapshot = purchaseInvoiceSource(db, source);
    assert.equal(snapshot.items.length, 1);
    assert.equal(snapshot.items[0].qty, 2);
    assert.equal(snapshot.totals.total, 200);
    assert.throws(() => purchaseInvoiceSource(db, { ...source, shipping: 100 }), /سیاست تأییدشده/);
    assert.throws(() => purchaseInvoiceSource(db, { ...source, tax: 150 }), /سیاست تأییدشده/);
  });

  it("binds invoice client identities to payload and refuses to invent legacy request receipts", async () => {
    const { createInvoice } = await import("../src/lib/invoice");
    const { getSessionByToken } = await import("../src/lib/auth");
    const session = getSessionByToken(ownerToken)!;
    const body = { type: "sale" as const, customer_id: 1, client_key: key(), items: [{ kind: "service", name: "سند پایدار", qty: 1, unit_price: 100 }] };
    const first = createInvoice(session, body);
    const again = createInvoice(session, body);
    assert.equal(again.id, first.id);
    assert.equal(again.duplicate, true);
    assert.throws(() => createInvoice(session, { ...body, items: [{ ...body.items[0], unit_price: 200 }] }), /درخواست دیگری/);
    const legacy = key();
    db.prepare("INSERT INTO invoices(number,type,customer_id,branch_id,status,total,client_key,created_by) VALUES(?,'sale',1,1,'draft',100,?,1)").run(key(), legacy);
    assert.throws(() => createInvoice(session, { ...body, client_key: legacy }), /فاقد رسید درخواست/);
  });

  it("accepts a persistent invoice header key and rejects missing or conflicting identities", async () => {
    const { POST } = await import("../src/app/api/invoices/route");
    const identity = key();
    const body = { type: "sale", customer_id: 1, confirm: true, items: [{ kind: "service", name: "ثبت پایدار", qty: 1, unit_price: 100 }] };
    const first = await POST(request("/api/invoices", body, identity));
    assert.equal(first.status, 201);
    const original = await first.json();
    const repeated = await POST(request("/api/invoices", body, identity));
    assert.equal(repeated.status, 200);
    const duplicate = await repeated.json();
    assert.equal(duplicate.id, original.id);
    assert.equal(duplicate.duplicate, true);
    assert.equal((await POST(request("/api/invoices", { ...body, notes: "درخواست متفاوت" }, identity))).status, 409);
    assert.equal((await POST(request("/api/invoices", body, null))).status, 400);
  });

  it("replays the original response, rejects changed semantics and requires a key", async () => {
    const { POST } = await import("../src/app/api/payments/route");
    const id = invoice();
    const body = { invoice_id: id, amount: 100, method: "cash" };
    const operationKey = key();
    const first = await POST(request("/api/payments", body, operationKey));
    assert.equal(first.status, 200);
    const original = await first.json();
    assert.deepEqual(await (await POST(request("/api/payments", body, operationKey))).json(), original);
    assert.equal((await POST(request("/api/payments", { ...body, amount: 200 }, operationKey))).status, 409);
    assert.equal((await POST(request("/api/payments", body, null))).status, 400);
    assert.equal(state(id)?.paid, 100);
    assert.equal(scalar("SELECT COUNT(*) n FROM payments WHERE invoice_id=?", id), 1);
  });

  it("does not settle a cheque before collection; reserves its limit and settles once", async () => {
    const { POST: pay } = await import("../src/app/api/payments/route");
    const { POST: changeCheck } = await import("../src/app/api/checks/route");
    const { POST: refund } = await import("../src/app/api/payments/refund/route");
    const { cancelInvoice } = await import("../src/lib/invoice");
    const { getSessionByToken } = await import("../src/lib/auth");
    const id = invoice();
    const response = await pay(request("/api/payments", { invoice_id: id, amount: 700, method: "check", cheque: { due_date: "2027-01-20" } }));
    assert.equal(response.status, 200);
    const payment = await response.json();
    const checkId = Number(scalar("SELECT id FROM checks WHERE payment_id=?", payment.id));
    assert.equal(state(id)?.paid, 0);
    assert.equal(state(id)?.status, "issued");
    assert.throws(() => cancelInvoice(getSessionByToken(ownerToken)!, id, "لغو"), /چک/);
    assert.equal((await refund(request("/api/payments/refund", { payment_id: payment.id, amount: 50 }))).status, 400);
    assert.equal((await pay(request("/api/payments", { invoice_id: id, amount: 301 }))).status, 400);
    assert.equal((await pay(request("/api/payments", { invoice_id: id, amount: 300 }))).status, 200);
    assert.equal(state(id)?.paid, 300);
    assert.equal((await changeCheck(request("/api/checks", { id: checkId, action: "deposit_bank", bank_account_id: 1 }))).status, 200);
    const bankBefore = Number(scalar("SELECT current_balance FROM bank_accounts WHERE id=1"));
    const body = { id: checkId, action: "pass" };
    const operationKey = key();
    const collected = await changeCheck(request("/api/checks", body, operationKey));
    assert.equal(collected.status, 200);
    assert.equal(state(id)?.paid, 1000);
    assert.equal(state(id)?.status, "paid");
    await changeCheck(request("/api/checks", body, operationKey));
    await changeCheck(request("/api/checks", body)); // A fresh key cannot double collect either.
    assert.equal(scalar("SELECT current_balance FROM bank_accounts WHERE id=1"), bankBefore + 700);
    assert.equal(scalar("SELECT COUNT(*) n FROM bank_transactions WHERE check_id=?", checkId), 1);
    assert.equal((await changeCheck(request("/api/checks", { id: checkId, action: "bounce" }))).status, 409);
    const refundKey = key();
    const refundBody = { payment_id: payment.id, amount: 200, method: "cash" };
    const original = await (await refund(request("/api/payments/refund", refundBody, refundKey))).json();
    assert.deepEqual(await (await refund(request("/api/payments/refund", refundBody, refundKey))).json(), original);
    assert.equal(state(id)?.paid, 800);
    assert.equal(state(id)?.status, "partially_paid");
  });

  it("withdraws issued cheques instead of crediting the bank", async () => {
    const { POST: invoicePay } = await import("../src/app/api/invoices/[id]/payments/route");
    const { POST: changeCheck } = await import("../src/app/api/checks/route");
    const id = invoice(600, 1, "purchase");
    const response = await invoicePay(request(`/api/invoices/${id}/payments`, { amount: 600, method: "check", cheque: { due_date: "2027-02-01" } }), { params: Promise.resolve({ id: String(id) }) });
    assert.equal(response.status, 200);
    assert.equal(state(id)?.paid, 0);
    const checkId = Number(scalar("SELECT id FROM checks WHERE invoice_id=?", id));
    const before = Number(scalar("SELECT current_balance FROM bank_accounts WHERE id=1"));
    assert.equal((await changeCheck(request("/api/checks", { id: checkId, action: "pass", bank_account_id: 1 }))).status, 200);
    assert.equal(scalar("SELECT current_balance FROM bank_accounts WHERE id=1"), before - 600);
    assert.equal(scalar("SELECT type FROM bank_transactions WHERE check_id=?", checkId), "withdraw");
    assert.equal(state(id)?.paid, 600);
  });

  it("rolls back bank, instrument, invoice and idempotency receipt when audit insertion fails", async () => {
    const { POST } = await import("../src/app/api/checks/route");
    const checkId = Number(db.prepare("INSERT INTO checks(kind,amount,due_date,branch_id) VALUES('received',50,'2027-02-01',1)").run().lastInsertRowid);
    const bank = scalar("SELECT current_balance FROM bank_accounts WHERE id=1");
    const operationKey = key();
    db.exec("CREATE TRIGGER fail_check_audit BEFORE INSERT ON audit_logs WHEN NEW.action='check_pass' BEGIN SELECT RAISE(ABORT,'injected failure'); END");
    try {
      assert.equal((await POST(request("/api/checks", { id: checkId, action: "pass", bank_account_id: 1 }, operationKey))).status, 500);
      assert.equal(scalar("SELECT current_balance FROM bank_accounts WHERE id=1"), bank);
      assert.equal(scalar("SELECT status FROM checks WHERE id=?", checkId), "in_hand");
      assert.equal(scalar("SELECT COUNT(*) n FROM bank_transactions WHERE check_id=?", checkId), 0);
      assert.equal(db.prepare("SELECT operation_key FROM operation_receipts WHERE operation_key=?").get(operationKey), undefined);
    } finally { db.exec("DROP TRIGGER fail_check_audit"); }
    assert.equal((await POST(request("/api/checks", { id: checkId, action: "pass", bank_account_id: 1 }, operationKey))).status, 200);
  });

  it("isolates invoice details, payments, refunds, cheque mutations and summaries by branch", async () => {
    const { POST: pay, GET: listPayments } = await import("../src/app/api/payments/route");
    const { POST: changeCheck, GET: listChecks } = await import("../src/app/api/checks/route");
    const { GET: details } = await import("../src/app/api/invoices/[id]/route");
    const { POST: invoicePay } = await import("../src/app/api/invoices/[id]/payments/route");
    const id = invoice(100, 1);
    assert.equal((await pay(request("/api/payments", { invoice_id: id, amount: 10 }, key(), staffToken))).status, 404);
    assert.equal((await invoicePay(request(`/api/invoices/${id}/payments`, { amount: 10 }, key(), staffToken), { params: Promise.resolve({ id: String(id) }) })).status, 404);
    assert.equal((await details(request(`/api/invoices/${id}`, undefined, key(), staffToken), { params: Promise.resolve({ id: String(id) }) })).status, 404);
    const checkId = Number(scalar("SELECT id FROM checks WHERE branch_id=1 LIMIT 1"));
    assert.equal((await changeCheck(request("/api/checks", { id: checkId, action: "pass" }, key(), staffToken))).status, 404);
    assert.deepEqual((await (await listPayments(request("/api/payments", undefined, key(), staffToken))).json()).payments, []);
    const listed = await (await listChecks(request("/api/checks", undefined, key(), staffToken))).json();
    assert.deepEqual(listed.checks, []);
    assert.deepEqual(listed.summary, []);
  });

  it("does not double count a POS invoice and includes unallocated advances", async () => {
    const { customerBalance } = await import("../src/lib/finance");
    const before = customerBalance(1, 1);
    const sale = Number(db.prepare("INSERT INTO sales(number,customer_id,branch_id,total,paid,status) VALUES(?,1,1,200,0,'credit')").run(key()).lastInsertRowid);
    assert.equal(customerBalance(1, 1), before + 200);
    const id = invoice(200);
    db.prepare("UPDATE invoices SET sale_id=? WHERE id=?").run(sale, id);
    assert.equal(customerBalance(1, 1), before + 200);
    const { POST } = await import("../src/app/api/payments/route");
    await POST(request("/api/payments", { customer_id: 1, amount: 50, method: "cash" }));
    assert.equal(customerBalance(1, 1), before + 150);
  });

  it("rejects unsupported online confirmations, invalid dates and fabricated invoice allocations", async () => {
    const { POST: pay } = await import("../src/app/api/payments/route");
    const { POST: check } = await import("../src/app/api/checks/route");
    assert.equal((await pay(request("/api/payments", { customer_id: 1, amount: 10, method: "online" }))).status, 400);
    assert.equal((await check(request("/api/checks", { amount: 10, due_date: "2027-02-30" }))).status, 400);
    assert.equal((await check(request("/api/checks", { amount: 10, due_date: "2027-02-01", invoice_id: invoice() }))).status, 400);
  });

  it("records an expense and its audit exactly once and rejects fractional rials", async () => {
    const { POST, GET } = await import("../src/app/api/expenses/route");
    const operationKey = key();
    const body = { category: "ابزار", amount: 145, date: "2026-10-24", method: "cash" };
    const response = await POST(request("/api/expenses", body, operationKey));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(await (await POST(request("/api/expenses", body, operationKey))).json(), result);
    assert.equal(scalar("SELECT COUNT(*) n FROM audit_logs WHERE entity='expense' AND entity_id=?", result.id), 1);
    assert.equal(scalar("SELECT branch_id FROM audit_logs WHERE entity='expense' AND entity_id=?", result.id), 1);
    assert.equal((await POST(request("/api/expenses", { ...body, amount: 1.5 }))).status, 400);
    assert.deepEqual((await (await GET(request("/api/expenses", undefined, key(), staffToken))).json()).expenses, []);
  });

  it('blocks independent recognition of the two bank transfer legs rather than doubling the transfer or inventing revenue',async()=>{
    const {POST}=await import('../src/app/api/bank/route'),{reviewFinancialEvent}=await import('../src/lib/accounting-events'),{getSessionByToken}=await import('../src/lib/auth');
    const result=await POST(request('/api/bank',{action:'transfer',from_account:1,to_account:2,amount:11,date:'2026-10-30'},key()));assert.equal(result.status,200);
    const primary=(await result.json()).id,rows=db.prepare("SELECT id FROM accounting_events WHERE source_type='bank' AND source_id IN (?,?) ORDER BY id").all(String(primary),String(primary+1));assert.equal(rows.length,2);
    const before=scalar('SELECT COUNT(*) n FROM accounting_journals');
    for(const row of rows)assert.throws(()=>reviewFinancialEvent(db,getSessionByToken(ownerToken)!,Number(row.id),{posting_date:'2026-10-30',reason:'Unsupported separate bank transfer recognition',lines:[{account_code:'1020',debit:11,bank_account_id:2},{account_code:'4000',credit:11}]}),error=>(error as {status:number}).status===409);
    assert.equal(scalar('SELECT COUNT(*) n FROM accounting_journals'),before);assert.equal(scalar('SELECT COUNT(*) n FROM accounting_event_reviews WHERE event_id IN (?,?)',Number(rows[0].id),Number(rows[1].id)),0);
  });

  it("keeps centralized identities stable across branch selection and denies cross-branch invoice mutations", async () => {
    const { durableOperation } = await import("../src/lib/idempotency");
    const { createInvoice, confirmInvoice, cancelInvoice } = await import("../src/lib/invoice");
    const { getSessionByToken } = await import("../src/lib/auth");
    const options = { actorId: 1, branchId: 1, operation: "business-scope-proof", key: key(), payload: { amount: 100 }, scope: "business" as const };
    const first = durableOperation(db, options, () => ({ document: 456 }));
    assert.deepEqual(durableOperation(db, { ...options, branchId: 2 }, () => { throw new Error("Repeated centralized operation"); }), first);
    const staff = getSessionByToken(staffToken)!;
    const id = invoice();
    assert.throws(() => confirmInvoice(staff, id, []), /یافت نشد/);
    assert.throws(() => cancelInvoice(staff, id, "غیرمجاز"), /یافت نشد/);
    assert.throws(() => createInvoice(staff, { type: "sale", customer_id: 1, branch_id: 1,
      items: [{ kind: "service", name: "غیرمجاز", qty: 1, unit_price: 100 }] }), /یافت نشد/);
    assert.equal(state(id)?.status, "issued");
  });

  it("keeps both legs of a central bank transfer atomic, balanced and retry-safe", async () => {
    const { POST, GET } = await import("../src/app/api/bank/route");
    const fromBefore = Number(scalar("SELECT current_balance FROM bank_accounts WHERE id=1"));
    const toBefore = Number(scalar("SELECT current_balance FROM bank_accounts WHERE id=2"));
    const operationKey = key();
    const body = { action: "transfer", from_account: 1, to_account: 2, amount: 100, date: "2026-10-24" };
    db.exec("CREATE TRIGGER fail_transfer BEFORE INSERT ON bank_transactions WHEN NEW.type='transfer_in' BEGIN SELECT RAISE(ABORT,'interrupted transfer'); END");
    try {
      assert.equal((await POST(request("/api/bank", body, operationKey))).status, 500);
      assert.equal(scalar("SELECT current_balance FROM bank_accounts WHERE id=1"), fromBefore);
      assert.equal(scalar("SELECT current_balance FROM bank_accounts WHERE id=2"), toBefore);
    } finally { db.exec("DROP TRIGGER fail_transfer"); }
    const result = await POST(request("/api/bank", body, operationKey));
    assert.equal(result.status, 200);
    const original = await result.json();
    assert.deepEqual(await (await POST(request("/api/bank", body, operationKey))).json(), original);
    assert.equal(scalar("SELECT current_balance FROM bank_accounts WHERE id=1"), fromBefore - 100);
    assert.equal(scalar("SELECT current_balance FROM bank_accounts WHERE id=2"), toBefore + 100);
    assert.equal((await POST(request("/api/bank", { ...body, to_account: 999 }))).status, 404);
    assert.equal((await POST(request("/api/bank", { ...body, amount: -100 }))).status, 400);
    assert.equal((await POST(request("/api/bank", body, key(), staffToken))).status, 403);
    assert.equal((await GET(request("/api/bank", undefined, key(), staffToken))).status, 403);
  });

  it("synchronizes the original POS sale when its linked invoice is paid or refunded", async () => {
    const { POST: pay } = await import("../src/app/api/payments/route");
    const { POST: refund } = await import("../src/app/api/payments/refund/route");
    const sale = Number(db.prepare("INSERT INTO sales(number,customer_id,branch_id,total,paid,status) VALUES(?,1,1,200,0,'credit')").run(key()).lastInsertRowid);
    const id = invoice(200);
    db.prepare("UPDATE invoices SET sale_id=? WHERE id=?").run(sale, id);
    const response = await pay(request("/api/payments", { invoice_id: id, amount: 200 }));
    assert.equal(response.status, 200);
    const payment = await response.json();
    assert.equal(scalar("SELECT paid FROM sales WHERE id=?", sale), 200);
    assert.equal(scalar("SELECT status FROM sales WHERE id=?", sale), "completed");
    assert.equal((await refund(request("/api/payments/refund", { payment_id: payment.id, amount: 50 }))).status, 200);
    assert.equal(scalar("SELECT paid FROM sales WHERE id=?", sale), 150);
    assert.equal(scalar("SELECT status FROM sales WHERE id=?", sale), "credit");
    assert.equal(state(id)?.paid, 150);
  });

  it("reports historical discrepancies without silently changing evidence", async () => {
    const { financialReconciliation } = await import("../src/lib/financial-reconciliation");
    const id = invoice(100);
    db.prepare("UPDATE invoices SET paid=50 WHERE id=?").run(id);
    const before = scalar("SELECT COUNT(*) n FROM audit_logs");
    const report = financialReconciliation(db);
    assert.equal(report.ledgerPresent, true);
    assert.equal(report.ledgerConfigured, false);
    assert.equal(report.openingBalancesVerified, false);
    assert.equal(report.ledger?.valid, true);
    assert.ok(report.checks.invoice_paid_cache_mismatch >= 1);
    assert.equal(report.requiresReview, true);
    assert.equal(state(id)?.paid, 50);
    assert.equal(scalar("SELECT COUNT(*) n FROM audit_logs"), before);
  });

  it("reconciles scoped documentary flows, receivables, payables and inventory against independent outcomes", async () => {
    const { operationalFinance } = await import("../src/lib/financial-report");
    db.exec(`INSERT INTO branches(id,name,code) VALUES(3,'گزارش','B3');
      INSERT INTO invoices(id,number,type,customer_id,branch_id,status,total,paid,date,due_date)
        VALUES(30001,'REPORT-S','sale',1,3,'issued',1000,999,'2026-10-24','2026-11-01'),
              (30002,'REPORT-P','purchase',0,3,'issued',600,599,'2026-10-24',NULL);
      INSERT INTO sales(id,number,customer_id,branch_id,status,total,paid) VALUES(30001,'REPORT-POS',1,3,'credit',200,199);
      INSERT INTO payments(id,number,customer_id,invoice_id,amount,method,branch_id,user_id,direction,created_at)
        VALUES(30001,'REPORT-P1',1,30001,200,'cash',3,1,'in','2026-10-24 10:00:00'),
              (30002,'REPORT-P2',0,30002,100,'transfer',3,1,'out','2026-10-24 10:00:00');
      INSERT INTO payments(number,customer_id,sale_id,amount,method,branch_id,user_id,direction,created_at)
        VALUES('REPORT-P3',1,30001,50,'cash',3,1,'in','2026-10-24 10:00:00');
      INSERT INTO payments(number,customer_id,amount,method,branch_id,user_id,direction,created_at)
        VALUES('REPORT-ADV',1,100,'cash',3,1,'in','2026-10-24 10:00:00');
      INSERT INTO refunds(number,payment_id,invoice_id,customer_id,amount,method,branch_id,user_id,created_at)
        VALUES('REPORT-REF',30001,30001,1,50,'cash',3,1,'2026-10-25 10:00:00');
      INSERT INTO expenses(category,amount,date,branch_id,user_id) VALUES('ابزار',25,'2026-10-24',3,1);
      INSERT INTO inventory_locations(id,name,branch_id) VALUES(30001,'انبار گزارش',3);
      INSERT INTO parts(id,name,price,avg_cost) VALUES(30001,'کالا',200,100);
      INSERT INTO inventory_stock(part_id,location_id,qty) VALUES(30001,30001,2);`);
    const report = operationalFinance(db, 3, "2026-10-01", "2026-11-01", "2026-10-01");
    assert.equal(report.cashIn, 350);
    assert.equal(report.cashOut, 150);
    assert.equal(report.expenses, 25);
    assert.equal(report.netFlow, 175);
    assert.equal(report.receivables, 1000); // Invoice 850 + unbilled POS 150. Caches deliberately wrong.
    assert.equal(report.payables, 500);
    assert.equal(report.inventoryValue, 200);
    assert.equal(report.aging.current, 850);
    assert.deepEqual(report.flow, [{ d: "2026-10-24", inflow: 350, outflow: 125 }, { d: "2026-10-25", inflow: 0, outflow: 50 }]);
    const other = operationalFinance(db, -1, "2026-10-01", "2026-11-01", "2026-10-01");
    assert.equal(other.cashIn, 0);
    assert.equal(other.receivables, 0);
    assert.equal(other.inventoryValue, 0);
  });

  it("preserves committed operation identities and financial records through verified backup/restore", async () => {
    const { verifiedSnapshot } = await import("../src/lib/backup");
    const { durableOperation } = await import("../src/lib/idempotency");
    const operationKey = key();
    const options = { actorId: 1, branchId: 1, operation: "restore-proof", key: operationKey, payload: { amount: 10 } };
    const original = durableOperation(db, options, () => ({ document: 123 }));
    const snapshot = await verifiedSnapshot(db);
    const filename = path.join(directory, "restored-financial.db");
    fs.writeFileSync(filename, snapshot);
    const restored = new DatabaseSync(filename);
    try {
      assert.equal(restored.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      assert.deepEqual(durableOperation(restored, options, () => { throw new Error("Duplicate after restore"); }), original);
      assert.equal(restored.prepare("SELECT COUNT(*) n FROM payments").get()?.n, scalar("SELECT COUNT(*) n FROM payments"));
    } finally { restored.close(); }
  });

  it("keeps repair inventory ownership separate and accrues exact eligible commission once", async () => {
    const { computeTechnicianCommission } = await import("../src/lib/payroll");
    const { confirmInvoice, cancelInvoice } = await import("../src/lib/invoice");
    const { getSessionByToken } = await import("../src/lib/auth");
    const device = Number(db.prepare("INSERT INTO devices(customer_id,type) VALUES(1,'mobile')").run().lastInsertRowid);
    const status = Number(db.prepare("INSERT INTO repair_statuses(name) VALUES('Financial Test')").run().lastInsertRowid);
    const ticket = Number(db.prepare("INSERT INTO repair_tickets(number,branch_id,customer_id,device_id,status_id,technician_id,delivered_at) VALUES(?,1,1,?,?,1,'2026-10-24')")
      .run(key(), device, status).lastInsertRowid);
    db.prepare("INSERT INTO ticket_items(ticket_id,kind,name,qty,unit_price,consumed) VALUES(?,'labor','اجرت',0.145,100,1)").run(ticket);
    db.prepare("INSERT INTO ticket_items(ticket_id,kind,name,qty,unit_price,consumed) VALUES(?,'part','قطعهٔ مصرف‌نشده',1,0,0)").run(ticket);
    db.exec("INSERT INTO payroll_profiles(user_id,salary_type,percent_repair,is_active) VALUES(1,'percent',100,0)");
    computeTechnicianCommission(ticket);
    assert.equal(scalar("SELECT COUNT(*) n FROM payroll_runs WHERE source_ticket_id=?", ticket), 0);
    db.exec("UPDATE payroll_profiles SET is_active=1 WHERE user_id=1");
    computeTechnicianCommission(ticket);
    computeTechnicianCommission(ticket);
    assert.equal(scalar("SELECT earned_commission FROM payroll_runs WHERE source_ticket_id=?", ticket), 15);
    assert.equal(scalar("SELECT COUNT(*) n FROM payroll_runs WHERE source_ticket_id=?", ticket), 1);
    const id = invoice(100, 1, "repair");
    db.prepare("UPDATE invoices SET ticket_id=?,status='draft' WHERE id=?").run(ticket, id);
    const session = getSessionByToken(ownerToken)!;
    confirmInvoice(session, id, []);
    assert.equal(scalar("SELECT consumed FROM ticket_items WHERE ticket_id=? AND kind='part'", ticket), 0);
    db.prepare("UPDATE ticket_items SET consumed=1 WHERE ticket_id=? AND kind='part'").run(ticket);
    cancelInvoice(session, id, "لغو سند مالی");
    assert.equal(scalar("SELECT consumed FROM ticket_items WHERE ticket_id=? AND kind='part'", ticket), 1);
  });
});

function competing(id: number, identity: string, amount: number, ...extra: string[]): Promise<{ status: number; id?: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/financial-contention-worker.ts", String(id), identity, String(amount), ...extra],
      { env: { ...process.env, FINANCIAL_TEST_MODE: "1", REPAID_DATA_DIR: directory }, windowsHide: true });
    let output = "";
    let errors = "";
    child.stdout.on("data", data => { output += data; });
    child.stderr.on("data", data => { errors += data; });
    child.on("error", reject);
    child.on("exit", code => { if (code) reject(new Error(errors)); else { try { resolve(JSON.parse(output)); } catch (error) { reject(error); } } });
  });
}

describe("independent-process SQLite financial contention", () => {
  it("serializes overlapping stock transfers without negative stock or a partial pair", async () => {
    const { moveStock, getTotalQty } = await import("../src/lib/inventory");
    const from = Number(scalar("SELECT id FROM inventory_locations WHERE branch_id=1 LIMIT 1"));
    const to = Number(scalar("SELECT id FROM inventory_locations WHERE branch_id=2 LIMIT 1"));
    const part = Number(db.prepare("INSERT INTO parts(name,price,purchase_price,avg_cost) VALUES('انتقال هم‌زمان',200,100,100)").run().lastInsertRowid);
    moveStock({ part_id: part, qty: 1, type: "purchase", unit_cost: 100, branch_id: 1, location_id: from });
    const results = await Promise.all([competing(part, key(), 1, "stock", String(from), String(to)), competing(part, key(), 1, "stock", String(from), String(to))]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 400]);
    assert.equal(getTotalQty(part), 1);
    assert.equal(scalar("SELECT qty FROM inventory_stock WHERE part_id=? AND location_id=?", part, from), 0);
    assert.equal(scalar("SELECT qty FROM inventory_stock WHERE part_id=? AND location_id=?", part, to), 1);
    assert.equal(scalar("SELECT COUNT(*) n FROM inventory_transfers WHERE part_id=?", part), 1);
    assert.equal(scalar("SELECT COUNT(*) n FROM inventory_movements WHERE part_id=? AND ref_type='inventory_transfer'", part), 2);
  });
  it("commits only once when four processes retry the same operation", async () => {
    const id = invoice(1000);
    const identity = key();
    const results = await Promise.all(Array.from({ length: 4 }, () => competing(id, identity, 700)));
    assert.deepEqual(results.map(r => r.status), [200, 200, 200, 200]);
    assert.equal(new Set(results.map(r => r.id)).size, 1);
    assert.equal(state(id)?.paid, 700);
    assert.equal(scalar("SELECT COUNT(*) n FROM payments WHERE invoice_id=?", id), 1);
  });
  it("serializes competing different requests without overpaying", async () => {
    const id = invoice(1000);
    const results = await Promise.all([competing(id, key(), 700), competing(id, key(), 700)]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
    assert.equal(state(id)?.paid, 700);
    assert.equal(scalar("SELECT COUNT(*) n FROM payments WHERE invoice_id=?", id), 1);
  });
});
