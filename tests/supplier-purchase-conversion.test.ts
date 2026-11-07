import {before,after,describe,it} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import type {Session} from '../src/lib/auth';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-purchase-convert-'));process.env.REPAID_DATA_DIR=directory;process.env.REPAID_DEMO_MODE='0';
let db:ReturnType<typeof import('../src/lib/db/schema').getDb>,convert:typeof import('../src/lib/supplier-purchase-conversion').convertSupplierPurchaseList;
const owner={user:{id:1,role:'owner',branch_id:1}} as Session,foreign={user:{id:2,role:'manager',branch_id:2}} as Session;
before(async()=>{db=(await import('../src/lib/db/schema')).getDb();convert=(await import('../src/lib/supplier-purchase-conversion')).convertSupplierPurchaseList;
 db.exec("INSERT INTO branches(id,name,code) VALUES(1,'ONE','ONE'),(2,'TWO','TWO');INSERT INTO users(id,name,email,password_hash,role,branch_id) VALUES(1,'Owner','o@test','x','owner',1),(2,'Foreign manager','f@test','x','manager',2);INSERT INTO suppliers(id,name) VALUES(1,'Supplier');INSERT INTO settings(key,value) VALUES('vat_enabled','0'),('tax_rate','7.5');INSERT INTO supplier_purchase_items(id,supplier_id,branch_id,name,qty,est_cost) VALUES(1,1,1,'Fraction A',1.25,101),(2,1,1,'Fraction B',0.5,3),(3,1,2,'Other branch',1,128);");
});after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
describe('supplier list conversion uses authoritative exact purchase rules',()=>{
 it('respects configured tax exemption, rounds each fractional line exactly and isolates branches',()=>{
  assert.throws(()=>convert(db,foreign,1,1),/یافت نشد/);const result=convert(db,owner,1,1,{expected_total:128});assert.equal(result.count,2);assert.equal(result.total,128);
  const order=db.prepare('SELECT items_total,tax,total FROM purchase_orders WHERE id=?').get(result.id)!;assert.deepEqual({...order},{items_total:128,tax:0,total:128});assert.deepEqual(db.prepare('SELECT total FROM purchase_order_items WHERE po_id=? ORDER BY id').all(result.id).map(row=>row.total),[126,2]);
  assert.equal(db.prepare('SELECT po_id FROM supplier_purchase_items WHERE id=3').get()!.po_id,null);assert.throws(()=>convert(db,owner,1,1),/باقی نمانده/);assert.equal(db.prepare('SELECT COUNT(*) n FROM inventory_movements').get()!.n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM accounting_events').get()!.n,0);
 });
 it('uses the configured 7.5 percent instead of the old hardcoded 8.5 percent and validates dates',()=>{
  db.prepare("UPDATE settings SET value='1' WHERE key='vat_enabled'").run();assert.throws(()=>convert(db,owner,1,2,{expected_date:'2026-02-30'}),/تاریخ/);
  const result=convert(db,owner,1,2,{expected_total:138});assert.equal(result.total,138);assert.equal(db.prepare('SELECT tax FROM purchase_orders WHERE id=?').get(result.id)!.tax,10);
 });
 it('rolls the order and source links back on failure and rejects stale expected totals',()=>{
  db.prepare("INSERT INTO supplier_purchase_items(id,supplier_id,branch_id,name,qty,est_cost) VALUES(4,1,1,'Rollback item',1,100)").run();
  assert.throws(()=>convert(db,owner,1,1,{expected_total:100}),/تغییر کرده/);const before=db.prepare('SELECT COUNT(*) n FROM purchase_orders').get()!.n;
  db.exec("CREATE TRIGGER fail_purchase_convert BEFORE INSERT ON audit_logs WHEN NEW.entity='purchase_order' BEGIN SELECT RAISE(ABORT,'injected conversion failure'); END");
  try{assert.throws(()=>convert(db,owner,1,1),/injected conversion/);assert.equal(db.prepare('SELECT COUNT(*) n FROM purchase_orders').get()!.n,before);assert.equal(db.prepare('SELECT po_id FROM supplier_purchase_items WHERE id=4').get()!.po_id,null);}finally{db.exec('DROP TRIGGER fail_purchase_convert');}
  const result=convert(db,owner,1,1);assert.equal(result.total,108);assert.equal(db.prepare('SELECT po_id FROM supplier_purchase_items WHERE id=4').get()!.po_id,result.id);
 });
});
