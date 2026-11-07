/** Disposable large-history measurements; never accepts an existing database. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';

async function main() {
  if(process.env.REPAID_SETTLEMENT_PROFILE!=='1')throw new Error('Explicit disposable settlement profile required');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-settlement-profile-'));
  process.env.REPAID_DATA_DIR=directory;process.env.REPAID_DEMO_MODE='0';
  const {getDb,DB_PATH}=await import('../src/lib/db/schema');
  assert.equal(DB_PATH,path.join(directory,'repaid.db'));
  const db=getDb();
  try {
    db.exec("BEGIN IMMEDIATE; INSERT INTO branches(id,name,code) VALUES(1,'ONE','ONE'),(2,'TWO','TWO'); INSERT INTO customers(id,first_name,branch_id) VALUES(1,'ONE',1),(2,'TWO',2)");
    const invoice=db.prepare("INSERT INTO invoices(number,type,customer_id,branch_id,status,total) VALUES(?,'sale',?,?,'issued',1000)"),payment=db.prepare("INSERT INTO payments(invoice_id,customer_id,branch_id,direction,amount,method) VALUES(?,?,?,'in',?,'cash')"),refund=db.prepare('INSERT INTO refunds(payment_id,invoice_id,customer_id,branch_id,amount) VALUES(?,?,?,?,?)');
    for(let index=1;index<=10000;index++){
      const branch=index%2+1,id=Number(invoice.run('PROFILE-'+index,branch,branch).lastInsertRowid);
      payment.run(id,branch,branch,300);const returned=Number(payment.run(id,branch,branch,200).lastInsertRowid);payment.run(id,branch,branch,100);refund.run(returned,id,branch,branch,50);
    }
    db.exec('COMMIT; ANALYZE');
    const {netInvoicePaid}=await import('../src/lib/payment-state');
    const {operationalFinance}=await import('../src/lib/financial-report');
    const measure=(work:()=>unknown,count:number)=>{const times:number[]=[];for(let i=0;i<count;i++){const start=performance.now();work();times.push(performance.now()-start);}times.sort((a,b)=>a-b);return {samples:count,p50Ms:times[Math.ceil(count*.5)-1],p95Ms:times[Math.ceil(count*.95)-1],maxMs:times[count-1]};};
    const detail=db.prepare('SELECT total,paid,original_total,credit_total FROM effective_invoices WHERE id=?');
    const expected={total:1000,paid:550,original_total:1000,credit_total:0};
    assert.deepEqual({...detail.get(10000)},expected);assert.equal(netInvoicePaid(db,10000,'in'),550);
    const today=new Date().toISOString().slice(0,10),year=today.slice(0,4),report=()=>operationalFinance(db,1,year+'-01-01',String(Number(year)+1)+'-01-01',year+'-01-01');
    assert.equal(report().receivables,2250000);
    console.log(JSON.stringify({environment:'disposable SQLite WAL/FULL on development host; no production capacity claim',invoices:10000,payments:30000,refunds:10000,singleInvoice:measure(()=>detail.get(10000),30),paymentBalance:measure(()=>netInvoicePaid(db,10000,'in'),30),branchReport:measure(report,5),exactExpected:expected,plan:db.prepare('EXPLAIN QUERY PLAN SELECT paid FROM effective_invoices WHERE id=10000').all().map(row=>row.detail)},null,2));
  }finally{db.close();if(path.dirname(fs.realpathSync(directory))!==fs.realpathSync(os.tmpdir())||!path.basename(directory).startsWith('repaid-settlement-profile-'))throw new Error('Unsafe profile cleanup');fs.rmSync(directory,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
