import {describe,it,after} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {GROWTH_INDEXES} from '../src/lib/db/growth-indexes';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-growth-'));process.env.REPAID_DATA_DIR=directory;process.env.REPAID_DEMO_MODE='0';let db:ReturnType<typeof import('../src/lib/db/schema').getDb>;
after(()=>{db?.close();fs.rmSync(directory,{recursive:true,force:true});});
describe('branch-scoped growth indexes preserve results and avoid history sorts',()=>{
 it('uses composite indexes for large branch histories without rewriting source values',async()=>{
  db=(await import('../src/lib/db/schema')).getDb();db.exec("INSERT INTO branches(id,name,code) VALUES(1,'ONE','ONE'),(2,'TWO','TWO');INSERT INTO customers(id,first_name,branch_id) VALUES(1,'ONE',1);INSERT INTO devices(id,customer_id,type) VALUES(1,1,'phone');INSERT INTO repair_statuses(id,name) VALUES(1,'Received');");
  db.exec('DROP INDEX idx_tickets_branch_recent;BEGIN');const insert=db.prepare("INSERT INTO repair_tickets(number,branch_id,customer_id,device_id,status_id,created_at) VALUES(?,?,1,1,1,?)");
  for(let i=0;i<6000;i++)insert.run('GROW-'+i,i%2+1,'2026-10-'+String(i%28+1).padStart(2,'0')+' 00:00:00');db.exec('COMMIT');
  const sql='SELECT id,number FROM repair_tickets WHERE branch_id=? ORDER BY created_at DESC,id DESC LIMIT 50',before=db.prepare(sql).all(1),oldPlan=db.prepare('EXPLAIN QUERY PLAN '+sql).all(1).map(row=>String(row.detail)).join(' ');
  assert.match(oldPlan,/TEMP B-TREE/);for(const statement of GROWTH_INDEXES)db.exec(statement);
  const newPlan=db.prepare('EXPLAIN QUERY PLAN '+sql).all(1).map(row=>String(row.detail)).join(' ');assert.match(newPlan,/idx_tickets_branch_recent/);assert.doesNotMatch(newPlan,/TEMP B-TREE/);assert.deepEqual(db.prepare(sql).all(1),before);assert.equal(db.prepare('SELECT COUNT(*) n FROM repair_tickets').get()!.n,6000);
  const paymentPlan=db.prepare('EXPLAIN QUERY PLAN SELECT id FROM payments WHERE customer_id=? AND branch_id=? ORDER BY id DESC LIMIT 20').all(1,1).map(row=>String(row.detail)).join(' ');assert.match(paymentPlan,/idx_payments_customer_branch_recent/);
 });
});
