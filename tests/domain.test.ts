import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { STATUS_FA, statusFa } from "@/lib/status-fa";
import { jalaaliMonthLength, jWeekdayIndexOfMonthStart } from "@/lib/jdate";
import { toJalaali, toGregorian } from "@/lib/format";

describe("ترجمه وضعیت‌ها", () => {
  it("همه وضعیت‌های اصلی ترجمه فارسی دارند", () => {
    const required = [
      "New", "Received", "Waiting for Diagnosis", "Diagnosing", "Estimate Prepared",
      "Waiting for Customer Approval", "Approved", "Waiting for Parts", "Parts Available",
      "In Repair", "Quality Control", "Ready for Pickup", "Delivered", "Warranty",
      "Returned for Rework", "Cancelled", "Unrepairable", "No Fault Found",
    ];
    for (const name of required) {
      assert.ok((STATUS_FA[name]));
      assert.notStrictEqual(statusFa(name), name);
    }
  });
});

describe("تقویم جلالی", () => {
  it("تطابق رفت‌وبرگشت میلادی↔جلالی", () => {
    // چند تاریخ معروف — ۱۴۰۳ کبیسه است (اسفند ۳۰ روز)
    const cases = [
      { g: [2026, 9, 26], j: [1405, 7, 4] },   // مهر ۱۴۰۵
      { g: [2026, 3, 21], j: [1405, 1, 1] },   // نوروز ۱۴۰۵
      { g: [2025, 3, 21], j: [1404, 1, 1] },   // نوروز ۱۴۰۴
      { g: [2025, 3, 20], j: [1403, 12, 30] }, // آخرین روز کبیسه ۱۴۰۳
      { g: [2024, 3, 20], j: [1403, 1, 1] },   // نوروز ۱۴۰۳
    ];
    for (const c of cases) {
      const j = toJalaali(c.g[0], c.g[1], c.g[2]);
      assert.deepStrictEqual([j.jy, j.jm, j.jd], c.j);
      const g = toGregorian(c.j[0], c.j[1], c.j[2]);
      assert.deepStrictEqual([g.gy, g.gm, g.gd], c.g);
    }
  });

  it("طول ماه‌های جلالی درست است (شش ماه اول ۳۱ روز)", () => {
    assert.strictEqual(jalaaliMonthLength(1404, 1), 31);
    assert.strictEqual(jalaaliMonthLength(1404, 6), 31);
    assert.strictEqual(jalaaliMonthLength(1404, 7), 30);
    assert.strictEqual(jalaaliMonthLength(1404, 11), 30);
    // اسفند ۱۴۰۳ کبیسه = ۳۰ روز، اسفند ۱۴۰۴ = ۲۹ روز
    assert.strictEqual(jalaaliMonthLength(1403, 12), 30);
    assert.strictEqual(jalaaliMonthLength(1404, 12), 29);
  });

  it("ماه جلالی از شنبه شروع شود که شنبه است", () => {
    // فروردین ۱۴۰۵ اولین روز = ۲۱ مارس ۲۰۲۶ = شنبه
    const g = toGregorian(1405, 1, 1);
    const dt = new Date(Date.UTC(g.gy, g.gm - 1, g.gd));
    assert.strictEqual(dt.getUTCDay(), 6); // JS: Saturday = 6
    assert.strictEqual(jWeekdayIndexOfMonthStart(1405, 1), 0); // شنبه = ایندکس ۰
  });
});
