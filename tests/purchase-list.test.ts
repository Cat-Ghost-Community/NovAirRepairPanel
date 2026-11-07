import { describe, it, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// دیتابیس مجزا در پوشهٔ موقت: DDL و مهاجرت‌ها واقعاً اجرا می‌شوند
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repaid-plist-"));
process.env.REPAID_DATA_DIR = dir;

describe("لیست خرید تأمین‌کننده (supplier_purchase_items)", () => {
  it("جدول در DDL ساخته می‌شود و درج/خواندن کار می‌کند", async () => {
    const { getDb } = await import("@/lib/db/schema");
    const db = getDb();

    const cols = (db.prepare("PRAGMA table_info(supplier_purchase_items)").all() as any[]).map((c) => c.name);
    for (const col of ["supplier_id", "part_id", "name", "qty", "est_cost", "priority", "status", "done_at", "po_id"]) {
      assert.ok((cols).includes(col));
    }

    const supplierId = db.prepare("INSERT INTO suppliers(name) VALUES(?)").run("تأمین‌کنندهٔ تست").lastInsertRowid;
    db.prepare("INSERT INTO supplier_purchase_items(supplier_id, name, qty, est_cost, priority) VALUES(?,?,?,?,?)")
      .run(supplierId, "برد شارژ تست", 2, 150000, "urgent");

    const row = db
      .prepare("SELECT name, qty, est_cost, priority, status FROM supplier_purchase_items WHERE supplier_id = ?")
      .get(supplierId) as any;
    assert.strictEqual(row.name, "برد شارژ تست");
    assert.strictEqual(Number(row.qty), 2);
    assert.strictEqual(Number(row.est_cost), 150000);
    assert.strictEqual(row.priority, "urgent");
    assert.strictEqual(row.status, "pending");
  });

  it("کلید خارجی تأمین‌کننده اعمال می‌شود", async () => {
    const { getDb } = await import("@/lib/db/schema");
    const db = getDb();
    assert.throws(() => {
      db.prepare("INSERT INTO supplier_purchase_items(supplier_id, name) VALUES(?,?)").run(999999, "بی‌صاحب");
    });
  });
});

afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});
