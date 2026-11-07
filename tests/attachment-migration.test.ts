import {describe,it,after,before} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomBytes,createHash} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {migrateAttachmentCopy} from '../src/lib/attachment-migration';
import {attachmentBody,storeAttachmentStream} from '../src/lib/attachment-storage';
import {fileSha256,openStandaloneSqlite} from '../src/lib/backup';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-attachment-migration-')),objects=path.join(directory,'objects');fs.mkdirSync(objects);
const oldMode=process.env.REPAID_ATTACHMENT_STORAGE,oldRoot=process.env.REPAID_OBJECT_DIR;
before(()=>{process.env.REPAID_ATTACHMENT_STORAGE='filesystem';process.env.REPAID_OBJECT_DIR=objects;});
after(()=>{if(oldMode===undefined)delete process.env.REPAID_ATTACHMENT_STORAGE;else process.env.REPAID_ATTACHMENT_STORAGE=oldMode;if(oldRoot===undefined)delete process.env.REPAID_OBJECT_DIR;else process.env.REPAID_OBJECT_DIR=oldRoot;fs.rmSync(directory,{recursive:true,force:true});});
function fixture(name:string,bytes=Buffer.from('original private signature evidence')){
 const source=path.join(directory,name+'-source.db'),destination=path.join(directory,name+'-copy.db'),db=new DatabaseSync(source);
 db.exec("PRAGMA foreign_keys=ON;CREATE TABLE invoices(id INTEGER PRIMARY KEY,total INTEGER NOT NULL,original TEXT NOT NULL);INSERT INTO invoices VALUES(1,9007199254740991,'{ \"order\": 1 }');CREATE TABLE repair_attachments(id INTEGER PRIMARY KEY,size INTEGER NOT NULL,data BLOB NOT NULL,invoice_id INTEGER REFERENCES invoices(id),filename TEXT);CREATE TABLE chat_attachments(id INTEGER PRIMARY KEY,size INTEGER NOT NULL,data BLOB NOT NULL,filename TEXT)");
 db.prepare('INSERT INTO repair_attachments VALUES(1,?,?,1,?)').run(bytes.length,bytes,'مدرک.pdf');db.prepare('INSERT INTO chat_attachments VALUES(2,?,?,?)').run(bytes.length,bytes,'internal.png');db.close();return {source,destination,bytes};
}
describe('resumable offline legacy attachment migration',()=>{
 it('externalizes duplicate multi-chunk BLOBs with exact hashes and immutable business evidence',async()=>{
  const input=fixture('large',randomBytes(700001)),before=await fileSha256(input.source),result=await migrateAttachmentCopy(input);assert.equal(result.tables_verified,3);assert.equal(result.attachments_migrated,2);assert.equal(result.attachment_bytes,1400002);assert.equal(result.production_swapped,false);assert.equal(await fileSha256(input.source),before);
  const db=openStandaloneSqlite(input.destination);try{const row=db.prepare('SELECT * FROM repair_attachments WHERE id=1').get()!;assert.equal((row.data as Uint8Array).length,0);assert.equal(row.object_key,createHash('sha256').update(input.bytes).digest('hex'));const body=await attachmentBody(row as never);assert.deepEqual(Buffer.from(await new Response(body.body).arrayBuffer()),input.bytes);assert.equal(db.prepare('SELECT total FROM invoices').get()?.total,Number.MAX_SAFE_INTEGER);}finally{db.close();}
  const resumed=await migrateAttachmentCopy({...input,resume:true});assert.equal(resumed.attachments_migrated,2);assert.equal(await fileSha256(input.source),before);
 });
 it('rolls back interrupted row metadata and rejects removal of original source guards',async()=>{
  const input=fixture('failure'),copy=new DatabaseSync(input.source);copy.exec("CREATE TRIGGER injected BEFORE UPDATE ON repair_attachments WHEN NEW.object_key IS NOT NULL BEGIN SELECT RAISE(ABORT,'injected migration boundary');END");copy.close();
  await assert.rejects(()=>migrateAttachmentCopy(input),/injected/);const target=new DatabaseSync(input.destination);assert.equal(target.prepare('SELECT COUNT(*) n FROM _repaid_attachment_migration_rows').get()?.n,0);assert.equal(target.prepare('SELECT length(data) n FROM repair_attachments').get()?.n,input.bytes.length);assert.equal(target.prepare('SELECT object_key FROM repair_attachments').get()?.object_key,null);target.exec('DROP TRIGGER injected');target.close();
  await assert.rejects(()=>migrateAttachmentCopy({...input,resume:true}),/schema evidence changed/);
 });
 it('resumes after partial progress once the exact corrupt object is repaired, without duplicating effects',async()=>{
  const input=fixture('partial',Buffer.from('repair bytes')),other=Buffer.from('different chat evidence'),db=new DatabaseSync(input.source);db.prepare('UPDATE chat_attachments SET data=?,size=?').run(other,other.length);db.close();
  const hash=createHash('sha256').update(other).digest('hex'),prefix=path.join(objects,hash.slice(0,2));fs.mkdirSync(prefix,{recursive:true});fs.writeFileSync(path.join(prefix,hash),Buffer.alloc(other.length));
  await assert.rejects(()=>migrateAttachmentCopy(input),/checksum/);const target=new DatabaseSync(input.destination);assert.equal(target.prepare('SELECT COUNT(*) n FROM _repaid_attachment_migration_rows').get()?.n,1);assert.equal(target.prepare('SELECT length(data) n FROM chat_attachments').get()?.n,other.length);target.close();
  fs.writeFileSync(path.join(prefix,hash),other);const result=await migrateAttachmentCopy({...input,resume:true});assert.equal(result.attachments_migrated,2);assert.equal(result.objects_verified,2);
 });
 it('refuses conflicts, altered business projections, invalid lengths, source overwrite and concurrent copy claims',async()=>{
  const input=fixture('conflict');await migrateAttachmentCopy({...input,retainBlobs:true});await assert.rejects(()=>migrateAttachmentCopy({...input,resume:true}),/options conflict/);
  const copy=new DatabaseSync(input.destination);copy.prepare('UPDATE invoices SET total=1').run();copy.close();await assert.rejects(()=>migrateAttachmentCopy({...input,resume:true,retainBlobs:true}),/business projection/);
  await assert.rejects(()=>migrateAttachmentCopy({...input,destination:input.source}),/In-place/);
  const bad=fixture('bad-size'),db=new DatabaseSync(bad.source);db.exec('UPDATE repair_attachments SET size=size+1');db.close();await assert.rejects(()=>migrateAttachmentCopy(bad),/length/);
  const locked=fixture('locked');fs.writeFileSync(locked.destination+'.attachment-migration.lock','independent operator');await assert.rejects(()=>migrateAttachmentCopy(locked),(error:unknown)=>(error as NodeJS.ErrnoException).code==='EEXIST');assert.equal(fs.existsSync(locked.destination),false);
 });
 it('verifies retained BLOB bytes on replay rather than trusting equal lengths',async()=>{
  const input=fixture('retained');await migrateAttachmentCopy({...input,retainBlobs:true});const db=new DatabaseSync(input.destination);db.prepare('UPDATE repair_attachments SET data=?').run(Buffer.alloc(input.bytes.length));db.close();await assert.rejects(()=>migrateAttachmentCopy({...input,resume:true,retainBlobs:true}),/Retained BLOB/);
 });
 it('rejects truncated or oversized streams and corrupt existing objects without false success',async()=>{
  await assert.rejects(()=>storeAttachmentStream((async function*(){yield Buffer.from('short');})(),6),/truncated/);await assert.rejects(()=>storeAttachmentStream((async function*(){yield Buffer.from('oversized');})(),1),/exceeds/);
  const input=fixture('corrupt');await migrateAttachmentCopy(input);const digest=createHash('sha256').update(input.bytes).digest('hex');fs.writeFileSync(path.join(objects,digest.slice(0,2),digest),Buffer.alloc(input.bytes.length));await assert.rejects(()=>migrateAttachmentCopy({...input,resume:true}),/checksum/);
 });
});
