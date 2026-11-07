import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canForUser, PERM_TEMPLATES } from "@/lib/auth";
import { fmtMoney, toFaDigits, fmtDate, fmtDateTime, toJalaali, toGregorian,faQty } from "@/lib/format";
import { jalaaliMonthLength } from "@/lib/jdate";
import { pageMeta, pageParams } from "@/lib/pagination";

describe("دسترسی per-user", () => {
  it("نقش owner همه‌چیز دارد", () => {
    assert.strictEqual(canForUser("owner", "settings.edit", null), true);
  });

  it("نقش معمولی دسترسی نامرتبط ندارد", () => {
    assert.strictEqual(canForUser("technician", "settings.edit", null), false);
  });

  it("deny شخصی بر نقش مقدم است", () => {
    // technician repairs.view دارد؛ deny شخصی باید برنده شود
    assert.strictEqual(canForUser("technician", "repairs.view", null), true);
  });

  it("قالب‌های آماده حداقل یک دسترسی دارند", () => {
    for (const [k, t] of Object.entries(PERM_TEMPLATES)) {
      assert.ok((t.perms.length) > (0));
      assert.ok((t.label.length) > (0));
    }
  });
});

describe("قالب پول و اعداد فارسی", () => {
  it("fmtMoney صفر و منفی", () => {
    assert.ok((fmtMoney(0)).includes("۰"));
    assert.ok((fmtMoney(-5000)).includes("-"));
  });

  it("toFaDigits تبدیل درست", () => {
    assert.equal(faQty(0.333333),'۰.۳۳۳۳۳۳');assert.equal(faQty(0.000001),'۰.۰۰۰۰۰۱');
    assert.strictEqual(toFaDigits("123"), "۱۲۳");
    assert.strictEqual(toFaDigits(45), "۴۵");
  });
});

describe("تقویم جلالی", () => {
  it("timestamps retain their offset and display Tehran midnight correctly", () => {
    assert.equal(fmtDateTime("2026-10-24T21:00:00Z"), fmtDateTime("2026-10-25T00:30:00+03:30"));
    assert.match(fmtDateTime("2026-10-24T21:00:00Z"), /۰۰:۳۰/);
    assert.equal(fmtDate("2026-02-31"), "—");
    assert.equal(fmtDate("invalid"), "—");
    assert.notEqual(fmtDate("2026-10-24 12:34:56"), "—");
  });
  it("تبدیل رفت و برگشت یک تاریخ معروف", () => {
    // ۱۴۰۵/۰۷/۱۵ ↔ میلادی
    const j = toJalaali(2026, 10, 7);
    assert.strictEqual(j.jy, 1405);
    assert.strictEqual(j.jm, 7);
    const g = toGregorian(1405, 7, 15);
    assert.strictEqual(g.gy, 2026);
    assert.strictEqual(g.gm, 10);
    assert.strictEqual(g.gd, 7);
  });

  it("طول ماه‌ها: فروردین ۳۱، مهر ۳۰", () => {
    assert.strictEqual(jalaaliMonthLength(1405, 1), 31);
    assert.strictEqual(jalaaliMonthLength(1405, 7), 30);
  });

  it("fmtDate خالی خطا نمی‌دهد", () => {
    assert.strictEqual(fmtDate(null), "—");
    assert.strictEqual(fmtDate(""), "—");
  });

  it("fmtDate با datetime خراب هم درست کار می‌کند", () => {
    // باگ قبلی: "2026-09-29 21:37:29" باعث RangeError می‌شد
    assert.notStrictEqual(fmtDate("2026-09-29 21:37:29"), "—");
  });
});

describe("صفحه‌بندی", () => {
  it("meta درست حساب می‌شود", () => {
    const m = pageMeta(2, 50, 130);
    assert.strictEqual(m.totalPages, 3);
    assert.strictEqual(m.page, 2);
  });

  it("pageParams صف نامعتبر را ۱ می‌کند", () => {
    const p = pageParams(new URLSearchParams("page=abc"));
    assert.strictEqual(p.page, 1);
    assert.strictEqual(p.offset, 0);
  });

  it("perPage بیش از ۲۰۰ محدود می‌شود", () => {
    const p = pageParams(new URLSearchParams("perPage=9999"));
    assert.ok((p.perPage) <= (200));
  });
});
