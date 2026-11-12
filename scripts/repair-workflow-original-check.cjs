/** Read-only checkpoint comparison: never initializes, migrates or authenticates original data. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const before=path.resolve(process.env.WORKFLOW_BASELINE||'.qa-work/workflow-before.db'),target=path.resolve(process.env.WORKFLOW_VERIFY_TARGET||'data/repaid.db');
if(before===target||!fs.existsSync(before)||!fs.existsSync(target))throw Error('Two existing distinct database files required');
const baseline=new DatabaseSync(before,{readOnly:true}),current=new DatabaseSync(target,{readOnly:true}),quote=s=>'"'+s.replaceAll('"','""')+'"';
const hash=rows=>crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
try{
 const tables=baseline.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all(),changed=[];
 for(const {name} of tables){const fields=baseline.prepare(`PRAGMA table_info(${quote(name)})`).all().map(f=>quote(f.name)).join(',');const sql=`SELECT ${fields} FROM ${quote(name)} ORDER BY rowid`;if(hash(baseline.prepare(sql).all())!==hash(current.prepare(sql).all()))changed.push(name);}
 const result={tables_checked:tables.length,original_values_preserved:changed.length===0,changed_tables:changed,integrity:current.prepare('PRAGMA integrity_check').get().integrity_check,foreign_key_violations:current.prepare('PRAGMA foreign_key_check').all().length,live_workflow_configurations:current.prepare('SELECT COUNT(*) n FROM branch_repair_workflows').get().n,live_supervisor_grants:current.prepare('SELECT COUNT(*) n FROM repair_workflow_supervisors').get().n,historical_assignment_versions_nonzero:current.prepare('SELECT COUNT(*) n FROM repair_tickets WHERE assignment_version!=0').get().n};
 fs.writeFileSync('.qa-work/workflow-original-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(changed.length||result.integrity!=='ok'||result.foreign_key_violations)process.exitCode=1;
}finally{baseline.close();current.close();}
