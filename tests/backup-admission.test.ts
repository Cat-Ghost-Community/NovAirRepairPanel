import {describe,it,after} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';import {fork} from 'node:child_process';import {once} from 'node:events';
import {BACKUP_DOWNLOAD_DDL} from '../src/lib/db/backup-download-schema';import {reserveBackupPreparation,releaseBackupPreparation} from '../src/lib/backup-admission';import {verifiedFileSnapshot,backupWorkDirectory} from '../src/lib/backup';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-backup-admission-')),filename=path.join(directory,'fixture.db'),db=new DatabaseSync(filename);process.env.REPAID_DATA_DIR=directory;
db.exec('PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;PRAGMA busy_timeout=1000;CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1);CREATE TABLE backups(id INTEGER PRIMARY KEY,status TEXT);'+BACKUP_DOWNLOAD_DDL);
after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
describe('durable backup admission before resource allocation',()=>{
 it('permits only one live preparation and releases the reservation after failure',()=>{const id=reserveBackupPreparation(db,1);assert.throws(()=>reserveBackupPreparation(db,1),(error:unknown)=>(error as {status:number}).status===429);releaseBackupPreparation(db,id,true);assert.equal(db.prepare('SELECT state FROM backup_preparations WHERE id=?').get(id)?.state,'failed');const next=reserveBackupPreparation(db,null);releaseBackupPreparation(db,next);});
 it('rejects an independent active process and safely reclaims its reservation only after actual exit',async()=>{
  const child=fork(path.resolve('tests/backup-admission-worker.ts'),[filename],{execArgv:['--import','tsx'],stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
  try{const [message]=await once(child,'message',{signal:AbortSignal.timeout(5000)});assert.throws(()=>reserveBackupPreparation(db,1),(error:unknown)=>(error as {status:number}).status===429);const ended=once(child,'exit');child.kill();await ended;const replacement=reserveBackupPreparation(db,1);assert.equal(db.prepare('SELECT state FROM backup_preparations WHERE id=?').get(message.id)?.state,'abandoned');releaseBackupPreparation(db,replacement);}
  finally{if(child.exitCode==null&&child.signalCode==null){const ended=once(child,'exit');child.kill();await ended;}}
 });
 it('fails before allocating a snapshot when the required disk reserve is unavailable',async()=>{
  const before=fs.readdirSync(backupWorkDirectory()).filter(name=>name.startsWith('repaid-backup-')),old=process.env.REPAID_BACKUP_MIN_FREE_BYTES;process.env.REPAID_BACKUP_MIN_FREE_BYTES='18446744073709551615';
  try{await assert.rejects(()=>verifiedFileSnapshot(db),(error:unknown)=>(error as {status:number}).status===507);assert.deepEqual(fs.readdirSync(backupWorkDirectory()).filter(name=>name.startsWith('repaid-backup-')),before);}
  finally{if(old==null)delete process.env.REPAID_BACKUP_MIN_FREE_BYTES;else process.env.REPAID_BACKUP_MIN_FREE_BYTES=old;}
 });
});
