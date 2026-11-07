import { it, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const directory=fs.mkdtempSync(path.join(os.tmpdir(),"repaid-migrations-"));
process.env.REPAID_DATA_DIR=directory;
let initialized: DatabaseSync | undefined;
let fixture: DatabaseSync | undefined;
after(()=>{ fixture?.close(); initialized?.close(); fs.rmSync(directory,{recursive:true,force:true}); });

it("rolls back failed additive migrations, preserves records and allows a verified retry",async()=>{
  const {DDL,getDb}=await import("../src/lib/db/schema");
  fixture=new DatabaseSync(path.join(directory,"repaid.db"));
  fixture.exec(DDL);
  const columns=fixture.prepare("PRAGMA table_info(invoices)").all();
  if(!columns.some(c=>c.name==="client_key")) fixture.exec("ALTER TABLE invoices ADD COLUMN client_key TEXT");
  fixture.exec("INSERT INTO customers(id,first_name) VALUES(1,'داده قبلی'); INSERT INTO invoices(number,customer_id,total,client_key) VALUES('OLD-1',1,100,'duplicate'),('OLD-2',1,200,'duplicate')");
  fixture.exec("INSERT INTO payroll_runs(user_id,earned_commission) VALUES(1,1234)");
  fixture.exec("INSERT INTO installments(id,customer_id,invoice_id,seq,amount,paid_amount,due_date,status,notes) VALUES(1,1,1,1,100,40,'2026-10-01','partially_paid','Original documentary evidence')");
  const installmentBefore=fixture.prepare('SELECT * FROM installments WHERE id=1').get()!;
  fixture.exec("INSERT INTO checks(number,kind,amount,due_date,status,invoice_id) VALUES('LEGACY','received',150,'2026-01-01','passed',1)");
  assert.throws(()=>getDb(),/UNIQUE constraint/);
  assert.equal(fixture.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accounting_journals'").get(),undefined);
  for(const table of ['accounting_recognition_policies','accounting_automatic_postings','accounting_opening_documents','accounting_opening_event_links','business_returns','business_return_lines','credit_notes','credit_note_lines','return_settlements','installment_schedules','installment_schedule_terms','installment_allocations','installment_allocation_reversals'])
    assert.equal(fixture.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table),undefined);
  assert.equal(fixture.prepare("PRAGMA table_info(payroll_runs)").all().some(c=>c.name==="source_ticket_id"),false);
  assert.equal(fixture.prepare("SELECT earned_commission FROM payroll_runs").get()?.earned_commission,1234);
  // Resolve only the test fixture collision; customer data is never modified by the migrator.
  fixture.exec("UPDATE invoices SET client_key='resolved' WHERE number='OLD-2'");
  fixture.close();
  fixture=undefined;
  initialized=getDb();
  assert.equal(initialized.prepare("SELECT COUNT(*) n FROM accounting_journals").get()?.n,0);
  for(const table of ['accounting_recognition_policies','accounting_automatic_postings','accounting_opening_documents','accounting_opening_event_links','business_returns','business_return_lines','credit_notes','credit_note_lines','return_settlements','installment_schedules','installment_schedule_terms','installment_allocations','installment_allocation_reversals'])
    assert.equal(initialized.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n,0);
  assert.equal(initialized.prepare("PRAGMA table_info(payroll_runs)").all().some(c=>c.name==="source_ticket_id"),true);
  assert.equal(initialized.prepare("SELECT earned_commission FROM payroll_runs").get()?.earned_commission,1234);
  const installmentAfter=initialized.prepare('SELECT * FROM installments WHERE id=1').get()!;
  for(const [key,value] of Object.entries(installmentBefore))assert.equal(installmentAfter[key],value,`original installment ${key} preserved`);
  const effective=initialized.prepare('SELECT * FROM effective_installments WHERE id=1').get()!;
  assert.equal(effective.legacy_review,1);assert.equal(effective.stored_paid_amount,40);assert.equal(effective.paid_amount,0);
  assert.throws(()=>initialized!.prepare('UPDATE installments SET paid_amount=100 WHERE id=1').run(),/immutable/);
  const legacyCheck = initialized.prepare("SELECT amount,status,payment_id FROM checks WHERE number='LEGACY'").get();
  assert.equal(legacyCheck?.amount,150);
  assert.equal(legacyCheck?.status,"passed");
  assert.equal(legacyCheck?.payment_id,null); // Historical links are never guessed.
  assert.equal(getDb(),initialized);
  assert.equal(initialized.prepare("PRAGMA integrity_check").get()?.integrity_check,"ok");
});

it('upgrades only empty legacy credit schemas and preserves populated financial history without automatic rebuild',async()=>{
  const {DDL}=await import('../src/lib/db/schema'),{ACCOUNTING_DDL}=await import('../src/lib/accounting-schema'),{RETURNS_DDL}=await import('../src/lib/returns-schema');
  const {legacyCreditUniqueness,prepareEmptyCreditReissues}=await import('../src/lib/credit-reissue-schema');
  const legacy=new DatabaseSync(':memory:');
  try{
    legacy.exec(DDL);legacy.exec(ACCOUNTING_DDL);legacy.exec(RETURNS_DDL);
    legacy.exec('CREATE UNIQUE INDEX legacy_one_credit ON credit_notes(return_id); CREATE UNIQUE INDEX legacy_one_credit_line ON credit_note_lines(return_line_id); BEGIN IMMEDIATE');
    assert.equal(legacyCreditUniqueness(legacy),true);assert.equal(prepareEmptyCreditReissues(legacy),true);assert.equal(legacyCreditUniqueness(legacy),false);
    legacy.exec('ROLLBACK');assert.equal(legacyCreditUniqueness(legacy),true,'an interrupted empty-schema upgrade restores the exact former uniqueness');
    legacy.exec(`INSERT INTO branches(id,name,code) VALUES(1,'Legacy branch','LEGACY');INSERT INTO users(id,name,email,password_hash,role,branch_id) VALUES(1,'Legacy owner','legacy@test','x','owner',1);
      INSERT INTO customers(id,first_name,branch_id) VALUES(1,'Legacy customer',1);INSERT INTO invoices(id,number,customer_id,total) VALUES(1,'LEGACY-CREDIT',1,100);
      INSERT INTO business_returns(id,number,invoice_id,branch_id,kind,reason,delivery_reference,requested_by) VALUES(1,'OLD-RETURN',1,1,'customer','Original preserved evidence','Original actual delivery',1);
      INSERT INTO credit_notes(id,number,return_id,invoice_id,branch_id,customer_id,amount,net_amount,reason,evidence_reference,requested_by) VALUES(1,'OLD-CREDIT',1,1,1,1,100,100,'Original preserved reason','Original credit evidence',1); BEGIN IMMEDIATE`);
    assert.equal(prepareEmptyCreditReissues(legacy),false);assert.equal(legacyCreditUniqueness(legacy),true);assert.equal(legacy.prepare('SELECT amount,reason FROM credit_notes WHERE id=1').get()!.amount,100);
    legacy.exec('COMMIT');assert.equal(legacy.prepare('SELECT reason FROM credit_notes WHERE id=1').get()!.reason,'Original preserved reason');
  }finally{legacy.close();}
});
