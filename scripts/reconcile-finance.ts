import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { financialReconciliation } from "../src/lib/financial-reconciliation";

const database = process.argv[2];
if (!database || database.startsWith("--")) throw new Error("Usage: node --import tsx scripts/reconcile-finance.ts <database-path> [--strict]");
const db = new DatabaseSync(path.resolve(database), { readOnly: true });
try {
  db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000; BEGIN");
  const result = financialReconciliation(db);
  const integrity = db.prepare("PRAGMA integrity_check").all();
  const foreignKeyViolations = db.prepare("PRAGMA foreign_key_check").all().length;
  db.exec("COMMIT");
  console.log(JSON.stringify({ ...result, integrityOk: integrity.length === 1 && integrity[0].integrity_check === "ok", foreignKeyViolations }, null, 2));
  if (process.argv.includes("--strict") && (result.requiresReview || foreignKeyViolations || integrity[0]?.integrity_check !== "ok")) process.exitCode = 1;
} finally { if (db.isTransaction) db.exec("ROLLBACK"); db.close(); }
