import { before,after,describe,it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Session } from '../src/lib/auth';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-returns-'));process.env.REPAID_DATA_DIR=directory;
let db:ReturnType<typeof import('../src/lib/db/schema').getDb>,returns:typeof import('../src/lib/returns'),invoices:typeof import('../src/lib/invoice'),payments:typeof import('../src/lib/customer-payments'),ledger:typeof import('../src/lib/accounting');
const owner={user:{id:1,name:'Owner',email:'owner@test',role:'owner',branch_id:1,avatar_color:'blue'}} as Session;
const approver={user:{id:2,name:'Approver',email:'approver@test',role:'owner',branch_id:1,avatar_color:'blue'}} as Session;
const other={user:{id:3,name:'Other',email:'other@test',role:'accountant',branch_id:2,avatar_color:'blue'}} as Session;
const date=new Date().toISOString().slice(0,10);let location:number,part:number,serial=0;
async function reviewInvoice(id:number){const {reviewFinancialEvent}=await import('../src/lib/accounting-events');
 const inv=db.prepare('SELECT * FROM invoices WHERE id=?').get(id)!;
 const events=db.prepare("SELECT e.id,e.source_type,e.source_id FROM accounting_events e LEFT JOIN accounting_event_reviews r ON r.event_id=e.id WHERE r.event_id IS NULL AND ((e.source_type='invoice' AND e.source_id=?) OR (e.source_type='stock' AND e.source_id IN (SELECT CAST(id AS TEXT) FROM inventory_movements WHERE ref_type='invoice' AND ref_id=?))) ORDER BY e.id").all(String(id),id);
 for(const event of events){if(event.source_type==='stock'){const m=db.prepare('SELECT * FROM inventory_movements WHERE id=?').get(Number(event.source_id))!;const cost=Number(m.unit_cost)*Math.abs(Number(m.qty));if(!cost)continue;
  reviewFinancialEvent(db,owner,Number(event.id),{posting_date:date,reason:'Explicit independent stock/COGS fixture policy',lines:inv.type==='purchase'?[{account_code:'1110',debit:cost,part_id:Number(m.part_id)},{account_code:'2100',credit:cost}]:[{account_code:'5000',debit:cost},{account_code:'1110',credit:cost,part_id:Number(m.part_id)}]});
 }else if(Number(inv.total)>0)reviewFinancialEvent(db,owner,Number(event.id),{posting_date:date,reason:'Explicit original obligation recognition',lines:inv.type==='purchase'?[{account_code:'2100',debit:Number(inv.total)},{account_code:'2000',credit:Number(inv.total),supplier_id:1}]:[{account_code:'1100',debit:Number(inv.total),customer_id:1},{account_code:'4000',credit:Number(inv.total)}]});}
}
async function sale(qty=2){const inv=invoices.createInvoice(owner,{type:'sale',customer_id:1,confirm:true,date,client_key:`return-fixture-${++serial}`,items:[{kind:'part',ref_id:part,qty,unit_price:300,cost:100}]},'1');await reviewInvoice(inv.id);const receipt=payments.createCustomerReceipt(db,owner,{invoice_id:inv.id,amount:qty*300,method:'cash'},1);return {id:inv.id,payment:receipt.id,line:Number(db.prepare('SELECT id FROM invoice_items WHERE invoice_id=?').get(inv.id)!.id)};}
function request(invoice:{id:number;line:number},qty=1){return returns.requestReturn(db,owner,{invoice_id:invoice.id,reason:'Documented customer return request',delivery_reference:'Actual original delivery DOC-001',lines:[{invoice_item_id:invoice.line,qty}]});}
function receiveInspect(id:number,disposition='restock'){
 returns.authorizeReturn(db,owner,id,true);returns.receiveReturn(db,owner,id,'Physical receipt signed by employee');
 const line=Number(db.prepare('SELECT id FROM business_return_lines WHERE return_id=?').get(id)!.id);
 returns.inspectReturn(db,owner,id,{reference:'Inspection signed evidence',lines:[{id:line,disposition,location_id:location,note:'Actual condition inspected and recorded'}]});return line;
}
const dispose=(id:number)=>returns.disposeReturn(db,owner,id,{reference:'Signed actual physical disposition evidence',confirmed:true});
function credit(id:number,line:number,amount=300){const note=returns.proposeCreditNote(db,owner,id,{reason:'Reviewed original line return value',evidence_reference:'Signed credit authorization statement',tax_amount:0,lines:[{return_line_id:line,net_amount:amount}]});returns.approveCreditNote(db,approver,note.id);return note;}
function worker(body:unknown,key:string){return new Promise<{status:number;id?:number}>(resolve=>{const child=spawn(process.execPath,['--import','tsx','scripts/return-contention-worker.ts',Buffer.from(JSON.stringify(body)).toString('base64'),key],{env:{...process.env,REPAID_DATA_DIR:directory,FINANCIAL_TEST_MODE:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',data=>output+=data);child.on('error',()=>resolve({status:500}));child.on('exit',()=>{try{resolve(JSON.parse(output));}catch{resolve({status:500});}});});}
before(async()=>{
 const schema=await import('../src/lib/db/schema');assert.equal(schema.DB_PATH,path.join(directory,'repaid.db'));db=schema.getDb();returns=await import('../src/lib/returns');invoices=await import('../src/lib/invoice');payments=await import('../src/lib/customer-payments');ledger=await import('../src/lib/accounting');
 db.exec(`INSERT INTO branches(id,name,code) VALUES(1,'Main','R1'),(2,'Other','R2');INSERT INTO users(id,name,email,password_hash,role,branch_id) VALUES(1,'Owner','owner@test','x','owner',1),(2,'Approver','approver@test','x','owner',1),(3,'Other','other@test','x','accountant',2);
 INSERT INTO customers(id,first_name,branch_id) VALUES(1,'Customer',1);INSERT INTO suppliers(id,name) VALUES(1,'Supplier');INSERT INTO settings(key,value) VALUES('vat_enabled','0'),('tax_rate','0'),('duty_rate','0'),('round_to','0');`);
 ledger.initializeChart(db,owner);ledger.createPeriod(db,owner,{name:'Return test year',start_date:date.slice(0,4)+'-01-01',end_date:date.slice(0,4)+'-12-31'});
 const opening=await import('../src/lib/accounting-opening');const proposed=opening.proposeOpening(db,owner,{branch_id:1,mode:'new_business',cutover_date:date,memo:'Independent explicit zero opening',lines:[],controls:opening.openingControlCodes.map(account_code=>({account_code,balance:0,reference:'Actual reviewed zero statement'})),evidence:['Independent opening evidence']});opening.decideOpening(db,approver,proposed.id,'approved');await opening.rehearseOpening(db,owner,proposed.id);opening.applyOpening(db,owner,proposed.id);
 const policies=await import('../src/lib/accounting-policy');for(const kind of ['cash_receivable_v1','cash_payable_v1','customer_return_credit_v1','supplier_return_credit_v1','return_restock_cost_v1','return_damage_cost_v1','supplier_return_stock_v1','return_cash_refund_v1','supplier_return_cash_v1','return_restock_cost_v2','return_damage_cost_v2','supplier_return_stock_v2'] as const){const p=policies.proposeRecognitionPolicy(db,owner,{branch_id:1,kind,effective_date:date,reason:'Synthetic explicit acceptance policy for new returns'});policies.changeRecognitionPolicy(db,approver,p.id,'approve');}
 location=Number(db.prepare("INSERT INTO inventory_locations(name,branch_id,is_default) VALUES('Returns warehouse',1,1)").run().lastInsertRowid);part=Number(db.prepare("INSERT INTO parts(name,sku,price,purchase_price,avg_cost) VALUES('Part','RET-PART',300,100,100)").run().lastInsertRowid);
 const {moveStock}=await import('../src/lib/inventory');moveStock({part_id:part,location_id:location,qty:30,type:'purchase',unit_cost:100,branch_id:1,user_id:1});
 const {reviewFinancialEvent}=await import('../src/lib/accounting-events');const event=Number(db.prepare("SELECT id FROM accounting_events WHERE source_type='stock' ORDER BY id DESC LIMIT 1").get()!.id);reviewFinancialEvent(db,owner,event,{posting_date:date,reason:'Actual initial unbilled inventory source',lines:[{account_code:'1110',debit:3000,part_id:part},{account_code:'2100',credit:3000}]});
});
after(()=>{db?.close();fs.rmSync(directory,{recursive:true,force:true});});

describe('complete customer/supplier returns on real financial source records',()=>{
 it('returns and refunds a paid product with exact stock, obligation, cash and immutable original invoice',async()=>{
  const original=await sale(),beforeStock=Number(db.prepare('SELECT qty FROM inventory_stock WHERE part_id=? AND location_id=?').get(part,location)!.qty);
  const r=request(original),line=receiveInspect(r.id);dispose(r.id);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM accounting_events e JOIN accounting_event_reviews v ON v.event_id=e.id WHERE e.source_type='stock' AND e.source_id=CAST((SELECT movement_id FROM business_return_lines WHERE id=?) AS TEXT)").get(line)!.n,0,'customer cost awaits the approved financial credit');
  const note=credit(r.id,line);
  assert.throws(()=>payments.refundReceipt(db,owner,{payment_id:original.payment,amount:1,method:'cash',return_id:r.id,document_reference:'Must not bypass return confirmation'},1),/تأیید/);
  assert.equal(db.prepare('SELECT status FROM credit_notes WHERE id=?').get(note.id)!.status,'posted');assert.equal(db.prepare('SELECT total FROM invoices WHERE id=?').get(original.id)!.total,600);
  assert.equal(db.prepare('SELECT total FROM effective_invoices WHERE id=?').get(original.id)!.total,300);assert.equal(Number(db.prepare('SELECT qty FROM inventory_stock WHERE part_id=? AND location_id=?').get(part,location)!.qty),beforeStock+1);
  returns.refundReturn(db,owner,r.id,{payment_id:original.payment,amount:300,method:'cash',reference:'Confirmed cash refund receipt 001',confirmed:true});
  assert.equal(db.prepare('SELECT paid,status FROM invoices WHERE id=?').get(original.id)!.paid,300);assert.equal(db.prepare('SELECT state FROM business_returns WHERE id=?').get(r.id)!.state,'completed');
  const {customerBalance}=await import('../src/lib/finance');assert.equal(customerBalance(1,1),0);const report=ledger.trialBalance(db,owner,{branch_id:1,to:date});assert.equal(report.rows.find(r=>r.code==='1100')!.balance,0);assert.equal(ledger.verifyLedger(db).valid,true);
  assert.throws(()=>returns.refundReturn(db,owner,r.id,{payment_id:original.payment,amount:1,method:'cash',reference:'Duplicate refund',confirmed:true}),/اعتبار واقعی/);
 });
 it('enforces cumulative quantity and original-value limits across repeated partial returns',async()=>{
  const original=await sale(2),first=request(original,1),firstLine=receiveInspect(first.id);dispose(first.id);credit(first.id,firstLine);
  const second=request(original,1),secondLine=receiveInspect(second.id);dispose(second.id);credit(second.id,secondLine);
  assert.equal(db.prepare('SELECT total FROM effective_invoices WHERE id=?').get(original.id)!.total,0);assert.throws(()=>request(original,1),/ماندهٔ قابل برگشت/);
  assert.throws(()=>dispose(second.id),/مرحله/);assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE ref_type='business_return' AND ref_id=?").get(secondLine)!.n,1);
 });
 it('does not restock damaged/quarantined goods and reclassifies existing cost without doubling expense',async()=>{
  const original=await sale(1),r=request(original),line=receiveInspect(r.id,'quarantined');const before=db.prepare('SELECT qty FROM inventory_stock WHERE part_id=? AND location_id=?').get(part,location)!.qty;
  assert.throws(()=>dispose(r.id),/قرنطینه/);assert.throws(()=>returns.refundReturn(db,owner,r.id,{payment_id:original.payment,amount:100,method:'cash',reference:'Forbidden early refund',confirmed:true}),/اعتبارنامه/);
  returns.inspectReturn(db,owner,r.id,{reference:'Final damaged inspection',lines:[{id:line,disposition:'damaged',note:'Unsellable confirmed damaged goods'}]});dispose(r.id);credit(r.id,line);
  assert.equal(db.prepare('SELECT qty FROM inventory_stock WHERE part_id=? AND location_id=?').get(part,location)!.qty,before);assert.equal(db.prepare('SELECT movement_id FROM business_return_lines WHERE id=?').get(line)!.movement_id,null);
  const journal=db.prepare("SELECT r.journal_id FROM accounting_events e JOIN accounting_event_reviews r ON r.event_id=e.id WHERE e.source_type='return_cost' AND e.source_id=?").get(String(line))!;
  assert.deepEqual(db.prepare('SELECT account_code,debit,credit FROM accounting_lines WHERE journal_id=? ORDER BY position').all(journal.journal_id).map(l=>({...l})),[{account_code:'6020',debit:100,credit:0},{account_code:'5000',debit:0,credit:100}]);
 });
 it('dispatches supplier goods once, waits for their receipt, credits AP and records an actual supplier refund',async()=>{
  const inv=invoices.createInvoice(owner,{type:'purchase',supplier_id:1,confirm:true,date,items:[{kind:'part',ref_id:part,qty:3,unit_price:100,cost:100}]},'1');await reviewInvoice(inv.id);const paid=invoices.addPaymentInTx(db,owner,{id:inv.id},{amount:300,method:'cash'},1);
  const item=Number(db.prepare('SELECT id FROM invoice_items WHERE invoice_id=?').get(inv.id)!.id),r=request({id:inv.id,line:item});returns.authorizeReturn(db,owner,r.id,true);const line=Number(db.prepare('SELECT id FROM business_return_lines WHERE return_id=?').get(r.id)!.id);
  returns.inspectReturn(db,owner,r.id,{reference:'Supplier dispatch inspection',lines:[{id:line,disposition:'supplier',location_id:location,note:'Actual supplier-return goods checked'}]});dispose(r.id);
  assert.equal(db.prepare('SELECT state FROM business_returns WHERE id=?').get(r.id)!.state,'dispatched');assert.throws(()=>credit(r.id,line,100),/مرحله/);
  returns.receiveReturn(db,owner,r.id,'Supplier signed receipt actual goods');credit(r.id,line,100);returns.refundReturn(db,owner,r.id,{payment_id:paid.id,amount:100,method:'cash',reference:'Actual supplier cash refund',confirmed:true});
  assert.equal(db.prepare('SELECT total FROM effective_invoices WHERE id=?').get(inv.id)!.total,200);const trial=ledger.trialBalance(db,owner,{branch_id:1,to:date});assert.equal(trial.rows.find(r=>r.code==='1310')!.balance,0);assert.equal(trial.rows.find(r=>r.code==='2000')!.balance,0);assert.equal(ledger.verifyLedger(db).valid,true);
 });
 it('rolls stock and journals back after a critical injected audit failure and denies another branch',async()=>{
  const original=await sale(1),r=request(original),line=receiveInspect(r.id);const before=db.prepare('SELECT qty FROM inventory_stock WHERE part_id=? AND location_id=?').get(part,location)!.qty;
  assert.throws(()=>returns.receiveReturn(db,other,r.id,'Forbidden branch receipt'),/اجازه|یافت نشد|شعبه/);
  db.exec("CREATE TRIGGER fail_return_disposition BEFORE INSERT ON audit_logs WHEN NEW.entity='business_return' AND NEW.action='dispose' BEGIN SELECT RAISE(ABORT,'return disposition failure'); END");
  assert.throws(()=>dispose(r.id),/return disposition failure/);db.exec('DROP TRIGGER fail_return_disposition');
  assert.equal(db.prepare('SELECT qty FROM inventory_stock WHERE part_id=? AND location_id=?').get(part,location)!.qty,before);assert.equal(db.prepare('SELECT movement_id FROM business_return_lines WHERE id=?').get(line)!.movement_id,null);assert.equal(db.prepare('SELECT state FROM business_returns WHERE id=?').get(r.id)!.state,'inspected');
  assert.equal(db.prepare('SELECT cost_amount,valuation_json FROM business_return_lines WHERE id=?').get(line)!.cost_amount,null);
  dispose(r.id);credit(r.id,line);assert.equal(ledger.verifyLedger(db).valid,true);
 });
 it('supports a multi-line partial return with exact net obligations and independent draft correction',async()=>{
  const second=Number(db.prepare("INSERT INTO parts(name,sku,price,purchase_price,avg_cost) VALUES('Second part','RET-SECOND',400,200,200)").run().lastInsertRowid);
  const {moveStock}=await import('../src/lib/inventory');moveStock({part_id:second,location_id:location,qty:2,type:'purchase',unit_cost:200,branch_id:1,user_id:1});
  const stockEvent=Number(db.prepare("SELECT id FROM accounting_events WHERE source_type='stock' ORDER BY id DESC LIMIT 1").get()!.id),{reviewFinancialEvent}=await import('../src/lib/accounting-events');reviewFinancialEvent(db,owner,stockEvent,{posting_date:date,reason:'Actual second part purchase receipt',lines:[{account_code:'1110',debit:400,part_id:second},{account_code:'2100',credit:400}]});
  const inv=invoices.createInvoice(owner,{type:'sale',customer_id:1,confirm:true,date,items:[{kind:'part',ref_id:part,qty:2,unit_price:300,cost:100},{kind:'part',ref_id:second,qty:1,unit_price:400,cost:200}]},'1');await reviewInvoice(inv.id);
  const originalLines=db.prepare('SELECT id FROM invoice_items WHERE invoice_id=? ORDER BY id').all(inv.id);
  const r=returns.requestReturn(db,owner,{invoice_id:inv.id,reason:'Actual multi-line partial return',delivery_reference:'Original multi-line delivery',lines:[{invoice_item_id:Number(originalLines[0].id),qty:1},{invoice_item_id:Number(originalLines[1].id),qty:1}]});
  returns.authorizeReturn(db,owner,r.id,true);returns.receiveReturn(db,owner,r.id,'Actual multiple goods receipt');const returned=db.prepare('SELECT id,gross_limit FROM business_return_lines WHERE return_id=? ORDER BY id').all(r.id);
  returns.inspectReturn(db,owner,r.id,{reference:'Multi-line actual inspection',lines:returned.map(l=>({id:Number(l.id),disposition:'restock',location_id:location,note:'Both goods inspected as resellable'}))});dispose(r.id);
  const proposal={reason:'Explicit partial credit document values',evidence_reference:'Reviewed line-level credit evidence',tax_amount:0,lines:returned.map(l=>({return_line_id:Number(l.id),net_amount:Number(l.gross_limit)-10}))};
  const draft=returns.proposeCreditNote(db,owner,r.id,proposal);assert.throws(()=>returns.proposeCreditNote(db,approver,r.id,proposal),/پیشنهاددهنده/);
  const edited=returns.proposeCreditNote(db,owner,r.id,{...proposal,lines:returned.map(l=>({return_line_id:Number(l.id),net_amount:Number(l.gross_limit)}))});assert.equal(edited.id,draft.id);
  assert.throws(()=>returns.approveCreditNote(db,owner,draft.id),/مستقل/);returns.approveCreditNote(db,approver,draft.id);
  assert.equal(db.prepare('SELECT amount FROM credit_notes WHERE id=?').get(draft.id)!.amount,700);assert.equal(db.prepare('SELECT total FROM effective_invoices WHERE id=?').get(inv.id)!.total,300);
  assert.throws(()=>db.prepare('UPDATE invoices SET total=0 WHERE id=?').run(inv.id),/immutable/);assert.throws(()=>db.prepare('DELETE FROM invoice_items WHERE invoice_id=?').run(inv.id),/cannot be deleted/);
 });
 it('bounds fractional quantities in exact micro-units and rejects a duplicate remaining quantity',async()=>{
  const inv=await sale(1),first=request(inv,0.333333),second=request(inv,0.333333),third=request(inv,0.333334);
  assert.ok(first.id&&second.id&&third.id);assert.equal(db.prepare('SELECT SUM(l.qty_micro) n FROM business_return_lines l JOIN business_returns r ON r.id=l.return_id WHERE r.invoice_id=?').get(inv.id)!.n,1000000);assert.throws(()=>request(inv,0.000001),/ماندهٔ قابل برگشت/);
 });
 it('commits only one concurrent remaining return and one valid remaining refund; replays are durable',async()=>{
  const inv=await sale(1),body={action:'request',invoice_id:inv.id,reason:'Concurrent quantity claim test',delivery_reference:'Actual delivery concurrency proof',lines:[{invoice_item_id:inv.line,qty:1}]};
  const responses=await Promise.all([worker(body,'return-quantity-a'),worker(body,'return-quantity-b')]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);const id=responses.find(r=>r.status===200)!.id!;
  const line=receiveInspect(id);dispose(id);credit(id,line);
  const refund=(reference:string)=>({action:'refund',id,payment_id:inv.payment,amount:200,method:'cash',reference,confirmed:true});
  const results=await Promise.all([worker(refund('Actual concurrency cash A'),'return-refund-a'),worker(refund('Actual concurrency cash B'),'return-refund-b')]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const win=results.findIndex(r=>r.status===200),winningBody=refund(win===0?'Actual concurrency cash A':'Actual concurrency cash B'),key=win===0?'return-refund-a':'return-refund-b';
  assert.equal((await worker(winningBody,key)).id,results[win].id);assert.equal((await worker({...winningBody,amount:201},key)).status,409);
  assert.equal(db.prepare('SELECT SUM(amount) n FROM return_settlements WHERE return_id=?').get(id)!.n,200);assert.equal(db.prepare('SELECT COUNT(*) n FROM refunds WHERE return_id=?').get(id)!.n,1);
  assert.equal(db.prepare("SELECT branch_id FROM customer_events WHERE type='refund' ORDER BY id DESC LIMIT 1").get()!.branch_id,1);
  assert.throws(()=>returns.refundReturn(db,owner,id,{payment_id:inv.payment,amount:50,method:'cash',reference:winningBody.reference,confirmed:true}),/قبلاً ثبت/);
 });
 it('keeps approved but unposted credits out of balances, and source/audit failures roll approval back',async()=>{
  const inv=await sale(1),r=request(inv),line=receiveInspect(r.id);dispose(r.id);
  const note=returns.proposeCreditNote(db,owner,r.id,{reason:'Credit pending policy acceptance',evidence_reference:'Independent pending policy statement',tax_amount:0,lines:[{return_line_id:line,net_amount:300}]});
  db.exec("CREATE TRIGGER fail_credit_note BEFORE INSERT ON audit_logs WHEN NEW.entity='business_return' AND NEW.action='approve_credit' BEGIN SELECT RAISE(ABORT,'injected credit failure'); END");
  assert.throws(()=>returns.approveCreditNote(db,approver,note.id),/injected credit failure/);db.exec('DROP TRIGGER fail_credit_note');
  assert.equal(db.prepare('SELECT status FROM credit_notes WHERE id=?').get(note.id)!.status,'draft');assert.equal(db.prepare('SELECT total FROM effective_invoices WHERE id=?').get(inv.id)!.total,300);
  const {changeRecognitionPolicy}=await import('../src/lib/accounting-policy');const policy=db.prepare("SELECT id FROM accounting_recognition_policies WHERE kind='customer_return_credit_v1' AND status='approved'").get()!;changeRecognitionPolicy(db,approver,Number(policy.id),'disable');
  returns.approveCreditNote(db,approver,note.id);assert.equal(db.prepare('SELECT status FROM credit_notes WHERE id=?').get(note.id)!.status,'approved');assert.equal(db.prepare('SELECT total FROM effective_invoices WHERE id=?').get(inv.id)!.total,300);
  const event=db.prepare("SELECT id FROM accounting_events WHERE source_type='credit_note' AND source_id=?").get(String(note.id))!;
  const {reviewFinancialEvent}=await import('../src/lib/accounting-events');assert.throws(()=>reviewFinancialEvent(db,approver,Number(event.id),{posting_date:date,reason:'Wrong control must reject',lines:[{account_code:'6000',debit:300},{account_code:'1000',credit:300}]}),/حساب کنترل/);
  assert.throws(()=>reviewFinancialEvent(db,approver,Number(event.id),{posting_date:date,reason:'Missing customer control attribution must reject',lines:[{account_code:'4000',debit:300},{account_code:'1100',credit:300}]}),/\u0637\u0631\u0641 \u062d\u0633\u0627\u0628/);
  reviewFinancialEvent(db,approver,Number(event.id),{posting_date:date,reason:'Explicit reviewed original revenue and AR reversal',lines:[{account_code:'4000',debit:300},{account_code:'1100',credit:300,customer_id:1}]});assert.equal(db.prepare('SELECT total FROM effective_invoices WHERE id=?').get(inv.id)!.total,0);
  assert.throws(()=>returns.reverseReturnCredit(db,approver,note.id,date,'Same approver must not reverse'),/مستقل/);
  const beforeStock=db.prepare('SELECT qty FROM inventory_stock WHERE part_id=? AND location_id=?').get(part,location)!.qty;returns.reverseReturnCredit(db,owner,note.id,date,'Independent correction of unrefunded credit');
  assert.equal(db.prepare('SELECT total FROM effective_invoices WHERE id=?').get(inv.id)!.total,300);assert.equal(db.prepare('SELECT qty FROM inventory_stock WHERE part_id=? AND location_id=?').get(part,location)!.qty,beforeStock);
 });
 it('reconciles statements, operational balances, stock, AP and consolidated journal totals from mixed real sources',async()=>{
  const {partyStatement}=await import('../src/lib/party-statements'),{customerBalance}=await import('../src/lib/finance'),{reconcileSubledgers}=await import('../src/lib/accounting-reports'),{operationalFinance}=await import('../src/lib/financial-report');
  const customer=partyStatement(db,'customer',1,1),supplier=partyStatement(db,'supplier',1,1),reconciliation=reconcileSubledgers(db,owner,1);
  assert.equal(customer.closing,customerBalance(1,1));assert.equal(supplier.closing,0);assert.ok(reconciliation.customers.every(r=>r.difference===0));assert.ok(reconciliation.suppliers.every(r=>r.difference===0));assert.equal(reconciliation.inventory.difference,0);
  const report=operationalFinance(db,1,'2000-01-01','2100-01-01','2000-01-01');assert.equal(report.inventoryValue,reconciliation.inventory.operational);assert.equal(ledger.trialBalance(db,owner,{to:date}).balanced,true);assert.equal(ledger.verifyLedger(db).valid,true);
 });
 it('requires proof before releasing rejected physical quantities and continues accepted lines separately',async()=>{
  const second=Number(db.prepare("SELECT id FROM parts WHERE sku='RET-SECOND'").get()!.id);
  const inv=invoices.createInvoice(owner,{type:'sale',customer_id:1,confirm:true,date,items:[{kind:'part',ref_id:part,qty:1,unit_price:300,cost:100},{kind:'part',ref_id:second,qty:1,unit_price:400,cost:200}]},'1');await reviewInvoice(inv.id);
  const original=db.prepare('SELECT id FROM invoice_items WHERE invoice_id=? ORDER BY id').all(inv.id);
  const r=returns.requestReturn(db,owner,{invoice_id:inv.id,reason:'Mixed accepted and rejected goods',delivery_reference:'Actual original mixed delivery',lines:original.map(l=>({invoice_item_id:Number(l.id),qty:1}))});returns.authorizeReturn(db,owner,r.id,true);returns.receiveReturn(db,owner,r.id,'Real receipt pending inspection');
  const items=db.prepare('SELECT id FROM business_return_lines WHERE return_id=? ORDER BY id').all(r.id);
  returns.inspectReturn(db,owner,r.id,{reference:'Actual mixed inspection evidence',lines:items.map((l,i)=>({id:Number(l.id),disposition:i===0?'restock':'rejected',location_id:location,note:'Documented independent condition result'}))});
  assert.throws(()=>dispose(r.id),/تحویل مجدد/);assert.throws(()=>returns.requestReturn(db,owner,{invoice_id:inv.id,reason:'Premature repeated rejected quantity',delivery_reference:'Goods still in custody',lines:[{invoice_item_id:Number(original[1].id),qty:1}]}),/ماندهٔ قابل برگشت/);
  returns.releaseRejectedReturn(db,owner,r.id,'Actual customer signed rejected-goods handover');dispose(r.id);credit(r.id,Number(items[0].id),300);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM credit_note_lines WHERE note_id=(SELECT id FROM credit_notes WHERE return_id=?)').get(r.id)!.n,1);
  const next=returns.requestReturn(db,owner,{invoice_id:inv.id,reason:'New receipt after actual rejected-goods release',delivery_reference:'Original physical delivery same invoice',lines:[{invoice_item_id:Number(original[1].id),qty:1}]});assert.ok(next.id);
  assert.throws(()=>db.prepare("UPDATE business_return_lines SET disposition='restock' WHERE id=?").run(items[1].id),/immutable/);
 });
 it('completes a documented free/warranty return without inventing a zero journal or cash refund',async()=>{
  const inv=invoices.createInvoice(owner,{type:'sale',customer_id:1,confirm:true,date,items:[{kind:'part',ref_id:part,qty:1,unit_price:0,cost:100}]},'1');await reviewInvoice(inv.id);
  const item=Number(db.prepare('SELECT id FROM invoice_items WHERE invoice_id=?').get(inv.id)!.id),r=request({id:inv.id,line:item}),line=receiveInspect(r.id);dispose(r.id);
  assert.throws(()=>returns.approveZeroReturnCredit(db,owner,r.id,'Actual independently verified zero claim'),/مستقل/);
  const journalCount=db.prepare('SELECT COUNT(*) n FROM accounting_journals').get()!.n;
  returns.approveZeroReturnCredit(db,approver,r.id,'Original free warranty invoice; no new monetary credit');
  assert.equal(db.prepare('SELECT state FROM business_returns WHERE id=?').get(r.id)!.state,'completed');assert.equal(db.prepare('SELECT COUNT(*) n FROM accounting_journals').get()!.n,Number(journalCount)+1,'only the actual inventory cost journal is posted after zero-credit approval');assert.equal(db.prepare('SELECT COUNT(*) n FROM credit_notes WHERE return_id=?').get(r.id)!.n,0);
  assert.ok(db.prepare('SELECT movement_id FROM business_return_lines WHERE id=?').get(line)!.movement_id);assert.equal(ledger.verifyLedger(db).valid,true);
 });
 it('conserves 100 rial across three fractional returns, refunds and independently competing final quantities',async()=>{
  const policy=await import('../src/lib/accounting-policy');const p=policy.proposeRecognitionPolicy(db,owner,{branch_id:1,kind:'customer_return_credit_v1',effective_date:date,reason:'Explicit fixture approval for new fractional acceptance documents'});policy.changeRecognitionPolicy(db,approver,p.id,'approve');
  const {moveStock,inventoryValue}=await import('../src/lib/inventory'),{reviewFinancialEvent}=await import('../src/lib/accounting-events');
  const fractional=Number(db.prepare("INSERT INTO parts(name,sku,price,purchase_price,avg_cost,quantity_precision) VALUES('Fractional','FRACTIONAL-V6',100,100,100,6)").run().lastInsertRowid);
  moveStock({part_id:fractional,location_id:location,qty:1,type:'purchase',unit_cost:100,branch_id:1,user_id:1});
  const originalStock=db.prepare("SELECT id FROM accounting_events WHERE source_type='stock' ORDER BY id DESC LIMIT 1").get()!;
  reviewFinancialEvent(db,owner,Number(originalStock.id),{posting_date:date,reason:'Documentary initial fractional inventory',lines:[{account_code:'1110',debit:100,part_id:fractional},{account_code:'2100',credit:100}]});
  const inv=invoices.createInvoice(owner,{type:'sale',customer_id:1,confirm:true,date,items:[{kind:'part',ref_id:fractional,qty:1,unit_price:100,cost:100}]},'1');await reviewInvoice(inv.id);
  const payment=payments.createCustomerReceipt(db,owner,{invoice_id:inv.id,amount:100,method:'cash'},1),sourceLine=Number(db.prepare('SELECT id FROM invoice_items WHERE invoice_id=?').get(inv.id)!.id);
  const amounts=[33,34,33],quantities=[0.333333,0.333333,0.333334],returned:number[]=[];
  for(let index=0;index<3;index++){
   let id:number;
   const body={action:'request',invoice_id:inv.id,reason:'Exact fractional return',delivery_reference:'Actual original fraction delivery',lines:[{invoice_item_id:sourceLine,qty:quantities[index]}]};
   if(index===2){const results=await Promise.all([worker(body,'fractional-final-a'),worker(body,'fractional-final-b')]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);id=results.find(r=>r.status===200)!.id!;}
   else id=returns.requestReturn(db,owner,body).id;
   returned.push(id);const line=receiveInspect(id);dispose(id);credit(id,line,amounts[index]);
   assert.equal(db.prepare('SELECT cost_amount FROM business_return_lines WHERE id=?').get(line)!.cost_amount,amounts[index]);
   const movement=db.prepare("SELECT extended_cost FROM inventory_movements WHERE ref_type='business_return' AND ref_id=?").get(line)!;assert.equal(movement.extended_cost,amounts[index]);
   returns.refundReturn(db,owner,id,{payment_id:payment.id,amount:amounts[index],method:'cash',reference:`Actual fractional cash ${index}`,confirmed:true});
   assert.equal(db.prepare('SELECT state FROM business_returns WHERE id=?').get(id)!.state,'completed');
  }
  assert.equal(db.prepare('SELECT qty FROM inventory_stock WHERE part_id=? AND location_id=?').get(fractional,location)!.qty,1);
  assert.equal(db.prepare('SELECT SUM(amount) amount FROM refunds WHERE payment_id=?').get(payment.id)!.amount,100);
  assert.equal(db.prepare('SELECT total,paid FROM effective_invoices WHERE id=?').get(inv.id)!.total,0);
  assert.equal(db.prepare("SELECT SUM(extended_cost) n FROM inventory_movements WHERE ref_type='business_return' AND part_id=?").get(fractional)!.n,100);
  const stockControl=db.prepare("SELECT SUM(l.debit-l.credit) n FROM accounting_lines l JOIN accounting_journals j ON j.id=l.journal_id WHERE l.account_code='1110' AND l.part_id=? AND j.state IN ('posted','reversed')").get(fractional)!;assert.equal(stockControl.n,100);assert.ok(Number.isSafeInteger(inventoryValue(1)));
  assert.throws(()=>db.prepare('UPDATE inventory_movements SET extended_cost=0 WHERE ref_type=\'business_return\' AND part_id=?').run(fractional),/immutable/);
  assert.equal(returned.length,3);assert.equal(ledger.verifyLedger(db).valid,true);
 });
 it('returns original cost into a changed weighted average only with exact valuation and separately approved v2 policy',async()=>{
  const {moveStock}=await import('../src/lib/inventory'),{reviewFinancialEvent}=await import('../src/lib/accounting-events');
  const weighted=Number(db.prepare("INSERT INTO parts(name,sku,price,purchase_price,avg_cost) VALUES('Weighted','WEIGHTED-V6',300,100,100)").run().lastInsertRowid);
  const receipt=(qty:number,cost:number)=>{moveStock({part_id:weighted,location_id:location,qty,type:'purchase',unit_cost:cost,branch_id:1,user_id:1});const e=db.prepare("SELECT id FROM accounting_events WHERE source_type='stock' ORDER BY id DESC LIMIT 1").get()!;reviewFinancialEvent(db,owner,Number(e.id),{posting_date:date,reason:'Actual weighted-cost purchase',lines:[{account_code:'1110',debit:qty*cost,part_id:weighted},{account_code:'2100',credit:qty*cost}]});};
  receipt(1,100);const inv=invoices.createInvoice(owner,{type:'sale',customer_id:1,confirm:true,date,items:[{kind:'part',ref_id:weighted,qty:1,unit_price:300,cost:100}]},'1');await reviewInvoice(inv.id);receipt(1,200);
  const source=Number(db.prepare('SELECT id FROM invoice_items WHERE invoice_id=?').get(inv.id)!.id),r=returns.requestReturn(db,owner,{invoice_id:inv.id,reason:'Original cost after price change',delivery_reference:'Actual original weighted delivery',lines:[{invoice_item_id:source,qty:1}]});const line=receiveInspect(r.id);dispose(r.id);credit(r.id,line);
  assert.equal(db.prepare('SELECT avg_cost FROM parts WHERE id=?').get(weighted)!.avg_cost,150);
  assert.equal(db.prepare('SELECT qty FROM inventory_stock WHERE part_id=? AND location_id=?').get(weighted,location)!.qty,2);
  const event=db.prepare("SELECT e.payload_json,a.policy_id FROM accounting_events e JOIN accounting_automatic_postings a ON a.event_id=e.id WHERE e.source_type='stock' AND e.source_id=CAST((SELECT movement_id FROM business_return_lines WHERE id=?) AS TEXT)").get(line)!;
  const proof=JSON.parse(String(event.payload_json));assert.equal(proof.control_amount,100);assert.equal(proof.document.return_valuation.before_value,200);assert.equal(proof.document.return_valuation.after_value,300);
  assert.equal(db.prepare('SELECT kind FROM accounting_recognition_policies WHERE id=?').get(event.policy_id)!.kind,'return_restock_cost_v2');assert.equal(ledger.verifyLedger(db).valid,true);
 });
 it('enforces item precision before any return quantity or stock mutation',async()=>{
  const original=await sale(1);db.prepare('UPDATE parts SET quantity_precision=2 WHERE id=?').run(part);
  const count=db.prepare('SELECT COUNT(*) n FROM business_returns').get()!.n;
  try{assert.throws(()=>request(original,0.001),/دقت/);const {moveStock}=await import('../src/lib/inventory');assert.throws(()=>moveStock({part_id:part,location_id:location,qty:0.001,type:'adjustment',unit_cost:100,branch_id:1,user_id:1}),/دقت/);assert.equal(db.prepare('SELECT COUNT(*) n FROM business_returns').get()!.n,count);}finally{db.prepare('UPDATE parts SET quantity_precision=6 WHERE id=?').run(part);}
 });
 it('serves all four financial reports from the actual database without leaking branch data',async()=>{
  const {GET}=await import('../src/app/api/reports/iran/route'),{createSession}=await import('../src/lib/auth'),{NextRequest}=await import('next/server');
  const token=createSession(1);
  for(const type of ['ar_ap','journal','pl','stock_value']){
   const response=await GET(new NextRequest(`http://app.test/api/reports/iran?type=${type}`,{headers:{cookie:`repaid_session=${token}; repaid_branch=1`}}));
   const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(response.headers.get('cache-control'),'no-store');
  }
  const invalid=await GET(new NextRequest('http://app.test/api/reports/iran?type=pl&days=-1',{headers:{cookie:`repaid_session=${token}`}}));assert.equal(invalid.status,400);
 });
 it('reverses and reissues a reviewed credit without repeating stock or losing original financial history',async()=>{
  const original=await sale(1),r=request(original),line=receiveInspect(r.id);dispose(r.id);const old=credit(r.id,line);
  const stockBefore=db.prepare('SELECT qty FROM inventory_stock WHERE part_id=? AND location_id=?').get(part,location)!.qty;
  returns.reverseReturnCredit(db,owner,old.id,date,'Independent documented correction before any refund');
  assert.equal(db.prepare('SELECT total FROM effective_invoices WHERE id=?').get(original.id)!.total,300);
  const replacement=returns.proposeCreditNote(db,owner,r.id,{reason:'Reviewed replacement with partial credit 250',evidence_reference:'New independently reviewed correction document',tax_amount:0,lines:[{return_line_id:line,net_amount:250}]});
  assert.notEqual(replacement.id,old.id);assert.equal(db.prepare('SELECT replaces_note_id FROM credit_notes WHERE id=?').get(replacement.id)!.replaces_note_id,old.id);
  assert.throws(()=>returns.approveCreditNote(db,owner,replacement.id),/مستقل/);const result=returns.approveCreditNote(db,approver,replacement.id);assert.equal(result.status,'approved','a reduced credit does not invent an automatic discount policy');
  const {reviewFinancialEvent}=await import('../src/lib/accounting-events');
  const posting={posting_date:date,reason:'Explicit approval of the 250 partial correction',lines:[{account_code:'4000',debit:250},{account_code:'1100',credit:250,customer_id:1}]};
  const closedDate=`${Number(date.slice(0,4))+1}-01-01`,period=ledger.createPeriod(db,owner,{name:'Closed replacement acceptance date',start_date:closedDate,end_date:closedDate});ledger.setPeriodState(db,owner,period.id,'closed','Independent empty future period closure');
  assert.throws(()=>reviewFinancialEvent(db,approver,result.event_id,{...posting,posting_date:closedDate}),/بسته|دوره/);assert.equal(db.prepare('SELECT status FROM credit_notes WHERE id=?').get(replacement.id)!.status,'approved');
  reviewFinancialEvent(db,approver,result.event_id,posting);
  assert.equal(db.prepare('SELECT total FROM effective_invoices WHERE id=?').get(original.id)!.total,50);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM credit_note_lines WHERE return_line_id=?').get(line)!.n,2);
  assert.equal(db.prepare('SELECT qty FROM inventory_stock WHERE part_id=? AND location_id=?').get(part,location)!.qty,stockBefore);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE ref_type='business_return' AND ref_id=?").get(line)!.n,1);
  assert.equal(db.prepare('SELECT status FROM credit_notes WHERE id=?').get(old.id)!.status,'reversed');assert.throws(()=>db.prepare('UPDATE credit_notes SET amount=1 WHERE id=?').run(old.id),/immutable|CHECK/);
  returns.refundReturn(db,owner,r.id,{payment_id:original.payment,amount:250,method:'cash',reference:'Actual refund of corrected credit only',confirmed:true});
  assert.throws(()=>returns.refundReturn(db,owner,r.id,{payment_id:original.payment,amount:1,method:'cash',reference:'Forbidden duplicate remaining refund',confirmed:true}),/بیشتر/);
  assert.throws(()=>returns.reverseReturnCredit(db,owner,replacement.id,date,'Must not erase settled credit'),/تسویه/);
  assert.equal(db.prepare('SELECT state FROM business_returns WHERE id=?').get(r.id)!.state,'completed');assert.equal(ledger.verifyLedger(db).valid,true);
 });
 it('paginates and searches original lines beyond the first page, settled payments and branch warehouses',async()=>{
  const {moveStock}=await import('../src/lib/inventory'),{GET}=await import('../src/app/api/returns/route'),{createSession}=await import('../src/lib/auth'),{NextRequest}=await import('next/server');
  const items=[];
  for(let i=0;i<300;i++){
   const id=Number(db.prepare('INSERT INTO parts(name,sku,price,purchase_price,avg_cost) VALUES(?,?,1,1,1)').run(`Paged item ${i}`,`PAGED-V6-${i}`).lastInsertRowid);
   moveStock({part_id:id,location_id:location,qty:1,type:'purchase',unit_cost:1,branch_id:1,user_id:1});items.push({kind:'part',ref_id:id,qty:1,unit_price:1,cost:1});
  }
  const inv=invoices.createInvoice(owner,{type:'sale',customer_id:1,confirm:true,date,items},'1'),last=Number(db.prepare('SELECT id FROM invoice_items WHERE invoice_id=? ORDER BY id DESC LIMIT 1').get(inv.id)!.id);
  const r=returns.requestReturn(db,owner,{invoice_id:inv.id,reason:'Select original line beyond the first page',delivery_reference:'Actual complete paged invoice delivery',lines:[{invoice_item_id:last,qty:1}]});assert.ok(r.id);
  const token=createSession(1),read=async(query:string)=>{const response=await GET(new NextRequest(`http://app.test/api/returns?${query}`,{headers:{cookie:`repaid_session=${token}; repaid_branch=1`}}));const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;};
  const first=await read(`invoice_id=${inv.id}`),tail=await read(`invoice_id=${inv.id}&page=3`);assert.equal(first.items.length,100);assert.equal(first.totalPages,3);assert.equal(tail.items.length,100);assert.equal(tail.items[99].id,last);assert.equal(tail.items[99].eligible_micro,0);
  assert.equal((await read(`invoice_id=${inv.id}&q=Paged%20item%20299`)).items[0].id,last);
  for(let i=0;i<101;i++)payments.createCustomerReceipt(db,owner,{invoice_id:inv.id,amount:1,method:'cash'},1);
  const paymentPage=await read(`view=selector&entity=payment&return_id=${r.id}&page=3`);assert.equal(paymentPage.options.length,1);assert.equal(paymentPage.total,101);
  const lastPayment=db.prepare('SELECT number FROM payments WHERE invoice_id=? ORDER BY id DESC LIMIT 1').get(inv.id)!;assert.equal((await read(`view=selector&entity=payment&return_id=${r.id}&q=${lastPayment.number}`)).options.length,1);
  for(let i=0;i<201;i++)db.prepare('INSERT INTO inventory_locations(name,branch_id) VALUES(?,1)').run(`Paged warehouse ${i}`);
  db.prepare("INSERT INTO inventory_locations(name,branch_id) VALUES('Forbidden warehouse',2)").run();
  const warehouses=await read(`view=selector&entity=location&return_id=${r.id}&page=5`);assert.ok(warehouses.options.length>0);assert.ok(warehouses.total>200);assert.equal((await read(`view=selector&entity=location&return_id=${r.id}&q=Forbidden`)).options.length,0);
  assert.equal((await read(`view=selector&entity=invoice&q=${inv.number}`)).options[0].id,inv.id);
  for(const entity of ['supplier','customer'])assert.ok((await read(`view=selector&entity=${entity}`)).options.length>0);
  const foreign=createSession(3);const denied=await GET(new NextRequest(`http://app.test/api/returns?view=selector&entity=payment&return_id=${r.id}`,{headers:{cookie:`repaid_session=${foreign}`}}));assert.ok([403,404].includes(denied.status));
 });
 it('enforces API branch/permission boundaries before replay and never caches financial reads',async()=>{
  const {GET,POST}=await import('../src/app/api/returns/route'),{createSession}=await import('../src/lib/auth'),{NextRequest}=await import('next/server');
  const row=db.prepare('SELECT id FROM business_returns WHERE branch_id=1 LIMIT 1').get()!,foreignToken=createSession(3),ownerToken=createSession(1);
  const denied=await GET(new NextRequest(`http://app.test/api/returns?id=${row.id}`,{headers:{cookie:`repaid_session=${foreignToken}`}}));assert.ok([403,404].includes(denied.status));assert.equal((await denied.json()).document,undefined);
  const forbidden=await GET(new NextRequest('http://app.test/api/returns?view=statement&type=customer&party_id=1&branch_id=1',{headers:{cookie:`repaid_session=${foreignToken}`}}));assert.ok([403,404].includes(forbidden.status));
  const visible=await GET(new NextRequest(`http://app.test/api/returns?id=${row.id}`,{headers:{cookie:`repaid_session=${ownerToken}`}}));assert.equal(visible.status,200);assert.equal(visible.headers.get('cache-control'),'no-store');
  const malformed=await POST(new NextRequest('http://app.test/api/returns',{method:'POST',headers:{origin:'http://app.test','content-type':'application/json',cookie:`repaid_session=${ownerToken}`},body:JSON.stringify({action:'__proto__'})}));assert.equal(malformed.status,400);
 });
});
