import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasAnyPerm, hasPerm } from "@/lib/perms-shared";

describe("hasPerm — بررسی مجوز در سمت کلاینت", () => {
  it("مجوز دقیق را می‌شناسد", () => {
    assert.strictEqual(hasPerm(["repairs.view"], "repairs.view"), true);
    assert.strictEqual(hasPerm(["repairs.view"], "repairs.edit"), false);
  });

  it("wildcard ماژول را پوشش می‌دهد", () => {
    assert.strictEqual(hasPerm(["repairs.*"], "repairs.edit"), true);
    assert.strictEqual(hasPerm(["repairs.*"], "payments.view"), false);
  });

  it("wildcard کل (مالک/ادمین) همه‌چیز را می‌دهد", () => {
    assert.strictEqual(hasPerm(["*"], "payments.refund"), true);
    assert.strictEqual(hasPerm(["*"], "settings.edit"), true);
  });

  it("فهرست خالی یا نامعتبر دسترسی نمی‌دهد", () => {
    assert.strictEqual(hasPerm([], "repairs.view"), false);
    assert.strictEqual(hasPerm(null, "repairs.view"), false);
    assert.strictEqual(hasPerm(undefined, "repairs.view"), false);
  });

  it("hasAnyPerm با داشتن یکی از موارد درست است", () => {
    assert.strictEqual(hasAnyPerm(["inventory.view"], ["payments.view", "inventory.view"]), true);
    assert.strictEqual(hasAnyPerm(["inventory.view"], ["payments.view", "finance.view"]), false);
  });
});
