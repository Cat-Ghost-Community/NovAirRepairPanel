import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';
import {RETURNS_DDL} from '@/lib/returns-schema';
import {legacyCreditUniqueness} from '@/lib/credit-reissue-schema';
const quote=(name:string)=>'"'+name.replaceAll('"','""')+'"';
function checks(sql:string){const values:string[]=[];for(const match of sql.matchAll(/\bCHECK\s*\(/gi)){let depth=1,end=match.index!+match[0].length;const start=end;for(;end<sql.length&&depth;end++){if(sql[end]==='(')depth++;if(sql[end]===')')depth--;}values.push(sql.slice(start,end-1).replace(/\s+/g,'').toLowerCase());}return values.sort();}
function knownDefinition(db:DatabaseSync,name:string,canonical:string){
 const old=String(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name)!.sql);
 if(/\bAUTOINCREMENT\b/i.test(old)||JSON.stringify(checks(old))!==JSON.stringify(checks(canonical)))throw new Error('Unknown legacy CHECK or sequence semantics require explicit migration review');
 const allowed=name==='credit_notes'?['number','journal_id','reversal_id','return_id']:['note_id,return_line_id','return_line_id'];
 for(const index of db.prepare(`PRAGMA index_list(${quote(name)})`).all())if(index.origin==='u'){
  const columns=db.prepare(`PRAGMA index_info(${quote(String(index.name))})`).all().map(c=>String(c.name)).join(',');if(!allowed.includes(columns))throw new Error('Unknown legacy automatic uniqueness must not be silently removed');
 }
}
function obsolete(db:DatabaseSync,table:string,name:string){const rows=db.prepare(`PRAGMA index_list(${quote(table)})`).all(),row=rows.find(r=>r.name===name);if(!row||!row.unique||row.partial)return false;const columns=db.prepare(`PRAGMA index_info(${quote(name)})`).all();return columns.length===1&&columns[0].name===(table==='credit_notes'?'return_id':'return_line_id');}
export function creditProjection(db:DatabaseSync){return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(t=>({name:String(t.name),columns:db.prepare(`PRAGMA table_info(${quote(String(t.name))})`).all().map(c=>String(c.name))}));}
export function creditDataFingerprint(db:DatabaseSync,projection=creditProjection(db)){const digest=createHash('sha256');for(const table of projection){const rows=db.prepare(`SELECT ${table.columns.map(quote).join(',')} FROM ${quote(table.name)}`).all().map(r=>JSON.stringify(Object.entries(r).sort(([a],[b])=>a.localeCompare(b)))).sort();digest.update(JSON.stringify({table:table.name,rows}));}return digest.digest('hex');}
/** SQLite's documented create/copy/drop/rename procedure, on a restored copy
 * ONLY. Never called by startup, an HTTP handler, or against customer originals. */
