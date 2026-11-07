import { getDb } from "../src/lib/db/schema";
import { ensureDefaultStatuses } from "../src/lib/repair";
import { hashPassword } from "../src/lib/auth";

// Run on the target persistent volume before exposing the service.
const email = process.env.REPAID_OWNER_EMAIL?.trim().toLowerCase();
const password = process.env.REPAID_OWNER_PASSWORD;
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  || !password || password.length < 12 || password.length > 1024) {
  throw new Error("Set REPAID_OWNER_EMAIL and REPAID_OWNER_PASSWORD (12–1024 characters) through your secret manager.");
}
if (!/^[a-f0-9]{64}$/i.test(process.env.REPAID_ENCRYPTION_KEY ?? "")) {
  throw new Error("Set REPAID_ENCRYPTION_KEY to 64 random hexadecimal characters and preserve it separately from backups.");
}
const db = getDb();
const passwordHash = hashPassword(password);
db.exec("BEGIN IMMEDIATE");
try {
  if (db.prepare("SELECT id FROM users LIMIT 1").get()) throw new Error("Setup refused: users already exist. Existing accounts are never overwritten.");
  ensureDefaultStatuses();
  let branch = db.prepare("SELECT id FROM branches WHERE is_active=1 ORDER BY id LIMIT 1").get();
  if (!branch) {
    const result = db.prepare("INSERT INTO branches(name,code) VALUES(?,?)").run("شعبه مرکزی", "MAIN");
    branch = { id: result.lastInsertRowid };
  }
  const result = db.prepare("INSERT INTO users(name,email,password_hash,role,branch_id) VALUES(?,?,?,'owner',?)")
    .run(process.env.REPAID_OWNER_NAME?.trim() || "مدیر سامانه", email, passwordHash, branch.id);
  db.prepare("INSERT INTO inventory_locations(name,is_default,branch_id) VALUES(?,1,?)").run("انبار مرکزی",branch.id);
  db.prepare("INSERT INTO audit_logs(user_id,action,entity,entity_id) VALUES(?,'bootstrap','user',?)")
    .run(result.lastInsertRowid, result.lastInsertRowid);
  db.exec("COMMIT");
  console.log("Production owner initialized. No demonstration business records installed.");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}
