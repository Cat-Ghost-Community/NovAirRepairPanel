import {before,after,describe,it} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import type {Session} from '../src/lib/auth';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-service-credit-'));process.env.REPAID_DATA_DIR=directory;process.env.REPAID_DEMO_MODE='0';
const owner={user:{id:1,role:'owner',branch_id:1}} as Session,approver={user:{id:2,role:'owner',branch_id:1}} as Session,foreign={user:{id:3,role:'accountant',branch_id:2}} as Session,date=new Date().toISOString().slice(0,10);
let db:ReturnType<typeof import('../src/lib/db/schema').getDb>,service:typeof import('../src/lib/service-credits'),ledger:typeof import('../src/lib/accounting'),invoice:number,item:number,receipt:number,note:number,replacement:number;
before(async()=>{db=(await import('../src/lib/db/schema')).getDb();service=await import('../src/lib/service-credits');ledger=await import('../src/lib/accounting');
 db.exec("INSERT INTO branches(id,name,code) VALUES(1,'ONE','ONE'),(2,'TWO','TWO');INSERT INTO users(id,name,email,password_hash,role,branch_id) VALUES(1,'Proposer','p@test','x','owner',1),(2,'Approver','a@test','x','owner',1),(3,'Foreign','f@test','x','accountant',2);INSERT INTO customers(id,first_name,branch_id) VALUES(1,'Customer',1);INSERT INTO settings(key,value) VALUES('vat_enabled','0'),('tax_rate','0'),('duty_rate','0'),('round_to','0');");
 ledger.initializeChart(db,owner);ledger.createPeriod(db,owner,{name:'Open test year',start_date:date.slice(0,4)+'-01-01',end_date:date.slice(0,4)+'-12-31'});
 const opening=await import('../src/lib/accounting-opening'),policy=await import('../src/lib/accounting-policy');const p=opening.proposeOpening(db,owner,{branch_id:1,mode:'new_business',cutover_date:date,memo:'Independent explicit empty source opening',lines:[],controls:['1000','1020','1100','1110','2000','2010','2030'].map(account_code=>({account_code,balance:0,reference:'Reviewed zero source statement'})),evidence:['Independent original empty source evidence']});opening.decideOpening(db,approver,p.id,'approved');await opening.rehearseOpening(db,owner,p.id);opening.applyOpening(db,owner,p.id);
 for(const kind of ['service_invoice_v1','cash_receivable_v1'] as const){const rule=policy.proposeRecognitionPolicy(db,owner,{branch_id:1,kind,effective_date:date,reason:'Independently reviewed acceptance recognition'});policy.changeRecognitionPolicy(db,approver,rule.id,'approve');}
 const invoices=await import('../src/lib/invoice'),receipts=await import('../src/lib/customer-payments');invoice=invoices.createInvoice(owner,{type:'sale',customer_id:1,confirm:true,date,client_key:'service-original',items:[{kind:'labor',name:'Completed repair labor',qty:1,unit_price:1000}]},'1').id;item=Number(db.prepare('SELECT id FROM invoice_items WHERE invoice_id=?').get(invoice)!.id);receipt=receipts.createCustomerReceipt(db,owner,{invoice_id:invoice,amount:1000,method:'cash'},1).id;
});
after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
const propose=(amount:number,extra={})=>service.proposeServiceCredit(db,owner,{invoice_id:invoice,reason:'Customer-approved partial service correction',evidence_reference:'SIGNED-SERVICE-ADJUSTMENT',tax_amount:0,lines:[{invoice_item_id:item,net_amount:amount}],...extra},'1');
describe('service-only credits integrate immutable invoices, allocations, refunds and ledger',()=>{
 it('rejects malformed credit lines and tax as validation errors before persistence',()=>{
  const before=db.prepare('SELECT COUNT(*) n FROM credit_notes').get()!.n;
  assert.throws(()=>propose(1,{tax_amount:0.1}),(error:unknown)=>Number((error as {status:number}).status)===400);
  assert.throws(()=>propose(1,{lines:[null]}),(error:unknown)=>Number((error as {status:number}).status)===400);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM credit_notes').get()!.n,before);
 });
 it('requires independent approval, bounds original service credit and creates no physical movement',()=>{
  note=propose(300).id;assert.throws(()=>service.decideServiceCredit(db,owner,note,true,'1'),/مستقل/);assert.throws(()=>service.postServiceCredit(db,owner,note,date,'1'),/تأیید/);
  service.decideServiceCredit(db,approver,note,true,'1');const result=service.postServiceCredit(db,owner,note,date,'1');
  assert.deepEqual(db.prepare('SELECT account_code,debit,credit FROM accounting_lines WHERE journal_id=? ORDER BY position').all(result.journal_id!).map(row=>({...row})),[{account_code:'4010',debit:300,credit:0},{account_code:'1100',debit:0,credit:300}]);
  assert.equal(db.prepare('SELECT total FROM invoices WHERE id=?').get(invoice)!.total,1000);assert.equal(db.prepare('SELECT total FROM effective_invoices WHERE id=?').get(invoice)!.total,700);assert.equal(db.prepare('SELECT COUNT(*) n FROM inventory_movements').get()!.n,0);
  assert.equal(service.postServiceCredit(db,owner,note,date,'1').duplicate,true);assert.throws(()=>propose(701),/تجمعی/);assert.equal(ledger.verifyLedger(db).valid,true);
 });
 it('reverses and replaces without duplicate credit, inventory restoration or rewritten source history',()=>{
  service.reverseServiceCredit(db,owner,note,date,'Independent documented original credit reversal','1');assert.equal(db.prepare('SELECT total FROM effective_invoices WHERE id=?').get(invoice)!.total,1000);
  replacement=propose(250,{replaces_note_id:note,reason:'Independent replacement for reviewed 250 adjustment',evidence_reference:'REVIEWED-REPLACEMENT-REFERENCE'}).id;
  service.decideServiceCredit(db,approver,replacement,true,'1');service.postServiceCredit(db,owner,replacement,date,'1');
  assert.equal(db.prepare('SELECT total FROM effective_invoices WHERE id=?').get(invoice)!.total,750);assert.equal(db.prepare('SELECT status FROM credit_notes WHERE id=?').get(note)!.status,'reversed');assert.equal(db.prepare('SELECT replaces_note_id FROM credit_notes WHERE id=?').get(replacement)!.replaces_note_id,note);
  assert.throws(()=>propose(1,{replaces_note_id:note,reason:'Attempt a second replacement'}),/جایگزین/);assert.throws(()=>db.prepare('UPDATE service_credit_lines SET net_amount=1 WHERE note_id=?').run(replacement),/immutable|replaced/);assert.equal(ledger.verifyLedger(db).valid,true);
 });
 it('allocates and refunds service credit through original receipt exactly once',async()=>{
  const credit=await import('../src/lib/customer-credit'),invoices=await import('../src/lib/invoice');const target=invoices.createInvoice(owner,{type:'sale',customer_id:1,confirm:true,date,client_key:'service-future',items:[{kind:'labor',name:'Future service',qty:1,unit_price:150}]},'1');
  assert.equal(credit.customerCreditSource(db,receipt).available,250);const allocation=credit.proposeCustomerCredit(db,owner,{payment_id:receipt,invoice_id:target.id,amount:150,posting_date:date,reason:'Customer consent for future service allocation',evidence_reference:'SIGNED-CREDIT-ALLOCATION'},'1');credit.decideCustomerCredit(db,approver,allocation.id,true,'1');credit.postCustomerCredit(db,owner,allocation.id,'1');
  const doc=Number(db.prepare('SELECT return_id FROM credit_notes WHERE id=?').get(replacement)!.return_id);credit.refundCustomerCredit(db,owner,{payment_id:receipt,amount:100,reason:'Confirmed remaining service credit refund',document_reference:'ACTUAL-SERVICE-CREDIT-REFUND',confirmed:true,return_id:doc},'1');
  assert.equal(credit.customerCreditSource(db,receipt).available,0);assert.equal(db.prepare('SELECT total-paid n FROM effective_invoices WHERE id=?').get(invoice)!.n,0);assert.equal(db.prepare('SELECT total-paid n FROM effective_invoices WHERE id=?').get(target.id)!.n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM payments').get()!.n,1);
  const trial=ledger.trialBalance(db,owner,{branch_id:1,to:date});assert.equal(trial.rows.find(row=>row.code==='1000')!.balance,900);assert.equal(trial.rows.find(row=>row.code==='1100')!.balance,0);assert.equal(trial.rows.find(row=>row.code==='4010')!.balance,-900);assert.equal(ledger.verifyLedger(db).valid,true);
  assert.throws(()=>service.reverseServiceCredit(db,owner,replacement,date,'Attempt reversal after actual refund','1'),/تسویه/);
 });
 it('enforces branch scope and atomically rolls back a failed recognition',()=>{
  assert.throws(()=>service.proposeServiceCredit(db,foreign,{invoice_id:invoice,reason:'Forged other branch financial correction',evidence_reference:'FORGED-REFERENCE',tax_amount:0,lines:[{invoice_item_id:item,net_amount:1}]},'2'),/یافت نشد/);
  const proposal=propose(50);service.decideServiceCredit(db,approver,proposal.id,true,'1');const before=Number(db.prepare('SELECT COUNT(*) n FROM accounting_journals').get()!.n);
  db.exec("CREATE TRIGGER fail_service_credit BEFORE INSERT ON audit_logs WHEN NEW.entity='service_credit' AND NEW.action='post' BEGIN SELECT RAISE(ABORT,'injected service credit failure'); END");
  try{assert.throws(()=>service.postServiceCredit(db,owner,proposal.id,date,'1'),/injected service/);assert.equal(db.prepare('SELECT COUNT(*) n FROM accounting_journals').get()!.n,before);assert.equal(db.prepare('SELECT status FROM credit_notes WHERE id=?').get(proposal.id)!.status,'approved');}finally{db.exec('DROP TRIGGER fail_service_credit');}
  service.postServiceCredit(db,owner,proposal.id,date,'1');assert.equal(ledger.verifyLedger(db).valid,true);
 });
});
