import {describe,it,mock,after} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomBytes} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {encryptedBackup} from '../src/lib/backup-archive';import {backupWorkDirectory,fileSha256} from '../src/lib/backup';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-backup-budget-')),filename=path.join(directory,'source.db'),db=new DatabaseSync(filename);db.exec('CREATE TABLE evidence(id INTEGER PRIMARY KEY,payload BLOB)');db.prepare('INSERT INTO evidence VALUES(1,?)').run(randomBytes(4096));
after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
describe('combined snapshot and archive disk budget',()=>{
 it('does not double-spend free space when the archive shares the snapshot filesystem',async()=>{
  const output=path.join(directory,'must-not-exist.rpbak'),before=await fileSha256(filename),work=backupWorkDirectory(),existing=fs.readdirSync(work),original=fs.statfsSync,old=process.env.REPAID_BACKUP_MIN_FREE_BYTES;process.env.REPAID_BACKUP_MIN_FREE_BYTES='5368709120';let calls=0;
  // Isolated capacity fault injection only. Snapshot, encryption path and cleanup are real implementations.
  function capacity(location:fs.PathLike,options?:fs.StatFsOptions&{bigint?:false}):fs.StatsFs;
  function capacity(location:fs.PathLike,options:fs.StatFsOptions&{bigint:true}):fs.BigIntStatsFs;
  function capacity(location:fs.PathLike,options?:fs.StatFsOptions):fs.StatsFs|fs.BigIntStatsFs;
  function capacity(location:fs.PathLike,options?:fs.StatFsOptions){if(options?.bigint){const real=original(location,{...options,bigint:true});calls++;return {...real,bsize:BigInt(1),bavail:calls===1?BigInt('5368809120'):BigInt('5368709120')};}return original(location,{...options,bigint:false});}
  const injected=mock.method(fs,'statfsSync',capacity);
  try{await assert.rejects(()=>encryptedBackup(db,output,randomBytes(32).toString('hex')),(error:unknown)=>(error as {status:number}).status===507);assert.equal(calls,2);assert.equal(fs.existsSync(output),false);assert.deepEqual(fs.readdirSync(work),existing);assert.equal(await fileSha256(filename),before);assert.deepEqual(fs.readdirSync(directory).filter(name=>name.includes('.partial-')),[]);}
  finally{injected.mock.restore();if(old==null)delete process.env.REPAID_BACKUP_MIN_FREE_BYTES;else process.env.REPAID_BACKUP_MIN_FREE_BYTES=old;}
 });
});
