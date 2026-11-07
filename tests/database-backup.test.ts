import {describe,it,after} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomBytes} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {encryptedBackup,restoreEncryptedBackup} from '../src/lib/backup-archive';import {verifiedFileSnapshot} from '../src/lib/backup';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-backup-test-')),db=new DatabaseSync(path.join(directory,'source.db')),key=randomBytes(32).toString('hex');
db.exec("PRAGMA journal_mode=WAL;CREATE TABLE original(id INTEGER PRIMARY KEY,evidence TEXT,payload BLOB);INSERT INTO original VALUES(1,'{ \"b\":2, \"a\":1 }',X'000102FF')");
after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
describe('verified streaming database backup and authenticated recovery',()=>{
 it('releases the archive source promptly when the restore destination cannot be opened',{timeout:5000},async()=>{
  const archive=path.join(directory,'open-failure.rpbak');await encryptedBackup(db,archive,key);
  const open=fs.openSync,target=path.join(directory,'destination-open-failed.db');
  try{
   fs.openSync=((file:fs.PathLike,flags:fs.OpenMode,mode?:fs.Mode)=>{if(String(file).includes('destination-open-failed.db.restore-'))throw Object.assign(Error('injected restore destination failure'),{code:'EACCES'});return open(file,flags,mode);}) as typeof fs.openSync;
   await assert.rejects(()=>restoreEncryptedBackup(archive,target,key),/injected restore destination failure/);
   assert.equal(fs.existsSync(target),false);assert.equal(fs.readdirSync(directory).some(name=>name.includes('.restore-')),false);
  }finally{fs.openSync=open;}
 });
 it('preserves committed WAL and original bytes through encryption and an independent restore',async()=>{
  const archive=path.join(directory,'archive.rpbak'),restored=path.join(directory,'restored.db');const proof=await encryptedBackup(db,archive,key);assert.equal(proof.algorithm,'aes-256-gcm');assert.equal(fs.readFileSync(archive).includes(Buffer.from('"b":2')),false);
  const result=await restoreEncryptedBackup(archive,restored,key);assert.equal(result.sha256,proof.sha256);const copy=new DatabaseSync(restored,{readOnly:true});try{assert.equal(copy.prepare('SELECT evidence FROM original').get()!.evidence,'{ "b":2, "a":1 }');assert.equal(Buffer.from(copy.prepare('SELECT payload FROM original').get()!.payload as Uint8Array).toString('hex'),'000102ff');}finally{copy.close();}
  await assert.rejects(()=>restoreEncryptedBackup(archive,restored,key),/new/);await assert.rejects(()=>encryptedBackup(db,archive,key),/new/);
 });
 it('rejects wrong keys, modified metadata, corrupt ciphertext and truncation without leaving a restore',async()=>{
  const original=fs.readFileSync(path.join(directory,'archive.rpbak'));
  for(const [name,bytes] of [['cipher',(()=>{const b=Buffer.from(original);b[b.length-20]^=1;return b;})()],['truncated',original.subarray(0,original.length-1)],['header',(()=>{const b=Buffer.from(original);const index=b.indexOf(Buffer.from('aes-256-gcm'));b[index]^=1;return b;})()]] as const){const input=path.join(directory,name+'.rpbak'),output=path.join(directory,name+'.db');fs.writeFileSync(input,bytes);await assert.rejects(()=>restoreEncryptedBackup(input,output,key));assert.equal(fs.existsSync(output),false);}
  const output=path.join(directory,'wrong-key.db');await assert.rejects(()=>restoreEncryptedBackup(path.join(directory,'archive.rpbak'),output,randomBytes(32).toString('hex')));assert.equal(fs.existsSync(output),false);assert.deepEqual(fs.readdirSync(directory).filter(name=>name.includes('.partial-')||name.includes('.restore-')),[]);
 });
 it('retains a bounded private file snapshot with explicit cleanup instead of a full Buffer',async()=>{
  const snapshot=await verifiedFileSnapshot(db);assert.equal(snapshot.sha256.length,64);assert.ok(snapshot.bytes>=512);assert.equal(fs.existsSync(snapshot.filename),true);snapshot.cleanup();assert.equal(fs.existsSync(snapshot.filename),false);
 });
});
