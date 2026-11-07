import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repaid-tariff-"));
process.env.REPAID_DATA_DIR = dir;

describe("تعرفهٔ تعمیرات (repair_tariffs)", () => {
  it("جدول و ایندکس ساخته می‌شوند و درج/خواندن درست است", async () => {
    const { getDb } = await import("@/lib/db/schema");
    const db = getDb();

    const cols = (db.prepare("PRAGMA table_info(repair_tariffs)").all() as any[]).map((c) => c.name);
    for (const col of ["device_type", "brand", "title", "labor_price", "duration_min", "warranty_days", "notes", "is_active"]) {
      assert.ok((cols).includes(col));
    }
    const idx = (db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='repair_tariffs'").all() as any[]).map((r) => r.name);
    assert.ok((idx).includes("idx_repair_tariffs_active"));

    // گارانتی هر قلم پذیرش (از تعرفه/خدمت پر می‌شود) — باید در ticket_items باشد
    const itemCols = (db.prepare("PRAGMA table_info(ticket_items)").all() as any[]).map((c) => c.name);
    assert.ok((itemCols).includes("warranty_days"));

    db.prepare(
      "INSERT INTO repair_tariffs(device_type, brand, title, labor_price, warranty_days) VALUES(?,?,?,?,?)"
    ).run("موبایل", "سامسونگ", "تعویض ال‌سی‌دی", 2500000, 90);
    const row = db
      .prepare("SELECT device_type, title, labor_price, warranty_days, is_active FROM repair_tariffs WHERE title = ?")
      .get("تعویض ال‌سی‌دی") as any;
    assert.strictEqual(row.device_type, "موبایل");
    assert.strictEqual(Number(row.labor_price), 2500000);
    assert.strictEqual(Number(row.warranty_days), 90);
    assert.strictEqual(Number(row.is_active), 1);
  });

  it("عنوان و نوع دستگاه اجباری‌اند", async () => {
    const { getDb } = await import("@/lib/db/schema");
    const db = getDb();
    assert.throws(() => {
      db.prepare("INSERT INTO repair_tariffs(device_type, title) VALUES(?,?)").run(null, "بدون نوع");
    });
  });
});