export function migrateLegacyCreditsOnCopy(db:DatabaseSync,checkpoint?:(phase:'copied'|'rebuilt')=>void){
 const filename=path.resolve(String(db.prepare('PRAGMA database_list').get()!.file)),tempRoot=path.resolve(os.tmpdir())+path.sep;
 if(!(filename.startsWith(tempRoot)&&filename.includes(path.sep+'repaid-credit-migration-')))throw new Error('Migration may run only on an explicitly restored private credit-migration copy');
 if(db.isTransaction)throw new Error('Offline credit migration requires its own transaction');
 const needed=legacyCreditUniqueness(db)||db.prepare("PRAGMA index_list('credit_note_lines')").all().some(i=>obsolete(db,'credit_note_lines',String(i.name)));if(!needed)return {changed:false,fingerprint:creditDataFingerprint(db)};
 if(db.prepare('PRAGMA integrity_check').get()!.integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Pre-existing integrity or foreign-key defects require reviewed correction first');
 const before=creditDataFingerprint(db),foreignKeys=Number(db.prepare('PRAGMA foreign_keys').get()!.foreign_keys);
 const triggers=db.prepare("SELECT name,tbl_name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all(),views=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='view' ORDER BY name").all(),indexes=db.prepare("SELECT name,tbl_name,sql FROM sqlite_master WHERE type='index' AND tbl_name IN ('credit_notes','credit_note_lines') AND sql IS NOT NULL ORDER BY name").all().filter(i=>!obsolete(db,String(i.tbl_name),String(i.name)));
 const creditTrigger=(t:Record<string,unknown>)=>['credit_notes','credit_note_lines'].includes(String(t.tbl_name)),known=new Set(Array.from(RETURNS_DDL.matchAll(/CREATE TRIGGER IF NOT EXISTS (\w+)/g),m=>m[1]));
 if(triggers.some(t=>creditTrigger(t)&&!known.has(String(t.name))))throw new Error('Unknown custom credit trigger requires explicit compatibility review');
 db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
 try{
  for(const t of triggers)db.exec(`DROP TRIGGER ${quote(String(t.name))}`);for(const v of views)db.exec(`DROP VIEW ${quote(String(v.name))}`);
  for(const name of ['credit_notes','credit_note_lines']){
   const sql=RETURNS_DDL.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\([\\s\\S]*?\\n\\);`))?.[0];if(!sql)throw new Error('Canonical credit definition missing');
   knownDefinition(db,name,sql);
   const shadow='migration_'+name;db.exec(sql.replace(`IF NOT EXISTS ${name}`,shadow));
   const old=db.prepare(`PRAGMA table_info(${quote(name)})`).all().map(c=>String(c.name)),next=db.prepare(`PRAGMA table_info(${quote(shadow)})`).all().map(c=>String(c.name));
   if(old.length!==next.length||old.some(c=>!next.includes(c)))throw new Error('Unknown legacy columns: migration blocked without losing historical evidence');
   const columnsOf=(table:string)=>db.prepare(`PRAGMA table_info(${quote(table)})`).all().map(c=>JSON.stringify([c.name,String(c.type).toUpperCase(),c.notnull,c.dflt_value,c.pk])).sort();
   const keysOf=(table:string)=>db.prepare(`PRAGMA foreign_key_list(${quote(table)})`).all().map(k=>JSON.stringify([k.table,k.from,k.to,k.on_update,k.on_delete,k.match])).sort();
   if(JSON.stringify(columnsOf(name))!==JSON.stringify(columnsOf(shadow))||JSON.stringify(keysOf(name))!==JSON.stringify(keysOf(shadow)))throw new Error('Unknown legacy column or foreign-key semantics require explicit compatibility review');
   const columns=old.map(quote).join(',');db.exec(`INSERT INTO ${quote(shadow)}(${columns}) SELECT ${columns} FROM ${quote(name)}`);
  }
  checkpoint?.('copied');db.exec('DROP TABLE credit_note_lines; DROP TABLE credit_notes; ALTER TABLE migration_credit_notes RENAME TO credit_notes; ALTER TABLE migration_credit_note_lines RENAME TO credit_note_lines');checkpoint?.('rebuilt');
  for(const index of indexes)db.exec(String(index.sql));
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_active_return ON credit_notes(return_id) WHERE status IN ('draft','approved','posted'); CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_replacement ON credit_notes(replaces_note_id) WHERE replaces_note_id IS NOT NULL");
  for(const t of triggers)if(!creditTrigger(t))db.exec(String(t.sql));db.exec(RETURNS_DDL);for(const v of views)db.exec(String(v.sql));
  if(db.prepare('PRAGMA foreign_key_check').all().length||db.prepare('PRAGMA integrity_check').get()!.integrity_check!=='ok'||creditDataFingerprint(db)!==before)throw new Error('Rebuilt credit schema failed exact historical preservation checks');
  db.exec('COMMIT');return {changed:true,fingerprint:before,notes:Number(db.prepare('SELECT COUNT(*) n FROM credit_notes').get()!.n),lines:Number(db.prepare('SELECT COUNT(*) n FROM credit_note_lines').get()!.n)};
 }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}finally{db.exec(`PRAGMA foreign_keys=${foreignKeys?'ON':'OFF'}`);}
}
