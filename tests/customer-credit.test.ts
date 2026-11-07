import {before,after,describe,it} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawn} from 'node:child_process';
import type {Session} from '../src/lib/auth';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-credit-'));process.env.REPAID_DATA_DIR=directory;process.env.REPAID_DEMO_MODE='0';
let db:ReturnType<typeof import('../src/lib/db/schema').getDb>,credit:typeof import('../src/lib/customer-credit'),ledger:typeof import('../src/lib/accounting');
let receipt:number,invoice:number;
const owner={user:{id:1,role:'owner',branch_id:1}} as Session,approver={user:{id:2,role:'owner',branch_id:1}} as Session,foreign={user:{id:3,role:'accountant',branch_id:2}} as Session;
const date=new Date().toISOString().slice(0,10);
before(async()=>{
 db=(await import('../src/lib/db/schema')).getDb();credit=await import('../src/lib/customer-credit');ledger=await import('../src/lib/accounting');
 db.exec("INSERT INTO branches(id,name,code) VALUES(1,'ONE','ONE'),(2,'TWO','TWO'); INSERT INTO users(id,name,email,password_hash,role,branch_id) VALUES(1,'Proposer','p@test','x','owner',1),(2,'Approver','a@test','x','owner',1),(3,'Foreign','f@test','x','accountant',2); INSERT INTO customers(id,first_name,branch_id) VALUES(1,'Customer',1),(2,'Foreign',2); INSERT INTO settings(key,value) VALUES('vat_enabled','0'),('tax_rate','0'),('duty_rate','0'),('round_to','0');");
 ledger.initializeChart(db,owner);ledger.createPeriod(db,owner,{name:'Open test year',start_date:date.slice(0,4)+'-01-01',end_date:date.slice(0,4)+'-12-31'});
 const opening=await import('../src/lib/accounting-opening'),policies=await import('../src/lib/accounting-policy');
 const p=opening.proposeOpening(db,owner,{branch_id:1,mode:'new_business',cutover_date:date,memo:'Independent explicit zero source opening',lines:[],controls:['1000','1020','1100','1110','2000','2010','2030'].map(account_code=>({account_code,balance:0,reference:'Reviewed explicit zero statement'})),evidence:['Independent source evidence TEST-OPENING']});opening.decideOpening(db,approver,p.id,'approved');await opening.rehearseOpening(db,owner,p.id);opening.applyOpening(db,owner,p.id);
 for(const kind of ['cash_advance_v1','service_invoice_v1','cash_receivable_v1'] as const){const rule=policies.proposeRecognitionPolicy(db,owner,{branch_id:1,kind,effective_date:date,reason:'Independently reviewed source recognition for acceptance'});policies.changeRecognitionPolicy(db,approver,rule.id,'approve');}
 const receipts=await import('../src/lib/customer-payments'),invoices=await import('../src/lib/invoice');
 receipt=receipts.createCustomerReceipt(db,owner,{customer_id:1,amount:1000,method:'cash'},1).id;
 invoice=invoices.createInvoice(owner,{type:'sale',customer_id:1,confirm:true,date,client_key:'credit-target-identity',items:[{kind:'labor',name:'Real service obligation',qty:1,unit_price:700}]},'1').id;
 assert.equal(db.prepare('SELECT COUNT(*) n FROM accounting_automatic_postings').get()!.n,2,JSON.stringify(db.prepare('SELECT e.source_type,e.event_type,r.journal_id FROM accounting_events e LEFT JOIN accounting_event_reviews r ON r.event_id=e.id').all()));
});
after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
function proposal(amount:number,extra:Record<string,unknown>={}){return credit.proposeCustomerCredit(db,owner,{payment_id:receipt,invoice_id:invoice,amount,posting_date:date,reason:'Customer expressly requests allocation',evidence_reference:'CUSTOMER-CONSENT-001',...extra},'1');}
describe('durable customer credit allocation using authoritative source and ledger',()=>{
 it('rejects malformed monetary input as validation errors without financial writes',()=>{
  const before=db.prepare('SELECT COUNT(*) n FROM customer_credit_operations').get()!.n;
  for(const amount of [-1,0.1,'not-money',{},Number.MAX_SAFE_INTEGER+1])assert.throws(()=>proposal(amount as number),(error:unknown)=>Number((error as {status:number}).status)===400);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM customer_credit_operations').get()!.n,before);
 });
 it('requires independent approval and posts exact liability/receivable lines without another receipt',()=>{
  const p=proposal(400);assert.throws(()=>credit.decideCustomerCredit(db,owner,p.id,true,'1'),/مستقل/);assert.throws(()=>credit.postCustomerCredit(db,owner,p.id,'1'),/تأیید/);
  credit.decideCustomerCredit(db,approver,p.id,true,'1');const result=credit.postCustomerCredit(db,owner,p.id,'1');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payments').get()!.n,1);assert.equal(db.prepare('SELECT paid FROM effective_invoices WHERE id=?').get(invoice)!.paid,400);assert.equal(credit.customerCreditSource(db,receipt).available,600);
  assert.deepEqual(db.prepare('SELECT account_code,debit,credit FROM accounting_lines WHERE journal_id=? ORDER BY position').all(result.journal_id!).map(r=>({...r})),[{account_code:'2010',debit:400,credit:0},{account_code:'1100',debit:0,credit:400}]);
  assert.equal(credit.postCustomerCredit(db,owner,p.id,'1').duplicate,true);assert.equal(ledger.verifyLedger(db).valid,true);
  assert.throws(()=>ledger.reverseJournal(db,owner,result.journal_id!,date,'Bypass controlled reversal','1'),/گردش برگشت/);
 });
 it('supports partial reversal while preserving original journals and payment history',()=>{
  const first=db.prepare("SELECT id FROM customer_credit_operations WHERE kind='allocation' AND state='posted'").get()!;
  const p=proposal(50,{reverses_id:Number(first.id)});credit.decideCustomerCredit(db,approver,p.id,true,'1');credit.postCustomerCredit(db,owner,p.id,'1');
  assert.equal(db.prepare('SELECT paid FROM effective_invoices WHERE id=?').get(invoice)!.paid,350);assert.equal(credit.customerCreditSource(db,receipt).available,650);assert.equal(db.prepare('SELECT remaining FROM active_customer_credit WHERE id=?').get(first.id)!.remaining,350);
  assert.throws(()=>db.prepare("UPDATE customer_credit_operations SET amount=1 WHERE id=?").run(first.id),/immutable/);
  assert.equal(ledger.verifyLedger(db).valid,true);
 });
 it('prevents refunds or relinking from spending allocated funds twice',async()=>{
  const {refundReceipt}=await import('../src/lib/customer-payments');assert.throws(()=>refundReceipt(db,owner,{payment_id:receipt,amount:651},1),/تخصیص/);
  assert.throws(()=>db.prepare('UPDATE payments SET invoice_id=? WHERE id=?').run(invoice,receipt),/identity/);
  const statements=await import('../src/lib/party-statements');const report=statements.partyStatement(db,'customer',1,1);assert.equal(report.closing,-300);assert.equal(report.rows.filter(r=>r.key.startsWith('customer-credit-')).length,2);
 });
 it('rejects cross-branch proposals without modifying documents',()=>{
  const count=db.prepare('SELECT COUNT(*) n FROM customer_credit_operations').get()!.n;
  assert.throws(()=>credit.proposeCustomerCredit(db,foreign,{payment_id:receipt,invoice_id:invoice,amount:1,posting_date:date,reason:'Forged branch request',evidence_reference:'FORGED-CONSENT'},'2'),/یافت نشد/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM customer_credit_operations').get()!.n,count);
 });
 it('invalidates competing approved proposals and rolls back interrupted financial posting',()=>{
  const one=proposal(200),two=proposal(200);credit.decideCustomerCredit(db,approver,one.id,true,'1');credit.decideCustomerCredit(db,approver,two.id,true,'1');
  const snapshot=()=>['accounting_events','accounting_journals','accounting_lines'].map(t=>db.prepare(`SELECT COUNT(*) n FROM ${t}`).get()!.n),before=snapshot();
  db.exec("CREATE TRIGGER fail_credit_audit BEFORE INSERT ON audit_logs WHEN NEW.entity='customer_credit' AND NEW.action='post' BEGIN SELECT RAISE(ABORT,'injected credit failure'); END");
  try{assert.throws(()=>credit.postCustomerCredit(db,owner,one.id,'1'),/injected credit/);assert.deepEqual(snapshot(),before);assert.equal(db.prepare('SELECT state FROM customer_credit_operations WHERE id=?').get(one.id)!.state,'approved');assert.equal(credit.customerCreditSource(db,receipt).available,650);}finally{db.exec('DROP TRIGGER fail_credit_audit');}
  credit.postCustomerCredit(db,owner,one.id,'1');assert.throws(()=>credit.postCustomerCredit(db,owner,two.id,'1'),/تغییر کرده|مانده/);assert.equal(db.prepare('SELECT paid FROM effective_invoices WHERE id=?').get(invoice)!.paid,550);assert.equal(credit.customerCreditSource(db,receipt).available,450);assert.equal(ledger.verifyLedger(db).valid,true);
 });
 it('refunds only the remaining credit with exact journals and atomic failure recovery',async()=>{
  const snapshot=()=>['refunds','customer_credit_refunds','accounting_events','accounting_journals'].map(t=>db.prepare(`SELECT COUNT(*) n FROM ${t}`).get()!.n),before=snapshot();
  const input={payment_id:receipt,amount:450,reason:'Customer requests remaining cash credit',document_reference:'ACTUAL-CASH-REFUND-001',confirmed:true};
  db.exec("CREATE TRIGGER fail_credit_refund BEFORE INSERT ON audit_logs WHEN NEW.action='refund_credit' BEGIN SELECT RAISE(ABORT,'injected refund failure'); END");
  try{assert.throws(()=>credit.refundCustomerCredit(db,owner,input,'1'),/injected refund/);assert.deepEqual(snapshot(),before);assert.equal(credit.customerCreditSource(db,receipt).available,450);}finally{db.exec('DROP TRIGGER fail_credit_refund');}
  const refunded=credit.refundCustomerCredit(db,owner,input,'1');assert.equal(refunded.amount,450);assert.equal(credit.customerCreditSource(db,receipt).available,0);
  assert.equal(db.prepare('SELECT amount FROM payments WHERE id=?').get(receipt)!.amount,1000);assert.equal(db.prepare('SELECT COUNT(*) n FROM payments').get()!.n,1);
  const trial=ledger.trialBalance(db,owner,{branch_id:1,to:date});assert.equal(trial.rows.find(r=>r.code==='1000')!.balance,550);assert.equal(trial.rows.find(r=>r.code==='2010')!.balance,0);assert.equal(trial.rows.find(r=>r.code==='1100')!.balance,150);assert.equal(ledger.verifyLedger(db).valid,true);
  const {partyStatement}=await import('../src/lib/party-statements');assert.equal(partyStatement(db,'customer',1,1).closing,150);
 });
 it('serializes conflicting credit allocations from independent database processes',async()=>{
  const receipts=await import('../src/lib/customer-payments'),invoices=await import('../src/lib/invoice');
  const cash=receipts.createCustomerReceipt(db,owner,{customer_id:1,amount:300,method:'cash'},1);
  const target=invoices.createInvoice(owner,{type:'sale',customer_id:1,confirm:true,date,client_key:'concurrent-credit-target',items:[{kind:'labor',name:'Concurrent service',qty:1,unit_price:300}]},'1');
  const requests=[1,2].map(n=>credit.proposeCustomerCredit(db,owner,{payment_id:cash.id,invoice_id:target.id,amount:200,posting_date:date,reason:'Independent concurrent customer consent '+n,evidence_reference:'PARALLEL-CONSENT-'+n},'1'));
  for(const request of requests)credit.decideCustomerCredit(db,approver,request.id,true,'1');
  const results=await Promise.all(requests.map(request=>new Promise<{ok:boolean;error?:string}>((resolve,reject)=>{
   const child=spawn(process.execPath,['--import','tsx','scripts/customer-credit-worker.ts',String(request.id)],{env:{...process.env,REPAID_DATA_DIR:directory,CUSTOMER_CREDIT_WORKER:'1'},windowsHide:true});let output='',errors='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>errors+=chunk);child.on('error',reject);child.on('exit',code=>{if(code!==0)return reject(new Error(errors));try{resolve(JSON.parse(output));}catch(error){reject(error);}});
  })));
  assert.equal(results.filter(r=>r.ok).length,1,JSON.stringify(results));assert.match(results.find(r=>!r.ok)!.error!,/مانده|تغییر کرده/);
  assert.equal(db.prepare('SELECT paid FROM effective_invoices WHERE id=?').get(target.id)!.paid,200);assert.equal(credit.customerCreditSource(db,cash.id).available,100);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM customer_credit_operations WHERE invoice_id=? AND state='posted'").get(target.id)!.n,1);assert.equal(ledger.verifyLedger(db).valid,true);
 });
});
