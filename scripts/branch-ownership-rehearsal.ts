import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";

async function main(){
  const source=path.resolve(process.env.BRANCH_REHEARSAL_INPUT??".freebuff/tonight-before-branch-ownership.db");
  const privateRoot=path.resolve(".freebuff")+path.sep;
  if(!source.startsWith(privateRoot)||!fs.existsSync(source))throw new Error("A verified private backup is required; original databases are never migration targets.");
  const directory=fs.mkdtempSync(path.join(privateRoot,"tonight-ownership-rehearsal-"));
  const restoredFile=path.join(directory,"repaid.db");
  fs.copyFileSync(source,restoredFile,fs.constants.COPYFILE_EXCL);
  const sha=(buffer:Buffer|string)=>crypto.createHash("sha256").update(buffer).digest("hex");
  const backupHash=sha(fs.readFileSync(source));
  assert.equal(sha(fs.readFileSync(restoredFile)),backupHash);
  const original=new DatabaseSync(source,{readOnly:true});
  const quote=(name:string)=>'"'+name.replaceAll('"','""')+'"';
  const snapshots=new Map<string,{columns:string[];hash:string;count:number}>();
  try{
    assert.equal(original.prepare("PRAGMA integrity_check").get()!.integrity_check,"ok");
    for(const {name} of original.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()){
      const table=String(name),columns=original.prepare(`PRAGMA table_info(${quote(table)})`).all().map(row=>String(row.name));
      const rows=original.prepare(`SELECT ${columns.map(quote).join(',')} FROM ${quote(table)} ORDER BY rowid`).all();
      snapshots.set(table,{columns,hash:sha(JSON.stringify(rows)),count:rows.length});
    }
  }finally{original.close();}
  process.env.REPAID_DATA_DIR=directory;process.env.REPAID_DEMO_MODE="0";
  const {getDb}=await import("../src/lib/db/schema");
  const restored=getDb();
  try{
    assert.equal(restored.prepare("PRAGMA integrity_check").get()!.integrity_check,"ok");
    assert.equal(restored.prepare("PRAGMA foreign_key_check").all().length,0);
    for(const [table,evidence] of snapshots){
      const rows=restored.prepare(`SELECT ${evidence.columns.map(quote).join(',')} FROM ${quote(table)} ORDER BY rowid`).all();
      assert.equal(rows.length,evidence.count,`${table}: row count changed`);
      assert.equal(sha(JSON.stringify(rows)),evidence.hash,`${table}: historical values changed`);
    }
    const newColumns=[];
    for(const [table,evidence] of snapshots)for(const row of restored.prepare(`PRAGMA table_info(${quote(table)})`).all())if(!evidence.columns.includes(String(row.name))){
      newColumns.push({table,column:String(row.name)});
      assert.equal(restored.prepare(`SELECT COUNT(*) n FROM ${quote(table)} WHERE ${quote(String(row.name))} IS NOT NULL`).get()!.n,0,`${table}: legacy branch data was backfilled`);
    }
    const evidence={backup:source,backup_sha256:backupHash,restored:restoredFile,tables_preserved:snapshots.size,historical_values_preserved:true,new_columns:newColumns,
      customer_access:restored.prepare("SELECT branch_id,COUNT(*) count FROM customer_branch_access GROUP BY branch_id ORDER BY branch_id").all(),
      device_access:restored.prepare("SELECT branch_id,COUNT(*) count FROM device_branch_access GROUP BY branch_id ORDER BY branch_id").all(),
      shared_legacy_profiles:Number(restored.prepare("SELECT COUNT(*) n FROM (SELECT customer_id FROM customer_branch_access GROUP BY customer_id HAVING COUNT(*)>1)").get()!.n),
      profiles_without_evidence:Number(restored.prepare("SELECT COUNT(*) n FROM customers c WHERE NOT EXISTS(SELECT 1 FROM customer_branch_access a WHERE a.customer_id=c.id)").get()!.n),
      integrity:"ok",foreign_key_violations:0,production_corrections_applied:false};
    fs.writeFileSync(path.join(privateRoot,"tonight-branch-rehearsal.json"),JSON.stringify(evidence,null,2));
    console.log(JSON.stringify({tables_preserved:snapshots.size,new_columns:newColumns.length,historical_values_preserved:true,integrity:"ok",foreign_key_violations:0,customer_access:evidence.customer_access,device_access:evidence.device_access,shared_legacy_profiles:evidence.shared_legacy_profiles,profiles_without_evidence:evidence.profiles_without_evidence}));
  }finally{restored.close();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
