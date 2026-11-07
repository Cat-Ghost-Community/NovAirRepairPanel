import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
async function main(){
 const backup=path.resolve(process.env.WORKFLOW_REHEARSAL_BACKUP||'.freebuff/workflow-before.db');
 const live=path.resolve(process.env.REPAID_DATA_DIR||'data','repaid.db');
 if(backup===live||!fs.existsSync(backup)||fs.existsSync(backup+'-wal')&&fs.statSync(backup+'-wal').size>0)throw Error('Use an existing standalone consistent backup, not a live WAL database.');
 fs.mkdirSync(path.resolve('.freebuff'),{recursive:true});
 const directory=fs.mkdtempSync(path.resolve('.freebuff/workflow-schema-'));
 fs.copyFileSync(backup,path.join(directory,'repaid.db'));process.env.REPAID_DATA_DIR=directory;
 const original=new DatabaseSync(backup,{readOnly:true});const {getDb}=await import('../src/lib/db/schema');const restored=getDb();
 const quote=(s:string)=>'"'+s.replaceAll('"','""')+'"',hash=(v:unknown)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const tables=original.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
 for(const table of tables){const name=String(table.name),columns=original.prepare(`PRAGMA table_info(${quote(name)})`).all().map(c=>quote(String(c.name))).join(',');const sql=`SELECT ${columns} FROM ${quote(name)} ORDER BY rowid`;if(hash(original.prepare(sql).all())!==hash(restored.prepare(sql).all()))throw Error('Historical mismatch '+name);}
 const result={restored_copy:directory,original_tables_preserved:tables.length,integrity:restored.prepare('PRAGMA integrity_check').get(),foreign_key_violations:restored.prepare('PRAGMA foreign_key_check').all().length,workflow_rows:restored.prepare('SELECT COUNT(*) n FROM branch_repair_workflows').get()};
 fs.writeFileSync('.freebuff/workflow-schema-rehearsal.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));original.close();restored.close();
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
