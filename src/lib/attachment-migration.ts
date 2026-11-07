import {sqliteProjectionHash} from './db/sqlite-evidence';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {fileSha256,openStandaloneSqlite,verifySqliteFile,requireBackupSpace} from './backup';
import {storeAttachmentStream,verifyStoredAttachment,verifySnapshotAttachments} from './attachment-storage';
import {atomic} from './db/transaction';

const tables=['repair_attachments','chat_attachments'] as const;
const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';
const batchBytes=256*1024;
type AttachmentTable=typeof tables[number];
type AttachmentRow={id:number;size:number;bytes:number;object_key:string|null;object_sha256:string|null};
export type AttachmentMigrationOptions={source:string;destination:string;resume?:boolean;retainBlobs?:boolean};
const exists=(db:DatabaseSync,table:string)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
function columns(db:DatabaseSync,table:string){return db.prepare(`PRAGMA table_info(${quote(table)})`).all().map(row=>String(row.name));}
function ensurePrivateDestination(file:string){
 const parent=fs.realpathSync(path.dirname(file)),publicRoot=fs.realpathSync('public');
 if(parent===publicRoot||parent.startsWith(publicRoot+path.sep)||fs.lstatSync(path.dirname(file)).isSymbolicLink()||(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink()))throw new Error('Migration output must be in a private directory');
 return path.join(parent,path.basename(file));
}
async function* blobChunks(db:DatabaseSync,table:AttachmentTable,id:number,size:number){
 const statement=db.prepare(`SELECT substr(data,?,?) chunk FROM ${quote(table)} WHERE id=?`);
 for(let offset=0;offset<size;offset+=batchBytes){const row=statement.get(offset+1,Math.min(batchBytes,size-offset),id);if(!(row?.chunk instanceof Uint8Array)||row.chunk.byteLength!==Math.min(batchBytes,size-offset))throw new Error('Source attachment changed or is incomplete');yield row.chunk;}
}
async function blobHash(db:DatabaseSync,table:AttachmentTable,id:number,size:number){const hash=createHash('sha256');for await(const chunk of blobChunks(db,table,id,size))hash.update(chunk);return hash.digest('hex');}
/** Hash source projections with typed framing; attachment bytes are independently checked in bounded chunks. */

function verifyOriginalSchema(original:DatabaseSync,copy:DatabaseSync){
 const objects=original.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name").all();
 for(const object of objects){const found=copy.prepare('SELECT sql FROM sqlite_master WHERE type=? AND name=?').get(String(object.type),String(object.name));let actual=String(found?.sql??'');
  if(object.type==='table'&&tables.includes(String(object.name) as AttachmentTable)){
   const names=columns(original,String(object.name));for(const name of ['object_key','object_sha256'])if(!names.includes(name))actual=actual.replace(new RegExp(',\\s*'+name+'\\s+TEXT(?=\\s*[,\\)])','i'),'');
  }if(actual!==object.sql)throw new Error('Original schema evidence changed: '+object.name);
 }
}
function prepareCopy(source:string,target:string,sourceHash:string,options:AttachmentMigrationOptions){
 if(fs.existsSync(target)){if(!options.resume)throw new Error('Destination exists; only an identified migration copy can be resumed');}
 else{if(options.resume)throw new Error('No migration copy exists to resume');requireBackupSpace(path.dirname(target),BigInt(fs.statSync(source).size));fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);fs.chmodSync(target,0o600);}
 const db=new DatabaseSync(target);db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
 try{
  if(options.resume){if(!exists(db,'_repaid_attachment_migration'))throw new Error('Destination is not a migration copy');const marker=db.prepare('SELECT * FROM _repaid_attachment_migration WHERE id=1').get();
   if(marker?.source_sha256!==sourceHash||marker?.retain_blobs!==Number(options.retainBlobs===true)||marker?.format_version!==1)throw new Error('Migration source or options conflict with the retained copy');
  }else atomic(db,()=>{
   if(exists(db,'_repaid_attachment_migration'))throw new Error('Source is already a migration copy');
   db.exec(`CREATE TABLE _repaid_attachment_migration(id INTEGER PRIMARY KEY CHECK(id=1),format_version INTEGER NOT NULL,source_sha256 TEXT NOT NULL,retain_blobs INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN ('running','verified')),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE _repaid_attachment_migration_rows(table_name TEXT NOT NULL,attachment_id INTEGER NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(table_name,attachment_id));`);
   db.prepare("INSERT INTO _repaid_attachment_migration(id,format_version,source_sha256,retain_blobs,status) VALUES(1,1,?,?,'running')").run(sourceHash,Number(options.retainBlobs===true));
   for(const table of tables){if(!exists(db,table))continue;const names=columns(db,table);for(const name of ['id','size','data'])if(!names.includes(name))throw new Error('Unsupported legacy attachment schema');
    for(const name of ['object_key','object_sha256'])if(!names.includes(name))db.exec(`ALTER TABLE ${quote(table)} ADD COLUMN ${name} TEXT`);
   }
  });return db;
 }catch(error){db.close();throw error;}
}
/** Offline COPY only. Source bytes and original BLOB evidence remain immutable and independently verifiable.
 * An interrupted identified copy is resumable; production replacement is deliberately outside this function. */
