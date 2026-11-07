import { before,after,describe,it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Session } from '../src/lib/auth';

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-cutover-'));
process.env.REPAID_DATA_DIR=directory;
let db:ReturnType<typeof import('../src/lib/db/schema').getDb>;
let ledger:typeof import('../src/lib/accounting'),opening:typeof import('../src/lib/accounting-opening'),policies:typeof import('../src/lib/accounting-policy');
let invoice:typeof import('../src/lib/invoice'),receipts:typeof import('../src/lib/customer-payments');
const owner={user:{id:1,name:'Proposer',email:'owner@test',role:'owner',branch_id:1,avatar_color:'blue'}} as Session;
const approver={user:{id:2,name:'Independent approver',email:'approver@test',role:'owner',branch_id:1,avatar_color:'blue'}} as Session;
const scoped={user:{id:3,name:'Accountant',email:'scoped@test',role:'accountant',branch_id:3,avatar_color:'blue'}} as Session;
const date=new Date().toISOString().slice(0,10);
const controls=(changes:Record<string,number>={})=>['1000','1020','1100','1110','2000','2010','2030'].map(account_code=>({account_code,balance:changes[account_code]??0,reference:'Independent statement / reviewed explicit zero'}));
const proposal=(branch_id:number,mode:'new_business'|'legacy'='new_business')=>({branch_id,mode,cutover_date:date,memo:'Reviewed independent opening balances',lines:[] as import('../src/lib/accounting').JournalLine[],controls:controls(),evidence:['Signed opening statement reference TEST-01']});
before(async()=>{
 const schema=await import('../src/lib/db/schema');assert.equal(schema.DB_PATH,path.join(directory,'repaid.db'));db=schema.getDb();
 ledger=await import('../src/lib/accounting');opening=await import('../src/lib/accounting-opening');policies=await import('../src/lib/accounting-policy');invoice=await import('../src/lib/invoice');receipts=await import('../src/lib/customer-payments');
 db.exec(`INSERT INTO branches(id,name,code) VALUES(1,'Legacy','B1'),(2,'New','B2'),(3,'Stale','B3'),(4,'Restricted','B4');
 INSERT INTO users(id,name,email,password_hash,role,branch_id) VALUES(1,'Proposer','owner@test','x','owner',1),(2,'Approver','approver@test','x','owner',1),(3,'Accountant','scoped@test','x','accountant',3);
 INSERT INTO customers(id,first_name,branch_id) VALUES(1,'Legacy',1),(2,'New',2),(3,'Stale',3);
 INSERT INTO settings(key,value) VALUES('vat_enabled','0'),('tax_rate','0'),('duty_rate','0'),('round_to','0');`);
 ledger.initializeChart(db,owner);ledger.createPeriod(db,owner,{name:'Approved testing year',start_date:date.slice(0,4)+'-01-01',end_date:date.slice(0,4)+'-12-31'});
});
after(()=>{db?.close();fs.rmSync(directory,{recursive:true,force:true});});

