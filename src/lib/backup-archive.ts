import fs from 'node:fs';import path from 'node:path';import {pipeline} from 'node:stream/promises';
import {createCipheriv,createDecipheriv,randomBytes,createHash} from 'node:crypto';import type {DatabaseSync} from 'node:sqlite';
import {verifiedFileSnapshot,verifySqliteFile,fileSha256,requireBackupSpace,backupWorkDirectory,cleanupFileSnapshot} from '@/lib/backup';
import {verifySnapshotAttachments} from '@/lib/attachment-storage';
import {Readable,Writable} from 'node:stream';
import {protectPrivateStorage,createPrivateWriteStream} from './private-storage';
const MAGIC=Buffer.from('RPDBAK01'),MAX_GCM_BYTES=2**36-32;
type Header={format:1;algorithm:'aes-256-gcm';created_at:string;bytes:number;sha256:string;purpose?:'attachment'};
function keyBytes(key:string){if(!/^[a-fA-F0-9]{64}$/.test(key))throw new Error('A separate 32-byte backup encryption key is required');return Buffer.from(key,'hex');}
/** No overwrite and no web-accessible exports; do not infer a live restore path. */
export function protectedBackupPath(filename:string){const absolute=path.resolve(filename),parent=fs.realpathSync(path.dirname(absolute)),target=path.join(parent,path.basename(absolute)),publicRoot=fs.existsSync('public')?fs.realpathSync('public'):path.resolve('public');
 if(target===publicRoot||target.startsWith(publicRoot+path.sep)||fs.existsSync(target))throw new Error('Backup output must be new and outside the public directory');return target;}
async function finishFile(filename:string){const handle=await fs.promises.open(filename,'r+');try{await handle.sync();}finally{await handle.close();}}
export async function encryptedBackup(db:DatabaseSync,filename:string,key:string){
 keyBytes(key).fill(0);protectedBackupPath(filename);
 const snapshot=await verifiedFileSnapshot(db);
 try{return await archiveVerifiedSnapshot(snapshot,filename,key);}finally{snapshot.cleanup();}
}
/** Internal immutable snapshot interface; backup sets enumerate this exact snapshot,
 * never the changing live database. Existing RPDBAK01 database archives stay valid. */
