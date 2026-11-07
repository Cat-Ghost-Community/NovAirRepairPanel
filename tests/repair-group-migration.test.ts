import {it} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync,backup} from 'node:sqlite';

it('rehearses additive group receipt startup on populated legacy data, rolls failed DDL back and restores a separate backup',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-group-upgrade-'));
 process.env.REPAID_DATA_DIR=directory;process.env.REPAID_DEMO_MODE='0';
 const schema=await import('../src/lib/db/schema');assert.equal(schema.DB_PATH,path.join(directory,'repaid.db'));
 let current:DatabaseSync|undefined,legacy:DatabaseSync|undefined;
 try{
  const old=new DatabaseSync(schema.DB_PATH);legacy=old;old.exec(schema.DDL);
  old.exec("INSERT INTO branches(id,name,code) VALUES(1,'Original branch','ORIGINAL');INSERT INTO users(id,name,email,password_hash,role,branch_id) VALUES(1,'Original owner','owner@test','x','owner',1);INSERT INTO customers(id,first_name,branch_id) VALUES(1,'Original customer',1);INSERT INTO devices(id,customer_id,type,brand,model) VALUES(1,1,'mobile','Original','Model');INSERT INTO repair_statuses(id,name) VALUES(1,'Received');INSERT INTO repair_tickets(id,number,branch_id,customer_id,device_id,status_id,group_receipt_id) VALUES(1,'ORIGINAL-REPAIR',1,1,1,1,'G-LEGACY');INSERT INTO payments(id,number,customer_id,ticket_id,branch_id,amount,method,reference,direction,user_id) VALUES(1,'ORIGINAL-PAYMENT',1,1,1,500,'cash','Original receipt evidence','in',1)");
  const original=old.prepare('SELECT * FROM payments').get();
  const backupFile=path.join(directory,'before.db');await backup(old,backupFile);old.exec('CREATE VIEW repair_group_receipts AS SELECT NULL group_id');old.close();legacy=undefined;
  assert.throws(()=>schema.getDb(),/already exists|view/i);
  const failed=new DatabaseSync(schema.DB_PATH);
  try{
   assert.equal(failed.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');
   assert.deepEqual(failed.prepare('SELECT * FROM payments').get(),original);
   assert.equal(failed.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='idx_repair_group_members'").get()!.n,0);
   assert.equal(failed.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='accounting_journals'").get()!.n,0);
   failed.exec('DROP VIEW repair_group_receipts');
  }finally{failed.close();}
  current=schema.getDb();assert.deepEqual(current.prepare('SELECT * FROM payments').get(),original);
  assert.equal(current.prepare('SELECT COUNT(*) n FROM repair_group_receipts').get()!.n,0);
  assert.equal(current.prepare('SELECT COUNT(*) n FROM accounting_events').get()!.n,0);
  assert.equal(current.prepare('SELECT COUNT(*) n FROM accounting_journals').get()!.n,0);
  assert.equal(current.prepare('PRAGMA foreign_key_check').all().length,0);
  const copied=new DatabaseSync(backupFile,{readOnly:true});
  const restore=path.join(directory,'restored.db');try{await backup(copied,restore);}finally{copied.close();}
  const restored=new DatabaseSync(restore,{readOnly:true});try{assert.deepEqual(restored.prepare('SELECT * FROM payments').get(),original);assert.equal(restored.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');assert.equal(restored.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='repair_group_receipts'").get()!.n,0);}finally{restored.close();}
 }finally{
  legacy?.close();current?.close();const target=fs.realpathSync(directory),parent=fs.realpathSync(os.tmpdir());if(path.dirname(target)!==parent||!path.basename(target).startsWith('repaid-group-upgrade-'))throw Error('Invalid migration cleanup path');fs.rmSync(target,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 }
});
