import { describe, it, after as afterAll, before as beforeAll } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repaid-invoice-"));
process.env.REPAID_DATA_DIR = dir;

const session = (id: number, role = "manager", name = "مدیر تست") =>
  ({ user: { id, name, email: `u${id}@x.local`, role, branch_id: 1, avatar_color: "#0ea5e9" } }) as any;

let db: any;
let mgrId = 0;
let salesId = 0;
let customerId = 0;
let supplierId = 0;
let partId = 0;
let locationId = 0;

beforeAll(async () => {
  const { getDb } = await import("@/lib/db/schema");
  db = getDb();
  // تنظیمات مالی: ارزش افزوده ۱۰٪، بدون عوارض و رند
  db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES('tax_rate','10')").run();
  db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES('vat_enabled','1')").run();
  db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES('duty_rate','0')").run();
  db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES('round_to','0')").run();
  db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES('business_name','تست‌گاه')").run();
  locationId = db.prepare("INSERT INTO inventory_locations(name, branch_id, is_default) VALUES('انبار مرکزی', 1, 1)").run().lastInsertRowid as number;
  db.prepare("INSERT INTO branches(name, code) VALUES('شعبهٔ مرکزی','B1')").run();
  mgrId = db.prepare("INSERT INTO users(name, email, password_hash, role, branch_id) VALUES('مدیر تست','m@x.local','h','manager',1)").run().lastInsertRowid as number;
  salesId = db.prepare("INSERT INTO users(name, email, password_hash, role, branch_id) VALUES('فروشنده','s@x.local','h','sales',1)").run().lastInsertRowid as number;
  customerId = db.prepare("INSERT INTO customers(first_name, last_name) VALUES('مشتری','فاکتور')").run().lastInsertRowid as number;
  supplierId = db.prepare("INSERT INTO suppliers(name) VALUES('تأمین‌کننده تست')").run().lastInsertRowid as number;
  partId = db.prepare("INSERT INTO parts(name, sku, barcode, price, purchase_price, avg_cost) VALUES('باتری تست','SKU-1','626000000001',50000,40000,30000)").run().lastInsertRowid as number;
});

afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

async function stockOf(partId: number): Promise<number> {
  const r = db.prepare("SELECT COALESCE(SUM(qty),0) q FROM inventory_stock WHERE part_id = ?").get(partId) as any;
  return Number(r.q);
}

