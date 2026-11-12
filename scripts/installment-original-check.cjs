const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const rehearsal=JSON.parse(fs.readFileSync('.qa-work/v7-schema-rehearsal.json','utf8')),old=new DatabaseSync(rehearsal.file,{readOnly:true}),current=new DatabaseSync(path.resolve('data/repaid.db'),{readOnly:true}),quote=s=>'"'+s.replaceAll('"','""')+'"';
try{
 const tables=old.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
 const hash=db=>{const digest=crypto.createHash('sha256');for(const t of tables){const columns=old.prepare(`PRAGMA table_info(${quote(t.name)})`).all().map(c=>c.name);const rows=db.prepare(`SELECT ${columns.map(quote).join(',')} FROM ${quote(t.name)}`).all().map(row=>JSON.stringify(row,(_,v)=>typeof v==='bigint'?String(v):v)).sort();digest.update(JSON.stringify({table:t.name,rows}));}return digest.digest('hex');};
 const before=hash(old),after=hash(current),counts={};for(const t of ['installment_schedules','installment_schedule_terms','installment_allocations','installment_allocation_reversals','accounting_journals','accounting_events','accounting_recognition_policies','accounting_opening_documents','business_returns','credit_notes'])counts[t]=current.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
 const integrity=current.prepare('PRAGMA integrity_check').get().integrity_check,foreignKeys=current.prepare('PRAGMA foreign_key_check').all().length;
 const caseEvidenceHash=crypto.createHash('sha256').update(fs.readFileSync('data/reconciliation/cases-v3-1c2f7bfc975b.json')).digest('hex');
 const result={tablesBefore:tables.length,tablesAfter:current.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n,before,after,originalRowsUnchanged:before===after,integrity,foreignKeys,counts,caseEvidenceHash};fs.writeFileSync('.qa-work/v7-original-verification.json',JSON.stringify(result,null,2),{mode:0o600});
 if(before!==after||integrity!=='ok'||foreignKeys||Object.values(counts).some(n=>n!==0)||caseEvidenceHash!=='1c2f7bfc975bc20aa7f35fec1b794c019008672b68575533d53f46970e1e732d')throw new Error('Original preservation check failed; inspect private evidence');
 console.log('All original table rows and disputed-case evidence unchanged; additive financial tables remain empty.');
}finally{old.close();current.close();}
