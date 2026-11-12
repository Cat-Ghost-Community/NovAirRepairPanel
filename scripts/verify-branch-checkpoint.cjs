/** Read-only comparison. Never migrates, seeds, authenticates or writes to either database. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const baseline=path.resolve(process.env.BRANCH_BASELINE||'.qa-work/tonight-before-branch-ownership.db');
const target=path.resolve(process.env.BRANCH_VERIFY_TARGET||'data/repaid.db');
if(!fs.existsSync(baseline)||!fs.existsSync(target)||baseline===target)throw Error('Existing, distinct baseline and target databases required');
const original=new DatabaseSync(baseline,{readOnly:true}),current=new DatabaseSync(target,{readOnly:true});
const quote=name=>'"'+name.replaceAll('"','""')+'"';
const digest=rows=>crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const differences=[],additions=[];
try{
  const tables=original.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  for(const {name} of tables){
    const columns=original.prepare(`PRAGMA table_info(${quote(name)})`).all().map(c=>c.name);
    const select=`SELECT ${columns.map(quote).join(',')} FROM ${quote(name)} ORDER BY rowid`;
    if(digest(original.prepare(select).all())!==digest(current.prepare(select).all()))differences.push(name);
    for(const field of current.prepare(`PRAGMA table_info(${quote(name)})`).all())if(!columns.includes(field.name))additions.push({table:name,column:field.name,non_null_rows:Number(current.prepare(`SELECT COUNT(*) n FROM ${quote(name)} WHERE ${quote(field.name)} IS NOT NULL`).get().n)});
  }
  const result={target,tables_checked:tables.length,historical_values_unchanged:differences.length===0,differences,additions,integrity:current.prepare('PRAGMA integrity_check').get().integrity_check,foreign_key_violations:current.prepare('PRAGMA foreign_key_check').all().length};
  fs.writeFileSync('.qa-work/tonight-original-verification.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify({tables_checked:result.tables_checked,historical_values_unchanged:result.historical_values_unchanged,changed_tables:differences.length,new_columns:additions.length,legacy_backfilled_rows:additions.reduce((sum,c)=>sum+c.non_null_rows,0),integrity:result.integrity,foreign_key_violations:result.foreign_key_violations}));
  if(differences.length||result.integrity!=='ok'||result.foreign_key_violations)process.exitCode=1;
}finally{original.close();current.close();}
