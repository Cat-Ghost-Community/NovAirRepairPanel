import {before,after,describe,it} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import type {Session} from '../src/lib/auth';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-compensation-'));process.env.REPAID_DATA_DIR=directory;process.env.REPAID_DEMO_MODE='0';
let db:ReturnType<typeof import('../src/lib/db/schema').getDb>,ledger:typeof import('../src/lib/accounting'),corrections:typeof import('../src/lib/commission-corrections'),settlements:typeof import('../src/lib/commission-settlement');
const owner={user:{id:1,role:'owner',branch_id:1}} as Session,approver={user:{id:2,role:'owner',branch_id:1}} as Session,foreign={user:{id:4,role:'manager',branch_id:2}} as Session;
const date=new Date().toISOString().slice(0,10);let run:number,ticket:number,reduction:number;
before(async()=>{
 db=(await import('../src/lib/db/schema')).getDb();ledger=await import('../src/lib/accounting');corrections=await import('../src/lib/commission-corrections');settlements=await import('../src/lib/commission-settlement');
 db.exec("INSERT INTO branches(id,name,code) VALUES(1,'ONE','ONE'),(2,'TWO','TWO'); INSERT INTO users(id,name,email,password_hash,role,branch_id) VALUES(1,'Proposer','p@test','x','owner',1),(2,'Approver','a@test','x','owner',1),(3,'Technician','t@test','x','technician',1),(4,'Foreign manager','f@test','x','manager',2); INSERT INTO customers(id,first_name,branch_id) VALUES(1,'Customer',1); INSERT INTO devices(id,customer_id,type) VALUES(1,1,'mobile');");
 db.exec("INSERT INTO user_permissions(user_id,perm,effect) VALUES(4,'finance.manage','allow'),(4,'team.manage','allow')");
 ledger.initializeChart(db,owner);ledger.createPeriod(db,owner,{name:'Current test period',start_date:date.slice(0,4)+'-01-01',end_date:date.slice(0,4)+'-12-31'});
 const opening=await import('../src/lib/accounting-opening'),policies=await import('../src/lib/accounting-policy');
 const p=opening.proposeOpening(db,owner,{branch_id:1,mode:'new_business',cutover_date:date,memo:'Reviewed empty business initialization',lines:[],controls:['1000','1020','1100','1110','2000','2010','2030'].map(account_code=>({account_code,balance:0,reference:'Independently reviewed zero statement'})),evidence:['Signed test opening record']});opening.decideOpening(db,approver,p.id,'approved');await opening.rehearseOpening(db,owner,p.id);opening.applyOpening(db,owner,p.id);
 const policy=policies.proposeRecognitionPolicy(db,owner,{branch_id:1,kind:'commission_cash_v1',effective_date:date,reason:'Independently reviewed documentary cash payouts'});policies.changeRecognitionPolicy(db,approver,policy.id,'approve');
 const capital=ledger.createJournal(db,owner,{branch_id:1,posting_date:date,memo:'Actual fixture owner contribution',event_key:'fixture-capital',source_type:'owner_contribution',source_id:'1',lines:[{account_code:'1000',debit:1000},{account_code:'3000',credit:1000}]},'1');ledger.postJournal(db,owner,capital.id,'1');
 (await import('../src/lib/repair')).ensureDefaultStatuses();ticket=Number(db.prepare("INSERT INTO repair_tickets(number,customer_id,device_id,branch_id,technician_id,status_id,delivered_at) VALUES('COMP-ONE',1,1,1,3,(SELECT id FROM repair_statuses WHERE name='Delivered'),datetime('now'))").run().lastInsertRowid);
 run=Number(db.prepare("INSERT INTO payroll_runs(user_id,source_ticket_id,branch_id,earned_commission,net_payable,status) VALUES(3,?,1,1000,1000,'pending')").run(ticket).lastInsertRowid);
 const {atomic}=await import('../src/lib/db/transaction'),events=await import('../src/lib/accounting-events');const event=atomic(db,()=>events.captureFinancialDocument(db,'commission',run,'accrual',1,1));events.reviewFinancialEvent(db,owner,event,{posting_date:date,reason:'Reviewed actual commission accrual',lines:[{account_code:'6010',debit:1000},{account_code:'2030',credit:1000,employee_id:3}]},'1');
 settlements.approveCommission(db,owner,run,'1');settlements.recordCommissionPayment(db,owner,run,{amount:600,method:'cash',payment_date:date,document_reference:'ACTUAL-PAYOUT-001',confirmed:true},'1');
});
after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
function propose(kind:'reduction'|'reinstatement'|'recovery',amount:number,reverses_id?:number){return corrections.proposeCommissionCorrection(db,owner,{run_id:run,kind,amount,reverses_id,posting_date:date,reason:'Independently reviewed repair compensation decision',evidence_reference:'REVIEWED-COMPENSATION-CASE'},'1');}
function post(id:number,input:{confirmed?:boolean;settlement_reference?:string}={}){corrections.decideCommissionCorrection(db,approver,id,true,'1');return corrections.postCommissionCorrection(db,owner,id,input,'1');}
function balance(code:string){return ledger.trialBalance(db,owner,{branch_id:1,to:date}).rows.find(r=>r.code===code)?.balance??0;}
describe('approved commission reduction, recovery and reinstatement against real SQLite',()=>{
 it('blocks direct cancellation after approval and payment; compensating correction remains mandatory',async()=>{
  const {cancelPendingCommission}=await import('../src/lib/commission-settlement');
  assert.throws(()=>cancelPendingCommission(db,owner,run,{reason:'Reviewed cancellation decision',reference:'Decision-001'},'1'),{status:409});
 });
 it('separates unpaid liability reversal from a recoverable paid overpayment after cancellation',()=>{
  db.prepare("UPDATE repair_tickets SET status_id=(SELECT id FROM repair_statuses WHERE name='Cancelled') WHERE id=?").run(ticket);
  assert.throws(()=>settlements.recordCommissionPayment(db,owner,run,{amount:1,method:'cash',payment_date:date,document_reference:'UNAPPROVED',confirmed:true},'1'),/اصلاح مصوب/);
  const p=propose('reduction',800);reduction=p.id;assert.throws(()=>corrections.decideCommissionCorrection(db,owner,p.id,true,'1'),/مستقل/);post(p.id);
  const position=db.prepare('SELECT * FROM commission_positions WHERE run_id=?').get(run)!;assert.equal(position.effective_commission,200);assert.equal(position.payable,0);assert.equal(position.recoverable,400);
  assert.equal(balance('2030'),0);assert.equal(balance('1320'),400);assert.equal(balance('6010'),200);assert.equal(balance('1000'),400);
  assert.equal(db.prepare('SELECT earned_commission FROM payroll_runs WHERE id=?').get(run)!.earned_commission,1000);assert.equal(db.prepare('SELECT SUM(amount) n FROM commission_payments WHERE run_id=?').get(run)!.n,600);assert.equal(db.prepare('SELECT COUNT(*) n FROM payroll_deductions').get()!.n,0);
  assert.equal(ledger.verifyLedger(db).valid,true);
 });
 it('requires actual recovery evidence and retains original branch ownership after employee transfer',()=>{
  const p=propose('recovery',200);corrections.decideCommissionCorrection(db,approver,p.id,true,'1');
  assert.throws(()=>corrections.postCommissionCorrection(db,owner,p.id,{},'1'),/مرجع|تأیید/);assert.equal(balance('1320'),400);
  db.prepare('UPDATE users SET branch_id=2 WHERE id=3').run();
  assert.throws(()=>corrections.postCommissionCorrection(db,foreign,p.id,{confirmed:true,settlement_reference:'ACTUAL-RECOVERY-001'},'2'),/یافت نشد/);
  corrections.postCommissionCorrection(db,owner,p.id,{confirmed:true,settlement_reference:'ACTUAL-RECOVERY-001'},'1');
  assert.equal(balance('1320'),200);assert.equal(balance('1000'),600);assert.equal(db.prepare('SELECT recoverable FROM commission_positions WHERE run_id=?').get(run)!.recoverable,200);assert.equal(db.prepare('SELECT branch_id FROM commission_corrections WHERE id=?').get(p.id)!.branch_id,1);
 });
 it('reinstates earned commission with correct receivable and payable treatment and permits only the corrected payout',()=>{
  post(propose('reinstatement',300,reduction).id);assert.equal(balance('1320'),0);assert.equal(balance('2030'),-100);assert.equal(balance('6010'),500);
  assert.throws(()=>settlements.recordCommissionPayment(db,owner,run,{amount:101,method:'cash',payment_date:date,document_reference:'TOO-MUCH',confirmed:true},'1'),/مانده/);
  const payment=settlements.recordCommissionPayment(db,owner,run,{amount:100,method:'cash',payment_date:date,document_reference:'CORRECTED-PAYOUT-002',confirmed:true},'1');assert.equal(payment.remaining,0);
  const position=db.prepare('SELECT * FROM commission_positions WHERE run_id=?').get(run)!;assert.equal(position.net_paid,500);assert.equal(position.effective_net,500);assert.equal(position.paid,700);assert.equal(position.recovered,200);assert.equal(position.payable,0);assert.equal(position.recoverable,0);
  assert.equal(balance('1000'),500);assert.equal(balance('2030'),0);assert.equal(ledger.verifyLedger(db).valid,true);assert.equal(db.prepare('SELECT net_payable FROM payroll_runs WHERE id=?').get(run)!.net_payable,1000);
 });
 it('rolls source, correction and journal back on audit failure without erasing payouts',()=>{
  const p=propose('reduction',100);corrections.decideCommissionCorrection(db,approver,p.id,true,'1');const snapshot=()=>['accounting_events','accounting_journals','commission_payments'].map(t=>db.prepare(`SELECT COUNT(*) n FROM ${t}`).get()!.n),before=snapshot();
  db.exec("CREATE TRIGGER fail_commission_correction BEFORE INSERT ON audit_logs WHEN NEW.entity='commission_correction' AND NEW.action='post' BEGIN SELECT RAISE(ABORT,'injected compensation failure'); END");
  try{assert.throws(()=>corrections.postCommissionCorrection(db,owner,p.id,{},'1'),/injected compensation/);assert.deepEqual(snapshot(),before);assert.equal(db.prepare('SELECT state FROM commission_corrections WHERE id=?').get(p.id)!.state,'approved');}finally{db.exec('DROP TRIGGER fail_commission_correction');}
  const result=corrections.postCommissionCorrection(db,owner,p.id,{},'1');assert.equal(corrections.postCommissionCorrection(db,owner,p.id,{},'1').duplicate,true);assert.throws(()=>ledger.reverseJournal(db,owner,result.journal_id!,date,'Unsafe direct reverse','1'),/اعاده/);assert.equal(balance('1320'),100);assert.equal(ledger.verifyLedger(db).valid,true);
 });
 it('reconciles employee liability and recovery controls against frozen branch sources',async()=>{
  const {reconcileSubledgers}=await import('../src/lib/accounting-reports');
  const result=reconcileSubledgers(db,owner,1,'1'),employee=result.employees.find(row=>row.id===3)!;
  assert.ok(employee);assert.equal(employee.payable,0);assert.equal(employee.recoverable,100);assert.equal(employee.ledger_recoverable,100);assert.equal(employee.payable_difference,0);assert.equal(employee.recoverable_difference,0);
  const other=reconcileSubledgers(db,owner,2,'2');assert.equal(other.employees.some(row=>row.id===3),false);
 });
});
