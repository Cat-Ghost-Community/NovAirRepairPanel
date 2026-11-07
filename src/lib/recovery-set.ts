import fs from 'node:fs';
import path from 'node:path';
import {createHash,createHmac,timingSafeEqual,hkdfSync} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import type {DatabaseSync} from 'node:sqlite';
import {archiveVerifiedSnapshot,archiveAttachment,inspectEncryptedDatabase,protectedBackupPath,restoreEncryptedAttachment,restoreEncryptedBackup,verifyEncryptedAttachment} from './backup-archive';
import {verifiedFileSnapshot,openStandaloneSqlite,fileSha256,requireBackupSpace} from './backup';
import {verifiedAttachmentFilename,type StoredObject} from './attachment-storage';
import {protectPrivateStorage,openPrivateFile,createPrivateWriteStream,syncPrivateDirectory as syncDirectory} from './private-storage';
import {prepareRecoveryCopy} from './recovery-copy';

type Archive={bytes:number;sha256:string;archive_bytes:number;archive_sha256:string};
type Header={type:'header';format:'repaid-recovery-set';version:1;created_at:string;database:Archive};
type ObjectRecord=Archive&{type:'object';key:string};
const shaPattern=/^[a-f0-9]{64}$/;
function mac(key:string){
 if(!/^[a-fA-F0-9]{64}$/.test(key))throw Error('A separate 32-byte backup encryption key is required');
 const secret=Buffer.from(key,'hex'),authenticationKey=Buffer.from(hkdfSync('sha256',secret,Buffer.alloc(0),'repaid/recovery-set/v1/manifest',32));
 try{return createHmac('sha256',authenticationKey).update('repaid-recovery-set-v1\0');}finally{secret.fill(0);authenticationKey.fill(0);}
}
function ordinaryFile(filename:string){const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Recovery set requires ordinary files');return stat;}
function setDirectory(filename:string){
 const stat=fs.lstatSync(filename);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Recovery set requires an ordinary directory');
 const directory=fs.realpathSync(filename),publicRoot=fs.realpathSync('public');
 if(directory===publicRoot||directory.startsWith(publicRoot+path.sep))throw Error('Recovery sets cannot be web-accessible');return directory;
}
/** Own a NEW directory only. A failed operation never removes an existing set. */
function newDirectory(filename:string){
 const target=protectedBackupPath(filename),parent=fs.realpathSync(path.dirname(target));
 fs.mkdirSync(target,{mode:0o700});const identity=fs.lstatSync(target,{bigint:true});
 const cleanup=()=>{if(!fs.existsSync(target))return;const actual=fs.lstatSync(target,{bigint:true});if(actual.isSymbolicLink()||actual.ino!==identity.ino||actual.dev!==identity.dev||fs.realpathSync(target)!==path.join(parent,path.basename(target)))throw Error('Recovery directory identity changed; cleanup refused');fs.rmSync(target,{recursive:true,force:true});};
 try{protectPrivateStorage(target,'directory');return {target,cleanup};}catch(error){cleanup();throw error;}
}
function writePrivate(filename:string,text:string){const file=openPrivateFile(filename);try{fs.writeFileSync(file,text);fs.fsyncSync(file);}finally{fs.closeSync(file);}}
/** Same immutable bytes referenced by the database snapshot, deduplicated across
 * repair and internal-chat attachments. No live-table enumeration or N+1 lookup. */
function* snapshotObjects(db:DatabaseSync):Generator<StoredObject>{
 const selects=[];
 for(const table of ['repair_attachments','chat_attachments'])if(db.prepare(`PRAGMA table_info(${table})`).all().some(column=>column.name==='object_key'))selects.push(`SELECT object_key,object_sha256,size FROM ${table} WHERE object_key IS NOT NULL`);
 if(!selects.length)return;
 for(const row of db.prepare(`SELECT object_key,MIN(object_sha256) sha,MAX(object_sha256) max_sha,MIN(size) size,MAX(size) max_size,COUNT(*) n,COUNT(object_sha256) hashes,COUNT(size) sizes FROM (${selects.join(' UNION ALL ')}) GROUP BY object_key ORDER BY object_key`).iterate()){
  const key=String(row.object_key),size=Number(row.size);
  if(!shaPattern.test(key)||row.sha!==key||row.max_sha!==key||row.size!==row.max_size||row.n!==row.hashes||row.n!==row.sizes||!Number.isSafeInteger(size)||size<0)throw Error('Snapshot contains conflicting attachment references');
  yield {object_key:key,object_sha256:key,size};
 }
}
function objectArchive(directory:string,key:string){
 for(const folder of [path.join(directory,'objects'),path.join(directory,'objects',key.slice(0,2))])if(fs.existsSync(folder)){const stat=fs.lstatSync(folder);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Unsafe recovery object directory');}
 return path.join(directory,'objects',key.slice(0,2),key+'.rpbak');
}
async function syncSetDirectories(directory:string){
 let synced=true;const objects=path.join(directory,'objects');
 if(fs.existsSync(objects)){for await(const prefix of await fs.promises.opendir(objects))synced=syncDirectory(path.join(objects,prefix.name))&&synced;synced=syncDirectory(objects)&&synced;}
 return syncDirectory(directory)&&syncDirectory(path.dirname(directory))&&synced;
}
function privatePrefix(directory:string,key:string){const prefix=path.dirname(objectArchive(directory,key));if(!fs.existsSync(prefix)){fs.mkdirSync(prefix,{recursive:true,mode:0o700});protectPrivateStorage(prefix,'directory');}return prefix;}
function assertArchive(value:Archive){if(!value||!Number.isSafeInteger(value.bytes)||value.bytes<0||!Number.isSafeInteger(value.archive_bytes)||value.archive_bytes<1||!shaPattern.test(value.sha256)||!shaPattern.test(value.archive_sha256))throw Error('Invalid authenticated archive metadata');}
async function archiveIdentity(filename:string,expected:Archive){if(ordinaryFile(filename).size!==expected.archive_bytes||await fileSha256(filename)!==expected.archive_sha256)throw Error('Recovery archive identity mismatch');}
async function* manifestLines(filename:string):AsyncGenerator<Record<string,unknown>>{
 ordinaryFile(filename);let pending=Buffer.alloc(0);
 for await(const chunk of fs.createReadStream(filename,{highWaterMark:65536})){
  const data=Buffer.concat([pending,chunk]);let start=0,index:number;
  while((index=data.indexOf(10,start))!==-1){if(index-start>16384)throw Error('Oversized recovery manifest line');const value=JSON.parse(data.subarray(start,index).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid recovery manifest record');yield value;start=index+1;}
  pending=data.subarray(start);if(pending.length>16384)throw Error('Oversized recovery manifest line');
 }
 if(pending.length)throw Error('Incomplete recovery manifest');
}
async function authenticate(directory:string,key:string,completionFile:'COMPLETE.json'|'COMPLETE.pending'){
 const complete=path.join(directory,completionFile);if(ordinaryFile(complete).size>16384)throw Error('Invalid recovery completion record');
 const proof=JSON.parse(fs.readFileSync(complete,'utf8')) as {version:number;hmac:string;manifest_sha256:string};
 if(proof.version!==1||!shaPattern.test(proof.hmac)||!shaPattern.test(proof.manifest_sha256))throw Error('Invalid recovery completion evidence');
 const filename=path.join(directory,'manifest.jsonl');ordinaryFile(filename);const signature=mac(key),digest=createHash('sha256');
 for await(const bytes of fs.createReadStream(filename)){signature.update(bytes);digest.update(bytes);}
 if(!timingSafeEqual(signature.digest(),Buffer.from(proof.hmac,'hex'))||digest.digest('hex')!==proof.manifest_sha256)throw Error('Recovery manifest authentication failed');return proof;
}
async function* setFiles(directory:string,completionFile:'COMPLETE.json'|'COMPLETE.pending'){
 // Reject unexplained files, symlinks and nested arbitrary paths as well as missing files.
 for await(const entry of await fs.promises.opendir(directory)){
  if(entry.name==='objects'){if(!entry.isDirectory()||entry.isSymbolicLink())throw Error('Invalid recovery object directory');continue;}
  if(!['database.rpbak','manifest.jsonl',completionFile].includes(entry.name)||!entry.isFile()||entry.isSymbolicLink())throw Error('Unexpected recovery set entry');yield entry.name;
 }
 const objects=path.join(directory,'objects');if(!fs.existsSync(objects))return;
 for await(const prefix of await fs.promises.opendir(objects)){
  if(!/^[a-f0-9]{2}$/.test(prefix.name)||!prefix.isDirectory()||prefix.isSymbolicLink())throw Error('Invalid recovery object prefix');
  for await(const entry of await fs.promises.opendir(path.join(objects,prefix.name))){if(!/^[a-f0-9]{64}\.rpbak$/.test(entry.name)||!entry.name.startsWith(prefix.name)||!entry.isFile()||entry.isSymbolicLink())throw Error('Invalid recovery object file');yield path.join('objects',prefix.name,entry.name);}
 }
}
async function verifySet(filename:string,key:string,completionFile:'COMPLETE.json'|'COMPLETE.pending'){
 const directory=setDirectory(filename),proof=await authenticate(directory,key,completionFile),records=manifestLines(path.join(directory,'manifest.jsonl'));
 try{
 const first=await records.next(),header=first.value as unknown as Header;
 if(first.done||header.type!=='header'||header.format!=='repaid-recovery-set'||header.version!==1||typeof header.created_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(header.created_at)||!Number.isFinite(Date.parse(header.created_at)))throw Error('Invalid recovery set header');assertArchive(header.database);
 const database=path.join(directory,'database.rpbak');await archiveIdentity(database,header.database);
 return await inspectEncryptedDatabase(database,key,async snapshot=>{
  if(fs.statSync(snapshot).size!==header.database.bytes||await fileSha256(snapshot)!==header.database.sha256)throw Error('Recovery database source mismatch');
  const db=openStandaloneSqlite(snapshot),expected=snapshotObjects(db);let objects=0,bytes=BigInt(0),complete=false;
  try{
   for await(const record of records){
    if(record.type==='complete'){if(record.objects!==objects||record.object_bytes!==bytes.toString()||!expected.next().done)throw Error('Recovery object manifest is incomplete');complete=true;if(!(await records.next()).done)throw Error('Recovery manifest has trailing records');break;}
    const row=record as unknown as ObjectRecord,source=expected.next();
    if(row.type!=='object'||!shaPattern.test(row.key)||source.done||row.key!==source.value.object_key||row.sha256!==source.value.object_sha256||row.bytes!==source.value.size)throw Error('Recovery manifest does not match snapshot attachment references');assertArchive(row);
    const file=objectArchive(directory,row.key);await archiveIdentity(file,row);const verified=await verifyEncryptedAttachment(file,key);
    if(verified.bytes!==row.bytes||verified.sha256!==row.sha256)throw Error('Recovered attachment bytes do not match snapshot');objects++;bytes+=BigInt(row.bytes);
   }
   if(!complete)throw Error('Recovery manifest has no complete footer');
   let files=0;for await(const _file of setFiles(directory,completionFile)){void _file;files++;}if(files!==objects+3)throw Error('Recovery set contains extra or missing files');
   return {verified:true,format:'repaid-recovery-set-v1',created_at:header.created_at,database_sha256:header.database.sha256,database_bytes:header.database.bytes,objects,object_bytes:bytes.toString(),manifest_sha256:proof.manifest_sha256,encrypted_payloads_verified:true,production_activated:false};
  }finally{expected.return(undefined);db.close();}
 });
 }finally{await records.return(undefined);}
}
export async function verifyRecoverySet(filename:string,key:string){return verifySet(filename,key,'COMPLETE.json');}

export async function createRecoverySet(db:DatabaseSync,filename:string,key:string){
 mac(key);const capturedAt=new Date().toISOString(),snapshot=await verifiedFileSnapshot(db);let owned:ReturnType<typeof newDirectory>|undefined;
 try{
  requireBackupSpace(fs.realpathSync(path.dirname(path.resolve(filename))),BigInt(snapshot.bytes)+BigInt(65536));owned=newDirectory(filename);const directory=owned.target;
  const database=await archiveVerifiedSnapshot(snapshot,path.join(directory,'database.rpbak'),key),header:Header={type:'header',format:'repaid-recovery-set',version:1,created_at:capturedAt,database};
  const signature=mac(key),digest=createHash('sha256');let objects=0,bytes=BigInt(0);
  const source=openStandaloneSqlite(snapshot.filename);
  try{const file=openPrivateFile(path.join(directory,'manifest.jsonl'));try{
   const line=(value:unknown)=>{const data=Buffer.from(JSON.stringify(value)+'\n');fs.writeFileSync(file,data);signature.update(data);digest.update(data);};
   line(header);for(const object of snapshotObjects(source)){
    const input=await verifiedAttachmentFilename(object);privatePrefix(directory,object.object_key);
    const archived=await archiveAttachment(input,objectArchive(directory,object.object_key),key,{bytes:object.size,sha256:object.object_sha256});
    line({type:'object',key:object.object_key,...archived});objects++;bytes+=BigInt(object.size);
   }line({type:'complete',objects,object_bytes:bytes.toString()});fs.fsyncSync(file);
  }finally{fs.closeSync(file);}}finally{source.close();}
  writePrivate(path.join(directory,'COMPLETE.pending'),JSON.stringify({version:1,hmac:signature.digest('hex'),manifest_sha256:digest.digest('hex')})+'\n');
  const verified=await verifySet(directory,key,'COMPLETE.pending');
  await syncSetDirectories(directory);
  fs.linkSync(path.join(directory,'COMPLETE.pending'),path.join(directory,'COMPLETE.json'));fs.unlinkSync(path.join(directory,'COMPLETE.pending'));
  const directorySynced=await syncSetDirectories(directory);return {...verified,directory_synced:directorySynced};
 }catch(error){owned?.cleanup();throw error;}finally{snapshot.cleanup();}
}

async function copyPrivate(source:string,destination:string){
 const size=ordinaryFile(source).size;requireBackupSpace(path.dirname(destination),BigInt(size));
 const output=createPrivateWriteStream(destination);await pipeline(fs.createReadStream(source),output);const file=fs.openSync(destination,'r+');try{fs.fsyncSync(file);}finally{fs.closeSync(file);}
 if(ordinaryFile(destination).size!==size||await fileSha256(source)!==await fileSha256(destination))throw Error('Recovery set copy did not preserve source bytes');
}
/** A verified second location is not automatically a physically off-host backup. */
export async function copyRecoverySet(source:string,filename:string,key:string){
 const directory=setDirectory(source);if(path.resolve(filename).startsWith(directory+path.sep))throw Error('Recovery destination cannot be inside the retained source');
 const before=await verifyRecoverySet(directory,key),owned=newDirectory(filename);
 try{
  for await(const relative of setFiles(directory,'COMPLETE.json')){
   const destination=relative==='COMPLETE.json'?'COMPLETE.pending':relative;
   if(relative.startsWith('objects'+path.sep)){const key=path.basename(relative,'.rpbak');privatePrefix(owned.target,key);}
   await copyPrivate(path.join(directory,relative),path.join(owned.target,destination));
  }
  const after=await verifySet(owned.target,key,'COMPLETE.pending');
  if(after.manifest_sha256!==before.manifest_sha256)throw Error('Recovery source changed during copy');
  await syncSetDirectories(owned.target);fs.linkSync(path.join(owned.target,'COMPLETE.pending'),path.join(owned.target,'COMPLETE.json'));fs.unlinkSync(path.join(owned.target,'COMPLETE.pending'));
  return {...after,destination_verified:true,directory_synced:await syncSetDirectories(owned.target),physical_offhost_verified:false};
 }catch(error){owned.cleanup();throw error;}
}

export async function restoreRecoverySet(source:string,filename:string,key:string,reason:string){
 if(!reason||reason.trim().length<12||reason.length>1000)throw Error('An explicit recovery rehearsal reason is required');
 const directory=setDirectory(source);if(path.resolve(filename).startsWith(directory+path.sep))throw Error('Recovery destination cannot be inside the retained source');
 const before=await verifyRecoverySet(directory,key),owned=newDirectory(filename);
 try{
  const objects=path.join(owned.target,'objects');fs.mkdirSync(objects,{mode:0o700});protectPrivateStorage(objects,'directory');
  for await(const record of manifestLines(path.join(directory,'manifest.jsonl'))){if(record.type!=='object')continue;const object=record as unknown as ObjectRecord;if(!shaPattern.test(object.key))throw Error('Invalid recovery object identity');
   const prefix=path.join(objects,object.key.slice(0,2));if(!fs.existsSync(prefix)){fs.mkdirSync(prefix,{recursive:true,mode:0o700});protectPrivateStorage(prefix,'directory');}
   const restored=await restoreEncryptedAttachment(objectArchive(directory,object.key),path.join(prefix,object.key),key);if(restored.sha256!==object.sha256||restored.bytes!==object.bytes)throw Error('Restored object identity mismatch');
  }
  const forensic=path.join(owned.target,'forensic.db'),restored=await restoreEncryptedBackup(path.join(directory,'database.rpbak'),forensic,key,{objectDirectory:objects});
  if(restored.sha256!==before.database_sha256)throw Error('Restored database identity mismatch');
  const ready=await prepareRecoveryCopy({source:forensic,destination:path.join(owned.target,'repaid.db'),expectedSha256:before.database_sha256,reason,objectDirectory:objects});
  const after=await authenticate(directory,key,'COMPLETE.json');if(after.manifest_sha256!==before.manifest_sha256)throw Error('Recovery source changed during restore');
  const result={...before,offline_recovery:ready,original_forensic_copy_retained:true,application_encryption_key_verified:false,production_activated:false,directory_synced:await syncSetDirectories(owned.target)};
  writePrivate(path.join(owned.target,'RECOVERY.json'),JSON.stringify(result,null,2)+'\n');await syncSetDirectories(owned.target);return result;
 }catch(error){owned.cleanup();throw error;}
}
