import { backup, DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {verifySnapshotAttachments} from '@/lib/attachment-storage';
import {requireStorageSpace} from './storage-budget';
import {protectPrivateStorage} from './private-storage';

export function openStandaloneSqlite(filename:string){
 if(fs.existsSync(filename+'-wal')||fs.existsSync(filename+'-journal'))throw new Error('Use a standalone verified snapshot, not an active WAL/journal database');
 // Immutable snapshots must not create/read recovery sidecars or change their hash.
 return new DatabaseSync(pathToFileURL(path.resolve(filename)).href+'?mode=ro&immutable=1',{readOnly:true});
}

export function verifySqliteFile(filename:string){
 const snapshot=openStandaloneSqlite(filename);
 try{const integrity=snapshot.prepare('PRAGMA integrity_check').all();
  if(integrity.length!==1||integrity[0].integrity_check!=='ok')throw new Error('Backup integrity check failed');
  if(snapshot.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Backup contains foreign key violations');
 }finally{snapshot.close();}
}
export async function fileSha256(filename:string){const digest=createHash('sha256');for await(const chunk of fs.createReadStream(filename))digest.update(chunk);return digest.digest('hex');}

export function backupWorkDirectory(){
 const configured=process.env.REPAID_BACKUP_WORK_DIR;if(!configured)return fs.realpathSync(os.tmpdir());
 const root=fs.realpathSync(configured),publicRoot=fs.realpathSync('public');if(root===publicRoot||root.startsWith(publicRoot+path.sep)||!fs.statSync(root).isDirectory())throw new Error('Backup workspace must be a private existing directory');return root;
}
export function requireBackupSpace(directory:string,bytes:bigint){
 requireStorageSpace(directory,bytes);
}

export function cleanupFileSnapshot(filename:string){
 const directory=path.dirname(filename);if(!fs.existsSync(directory))return;
 const roots=new Set([fs.realpathSync(os.tmpdir()),backupWorkDirectory()]);
 if(path.basename(filename)!=='snapshot.db'||!roots.has(path.dirname(fs.realpathSync(directory)))||!path.basename(directory).startsWith('repaid-backup-')||fs.lstatSync(directory).isSymbolicLink())throw new Error('Unsafe snapshot cleanup');
 fs.rmSync(directory,{recursive:true,force:true});
}

/** Private online snapshot; callers stream the file and explicitly release it. */
export async function verifiedFileSnapshot(db:DatabaseSync){
 const pages=db.prepare('PRAGMA page_count').get()?.page_count,pageSize=db.prepare('PRAGMA page_size').get()?.page_size;
 if(typeof pages!=='number'||typeof pageSize!=='number'||!Number.isSafeInteger(pages)||!Number.isSafeInteger(pageSize))throw new Error('Invalid database snapshot size');
 const work=backupWorkDirectory();requireBackupSpace(work,BigInt(pages)*BigInt(pageSize));
 const directory=fs.mkdtempSync(path.join(work,'repaid-backup-')),filename=path.join(directory,'snapshot.db');
 const cleanup=()=>cleanupFileSnapshot(filename);
 try{protectPrivateStorage(directory,'directory');await backup(db,filename);fs.chmodSync(filename,0o600);verifySqliteFile(filename);const objects=await verifySnapshotAttachments(filename);
  return {filename,bytes:fs.statSync(filename).size,sha256:await fileSha256(filename),objects,cleanup};
 }catch(error){cleanup();throw error;}
}

/** Online SQLite backup includes committed WAL data without blocking writers for a file copy. */
export async function verifiedSnapshot(db: DatabaseSync): Promise<Buffer> {
  const snapshot=await verifiedFileSnapshot(db);
  try {
    return fs.readFileSync(snapshot.filename);
  } finally {
    snapshot.cleanup();
  }
}
