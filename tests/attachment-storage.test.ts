import {before,after,describe,it} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash,randomBytes} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {storeAttachmentObject,attachmentBody} from '../src/lib/attachment-storage';import {encryptedBackup,restoreEncryptedBackup} from '../src/lib/backup-archive';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-object-test-')),objects=path.join(directory,'objects');fs.mkdirSync(objects);const oldMode=process.env.REPAID_ATTACHMENT_STORAGE,oldRoot=process.env.REPAID_OBJECT_DIR;
before(()=>{process.env.REPAID_ATTACHMENT_STORAGE='filesystem';process.env.REPAID_OBJECT_DIR=objects;});after(()=>{if(oldMode==null)delete process.env.REPAID_ATTACHMENT_STORAGE;else process.env.REPAID_ATTACHMENT_STORAGE=oldMode;if(oldRoot==null)delete process.env.REPAID_OBJECT_DIR;else process.env.REPAID_OBJECT_DIR=oldRoot;fs.rmSync(directory,{recursive:true,force:true});});
describe('private attachment objects and coordinated restore checks',()=>{
 it('does not publish an object when its independently configured disk reserve cannot be met',async()=>{
  const before=fs.readdirSync(objects),old=process.env.REPAID_OBJECT_MIN_FREE_BYTES;process.env.REPAID_OBJECT_MIN_FREE_BYTES='18446744073709551615';try{await assert.rejects(()=>storeAttachmentObject(Buffer.from('must not publish')),(error:unknown)=>(error as {status:number}).status===507);assert.deepEqual(fs.readdirSync(objects),before);}finally{if(old==null)delete process.env.REPAID_OBJECT_MIN_FREE_BYTES;else process.env.REPAID_OBJECT_MIN_FREE_BYTES=old;}
 });
 it('stores content once, streams exact bytes and validates identity before download',async()=>{
  const bytes=Buffer.from('%PDF-1.7\nprivate fixture evidence'),one=await storeAttachmentObject(bytes),two=await storeAttachmentObject(bytes);assert.deepEqual(one,two);assert.equal(one!.object_key,createHash('sha256').update(bytes).digest('hex'));
  const result=await attachmentBody({...one!,data:Buffer.alloc(0)});assert.deepEqual(Buffer.from(await new Response(result.body).arrayBuffer()),bytes);assert.equal(fs.readdirSync(path.join(objects,one!.object_key.slice(0,2))).length,1);
  await assert.rejects(()=>attachmentBody({size:10,object_key:'../../private',object_sha256:'x'}));
  const file=path.join(objects,one!.object_key.slice(0,2),one!.object_key);fs.writeFileSync(file,Buffer.alloc(bytes.length));await assert.rejects(()=>attachmentBody(one!),/checksum/);fs.writeFileSync(file,bytes);
 });
 it('retains legacy BLOB reads and blocks a restore when required objects are missing',async()=>{
  const legacy=await attachmentBody({data:Buffer.from('legacy'),size:6});assert.equal(Buffer.from(await new Response(legacy.body).arrayBuffer()).toString(),'legacy');
  const data=Buffer.from('immutable evidence'),object=(await storeAttachmentObject(data))!,db=new DatabaseSync(path.join(directory,'source.db')),key=randomBytes(32).toString('hex');
  db.exec('CREATE TABLE repair_attachments(id INTEGER PRIMARY KEY,size INTEGER,object_key TEXT,object_sha256 TEXT)');db.prepare('INSERT INTO repair_attachments VALUES(1,?,?,?)').run(object.size,object.object_key,object.object_sha256);
  const archive=path.join(directory,'backup.rpbak');try{await encryptedBackup(db,archive,key);}finally{db.close();}
  const originalRoot=process.env.REPAID_OBJECT_DIR;delete process.env.REPAID_OBJECT_DIR;const missing=path.join(directory,'incomplete.db');try{await assert.rejects(()=>restoreEncryptedBackup(archive,missing,key),/not configured/);assert.equal(fs.existsSync(missing),false);}finally{process.env.REPAID_OBJECT_DIR=originalRoot;}
  const restored=await restoreEncryptedBackup(archive,path.join(directory,'verified.db'),key);assert.equal(restored.objects_verified,1);
 });
});