describe('V4 approved cutover and source-atomic recognition against real SQLite',()=>{
 it('requires independent approval, restored rehearsal and explicit zero declaration for new business',async()=>{
  const proposed=opening.proposeOpening(db,owner,proposal(2));
  assert.throws(()=>opening.decideOpening(db,owner,proposed.id,'approved'),/نمی‌تواند/);
  assert.throws(()=>opening.applyOpening(db,owner,proposed.id),/تأیید مستقل/);
  opening.decideOpening(db,approver,proposed.id,'approved');
  const beforePosts=db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='post'").get()!.n;
  const proof=await opening.rehearseOpening(db,owner,proposed.id);assert.equal(proof.status,'rehearsed');
  const retained=db.prepare('SELECT backup_path FROM accounting_opening_documents WHERE id=?').get(proposed.id)!.backup_path as string;
  const bytes=fs.readFileSync(retained);fs.appendFileSync(retained,'tampered copy');assert.throws(()=>opening.applyOpening(db,owner,proposed.id),/پشتیبان معتبر/);fs.writeFileSync(retained,bytes);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='post'").get()!.n,beforePosts,'rehearsal audit must stay inside restored database');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM accounting_journals').get()!.n,0);
  const result=opening.applyOpening(db,owner,proposed.id);assert.equal(result.journal_id,null);assert.equal(opening.applyOpening(db,owner,proposed.id).duplicate,true);
  assert.throws(()=>db.prepare("UPDATE accounting_opening_documents SET memo='tamper' WHERE id=?").run(proposed.id),/Invalid opening/);
  const proposedPolicy=policies.proposeRecognitionPolicy(db,owner,{branch_id:2,kind:'cash_advance_v1',effective_date:date,reason:'Approved explicit advance liability policy'});
  assert.throws(()=>policies.changeRecognitionPolicy(db,owner,proposedPolicy.id,'approve'),/مستقل/);
 });
 it('reconciles real legacy obligations, preserves absorbed events and blocks duplicate recognition',async()=>{
  const inv=invoice.createInvoice(owner,{type:'sale',customer_id:1,confirm:true,date,items:[{kind:'labor',name:'Actual service',qty:1,unit_price:700}]},"1");
  receipts.createCustomerReceipt(db,owner,{invoice_id:inv.id,amount:200,method:'cash'},1);
  const p={...proposal(1,'legacy'),lines:[{account_code:'1100',debit:500,customer_id:1},{account_code:'3000',credit:500}],controls:controls({'1100':500})};
  assert.throws(()=>opening.proposeOpening(db,owner,{...p,controls:controls({'1100':499})}),/برابر نیست/);
  const proposed=opening.proposeOpening(db,owner,p);assert.throws(()=>policies.changeRecognitionPolicy(db,owner,1,'approve'),/مستقل/);
  opening.decideOpening(db,approver,proposed.id,'approved');await opening.rehearseOpening(db,owner,proposed.id);const applied=opening.applyOpening(db,owner,proposed.id);
  assert.ok(applied.journal_id);assert.equal(ledger.verifyLedger(db).valid,true);
  assert.equal(db.prepare('SELECT SUM(debit)-SUM(credit) n FROM accounting_lines WHERE journal_id=?').get(applied.journal_id!)!.n,0);
  const event=db.prepare("SELECT id FROM accounting_events WHERE source_type='invoice' AND source_id=?").get(String(inv.id))!;
  assert.ok(db.prepare('SELECT event_id FROM accounting_opening_event_links WHERE event_id=?').get(event.id));
  const {reviewFinancialEvent}=await import('../src/lib/accounting-events');assert.throws(()=>reviewFinancialEvent(db,owner,Number(event.id),{posting_date:date,reason:'Must not post absorbed obligation',lines:[{account_code:'1100',debit:700},{account_code:'4010',credit:700}]}),/افتتاحیه/);
  const trial=ledger.trialBalance(db,owner,{branch_id:1,to:date});assert.equal(trial.pendingEvents,0);assert.equal(trial.rows.find(r=>r.code==='1100')!.balance,500);
  const previous=new Date(date+'T00:00:00Z');previous.setUTCDate(previous.getUTCDate()-1);
  assert.throws(()=>ledger.createJournal(db,owner,{branch_id:1,posting_date:previous.toISOString().slice(0,10),memo:'Blocked prior cutoff',event_key:'before-opening',source_type:'manual',source_id:'test',lines:[{account_code:'1000',debit:1},{account_code:'3000',credit:1}]}),/cutover/);
  assert.throws(()=>ledger.reverseJournal(db,owner,applied.journal_id!,date,'Cannot silently reverse accepted opening'),/cutover procedure/);
 });
 it('rejects changed evidence, unauthorized branch access and false new-business initialization',async()=>{
  const p=proposal(3),proposed=opening.proposeOpening(db,owner,p);opening.decideOpening(db,approver,proposed.id,'approved');
  receipts.createCustomerReceipt(db,owner,{customer_id:3,amount:10,method:'cash'},3);
  assert.throws(()=>opening.applyOpening(db,owner,proposed.id),/بازآزمایی/);
  await assert.rejects(opening.rehearseOpening(db,owner,proposed.id),/تغییر کرده/);
  assert.throws(()=>opening.proposeOpening(db,owner,proposal(3)),/منبع مالی/);
  assert.throws(()=>opening.proposeOpening(db,scoped,proposal(4)),/اجازه|شعبه|مدیر/);
 });
 it('only posts future eligible operations after independent policy approval; exact invoice and partial/full settlement',()=>{
  const old=receipts.createCustomerReceipt(db,owner,{customer_id:2,amount:50,method:'cash'},2);
  policies.changeRecognitionPolicy(db,approver,1,'approve');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM accounting_automatic_postings').get()!.n,0);
  for(const kind of ['service_invoice_v1','cash_receivable_v1'] as const){const p=policies.proposeRecognitionPolicy(db,owner,{branch_id:2,kind,effective_date:date,reason:'Reviewed accrual and settlement testing policy'});policies.changeRecognitionPolicy(db,approver,p.id,'approve');}
  const inv=invoice.createInvoice(owner,{type:'sale',customer_id:2,confirm:true,date,items:[{kind:'labor',name:'Recognized service',qty:1,unit_price:1000}]},"2");
  receipts.createCustomerReceipt(db,owner,{invoice_id:inv.id,amount:400,method:'cash'},2);
  assert.equal(ledger.trialBalance(db,owner,{branch_id:2,to:date}).rows.find(r=>r.code==='1100')!.balance,600);
  receipts.createCustomerReceipt(db,owner,{invoice_id:inv.id,amount:600,method:'cash'},2);
  const paid=ledger.trialBalance(db,owner,{branch_id:2,to:date});assert.equal(paid.rows.find(r=>r.code==='1100')!.balance,0);assert.equal(paid.rows.find(r=>r.code==='1000')!.balance,1000);assert.equal(paid.rows.find(r=>r.code==='4010')!.balance,-1000);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM accounting_automatic_postings').get()!.n,3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM accounting_journals WHERE branch_id=2 AND posted_by!=1').get()!.n,0,'source actor retained; approver not impersonated');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM accounting_automatic_postings ap JOIN accounting_events e ON e.id=ap.event_id WHERE e.source_type='payment' AND e.source_id=?").get(String(old.id))!.n,0);
  receipts.createCustomerReceipt(db,owner,{customer_id:2,amount:75,method:'cash'},2);
  assert.equal(ledger.trialBalance(db,owner,{branch_id:2,to:date}).rows.find(r=>r.code==='2010')!.balance,-75);
  assert.equal(ledger.verifyLedger(db).valid,true);
 });
 it('rolls source, invoice settlement, journal, automatic link and receipt identity back on interrupted posting',()=>{
  const inv=invoice.createInvoice(owner,{type:'sale',customer_id:2,confirm:true,date,items:[{kind:'labor',name:'Rollback service',qty:1,unit_price:300}]},"2");
  const snapshot=()=>['payments','accounting_events','accounting_journals','accounting_automatic_postings'].map(t=>db.prepare(`SELECT COUNT(*) n FROM ${t}`).get()!.n);
  const before=snapshot();db.exec("CREATE TRIGGER reject_automatic_audit BEFORE INSERT ON audit_logs WHEN NEW.action='automatic_post' BEGIN SELECT RAISE(ABORT,'injected automatic failure'); END");
  assert.throws(()=>receipts.createCustomerReceipt(db,owner,{invoice_id:inv.id,amount:100,method:'cash'},2),/injected automatic failure/);
  assert.deepEqual(snapshot(),before);assert.equal(db.prepare('SELECT paid FROM invoices WHERE id=?').get(inv.id)!.paid,0);
  db.exec('DROP TRIGGER reject_automatic_audit');receipts.createCustomerReceipt(db,owner,{invoice_id:inv.id,amount:100,method:'cash'},2);
  assert.equal(db.prepare('SELECT paid FROM invoices WHERE id=?').get(inv.id)!.paid,100);assert.equal(ledger.verifyLedger(db).valid,true);
 });
 it('reclassifies proven repair advances only under a new independently approved policy, with atomic replay and rollback',async()=>{
  const {ensureDefaultStatuses}=await import('../src/lib/repair');ensureDefaultStatuses();
  const device=Number(db.prepare("INSERT INTO devices(customer_id,type) VALUES(2,'mobile')").run().lastInsertRowid);
  let serial=0;
  const make=(amount:number)=>{const ticket=Number(db.prepare("INSERT INTO repair_tickets(number,customer_id,device_id,branch_id,status_id) VALUES(?,2,?,2,?)").run('ADV-TEST-'+(++serial),device,Number(db.prepare("SELECT id FROM repair_statuses WHERE name='Received'").get()!.id)).lastInsertRowid);db.prepare("INSERT INTO ticket_items(ticket_id,kind,name,qty,unit_price,cost,consumed) VALUES(?,'labor','Completed labor',1,1000,0,1)").run(ticket);const receipt=receipts.createCustomerReceipt(db,owner,{ticket_id:ticket,amount,method:'cash'},2);return {ticket,receipt};};
  const pending=make(100),first=invoice.createInvoice(owner,{type:'repair',customer_id:2,ticket_id:pending.ticket,confirm:true,date,client_key:'advance-pending-identity'},'2');
  const pendingEvent=db.prepare("SELECT id FROM accounting_events WHERE source_type='invoice' AND source_id=? AND event_type='advance_allocation'").get(String(first.id))!;
  assert.equal(db.prepare('SELECT event_id FROM accounting_event_reviews WHERE event_id=?').get(pendingEvent.id),undefined);
  const p=policies.proposeRecognitionPolicy(db,owner,{branch_id:2,kind:'advance_allocation_v1',effective_date:date,reason:'Reviewed liability-to-receivable allocation of proven same-ticket cash advances'});policies.changeRecognitionPolicy(db,approver,p.id,'approve');
  const actual=make(300),input={type:'repair' as const,customer_id:2,ticket_id:actual.ticket,confirm:true,date,client_key:'advance-recognized-identity'};
  const created=invoice.createInvoice(owner,input,'2');assert.equal(created.total,1000);assert.equal(created.paid,300);
  const event=db.prepare("SELECT * FROM accounting_events WHERE source_type='invoice' AND source_id=? AND event_type='advance_allocation'").get(String(created.id))!;
  const snapshot=JSON.parse(String(event.payload_json));assert.equal(snapshot.advance_allocations[0].payment_id,actual.receipt.id);assert.equal(snapshot.control_amount,300);
  const journal=db.prepare('SELECT journal_id FROM accounting_event_reviews WHERE event_id=?').get(event.id)!;
  const lines=db.prepare('SELECT account_code,debit,credit,customer_id FROM accounting_lines WHERE journal_id=? ORDER BY position').all(journal.journal_id).map(r=>({...r}));
  assert.deepEqual(lines,[{account_code:'2010',debit:300,credit:0,customer_id:2},{account_code:'1100',debit:0,credit:300,customer_id:2}]);
  const invoicePosition=db.prepare("SELECT SUM(l.debit-l.credit) n FROM accounting_lines l JOIN accounting_event_reviews r ON r.journal_id=l.journal_id JOIN accounting_events e ON e.id=r.event_id WHERE e.source_type='invoice' AND e.source_id=? AND l.account_code='1100'").get(String(created.id))!.n;assert.equal(invoicePosition,700);
  const count=db.prepare('SELECT COUNT(*) n FROM accounting_journals').get()!.n;assert.equal(invoice.createInvoice(owner,input,'2').duplicate,true);assert.equal(db.prepare('SELECT COUNT(*) n FROM accounting_journals').get()!.n,count);
  const fail=make(200),before=['invoices','accounting_events','accounting_journals'].map(t=>db.prepare(`SELECT COUNT(*) n FROM ${t}`).get()!.n);
  db.exec(`CREATE TRIGGER fail_advance_post BEFORE INSERT ON audit_logs WHEN NEW.action='automatic_post' AND json_extract(NEW.after,'$.policy_id')=${p.id} BEGIN SELECT RAISE(ABORT,'injected advance posting failure'); END`);
  try{assert.throws(()=>invoice.createInvoice(owner,{type:'repair',customer_id:2,ticket_id:fail.ticket,confirm:true,date,client_key:'advance-fault-identity'},'2'),/injected advance/);assert.deepEqual(['invoices','accounting_events','accounting_journals'].map(t=>db.prepare(`SELECT COUNT(*) n FROM ${t}`).get()!.n),before);assert.equal(db.prepare('SELECT invoice_id FROM payments WHERE id=?').get(fail.receipt.id)!.invoice_id,null);}finally{db.exec('DROP TRIGGER fail_advance_post');}
  assert.equal(db.prepare('SELECT event_id FROM accounting_event_reviews WHERE event_id=?').get(pendingEvent.id),undefined,'approval never backfills older events');assert.equal(ledger.verifyLedger(db).valid,true);
 });
 it('leaves unsupported methods pending and disables a policy without rewriting prior postings',()=>{
  const count=db.prepare('SELECT COUNT(*) n FROM accounting_automatic_postings').get()!.n;
  receipts.createCustomerReceipt(db,owner,{customer_id:2,amount:20,method:'card'},2);assert.equal(db.prepare('SELECT COUNT(*) n FROM accounting_automatic_postings').get()!.n,count);
  policies.changeRecognitionPolicy(db,approver,1,'disable');receipts.createCustomerReceipt(db,owner,{customer_id:2,amount:15,method:'cash'},2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM accounting_automatic_postings').get()!.n,count);
  assert.throws(()=>db.exec("UPDATE accounting_recognition_policies SET kind='cash_payable_v1' WHERE id=1"),/Invalid recognition/);
 });
 it('posts exactly once for concurrent durable receipt retries with the same payload and rejects conflicting replay',async()=>{
  for(const kind of ['service_invoice_v1','cash_receivable_v1'] as const){const p=policies.proposeRecognitionPolicy(db,owner,{branch_id:1,kind,effective_date:date,reason:'Independent branch receipt concurrency policy'});policies.changeRecognitionPolicy(db,approver,p.id,'approve');}
  const inv=invoice.createInvoice(owner,{type:'sale',customer_id:1,confirm:true,date,items:[{kind:'labor',name:'Concurrent settlement',qty:1,unit_price:900}]},'1');
  const worker=(amount=400)=>new Promise<{status:number}>(resolve=>{const child=spawn(process.execPath,['--import','tsx','scripts/financial-contention-worker.ts',String(inv.id),'approved-policy-retry',String(amount),'receipt'],{env:{...process.env,REPAID_DATA_DIR:directory,FINANCIAL_TEST_MODE:"1"},windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',chunk=>output+=chunk);child.on('error',()=>resolve({status:500}));child.on('exit',()=>{try{resolve(JSON.parse(output));}catch{resolve({status:500});}});});
  assert.deepEqual((await Promise.all([worker(),worker()])).map(r=>r.status),[200,200]);assert.equal((await worker(401)).status,409);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payments WHERE invoice_id=?').get(inv.id)!.n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM accounting_automatic_postings a JOIN accounting_events e ON e.id=a.event_id JOIN payments p ON CAST(p.id AS TEXT)=e.source_id WHERE e.source_type='payment' AND p.invoice_id=?").get(inv.id)!.n,1);
  assert.equal(db.prepare('SELECT paid FROM invoices WHERE id=?').get(inv.id)!.paid,400);assert.equal(ledger.verifyLedger(db).valid,true);
 });
 it('integrates an actual supplier settlement and delivered-work commission payout under separately approved policies',async()=>{
  for(const kind of ['cash_payable_v1','commission_cash_v1'] as const){const p=policies.proposeRecognitionPolicy(db,owner,{branch_id:2,kind,effective_date:date,reason:'Reviewed supplier and commission cash settlement'});policies.changeRecognitionPolicy(db,approver,p.id,'approve');}
  db.prepare("INSERT INTO suppliers(id,name) VALUES(1,'Real isolated supplier')").run();
  const purchase=invoice.createInvoice(owner,{type:'purchase',supplier_id:1,confirm:true,date,items:[{kind:'labor',name:'Supplier service',qty:1,unit_price:600}]},'2');
  const {reviewFinancialEvent}=await import('../src/lib/accounting-events');
  const event=Number(db.prepare("SELECT id FROM accounting_events WHERE source_type='invoice' AND source_id=? AND event_type='confirm'").get(String(purchase.id))!.id);
  reviewFinancialEvent(db,owner,event,{posting_date:date,reason:'Explicit fixture expense/AP recognition',lines:[{account_code:'6000',debit:600},{account_code:'2000',credit:600,supplier_id:1}]});
  invoice.addPaymentInTx(db,owner,{id:purchase.id},{amount:100,method:'cash'},2);
  assert.equal(ledger.trialBalance(db,owner,{branch_id:2,to:date}).rows.find(r=>r.code==='2000')!.balance,-500);
  const {ensureDefaultStatuses}=await import('../src/lib/repair');ensureDefaultStatuses();
  const device=Number(db.prepare("INSERT INTO devices(customer_id,type) VALUES(2,'mobile')").run().lastInsertRowid);
  const ticket=Number(db.prepare("INSERT INTO repair_tickets(number,branch_id,customer_id,device_id,status_id,technician_id,delivered_at) VALUES('AUTO-COMMISSION',2,2,?,(SELECT id FROM repair_statuses WHERE name='Delivered'),3,datetime('now'))").run(device).lastInsertRowid);
  const run=Number(db.prepare("INSERT INTO payroll_runs(user_id,branch_id,earned_commission,net_payable,status,source_ticket_id) VALUES(3,2,1000,1000,'pending',?)").run(ticket).lastInsertRowid);
  const {atomic}=await import('../src/lib/db/transaction'),{captureFinancialDocument}=await import('../src/lib/accounting-events');
  const accrualEvent=atomic(db,()=>captureFinancialDocument(db,'commission',run,'accrual',1,2));
  reviewFinancialEvent(db,owner,accrualEvent,{posting_date:date,reason:'Reviewed actual commission accrual',lines:[{account_code:'6010',debit:1000},{account_code:'2030',credit:1000,employee_id:3}]});
  const {approveCommission,recordCommissionPayment}=await import('../src/lib/commission-settlement');approveCommission(db,owner,run);
  recordCommissionPayment(db,owner,run,{amount:400,method:'cash',payment_date:date,document_reference:'V4-COM-400',confirmed:true});
  const trial=ledger.trialBalance(db,owner,{branch_id:2,to:date});assert.equal(trial.rows.find(r=>r.code==='2030')!.balance,-600);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM accounting_automatic_postings a JOIN accounting_events e ON e.id=a.event_id WHERE e.source_type='commission_payment' AND e.branch_id=2").get()!.n,1);
  assert.equal(db.prepare('SELECT employee_id FROM accounting_lines l JOIN accounting_automatic_postings a ON a.journal_id=l.journal_id JOIN accounting_events e ON e.id=a.event_id WHERE e.source_type=\'commission_payment\' AND l.account_code=\'2030\'').get()!.employee_id,3);
  assert.equal(ledger.verifyLedger(db).valid,true);
 });
 it('does not settle an unrecognized or backdated obligation automatically and rolls a closed-period source back',()=>{
  const before=db.prepare('SELECT COUNT(*) n FROM accounting_automatic_postings').get()!.n;
  const past=new Date(date+'T00:00:00Z');past.setUTCDate(past.getUTCDate()-1);
  const late=invoice.createInvoice(owner,{type:'sale',customer_id:2,confirm:true,date:past.toISOString().slice(0,10),items:[{kind:'labor',name:'Late review required',qty:1,unit_price:200}]},'2');
  receipts.createCustomerReceipt(db,owner,{invoice_id:late.id,amount:50,method:'cash'},2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM accounting_automatic_postings').get()!.n,before,'cash must not silently clear a receivable that was never recognized');
  const current=invoice.createInvoice(owner,{type:'sale',customer_id:2,confirm:true,date,items:[{kind:'labor',name:'Closed-period rollback',qty:1,unit_price:200}]},'2');
  const count=db.prepare('SELECT COUNT(*) n FROM payments').get()!.n;
  db.prepare("UPDATE accounting_periods SET status='closed' WHERE id=1").run();
  try{assert.throws(()=>receipts.createCustomerReceipt(db,owner,{invoice_id:current.id,amount:50,method:'cash'},2),/دورهٔ باز|دورهٔ حسابداری بسته/);
   assert.equal(db.prepare('SELECT COUNT(*) n FROM payments').get()!.n,count);assert.equal(db.prepare('SELECT paid FROM invoices WHERE id=?').get(current.id)!.paid,0);
  }finally{db.prepare("UPDATE accounting_periods SET status='open' WHERE id=1").run();}
 });
 it('reconciles opening stock per item, not merely an aggregate that can conceal wrong item attribution',async()=>{
  const part=Number(db.prepare("INSERT INTO parts(name,sku,avg_cost) VALUES('Opening item','OPEN-A',100)").run().lastInsertRowid);
  const wrong=Number(db.prepare("INSERT INTO parts(name,sku,avg_cost) VALUES('Other item','OPEN-B',100)").run().lastInsertRowid);
  const location=Number(db.prepare("INSERT INTO inventory_locations(name,branch_id,is_default) VALUES('Opening location',4,1)").run().lastInsertRowid);
  const {moveStock}=await import('../src/lib/inventory');moveStock({part_id:part,location_id:location,qty:2,type:'adjustment',unit_cost:100,note:'Documented initial stock evidence',branch_id:4,user_id:1});
  const p={...proposal(4,'legacy'),lines:[{account_code:'1110',debit:200,part_id:part},{account_code:'3000',credit:200}],controls:controls({'1110':200})};
  assert.throws(()=>opening.proposeOpening(db,owner,{...p,lines:[{account_code:'1110',debit:200,part_id:wrong},{account_code:'3000',credit:200}]}),/هر کالا/);
  const prepared=opening.proposeOpening(db,owner,p);opening.decideOpening(db,approver,prepared.id,'approved');await opening.rehearseOpening(db,owner,prepared.id);opening.applyOpening(db,owner,prepared.id);
  const {reconcileSubledgers}=await import('../src/lib/accounting-reports');const reconciled=reconcileSubledgers(db,owner,4);
  assert.deepEqual(reconciled.inventory,{operational:200,ledger:200,difference:0});assert.equal(reconciled.requiresReview,false);
 });
});
