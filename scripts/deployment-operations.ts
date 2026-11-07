import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {openStandaloneSqlite} from '../src/lib/backup';
import {sqliteProjectionHash} from '../src/lib/db/sqlite-evidence';
import {restoreRecoverySet} from '../src/lib/recovery-set';
import {requireDatabaseSource} from './database-source';
function dataPath(){const configured=process.env.REPAID_DATA_DIR;if(!configured||!path.isAbsolute(configured))throw Error('Explicit persistent data directory required');return path.join(fs.realpathSync(configured),'repaid.db');}
function existingDatabase(filename:string){requireDatabaseSource(filename);}
function schema(db:DatabaseSync){return createHash('sha256').update(JSON.stringify(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all())).digest('hex');}
function evidence(db:DatabaseSync){return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>{const name=String(row.name),columns=db.prepare('PRAGMA table_info("'+name.replaceAll('"','""')+'")').all().map(c=>String(c.name));return {name,columns,...sqliteProjectionHash(db,name,columns)};});}
async function main(){
 const [action,...args]=process.argv.slice(2),filename=dataPath();
 const entry=fs.lstatSync(filename,{throwIfNoEntry:false});if(entry)existingDatabase(filename);
 if(action==='inspect'){
  if(!fs.existsSync(filename)){if(args.includes('--integrity')||args.includes('--require-existing'))throw Error('Missing database cannot pass verification');return {exists:false,users:0,schema_sha256:null};}
  existingDatabase(filename);
  const db=new DatabaseSync(filename,{readOnly:true});try{const has=!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").get(),users=has?Number(db.prepare('SELECT COUNT(*) n FROM users').get()!.n):0;if(args.includes('--require-existing')&&users<1)throw Error('Initialized application database with existing users required');let checked={};if(args.includes('--integrity')){const integrity=db.prepare('PRAGMA integrity_check').all(),violations=db.prepare('PRAGMA foreign_key_check').all().length;if(integrity.length!==1||integrity[0].integrity_check!=='ok'||violations!==0)throw Error('Database integrity or foreign-key check failed');checked={integrity:'ok',foreign_key_violations:0};}return {exists:true,users,schema_sha256:schema(db),...checked};}finally{db.close();}
 }
 if(action==='bootstrap'){
  const chunks:Buffer[]=[];let length=0;const chunk=Buffer.alloc(1024);for(;;){const size=fs.readSync(0,chunk,0,chunk.length,null);if(!size)break;length+=size;if(length>16384)throw Error('Owner input too large');chunks.push(Buffer.from(chunk.subarray(0,size)));}
  const fields=Buffer.concat(chunks).toString('utf8').split('\0'),[email,password,name,end]=fields;if(fields.length!==4||end!==''||!email||!password||!name)throw Error('Explicit owner credentials required');
  process.env.REPAID_OWNER_EMAIL=email;process.env.REPAID_OWNER_PASSWORD=password;process.env.REPAID_OWNER_NAME=name;
  await import('./bootstrap');return undefined;
 }
 if(action==='migrate'){
  if(args[0]!=='--apply')throw Error('Explicit schema application required');existingDatabase(filename);const {getDb}=await import('../src/lib/db/schema'),db=getDb();try{return {migrated:true,schema_sha256:schema(db)};}finally{db.close();}
 }
 if(action==='rehearse'){
  const source=args[0],key=process.env.REPAID_BACKUP_KEY;if(!source||!key)throw Error('Verified source set and backup key required');
  const base=path.join(path.dirname(filename),'deploy-rehearsals'),entry=fs.lstatSync(base,{throwIfNoEntry:false});if(entry&&(!entry.isDirectory()||entry.isSymbolicLink()))throw Error('Rehearsal workspace must be an ordinary local directory');fs.mkdirSync(base,{recursive:true,mode:0o700});const realBase=fs.realpathSync(base);if(path.dirname(realBase)!==path.dirname(filename))throw Error('Rehearsal workspace escapes the data directory');const target=path.join(realBase,'candidate-'+randomBytes(12).toString('hex'));
  await restoreRecoverySet(source,target,key,'Pre-deployment isolated schema migration rehearsal; no live business data changed');
  const before=openStandaloneSqlite(path.join(target,'repaid.db'));let old:ReturnType<typeof evidence>;try{old=evidence(before);}finally{before.close();}
  process.env.REPAID_DATA_DIR=target;process.env.REPAID_OBJECT_DIR=path.join(target,'objects');const {getDb}=await import('../src/lib/db/schema'),db=getDb();let result;
  try{const changed=[];for(const table of old){const next=sqliteProjectionHash(db,table.name,table.columns);if(next.rows!==table.rows||next.sha256!==table.sha256)changed.push(table.name);}if(changed.length)throw Error('Migration changes existing records; reviewed data migration required');result={rehearsed:true,business_tables_preserved:old.length,schema_sha256:schema(db),production_activated:false};}finally{db.close();}
  const resolved=fs.realpathSync(target);if(path.dirname(resolved)!==realBase||!/^candidate-[a-f0-9]{24}$/.test(path.basename(resolved))||fs.lstatSync(target).isSymbolicLink())throw Error('Unsafe rehearsal cleanup');fs.rmSync(resolved,{recursive:true,force:true});return result;
 }
 throw Error('Use inspect, bootstrap, migrate --apply or rehearse');
}
main().then(result=>{if(result!==undefined)console.log(JSON.stringify(result));}).catch(()=>{console.error('Deployment operation rejected; no automatic data correction or production recovery was performed. Retain the backup and inspect private deployment logs.');process.exitCode=1;});