export async function archiveVerifiedSnapshot(snapshot:{filename:string;bytes:number;sha256:string},filename:string,key:string){
 return encryptFile(snapshot.filename,filename,key,snapshot);
}
export async function archiveAttachment(source:string,filename:string,key:string,expected:{bytes:number;sha256:string}){
 return encryptFile(source,filename,key,expected,'attachment');
}
async function encryptFile(source:string,filename:string,key:string,expected:{bytes:number;sha256:string},purpose?:'attachment'){
 const target=protectedBackupPath(filename),secret=keyBytes(key),staging=target+'.partial-'+randomBytes(12).toString('hex');
 try{
  if(!Number.isSafeInteger(expected.bytes)||expected.bytes<(purpose?0:512)||expected.bytes>MAX_GCM_BYTES||!/^[a-f0-9]{64}$/.test(expected.sha256))throw new Error('File exceeds this archive format limit or has invalid exact metadata');
  // Recheck AFTER the snapshot exists: snapshot + archive can share the same disk.
  requireBackupSpace(path.dirname(target),BigInt(expected.bytes)+BigInt(65536));
  const header:Header={format:1,algorithm:'aes-256-gcm',created_at:new Date().toISOString(),bytes:expected.bytes,sha256:expected.sha256,...(purpose?{purpose}:{})},json=Buffer.from(JSON.stringify(header)),length=Buffer.alloc(4);length.writeUInt32BE(json.length);
  const iv=randomBytes(12),aad=Buffer.concat([MAGIC,length,json,iv]),cipher=createCipheriv('aes-256-gcm',secret,iv);cipher.setAAD(aad);
  const handle=await fs.promises.open(staging,'wx',0o600);try{protectPrivateStorage(staging,'file');await handle.writeFile(aad);}finally{await handle.close();}
  await pipeline(fs.createReadStream(source),cipher,fs.createWriteStream(staging,{flags:'a',mode:0o600}));await fs.promises.appendFile(staging,cipher.getAuthTag());await finishFile(staging);
  const verified=await decryptArchive(staging,key,()=>new Writable({write(_chunk,_encoding,done){done();}}),purpose);if(verified.sha256!==expected.sha256)throw new Error('Encrypted archive does not match the verified source snapshot');
  const archiveHash=await fileSha256(staging);await fs.promises.link(staging,target);
  return {...header,archive_sha256:archiveHash,archive_bytes:fs.statSync(target).size,encrypted_content_verified:true};
 }finally{secret.fill(0);await fs.promises.rm(staging,{force:true});}
}
async function decryptArchive(source:string,key:string,output:()=>Writable,purpose?:'attachment'){
 const secret=keyBytes(key),handle=await fs.promises.open(source,'r');
 try{
  const prefix=Buffer.alloc(12);if((await handle.read(prefix,0,12,0)).bytesRead!==12||!prefix.subarray(0,8).equals(MAGIC))throw new Error('Unsupported backup archive');
  const length=prefix.readUInt32BE(8);if(length<2||length>4096)throw new Error('Invalid backup header');
  const meta=Buffer.alloc(length+12);if((await handle.read(meta,0,meta.length,12)).bytesRead!==meta.length)throw new Error('Truncated backup header');
  const header=JSON.parse(meta.subarray(0,length).toString('utf8')) as Header,size=(await handle.stat()).size,offset=12+meta.length;
  if(header.format!==1||header.algorithm!=='aes-256-gcm'||header.purpose!==purpose||!Number.isSafeInteger(header.bytes)||header.bytes<(purpose?0:512)||header.bytes>MAX_GCM_BYTES||!(/^[a-f0-9]{64}$/).test(header.sha256)||size!==offset+header.bytes+16)throw new Error('Invalid backup metadata');
  const tag=Buffer.alloc(16);await handle.read(tag,0,16,size-16);const decipher=createDecipheriv('aes-256-gcm',secret,meta.subarray(length));decipher.setAAD(Buffer.concat([prefix,meta]));decipher.setAuthTag(tag);
  // A failed output factory must not leave an unconsumed source stream holding
  // the FileHandle open while finally awaits close().
  const destination=output();
  const hash=createHash('sha256');let bytes=0;const input=header.bytes?handle.createReadStream({start:offset,end:size-17,autoClose:false}):Readable.from([]);
  decipher.on('data',(chunk:Buffer)=>{hash.update(chunk);bytes+=chunk.length;});
  await pipeline(input,decipher,destination);
  if(bytes!==header.bytes||hash.digest('hex')!==header.sha256)throw new Error('Restored snapshot hash mismatch');return {bytes,sha256:header.sha256};
 }finally{secret.fill(0);await handle.close();}
}
export async function verifyEncryptedBackup(source:string,key:string){return decryptArchive(source,key,()=>new Writable({write(_chunk,_encoding,done){done();}}));}
export async function verifyEncryptedAttachment(source:string,key:string){return decryptArchive(source,key,()=>new Writable({write(_chunk,_encoding,done){done();}}),'attachment');}
/** Read-only inspection in a private disposable workspace. No incomplete restore
 * is published when the caller only needs the snapshot's object references. */
export async function inspectEncryptedDatabase<T>(source:string,key:string,work:(snapshot:string)=>Promise<T>){
 const root=backupWorkDirectory();requireBackupSpace(root,BigInt(fs.statSync(source).size));
 const directory=fs.mkdtempSync(path.join(root,'repaid-backup-')),snapshot=path.join(directory,'snapshot.db');
 try{protectPrivateStorage(directory,'directory');await decryptArchive(source,key,()=>createPrivateWriteStream(snapshot));verifySqliteFile(snapshot);return await work(snapshot);}
 finally{cleanupFileSnapshot(snapshot);}
}
export async function restoreEncryptedAttachment(source:string,filename:string,key:string){return restoreArchive(source,filename,key,'attachment');}
export async function restoreEncryptedBackup(source:string,filename:string,key:string,options:{objectDirectory?:string}={}){return restoreArchive(source,filename,key,undefined,options.objectDirectory);}
async function restoreArchive(source:string,filename:string,key:string,purpose?:'attachment',objectDirectory?:string){
 const target=protectedBackupPath(filename),staging=target+'.restore-'+randomBytes(12).toString('hex');
 // This authenticated, uncompressed format restores fewer bytes than its archive size.
 requireBackupSpace(path.dirname(target),BigInt(fs.statSync(source).size));
 try{const verified=await decryptArchive(source,key,()=>createPrivateWriteStream(staging),purpose);let objects=0;if(!purpose){verifySqliteFile(staging);objects=await verifySnapshotAttachments(staging,objectDirectory);}await finishFile(staging);await fs.promises.link(staging,target);
  return {...verified,integrity:purpose?'sha256_verified':'ok',objects_verified:objects,restored:true};
 }finally{await fs.promises.rm(staging,{force:true});}
}
