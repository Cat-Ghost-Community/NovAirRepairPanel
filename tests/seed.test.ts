import { describe, it, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// بازتولید نصب تازه: seed باید روی دیتابیس خالی بدون خطا و کامل اجرا شود
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repaid-seed-"));
process.env.REPAID_DATA_DIR = dir;
Object.assign(process.env, { NODE_ENV: "test", REPAID_DEMO_MODE: "1" });

describe("seed نصب تازه", () => {
  for (const environment of ["production", "development"] as const) it(`does not create a database or demo records in ${environment}, even when the legacy flag is enabled`, () => {
    const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "repaid-no-demo-"));
    const result = spawnSync(process.execPath, ["--import", "tsx", "-e", "import('./src/lib/seed.ts').then(({seedIfEmpty})=>seedIfEmpty())"], {
      env: { ...process.env, NODE_ENV: environment, REPAID_DEMO_MODE: "1", REPAID_DATA_DIR: isolated },
      encoding: "utf8", timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(isolated, "repaid.db")), false);
  });
  it("روی دیتابیس خالی بدون خطا و کامل اجرا می‌شود", async () => {
    const { seedIfEmpty } = await import("@/lib/seed");
    const { getDb } = await import("@/lib/db/schema");
    seedIfEmpty();
    const db = getDb();
    const one = (sql: string) => Number((db.prepare(sql).get() as any)?.c ?? 0);

    assert.ok((one("SELECT COUNT(*) c FROM branches")) > (0));
    assert.ok((one("SELECT COUNT(*) c FROM users")) > (0));
    assert.ok((one("SELECT COUNT(*) c FROM repair_statuses")) > (0));
    assert.ok((one("SELECT COUNT(*) c FROM repair_tickets")) > (0));
    // دادهٔ نمونهٔ چت
    assert.ok((one("SELECT COUNT(*) c FROM chat_conversations")) > (0));
    assert.ok((one("SELECT COUNT(*) c FROM chat_messages")) > (0));

    // seed دوم نباید چیزی را دوباره بسازد
    const before = one("SELECT COUNT(*) c FROM branches");
    seedIfEmpty();
    assert.strictEqual(one("SELECT COUNT(*) c FROM branches"), before);
  });
});

afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});
