// Read-only original database; all schema execution occurs on a restored private copy.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{DatabaseSync,backup}=require('node:sqlite'),{spawnSync}=require('node:child_process');
const quote=s=>'"'+s.replaceAll('"','""')+'"';
function fingerprint(db,tables){const hash=crypto.createHash('sha256');for(const t of tables){const rows=db.prepare(`SELECT ${t.columns.map(quote).join(',')} FROM ${quote(t.name)}`).all().map(row=>JSON.stringify(row,(_,v)=>typeof v==='bigint'?String(v):v)).sort();hash.update(JSON.stringify({table:t.name,rows}));}return hash.digest('hex');}
(async()=>{
 const original=new DatabaseSync(path.resolve('data/repaid.db'),{readOnly:true}),directory=fs.mkdtempSync(path.resolve('.freebuff/v8-schema-')),file=path.join(directory,'snapshot.db'),restored=path.join(directory,'restore');fs.mkdirSync(restored);
 let snapshot,copy;
 try{
  await backup(original,file);snapshot=new DatabaseSync(file,{readOnly:true});const tables=snapshot.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(t=>({name:t.name,columns:snapshot.prepare(`PRAGMA table_info(${quote(t.name)})`).all().map(c=>c.name)}));const before=fingerprint(snapshot,tables);
  if(snapshot.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||snapshot.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Backup verification failed');
  await backup(snapshot,path.join(restored,'repaid.db'));snapshot.close();snapshot=undefined;
  const run=spawnSync(process.execPath,['--import','tsx','-e',"const s=require('./src/lib/db/schema.ts');s.getDb().close();"],{env:{...process.env,REPAID_DATA_DIR:restored},encoding:'utf8',windowsHide:true});if(run.status!==0)throw new Error('Restored-copy schema initialization failed: '+run.stderr);
  copy=new DatabaseSync(path.join(restored,'repaid.db'),{readOnly:true});const after=fingerprint(copy,tables),integrity=copy.prepare('PRAGMA integrity_check').get().integrity_check,foreignKeys=copy.prepare('PRAGMA foreign_key_check').all().length;if(before!==after||integrity!=='ok'||foreignKeys)throw new Error('Historical preservation verification failed');
  fs.writeFileSync('.freebuff/v8-schema-rehearsal.json',JSON.stringify({file,restored,tables:tables.length,before,after,integrity,foreignKeys,originalModified:false,newTables:['installment_schedules','installment_schedule_terms','installment_allocations','installment_allocation_reversals'].map(name=>({name,count:copy.prepare(`SELECT COUNT(*) n FROM ${name}`).get().n})),legacyRows:copy.prepare('SELECT COUNT(*) n FROM effective_installments WHERE legacy_review=1').get().n},null,2),{mode:0o600});console.log('Verified backup, separate restoration, additive schema rehearsal and original-column historical fingerprint agree.');
 }finally{copy?.close();snapshot?.close();original.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
