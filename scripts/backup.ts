import fs from "node:fs";
import path from "node:path";
import { getDb,DB_PATH } from "../src/lib/db/schema";
import {requireDatabaseSource} from './database-source';
import { verifiedFileSnapshot,requireBackupSpace } from "../src/lib/backup";
import {protectedBackupPath} from '../src/lib/backup-archive';
import {withBackupPreparation} from '../src/lib/backup-admission';

async function main() {
  const output=process.env.REPAID_BACKUP_OUTPUT;
  if(!output) throw new Error("Set REPAID_BACKUP_OUTPUT to a new, protected backup file outside the web root.");
  const filename=protectedBackupPath(path.resolve(output));
  requireDatabaseSource(DB_PATH);const db=getDb();
  try {
    await withBackupPreparation(db,null,async()=>{const snapshot=await verifiedFileSnapshot(db);
    try{requireBackupSpace(path.dirname(filename),BigInt(snapshot.bytes));fs.copyFileSync(snapshot.filename,filename,fs.constants.COPYFILE_EXCL);fs.chmodSync(filename,0o600);console.log(`Verified SQLite backup created (${snapshot.bytes} bytes).`);}finally{snapshot.cleanup();}});
  } finally { db.close(); }
}
main().catch(()=>{ console.error("Backup failed; no recovery claim can be made. Check configuration and database integrity."); process.exitCode=1; });