describe("فاکتور یکپارچه — خرید، فروش، تعمیر", () => {
  it("پیش‌نویس خرید موجودی را تغییر نمی‌دهد و اقلام اسنپ‌شات می‌شوند", async () => {
    const { createInvoice } = await import("@/lib/invoice");
    const before = await stockOf(partId);
    const inv = createInvoice(session(mgrId), {
      type: "purchase",
      supplier_id: supplierId,
      employee_id: mgrId,
      client_key: "k-purchase-draft",
      confirm: false,
      items: [{ kind: "part", ref_id: partId, qty: 5, unit_price: 40000 }],
    });
    assert.strictEqual(inv.duplicate, false);
    assert.strictEqual(inv.status, "draft");
    assert.strictEqual(await stockOf(partId), before);
    // ۵×۴۰۰۰۰ = ۲۰۰۰۰۰ + ۱۰٪ = ۲۲۰۰۰۰
    assert.strictEqual(inv.total, 220000);
    const items = db.prepare("SELECT * FROM invoice_items WHERE invoice_id = ?").all(inv.id) as any[];
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].name, "باتری تست");
    assert.strictEqual(items[0].sku, "SKU-1");

    // ارسال دوباره با همان client_key → همان فاکتور، بدون تکرار
    const again = createInvoice(session(mgrId), {
      type: "purchase",
      supplier_id: supplierId,
      employee_id: mgrId,
      client_key: "k-purchase-draft",
      confirm: false,
      items: [{ kind: "part", ref_id: partId, qty: 5, unit_price: 40000 }],
    });
    assert.strictEqual(again.duplicate, true);
    assert.strictEqual(again.id, inv.id);
    assert.strictEqual((db.prepare("SELECT COUNT(*) c FROM invoices WHERE client_key='k-purchase-draft'").get() as any).c, 1);
  });

  it("ثبت نهایی خرید انبار را شارژ می‌کند و ثبت دوباره سند انبار نمی‌سازد", async () => {
    const { createInvoice, confirmInvoice } = await import("@/lib/invoice");
    const before = await stockOf(partId);
    const inv = createInvoice(session(mgrId), {
      type: "purchase",
      supplier_id: supplierId,
      client_key: "k-purchase-confirm",
      confirm: true,
      items: [{ kind: "part", ref_id: partId, qty: 10, unit_price: 40000 }],
    });
    assert.strictEqual(inv.status, "issued"); // بدون پرداخت → صادرشده (نه پرداخت‌شده)
    const after = await stockOf(partId);
    assert.strictEqual(after, before + 10);
    const second = confirmInvoice(session(mgrId), inv.id as number, []);
    assert.strictEqual(second.already, true);
    assert.strictEqual(await stockOf(partId), after);
    const movements = db.prepare("SELECT * FROM inventory_movements WHERE ref_type='invoice' AND ref_id = ?").all(inv.id) as any[];
    assert.strictEqual(movements.length, 1);
    assert.strictEqual(movements[0].type, "purchase");
  });

  it("فروش بدون موجودی کافی ثبت نمی‌شود و تراکنش کامل برمی‌گردد", async () => {
    const { createInvoice } = await import("@/lib/invoice");
    const before = await stockOf(partId);
    assert.throws(() =>
      createInvoice(
        session(mgrId),
        {
          type: "sale",
          customer_id: customerId,
          client_key: "k-sale-nostock",
          confirm: true,
          items: [{ kind: "part", ref_id: partId, qty: 99999, unit_price: 50000 }],
        },
        "1"
      ), /موجودی/);
    assert.strictEqual(await stockOf(partId), before);
    // فاکتور و اقلام هم نباید باقی بمانند (rollback)
    assert.strictEqual((db.prepare("SELECT COUNT(*) c FROM invoices WHERE client_key='k-sale-nostock'").get() as any).c, 0);
  });

  it("فروش: کسر انبار، پرداخت جزئی → partially_paid، تسویه کامل → paid، اضافه‌پرداخت رد", async () => {
    const { createInvoice, addPaymentInTx, paidOf } = await import("@/lib/invoice");
    const before = await stockOf(partId);
    const inv = createInvoice(
      session(mgrId),
      {
        type: "sale",
        customer_id: customerId,
        client_key: "k-sale-pay",
        confirm: true,
        items: [{ kind: "part", ref_id: partId, qty: 2, unit_price: 50000 }],
      },
      "1"
    );
    assert.strictEqual(await stockOf(partId), before - 2);
    // ۲×۵۰۰۰۰ = ۱۰۰۰۰۰ + ۱۰٪ = ۱۱۰۰۰۰
    assert.strictEqual(inv.total, 110000);

    const row = () => db.prepare("SELECT * FROM invoices WHERE id = ?").get(inv.id) as any;
    db.exec("BEGIN IMMEDIATE");
    addPaymentInTx(db, session(mgrId), row(), { amount: 60000, method: "cash" }, 1);
    db.exec("COMMIT");
    assert.strictEqual(row().status, "partially_paid");
    assert.strictEqual(paidOf(db, inv.id as number, "sale"), 60000);

    // اضافه‌پرداخت بزرگ رد می‌شود
    db.exec("BEGIN IMMEDIATE");
    assert.throws(() => addPaymentInTx(db, session(mgrId), row(), { amount: 999999, method: "cash" }, 1));
    db.exec("ROLLBACK");

    db.exec("BEGIN IMMEDIATE");
    addPaymentInTx(db, session(mgrId), row(), { amount: 50000, method: "card", reference: "REF-1" }, 1);
    db.exec("COMMIT");
    assert.strictEqual(row().status, "paid");
    assert.strictEqual(row().paid, 110000);
  });

  it("پرداخت چکی سند چک دریافتی می‌سازد و پرداخت بدون سرسید رد می‌شود", async () => {
    const { createInvoice, addPaymentInTx } = await import("@/lib/invoice");
    const inv = createInvoice(
      session(mgrId),
      { type: "sale", customer_id: customerId, client_key: "k-sale-check", confirm: true, items: [{ kind: "service", name: "خدمت تست", qty: 1, unit_price: 100000 }] },
      "1"
    );
    db.exec("BEGIN IMMEDIATE");
    assert.throws(() => addPaymentInTx(db, session(mgrId), db.prepare("SELECT * FROM invoices WHERE id=?").get(inv.id), { amount: 110000, method: "check" }, 1), /سرسید/);
    db.exec("ROLLBACK");

    db.exec("BEGIN IMMEDIATE");
    addPaymentInTx(
      db,
      session(mgrId),
      db.prepare("SELECT * FROM invoices WHERE id=?").get(inv.id),
      { amount: 110000, method: "check", reference: "CHQ-9", cheque: { due_date: "2026-12-01", bank_name: "ملی" } },
      1
    );
    db.exec("COMMIT");
    const chk = db.prepare("SELECT * FROM checks WHERE invoice_id = ?").get(inv.id) as any;
    assert.ok((chk));
    assert.strictEqual(chk.kind, "received");
    assert.strictEqual(chk.due_date, "2026-12-01");
  });

  it("قیمت مرجع: تغییر قیمت بدون مجوز «ویرایش فاکتور» رد می‌شود و قیمت خرید/فروش جابه‌جا نمی‌شود", async () => {
    const { createInvoice, sanitizeLines } = await import("@/lib/invoice");
    // فروشنده: invoices.create دارد ولی invoices.edit ندارد
    assert.throws(() =>
      createInvoice(session(salesId, "sales", "فروشنده"), {
        type: "sale",
        customer_id: customerId,
        items: [{ kind: "part", ref_id: partId, qty: 1, unit_price: 999999 }],
      }), /قیمت/);

    // قیمت مرجع برای خرید = purchase_price و برای فروش = price
    const purchaseLines = sanitizeLines(db, [{ kind: "part", ref_id: partId, qty: 1 }], "purchase", { allowPriceOverride: false });
    const saleLines = sanitizeLines(db, [{ kind: "part", ref_id: partId, qty: 1 }], "sale", { allowPriceOverride: false });
    assert.strictEqual(purchaseLines[0].unit_price, 40000);
    assert.strictEqual(saleLines[0].unit_price, 50000);
  });

  it("فاکتور تعمیر از پذیرش ساخته می‌شود، انبار را دست نمی‌زند و ویرایش فاکتور رکورد پذیرش را عوض نمی‌کند", async () => {
    const { createInvoice, updateDraftInvoice } = await import("@/lib/invoice");
    const statusId = db.prepare("INSERT INTO repair_statuses(name, category, is_open) VALUES('جدید تست','open',1)").run().lastInsertRowid as number;
    const deviceId = db.prepare("INSERT INTO devices(customer_id, type, brand, model) VALUES(?,?,?,?)").run(customerId, "mobile", "برند", "مدل").lastInsertRowid as number;
    const ticketId = db
      .prepare("INSERT INTO repair_tickets(number, branch_id, customer_id, device_id, status_id, problem, created_by) VALUES('R-INV-1',1,?,?,?,?,?)")
      .run(customerId, deviceId, statusId, "ایراد تست", mgrId).lastInsertRowid as number;
    db.prepare("INSERT INTO ticket_items(ticket_id, kind, ref_id, name, qty, unit_price, cost, added_by) VALUES(?,?,?,?,?,?,?,?)").run(ticketId, "part", partId, "باتری تست", 1, 50000, 30000, mgrId);
    db.prepare("INSERT INTO ticket_items(ticket_id, kind, ref_id, name, qty, unit_price, cost, added_by) VALUES(?,?,?,?,?,?,?,?)").run(ticketId, "labor", null, "اجرت تعمیر", 1, 200000, 0, mgrId);
    const stockBefore = await stockOf(partId);

    const inv = createInvoice(session(mgrId), { type: "repair", customer_id: customerId, ticket_id: ticketId, client_key: "k-repair-1", confirm: false }, "1");
    const items = db.prepare("SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort").all(inv.id) as any[];
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].kind, "part");
    assert.strictEqual(items[1].name, "اجرت تعمیر");
    assert.strictEqual(await stockOf(partId), stockBefore); // فاکتور تعمیر انبار را دوباره کم نمی‌کند
    const ticketRow = () => db.prepare("SELECT delivered_at FROM repair_tickets WHERE id = ?").get(ticketId) as any;
    assert.strictEqual(ticketRow().delivered_at, null); // صدور فاکتور ≠ تحویل

    // ویرایش پیش‌نویس: اقلام فاکتور عوض می‌شود ولی رکورد پذیرش دست‌نخورده می‌ماند
    updateDraftInvoice(session(mgrId), inv.id, { items: [{ kind: "labor", name: "اجرت تعمیر (تخفیف‌دار)", qty: 1, unit_price: 150000 }], end_discount: 0 });
    const after = db.prepare("SELECT * FROM invoice_items WHERE invoice_id = ?").all(inv.id) as any[];
    assert.strictEqual(after.length, 1);
    assert.strictEqual(after[0].unit_price, 150000);
    assert.strictEqual((db.prepare("SELECT unit_price FROM ticket_items WHERE ticket_id = ? AND kind='labor'").get(ticketId) as any).unit_price, 200000);

    // فاکتور دوم برای همان پذیرش ساخته نمی‌شود
    const dup = createInvoice(session(mgrId), { type: "repair", customer_id: customerId, ticket_id: ticketId }, "1");
    assert.strictEqual(dup.duplicate, true);
    assert.strictEqual(dup.id, inv.id);
  });

  it("لغو سند مالی مرجوعی فیزیکی نمی‌سازد و فاکتور پرداخت‌دار لغو نمی‌شود", async () => {
    const { createInvoice, cancelInvoice, addPaymentInTx, confirmInvoice } = await import("@/lib/invoice");
    const before = await stockOf(partId);
    const inv = createInvoice(
      session(mgrId),
      { type: "purchase", supplier_id: supplierId, client_key: "k-pur-cancel", confirm: true, items: [{ kind: "part", ref_id: partId, qty: 3, unit_price: 40000 }] },
      "1"
    );
    assert.strictEqual(await stockOf(partId), before + 3);
    assert.throws(()=>cancelInvoice(session(mgrId), inv.id as number, "سفارش اشتباه", "1"),/مرجوعی فیزیکی/);
    assert.strictEqual(await stockOf(partId), before+3);
    const st = db.prepare("SELECT status, cancel_reason FROM invoices WHERE id = ?").get(inv.id) as any;
    assert.strictEqual(st.status, "issued");
    assert.strictEqual(st.cancel_reason, null);
    const rev = db.prepare("SELECT * FROM inventory_movements WHERE ref_type='invoice_cancel' AND ref_id = ?").all(inv.id) as any[];
    assert.strictEqual(rev.length, 0);

    // فاکتور با پرداخت → لغو رد می‌شود
    const inv2 = createInvoice(
      session(mgrId),
      { type: "sale", customer_id: customerId, client_key: "k-sale-cancel-block", confirm: true, items: [{ kind: "labor", name: "اجرت", qty: 1, unit_price: 10000 }] },
      "1"
    );
    db.exec("BEGIN IMMEDIATE");
    addPaymentInTx(db, session(mgrId), db.prepare("SELECT * FROM invoices WHERE id=?").get(inv2.id), { amount: 5000, method: "cash" }, 1);
    db.exec("COMMIT");
    assert.throws(() => cancelInvoice(session(mgrId), inv2.id as number, null, "1"), /پرداخت/);
    assert.strictEqual((db.prepare("SELECT status FROM invoices WHERE id=?").get(inv2.id) as any).status, "partially_paid");
    void confirmInvoice;
  });

  it("تخفیف سطری و انتهایی با مالیات سرور هم‌خوان است", async () => {
    const { createInvoice } = await import("@/lib/invoice");
    const inv = createInvoice(
      session(mgrId),
      {
        type: "sale",
        customer_id: customerId,
        client_key: "k-disc",
        confirm: false,
        items: [
          { kind: "labor", name: "اجرت الف", qty: 2, unit_price: 100000, discount: 20000 },
          { kind: "labor", name: "اجرت ب", qty: 1, unit_price: 50000, discount: 0 },
        ],
        end_discount: 30000,
      },
      "1"
    );
    // gross=250000 ، تخفیف کل=50000 → 200000 ، مالیات ۱۰٪=20000 → 220000
    const row = db.prepare("SELECT subtotal, discount, tax, total FROM invoices WHERE id = ?").get(inv.id) as any;
    assert.strictEqual(row.subtotal, 250000);
    assert.strictEqual(row.discount, 50000);
    assert.strictEqual(row.tax, 20000);
    assert.strictEqual(row.total, 220000);
  });

  it("فاکتور از فروش صندوق: بدون کسر دوبارهٔ انبار، با وصل‌شدن اسناد پرداخت فروش", async () => {
    const { createInvoice, paidOf } = await import("@/lib/invoice");
    const before = await stockOf(partId);
    // فروش صندوق مشابه POS: کسر انبار + سند پرداخت کامل
    const saleNumber = "SAL-TEST-1";
    const saleId = db
      .prepare("INSERT INTO sales(number, customer_id, branch_id, subtotal, discount, tax, total, paid, status, user_id) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(saleNumber, customerId, 1, 50000, 5000, 4500, 49500, 49500, "completed", mgrId).lastInsertRowid as number;
    db.prepare("INSERT INTO sale_items(sale_id, kind, ref_id, name, qty, unit_price, cost, total) VALUES(?,?,?,?,?,?,?,?)").run(saleId, "part", partId, "باتری تست", 1, 50000, 30000, 50000);
    // مثل POS: سند پرداخت فروش (بدون invoice_id تا فاکتور آن را به ارث ببرد)
    db.prepare("INSERT INTO payments(number, customer_id, sale_id, amount, method, branch_id, user_id) VALUES(?,?,?,?,?,?,?)").run("PMT-SALE-T1", customerId, saleId, 49500, "cash", 1, mgrId);
    // کسر انبار مثل POS انجام شده:
    const { moveStock } = await import("@/lib/inventory");
    moveStock({ part_id: partId, qty: -1, type: "sale", ref_type: "sale", ref_id: saleId, user_id: mgrId, branch_id: 1 });
    const afterSale = await stockOf(partId);
    assert.strictEqual(afterSale, before - 1);

    const inv = createInvoice(session(mgrId), { type: "sale", sale_id: saleId, client_key: "k-from-pos", confirm: true }, "1");
    // مبلغ فاکتور برابر سند فروش است (تخفیف سند صندوق آینه شده)
    assert.strictEqual(inv.total, 49500);
    // انبار دوباره کم نشده
    assert.strictEqual(await stockOf(partId), afterSale);
    // هیچ حرکت «فاکتور» جدیدی ثبت نشده؛ فقط حرکت فروش قبلی
    const invMoves = db.prepare("SELECT COUNT(*) c FROM inventory_movements WHERE ref_type='invoice' AND ref_id = ?").get(inv.id) as any;
    assert.strictEqual(Number(invMoves.c), 0);
    // سند پرداخت فروش به فاکتور وصل شده و وضعیت پرداخت‌شده است
    const link = db.prepare("SELECT invoice_id FROM payments WHERE sale_id = ?").get(saleId) as any;
    assert.strictEqual(Number(link.invoice_id), inv.id);
    assert.strictEqual(paidOf(db, inv.id as number, "sale"), 49500);
    assert.strictEqual((db.prepare("SELECT status FROM invoices WHERE id = ?").get(inv.id) as any).status, "paid");
    // فاکتور دوم برای همان فروش ساخته نمی‌شود
    const dup = createInvoice(session(mgrId), { type: "sale", sale_id: saleId }, "1");
    assert.strictEqual(dup.duplicate, true);
    assert.strictEqual(dup.id, inv.id);
    // لغو فاکتور متصل: چون پرداخت وصل شده، ابتدا نیازمند برگشت وجه است و لغو نباید انبار را دست بزند
    const { cancelInvoice } = await import("@/lib/invoice");
    assert.throws(() => cancelInvoice(session(mgrId), inv.id as number, "تست لغو متصل", "1"), /پرداخت/);
    assert.strictEqual(await stockOf(partId), afterSale);
  });

  it("فاکتور خرید از سفارش دریافت‌شده: بدون شارژ دوبارهٔ انبار؛ سفارش دریافت‌نشده رد می‌شود", async () => {
    const { createInvoice } = await import("@/lib/invoice");
    const before = await stockOf(partId);
    // سفارش خرید دریافت‌شده (انبار از مسیر رسید کالا شارژ شده)
    const poId = db
      .prepare("INSERT INTO purchase_orders(number, supplier_id, branch_id, status, date, items_total, tax, total, created_by) VALUES(?,?,?,?,date('now'),?,?,?,?)")
      .run("PO-TEST-1", supplierId, 1, "received", 80000, 8000, 88000, mgrId).lastInsertRowid as number;
    db.prepare("INSERT INTO purchase_order_items(po_id, part_id, name, qty, received_qty, unit_cost, total) VALUES(?,?,?,?,?,?,?)").run(poId, partId, "باتری تست", 2, 2, 40000, 80000);
    const { moveStock } = await import("@/lib/inventory");
    moveStock({ part_id: partId, qty: 2, type: "purchase", ref_type: "goods_receipt", ref_id: 999, user_id: mgrId, branch_id: 1 });
    const afterReceipt = await stockOf(partId);
    assert.strictEqual(afterReceipt, before + 2);

    const inv = createInvoice(session(mgrId), { type: "purchase", purchase_order_id: poId, client_key: "k-from-po", confirm: true }, "1");
    assert.strictEqual(await stockOf(partId), afterReceipt);
    const invMoves = db.prepare("SELECT COUNT(*) c FROM inventory_movements WHERE ref_type='invoice' AND ref_id = ?").get(inv.id) as any;
    assert.strictEqual(Number(invMoves.c), 0);
    // اقلام از سفارش با مقدار دریافت‌شده و بهای واحد آمده‌اند
    const items = db.prepare("SELECT * FROM invoice_items WHERE invoice_id = ?").all(inv.id) as any[];
    assert.strictEqual(items.length, 1);
    assert.strictEqual(Number(items[0].qty), 2);
    assert.strictEqual(Number(items[0].unit_price), 40000);
    // سفارش دریافت‌نشده قابل اتصال نیست
    const po2 = db
      .prepare("INSERT INTO purchase_orders(number, supplier_id, branch_id, status, date, items_total, tax, total, created_by) VALUES(?,?,?,?,date('now'),?,?,?,?)")
      .run("PO-TEST-2", supplierId, 1, "sent", 0, 0, 0, mgrId).lastInsertRowid as number;
    assert.throws(() => createInvoice(session(mgrId), { type: "purchase", purchase_order_id: po2 }, "1"), /دریافت/);
  });

  it("شماره فاکتورها یکتا و بدون تکرار صادر می‌شود", async () => {
    const { createInvoice } = await import("@/lib/invoice");
    const a = createInvoice(session(mgrId), { type: "sale", customer_id: customerId, confirm: false, items: [{ kind: "labor", name: "x", qty: 1, unit_price: 1000 }] }, "1");
    const b = createInvoice(session(mgrId), { type: "sale", customer_id: customerId, confirm: false, items: [{ kind: "labor", name: "x", qty: 1, unit_price: 1000 }] }, "1");
    assert.notStrictEqual(a.number, b.number);
    const dup = (db.prepare("SELECT COUNT(*) c FROM invoices WHERE number = ?").get(a.number) as any).c;
    assert.strictEqual(Number(dup), 1);
  });
});
