import {it} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {copyVerifiedDatabase} from '../src/lib/backup-copy';
import {openStandaloneSqlite,fileSha256} from '../src/lib/backup';

it('independently verifies copied WAL-backed database bytes, publishes atomically and never replaces an existing backup',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-copy-')),source=new DatabaseSync(path.join(directory,'source.db'));
 try{
  source.exec("PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;CREATE TABLE evidence(id INTEGER PRIMARY KEY,note TEXT);INSERT INTO evidence VALUES(1,'Original Persian evidence: نمونه')");
  const target=path.join(directory,'verified.db'),result=await copyVerifiedDatabase(source,target);
  assert.equal(result.destination_verified,true);assert.equal(result.sha256,await fileSha256(target));
  if(process.platform!=='win32')assert.equal(result.directory_synced,true);
  const restored=openStandaloneSqlite(target);try{assert.equal(restored.prepare('SELECT note FROM evidence').get()!.note,'Original Persian evidence: نمونه');assert.equal(restored.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');}finally{restored.close();}
  const prior=await fileSha256(target);await assert.rejects(()=>copyVerifiedDatabase(source,target),/new|outside/);assert.equal(await fileSha256(target),prior);
  assert.equal(fs.readdirSync(directory).some(name=>name.includes('.copy-')),false);
 }finally{source.close();const resolved=fs.realpathSync(directory);assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('repaid-copy-'));fs.rmSync(resolved,{recursive:true,force:true});}
});

it('does not publish a backup if independent destination validation detects damaged copy bytes',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-copy-')),source=new DatabaseSync(path.join(directory,'source.db')),sync=fs.fsyncSync;
 try{
  source.exec('CREATE TABLE evidence(id INTEGER PRIMARY KEY);INSERT INTO evidence VALUES(1)');
  fs.fsyncSync=((file:number)=>{sync(file);fs.writeSync(file,Buffer.from('damaged!'),0,8,0);}) as typeof fs.fsyncSync;
  const target=path.join(directory,'never-published.db');await assert.rejects(()=>copyVerifiedDatabase(source,target));
  assert.equal(fs.existsSync(target),false);assert.equal(fs.readdirSync(directory).some(name=>name.includes('.copy-')),false);
  assert.equal(source.prepare('SELECT id FROM evidence').get()!.id,1);
 }finally{fs.fsyncSync=sync;source.close();const resolved=fs.realpathSync(directory);assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('repaid-copy-'));fs.rmSync(resolved,{recursive:true,force:true});}
});

it('rejects a destination-open failure before starting a source stream or leaving a partial artifact',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-copy-')),source=new DatabaseSync(path.join(directory,'source.db')),open=fs.openSync;
 try{
  source.exec('CREATE TABLE evidence(id INTEGER PRIMARY KEY);INSERT INTO evidence VALUES(1)');
  fs.openSync=((file:fs.PathLike,flags:fs.OpenMode,mode?:fs.Mode)=>{if(String(file).includes('.copy-'))throw Object.assign(Error('injected destination failure'),{code:'EACCES'});return open(file,flags,mode);}) as typeof fs.openSync;
  const target=path.join(directory,'never-opened.db');await assert.rejects(()=>copyVerifiedDatabase(source,target),/injected destination failure/);
  await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(fs.existsSync(target),false);assert.equal(fs.readdirSync(directory).some(name=>name.includes('.copy-')),false);
 }finally{fs.openSync=open;source.close();const resolved=fs.realpathSync(directory);assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('repaid-copy-'));fs.rmSync(resolved,{recursive:true,force:true});}
});
