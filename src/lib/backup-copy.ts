import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {verifiedFileSnapshot,requireBackupSpace,verifySqliteFile,fileSha256} from './backup';
import {protectedBackupPath} from './backup-archive';
import {pipeline} from 'node:stream/promises';
import {createPrivateWriteStream} from './private-storage';

/** Publish only independently verified destination bytes. Source snapshot and
 * destination can be on different disks; never certify the source hash alone. */
export async function copyVerifiedDatabase(db:DatabaseSync,filename:string){
 const target=protectedBackupPath(filename),snapshot=await verifiedFileSnapshot(db);
 const staging=target+'.copy-'+randomBytes(12).toString('hex');let published=false;
 try{
  requireBackupSpace(path.dirname(target),BigInt(snapshot.bytes));
  // Reject destination/ACL failures before starting an asynchronous source read.
  const destination=createPrivateWriteStream(staging);
  await pipeline(fs.createReadStream(snapshot.filename),destination);
  const handle=fs.openSync(staging,'r+');try{fs.fsyncSync(handle);}finally{fs.closeSync(handle);}
  verifySqliteFile(staging);
  const digest=await fileSha256(staging);
  if(digest!==snapshot.sha256||fs.statSync(staging).size!==snapshot.bytes)throw Error('Copied backup does not match the independently verified snapshot');
  fs.linkSync(staging,target);published=true;
  let directorySynced=false,folder:number|undefined;
  try{folder=fs.openSync(path.dirname(target),'r');fs.fsyncSync(folder);directorySynced=true;}
  catch(error){if(process.platform!=='win32'||!['EPERM','EISDIR','EINVAL','EBADF'].includes(String((error as NodeJS.ErrnoException).code)))throw error;}
  finally{if(folder!==undefined)fs.closeSync(folder);}
  return {verified:true,sha256:digest,bytes:snapshot.bytes,objects_verified:snapshot.objects,destination_verified:true,directory_synced:directorySynced};
 }catch(error){if(published)fs.rmSync(target,{force:true});throw error;}
 finally{snapshot.cleanup();fs.rmSync(staging,{force:true});}
}
