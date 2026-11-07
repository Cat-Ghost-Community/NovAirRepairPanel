import {after,before,describe,it} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {DatabaseSync} from 'node:sqlite';

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-settlement-history-'));
process.env.REPAID_DATA_DIR=directory;process.env.REPAID_DEMO_MODE='0';
let db:DatabaseSync;
before(async()=>{
  const schema=await import('../src/lib/db/schema');assert.equal(schema.DB_PATH,path.join(directory,'repaid.db'));db=schema.getDb();
  db.exec("BEGIN; INSERT INTO branches(id,name,code) VALUES(1,'ONE','ONE'),(2,'TWO','TWO'); INSERT INTO customers(id,first_name,branch_id) VALUES(1,'ONE',1),(2,'TWO',2); INSERT INTO suppliers(id,name) VALUES(1,'Supplier'); INSERT INTO invoices(id,number,type,customer_id,supplier_id,branch_id,status,total,paid) VALUES(1,'SALE','sale',1,NULL,1,'issued',1000,777),(2,'PURCHASE','purchase',0,1,2,'issued',1000,888),(3,'EMPTY','sale',2,NULL,2,'issued',1000,999)");
  const payment=db.prepare('INSERT INTO payments(invoice_id,branch_id,customer_id,supplier_id,direction,amount,method) VALUES(?,?,?,?,?,?,?)');
  const cash=Number(payment.run(1,1,1,null,'in',200,'cash').lastInsertRowid);
  db.prepare('INSERT INTO refunds(payment_id,invoice_id,customer_id,branch_id,amount) VALUES(?,1,1,1,50)').run(cash);
  for(const [amount,status] of [[300,'passed'],[100,'in_hand'],[50,'bounced']] as const){const id=Number(payment.run(1,1,1,null,'in',amount,'check').lastInsertRowid);db.prepare("INSERT INTO checks(payment_id,invoice_id,branch_id,kind,amount,status,due_date) VALUES(?,1,1,'received',?,?,'2026-01-01')").run(id,amount,status);}
  payment.run(1,1,1,null,'out',25,'cash');
  const out=Number(payment.run(2,2,0,1,'out',210,'transfer').lastInsertRowid);
  db.prepare('INSERT INTO refunds(payment_id,invoice_id,customer_id,branch_id,amount) VALUES(?,2,0,2,30)').run(out);
  payment.run(2,2,0,1,'in',999,'cash');
  const invoice=db.prepare("INSERT INTO invoices(number,type,customer_id,branch_id,status,total) VALUES(?,'sale',2,2,'issued',1000)");
  const unrelatedRefund=db.prepare('INSERT INTO refunds(payment_id,invoice_id,customer_id,branch_id,amount) VALUES(?,?,2,2,50)');
  for(let n=0;n<2000;n++){const id=Number(invoice.run('UNRELATED-'+n).lastInsertRowid),receipt=Number(payment.run(id,2,2,null,'in',300,'cash').lastInsertRowid);unrelatedRefund.run(receipt,id);}
  db.exec('COMMIT; ANALYZE');
});
after(()=>{db?.close();fs.rmSync(directory,{recursive:true,force:true});});

describe('scoped invoice settlement over unrelated financial history',()=>{
  it('uses verified receipts and exact refunds with the invoice direction, never stale cached amounts',async()=>{
    const {netInvoicePaid}=await import('../src/lib/payment-state');
    assert.equal(netInvoicePaid(db,1,'in'),450);assert.equal(netInvoicePaid(db,2,'out'),180);
    const result=db.prepare('SELECT paid,stored_paid,total,credit_total FROM effective_invoices WHERE id=?');
    assert.deepEqual({...result.get(1)},{paid:450,stored_paid:777,total:1000,credit_total:0});
    assert.deepEqual({...result.get(2)},{paid:180,stored_paid:888,total:1000,credit_total:0});
    assert.deepEqual({...result.get(3)},{paid:0,stored_paid:999,total:1000,credit_total:0});
    assert.equal(db.prepare('SELECT paid FROM invoices WHERE id=1').get()!.paid,777,'read must never rewrite source cache');
  });
  it('scopes payment/refund/credit lookups to the requested invoice instead of materializing other invoices',()=>{
    const plan=db.prepare('EXPLAIN QUERY PLAN SELECT paid,total FROM effective_invoices WHERE id=?').all(1).map(row=>String(row.detail)).join('\n');
    assert.doesNotMatch(plan,/MATERIALIZE/);
    assert.match(plan,/idx_payments_invoice_direction/);assert.match(plan,/idx_refunds_payment/);
    assert.match(plan,/idx_customer_credit_source_invoice/);assert.match(plan,/idx_customer_credit_invoice/);
    assert.match(plan,/idx_credit_invoice/);
  });
  it('retains exact per-branch and consolidated obligations after current cheque clearing evidence changes',async()=>{
    const {operationalFinance}=await import('../src/lib/financial-report');
    const year=new Date().getUTCFullYear(),report=(branch:number|null)=>operationalFinance(db,branch,year+'-01-01',(year+1)+'-01-01',year+'-01-01');
    const one=report(1),two=report(2),all=report(null);
    assert.equal(one.receivables,550);assert.equal(one.payables,0);assert.equal(two.receivables,1501000);assert.equal(two.payables,820);
    assert.equal(all.receivables,one.receivables+two.receivables);assert.equal(all.payables,820);
    db.exec("UPDATE checks SET status='passed' WHERE status='in_hand'");
    assert.equal(db.prepare('SELECT paid FROM effective_invoices WHERE id=1').get()!.paid,550);
    assert.equal(report(1).receivables,450);
  });
});