export async function migrateAttachmentCopy(options:AttachmentMigrationOptions){
 if(process.env.REPAID_ATTACHMENT_STORAGE!=='filesystem')throw new Error('Explicit private filesystem storage configuration required');
 const source=fs.realpathSync(options.source),target=ensurePrivateDestination(path.resolve(options.destination)),live=path.resolve(process.env.REPAID_DATA_DIR??'data','repaid.db');
 const sameFile=(left:string,right:string)=>{if(!fs.existsSync(left)||!fs.existsSync(right))return false;const a=fs.statSync(left),b=fs.statSync(right);return a.dev===b.dev&&a.ino===b.ino;};
 if(source===target||target===live||sameFile(source,target)||sameFile(live,target))throw new Error('In-place or active-database migration is forbidden');
 verifySqliteFile(source);await verifySnapshotAttachments(source);const sourceHash=await fileSha256(source),lock=target+'.attachment-migration.lock';
 const lockHandle=fs.openSync(lock,'wx',0o600);let db:DatabaseSync|undefined,original:DatabaseSync|undefined;
 try{
  fs.writeFileSync(lockHandle,JSON.stringify({pid:process.pid,source_sha256:sourceHash}));fs.fsyncSync(lockHandle);
  db=prepareCopy(source,target,sourceHash,options);original=openStandaloneSqlite(source);
  db.prepare("UPDATE _repaid_attachment_migration SET status='running' WHERE id=1").run();let migrated=0,external=0,bytes=0;
  for(const table of tables){if(!exists(original,table))continue;const sourceColumns=columns(original,table),hasObjects=sourceColumns.includes('object_key');let after=-1;
   while(true){const row=original.prepare(`SELECT id,size,length(data) bytes,${hasObjects?'object_key,object_sha256':'NULL object_key,NULL object_sha256'} FROM ${quote(table)} WHERE id>? ORDER BY id LIMIT 1`).get(after) as AttachmentRow|undefined;if(!row)break;
    if(!Number.isSafeInteger(row.id)||row.id<0||!Number.isSafeInteger(row.size)||row.size<0||!Number.isSafeInteger(row.bytes)||row.bytes<0)throw new Error('Invalid legacy attachment identity or byte length');after=row.id;
    const current=db.prepare(`SELECT size,length(data) bytes,object_key,object_sha256 FROM ${quote(table)} WHERE id=?`).get(row.id);if(!current||current.size!==row.size)throw new Error('Migration copy metadata changed');
    if(row.object_key){await verifyStoredAttachment({object_key:row.object_key,object_sha256:row.object_sha256??'',size:row.size});
     if(current.object_key!==row.object_key||current.object_sha256!==row.object_sha256||current.bytes!==row.bytes||await blobHash(original,table,row.id,row.bytes)!==await blobHash(db,table,row.id,row.bytes))throw new Error('Existing external attachment reference changed');external++;continue;
    }
    if(row.size!==row.bytes)throw new Error('Legacy attachment length disagrees with stored size');
    const prior=db.prepare('SELECT size,sha256 FROM _repaid_attachment_migration_rows WHERE table_name=? AND attachment_id=?').get(table,row.id);
    if(prior){const expected=await blobHash(original,table,row.id,row.size);if(prior.size!==row.size||prior.sha256!==expected||current.object_key!==expected||current.object_sha256!==expected||current.bytes!==(options.retainBlobs?row.bytes:0))throw new Error('Retained migration evidence conflicts with source');await verifyStoredAttachment({object_key:expected,object_sha256:expected,size:row.size});}
    else{
     if(current.object_key||current.object_sha256||current.bytes!==row.bytes)throw new Error('Untracked destination attachment mutation');
     const object=await storeAttachmentStream(blobChunks(original,table,row.id,row.size),row.size);if(await blobHash(original,table,row.id,row.size)!==object.object_sha256)throw new Error('Independent source hash mismatch');
     atomic(db,()=>{const changed=db!.prepare(`UPDATE ${quote(table)} SET object_key=?,object_sha256=?,data=${options.retainBlobs?'data':"X''"} WHERE id=? AND object_key IS NULL AND length(data)=?`).run(object.object_key,object.object_sha256,row.id,row.bytes);if(changed.changes!==1)throw new Error('Attachment changed during migration');
      db!.prepare('INSERT INTO _repaid_attachment_migration_rows(table_name,attachment_id,size,sha256) VALUES(?,?,?,?)').run(table,row.id,row.size,object.object_sha256);
     });
    }if(options.retainBlobs&&await blobHash(original,table,row.id,row.size)!==await blobHash(db,table,row.id,row.size))throw new Error('Retained BLOB bytes changed');migrated++;bytes+=row.size;if(!Number.isSafeInteger(bytes))throw new Error('Attachment migration byte count exceeds safe range');
   }
  }
  verifyOriginalSchema(original,db);const sourceTables=original.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();let rows=0;
  for(const record of sourceTables){const table=String(record.name),fields=columns(original,table).filter(field=>!tables.includes(table as AttachmentTable)||!['data','object_key','object_sha256'].includes(field));const before=sqliteProjectionHash(original,table,fields),after=sqliteProjectionHash(db,table,fields);
   if(before.rows!==after.rows||before.sha256!==after.sha256)throw new Error('Original business projection changed: '+table);rows+=before.rows;
  }
  if((db.prepare('SELECT COUNT(*) n FROM _repaid_attachment_migration_rows').get()?.n)!==migrated)throw new Error('Unexpected migration evidence row');
  if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Migrated copy failed SQLite integrity verification');
  if(await fileSha256(source)!==sourceHash)throw new Error('Original source bytes changed');
  db.prepare("UPDATE _repaid_attachment_migration SET status='verified' WHERE id=1").run();db.close();db=undefined;original.close();original=undefined;
  verifySqliteFile(target);const objects=await verifySnapshotAttachments(target);
  return {status:'verified_offline_copy' as const,source_sha256:sourceHash,destination_sha256:await fileSha256(target),tables_verified:sourceTables.length,rows_verified:rows,attachments_migrated:migrated,existing_external_attachments:external,attachment_bytes:bytes,objects_verified:objects,original_source_unchanged:true,blobs_retained_in_copy:options.retainBlobs===true,production_swapped:false};
 }finally{original?.close();db?.close();fs.closeSync(lockHandle);fs.unlinkSync(lock);}
}
