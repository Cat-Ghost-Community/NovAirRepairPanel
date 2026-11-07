import fs from "node:fs";
import { DB_PATH,getDb } from "../src/lib/db/schema";
import { atomic } from "../src/lib/db/transaction";
import { verifiedSnapshot } from "../src/lib/backup";
import { encryptCredential,decryptCredential } from "../src/lib/secrets";

async function main() {
  if(!/^[a-f0-9]{64}$/i.test(process.env.REPAID_ENCRYPTION_KEY??"")) throw new Error("Configure and preserve REPAID_ENCRYPTION_KEY before rotation.");
  const db=getDb();
  try {
    const count=db.prepare("SELECT COUNT(*) n FROM repair_tickets WHERE security_value_enc IS NOT NULL AND security_value_enc NOT LIKE 'v2.%'").get()?.n;
    console.log(`Legacy encrypted records: ${count}`);
    if(process.env.REPAID_MIGRATE_CREDENTIALS!=="approved") {
      console.log("Read-only inspection. Apply only after approval: REPAID_MIGRATE_CREDENTIALS=approved npm run migrate:credentials");
      return;
    }
    const snapshot=await verifiedSnapshot(db);
    fs.writeFileSync(DB_PATH+`.before-key-rotation-${Date.now()}.db`,snapshot,{flag:"wx",mode:0o600});
    atomic(db,()=>{
      const rows=db.prepare("SELECT id,security_value_enc FROM repair_tickets WHERE security_value_enc IS NOT NULL AND security_value_enc NOT LIKE 'v2.%'").all();
      const update=db.prepare("UPDATE repair_tickets SET security_value_enc=? WHERE id=? AND security_value_enc=?");
      for(const row of rows) {
        const original=String(row.security_value_enc);
        const plain=decryptCredential(original);
        const encrypted=encryptCredential(plain);
        if(decryptCredential(encrypted)!==plain) throw new Error("Credential round-trip failed");
        update.run(encrypted,row.id,original);
      }
      db.prepare("INSERT INTO audit_logs(action,entity,after) VALUES('key_rotation','repair_credentials',?)").run(JSON.stringify({count:rows.length}));
    });
    console.log("Credential rotation committed; verified recovery snapshot retained.");
  } finally { db.close(); }
}
main().catch(()=>{console.error("Credential rotation failed. Preserve the old database and keys; inspect in a protected maintenance session.");process.exitCode=1;});
