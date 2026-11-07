import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { describeEntry, groupByDay, hhmm, humanMinutes, weekdayName, type WorkLogRow } from "@/lib/worklog-shared";

const row = (patch: Partial<WorkLogRow> = {}): WorkLogRow => ({
  kind: "time",
  row_id: 1,
  ts: "2026-10-04 20:08:09",
  user_name: "جواد محمدی",
  user_color: "#0ea5e9",
  status_name: null,
  status_color: null,
  minutes: 30,
  is_manual: 0,
  running: 0,
  body: null,
  ...patch,
});

describe("متن ردیف گزارش کار", () => {
  it("متن نوشتهٔ تعمیرکار مقدم است", () => {
    assert.strictEqual(describeEntry(row({ kind: "note", body: "  تعویض فلت شارژ  " })), "تعویض فلت شارژ");
  });

  it("بدون متن، شرح خودکار رخداد میآید", () => {
    assert.ok((describeEntry(row({ kind: "status", status_name: "In Repair" }), "در حال تعمیر")).includes("در حال تعمیر"));
    assert.ok((describeEntry(row())).includes("بدون یادداشت"));
  });

  it("وضعیت بدون نام، جای‌خالی میماند — نه undefined", () => {
    assert.strictEqual(describeEntry(row({ kind: "status" })), "وضعیت دستگاه به «—» تغییر کرد");
  });
});

describe("ساعت ردیف", () => {
  it("ساعت را با ارقام فارسی برمیدارد", () => {
    assert.strictEqual(hhmm("2026-10-04 20:08:09"), "۲۰:۰۸");
    assert.strictEqual(hhmm("بد"), "—");
    assert.strictEqual(hhmm(""), "—");
  });

  it("نام روز هفته درست است", () => {
    assert.strictEqual(weekdayName("2026-10-04 12:00:00"), "یکشنبه"); // ۱۴۰۵/۰۷/۱۲
    assert.strictEqual(weekdayName("2026-10-03 12:00:00"), "شنبه");
    assert.strictEqual(weekdayName("2026-10-02 12:00:00"), "جمعه");
    assert.strictEqual(weekdayName("بد"), "");
  });
});

describe("گروه‌بندی روزها", () => {
  it("ردیف‌های پشت‌سرهم یک روز در یک گروه میروند و ترتیب حفظ میشود", () => {
    const rows = [
      row({ row_id: 1, ts: "2026-10-04 20:00:00" }),
      row({ row_id: 2, ts: "2026-10-04 09:00:00" }),
      row({ row_id: 3, ts: "2026-10-03 22:00:00" }),
    ];
    const groups = groupByDay(rows, (r) => r.ts.slice(0, 10));
    assert.deepStrictEqual(groups.map((g) => g.key), ["2026-10-04", "2026-10-03"]);
    assert.deepStrictEqual(groups[0].rows.map((r) => r.row_id), [1, 2]);
  });

  it("ورودی خالی، خروجی خالی", () => {
    assert.deepStrictEqual(groupByDay([], () => "x"), []);
  });
});

describe("مدت زمان کار", () => {
  it("ارقام فارسی و بدون رقم لاتین", () => {
    assert.strictEqual(humanMinutes(95), "۱ ساعت و ۳۵ دقیقه");
    assert.strictEqual(humanMinutes(120), "۲ ساعت");
    assert.strictEqual(humanMinutes(45), "۴۵ دقیقه");
    assert.strictEqual(humanMinutes(0), "۰ دقیقه");
    assert.doesNotMatch(humanMinutes(95), /[0-9]/);
  });

  it("ورودی نامعتبر صفر میشود", () => {
    assert.strictEqual(humanMinutes(null), "۰ دقیقه");
    assert.strictEqual(humanMinutes(undefined), "۰ دقیقه");
    assert.strictEqual(humanMinutes(-30), "۰ دقیقه");
  });
});
