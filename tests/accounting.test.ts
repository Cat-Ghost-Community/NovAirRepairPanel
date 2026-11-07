import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import type { Session } from "../src/lib/auth";

const directory=fs.mkdtempSync(path.join(os.tmpdir(),"repaid-ledger-"));
process.env.REPAID_DATA_DIR=directory;
let { createJournal, createPeriod, initializeChart, postJournal, reverseJournal, setPeriodState, trialBalance, verifyLedger } = {} as typeof import("../src/lib/accounting");
let db: ReturnType<typeof import("../src/lib/db/schema").getDb>;
let sequence=0;
const owner={user:{id:1,name:"مالک",email:"owner@test",role:"owner",branch_id:1,avatar_color:"blue"}} as Session;
const accountant={user:{id:2,name:"حسابدار",email:"accountant@test",role:"accountant",branch_id:2,avatar_color:"blue"}} as Session;
const input=(amount=100,branch=1)=>({branch_id:branch,posting_date:"2026-10-24",memo:"ثبت مستقل آزمون",event_key:`test-${++sequence}`,
  source_type:"manual",source_id:String(sequence),lines:[{account_code:"1000",debit:amount},{account_code:"4010",credit:amount}]});
before(async()=>{
  const {getDb,DB_PATH}=await import("../src/lib/db/schema");
  assert.equal(DB_PATH,path.join(directory,"repaid.db"));
  ({ createJournal, createPeriod, initializeChart, postJournal, reverseJournal, setPeriodState, trialBalance, verifyLedger } = await import("../src/lib/accounting"));
  db=getDb();
  db.exec(`INSERT INTO branches(id,name,code) VALUES(1,'یک','B1'),(2,'دو','B2');
    INSERT INTO users(id,name,email,password_hash,role,branch_id) VALUES(1,'مالک','owner@test','x','owner',1),(2,'حسابدار','accountant@test','x','accountant',2),(3,'تأییدکننده','approver@test','x','owner',1);
    INSERT INTO customers(id,first_name,branch_id) VALUES(1,'مشتری مستقل',1);
    INSERT INTO settings(key,value) VALUES('vat_enabled','0'),('tax_rate','0'),('duty_rate','0'),('round_to','0');`);
  initializeChart(db,owner);
  createPeriod(db,owner,{name:"دوره آزمون",start_date:"2026-01-01",end_date:"2026-12-31"});
});
after(()=>{db?.close();fs.rmSync(directory,{recursive:true,force:true});});

describe("authoritative double-entry foundation against SQLite",()=>{
  it("rejects unbalanced, fractional, overflowing and invalid-date journals before persistence",()=>{
    const before=db.prepare("SELECT COUNT(*) n FROM accounting_journals").get()!.n;
    assert.throws(()=>createJournal(db,owner,{...input(),lines:[{account_code:"1000",debit:100},{account_code:"4010",credit:99}]}),/برابر/);
    assert.throws(()=>createJournal(db,owner,input(0.5)),/صحیح/);
    assert.throws(()=>createJournal(db,owner,{...input(),posting_date:"2026-02-30"}),/تاریخ/);
    assert.throws(()=>createJournal(db,owner,{...input(),lines:[{account_code:"1000",debit:Number.MAX_SAFE_INTEGER},{account_code:"1000",debit:1},{account_code:"4010",credit:Number.MAX_SAFE_INTEGER}]}),/محدوده/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM accounting_journals").get()!.n,before);
  });
  it("posts exactly once, binds the source payload and protects immutable monetary history in SQL",()=>{
    const body=input(1250),draft=createJournal(db,owner,body);
    assert.equal(createJournal(db,owner,body).id,draft.id);
    assert.throws(()=>createJournal(db,owner,{...body,memo:"different"}),/محتوای متفاوت/);
    assert.equal(postJournal(db,owner,draft.id).state,"posted");
    assert.equal(postJournal(db,owner,draft.id).duplicate,true);
    assert.throws(()=>db.prepare("UPDATE accounting_lines SET debit=1200 WHERE journal_id=? AND debit>0").run(draft.id),/immutable/);
    assert.throws(()=>db.prepare("DELETE FROM accounting_lines WHERE journal_id=?").run(draft.id),/immutable/);
    assert.throws(()=>db.prepare("UPDATE accounting_journals SET memo='tamper' WHERE id=?").run(draft.id),/immutable/);
    assert.throws(()=>db.prepare("DELETE FROM accounting_journals WHERE id=?").run(draft.id),/cannot be deleted/);
    assert.throws(()=>db.exec("UPDATE accounting_accounts SET classification='expense' WHERE code='1000'"),/immutable/);
    assert.equal(verifyLedger(db).valid,true);
  });
  it("protects periods, reverses with exact opposite lines and retains original evidence",()=>{
    const draft=createJournal(db,owner,input(300));
    assert.throws(()=>setPeriodState(db,owner,1,"closed","بررسی"),/پیش‌نویس/);
    postJournal(db,owner,draft.id);
    setPeriodState(db,owner,1,"closed","تأیید پایان دورهٔ آزمون");
    assert.throws(()=>createJournal(db,owner,input()),/دورهٔ باز/);
    assert.throws(()=>reverseJournal(db,owner,draft.id,"2026-10-25","اصلاح"),/دورهٔ باز/);
    setPeriodState(db,owner,1,"open","بازگشایی مصوب آزمون");
    const reversal=reverseJournal(db,owner,draft.id,"2026-10-25","اصلاح معتبر");
    assert.equal(reverseJournal(db,owner,draft.id,"2026-10-25","اصلاح معتبر").id,reversal.id);
    assert.throws(()=>reverseJournal(db,owner,draft.id,"2026-10-25","دلیل متفاوت"),/مشخصات دیگری/);
    assert.equal(db.prepare("SELECT state FROM accounting_journals WHERE id=?").get(draft.id)!.state,"reversed");
    assert.deepEqual(db.prepare("SELECT account_code,debit,credit FROM accounting_lines WHERE journal_id=? ORDER BY position").all(reversal.id).map(l=>({...l})),[
      {account_code:"1000",debit:0,credit:300},{account_code:"4010",debit:300,credit:0}]);
    assert.equal(verifyLedger(db).valid,true);
  });
  it("enforces branch permissions and exact consolidated trial-balance reconciliation",()=>{
    const second=createJournal(db,owner,input(700,2));postJournal(db,owner,second.id);
    assert.throws(()=>postJournal(db,accountant,1),/یافت نشد|اجازه/);
    assert.throws(()=>trialBalance(db,accountant,{branch_id:1,to:"2026-12-31"}),/شعبهٔ دیگر/);
    const first=trialBalance(db,owner,{branch_id:1,to:"2026-12-31"});
    const branch2=trialBalance(db,owner,{branch_id:2,to:"2026-12-31"});
    const all=trialBalance(db,owner,{to:"2026-12-31"});
    assert.equal(first.balanced,true);assert.equal(branch2.balanced,true);assert.equal(all.balanced,true);
    assert.equal(all.debit,first.debit+branch2.debit);assert.equal(all.credit,first.credit+branch2.credit);
    assert.equal(first.rows.find(r=>r.code==="1000")!.balance,1250);
    assert.equal(branch2.rows.find(r=>r.code==="1000")!.balance,700);
  });
  it("rolls posting back when audit persistence fails",()=>{
    const draft=createJournal(db,owner,input(90));
    db.exec("CREATE TRIGGER fail_ledger_audit BEFORE INSERT ON audit_logs WHEN NEW.action='post' AND NEW.entity='accounting_journal' BEGIN SELECT RAISE(ABORT,'injected failure'); END");
    assert.throws(()=>postJournal(db,owner,draft.id),/injected failure/);
    assert.equal(db.prepare("SELECT state FROM accounting_journals WHERE id=?").get(draft.id)!.state,"draft");
    db.exec("DROP TRIGGER fail_ledger_audit");postJournal(db,owner,draft.id);
    assert.equal(verifyLedger(db).valid,true);
  });
  it("rejects direct unbalanced SQL posting and overlapping periods",()=>{
    const draft=createJournal(db,owner,input(100));
    db.prepare("UPDATE accounting_lines SET debit=99 WHERE journal_id=? AND debit=100").run(draft.id);
    assert.throws(()=>postJournal(db,owner,draft.id),/تراز/);
    assert.throws(()=>db.prepare("UPDATE accounting_journals SET state='posted',posted_by=1,posted_at='now',digest=?,posted_sequence=900,previous_hash='' WHERE id=?").run("a".repeat(64),draft.id),/not balanced/);
    assert.throws(()=>db.prepare("UPDATE accounting_journals SET state='reversed' WHERE id=?").run(draft.id),/Only posted/);
    assert.throws(()=>createPeriod(db,owner,{name:"همپوشان",start_date:"2026-12-01",end_date:"2027-01-01"}),/هم‌پوشان/);
  });
  it("records immutable real invoice/receipt events and posts exact reviewed recognition and settlement",async()=>{
    const {createInvoice}=await import("../src/lib/invoice");
    const {createCustomerReceipt}=await import("../src/lib/customer-payments");
    const {reviewFinancialEvent}=await import("../src/lib/accounting-events");
    const {financialStatements,generalLedger}=await import("../src/lib/accounting");
    const invoice=createInvoice(owner,{type:"sale",customer_id:1,confirm:true,items:[{kind:"labor",name:"خدمت",qty:1,unit_price:1000}]});
    const receipt1=createCustomerReceipt(db,owner,{invoice_id:invoice.id,amount:400,method:"cash"},1);
    const receipt2=createCustomerReceipt(db,owner,{invoice_id:invoice.id,amount:600,method:"cash"},1);
    const eventId=(kind:string,id:number)=>Number(db.prepare("SELECT id FROM accounting_events WHERE source_type=? AND source_id=? AND event_type=?").get(kind,String(id),kind==="invoice"?"confirm":"receipt")!.id);
    const before=financialStatements(db,owner,{from:"2026-01-01",to:"2026-12-31"});
    assert.equal(db.prepare("SELECT paid,status FROM invoices WHERE id=?").get(invoice.id)!.paid,1000);
    const reason="سیاست تعهدی صریح سناریوی آزمون؛ درآمد با فاکتور و تسویه با دریافت";
    const recognized=reviewFinancialEvent(db,owner,eventId("invoice",invoice.id),{posting_date:"2026-10-24",reason,lines:[{account_code:"1100",debit:1000},{account_code:"4010",credit:1000}]});
    assert.equal(reviewFinancialEvent(db,owner,eventId("invoice",invoice.id),{posting_date:"2026-10-24",reason,lines:[{account_code:"1100",debit:1000},{account_code:"4010",credit:1000}]}).journal_id,recognized.journal_id);
    for(const [id,amount] of [[receipt1.id,400],[receipt2.id,600]])reviewFinancialEvent(db,owner,eventId("payment",id),{posting_date:"2026-10-24",reason,lines:[{account_code:"1000",debit:amount},{account_code:"1100",credit:amount}]});
    assert.equal(db.prepare("SELECT customer_id FROM accounting_lines WHERE journal_id=? AND account_code='1100'").get(recognized.journal_id)!.customer_id,1);
    const after=financialStatements(db,owner,{from:"2026-01-01",to:"2026-12-31"});
    assert.equal(after.revenue-before.revenue,1000);assert.equal(after.profit-before.profit,1000);assert.equal(after.assets-before.assets,1000);
    assert.equal(after.balanceSheetBalanced,true);
    const ledger=generalLedger(db,owner,{account_code:"1100",from:"2026-01-01",to:"2026-12-31",limit:1});
    assert.equal(ledger.rows[0].balance,1000);assert.ok(ledger.next);
    assert.equal(verifyLedger(db).valid,true);
    assert.throws(()=>db.prepare("UPDATE accounting_events SET payload_json='{}' WHERE id=?").run(eventId("payment",receipt1.id)),/immutable/);
    const unposted=createCustomerReceipt(db,owner,{customer_id:1,amount:20,method:"cash"},1);
    assert.throws(()=>reviewFinancialEvent(db,owner,eventId("payment",unposted.id),{posting_date:"2026-10-24",reason,lines:[{account_code:"1000",debit:19},{account_code:"2010",credit:19}]}),/مبلغ کنترلی/);
  });
  it("requires independent approval, verified restored rehearsal and unchanged evidence for historical cache correction",async()=>{
    const {proposeCacheCorrection,approveCacheCorrection,rehearseCacheCorrection,applyCacheCorrection}=await import("../src/lib/financial-corrections");
    const approver={user:{...owner.user,id:3,email:"approver@test"}};
    const id=Number(db.prepare("INSERT INTO invoices(number,type,customer_id,branch_id,status,total,paid) VALUES('CACHE-REVIEW','sale',1,1,'cancelled',1000,300)").run().lastInsertRowid);
    const proposal=proposeCacheCorrection(db,owner,id,"تطبیق مانده با مدارک قطعی سناریوی مستقل");
    assert.throws(()=>approveCacheCorrection(db,owner,proposal.id),/خودش/);
    assert.throws(()=>applyCacheCorrection(db,approver,proposal.id),/تأیید مستقل/);
    approveCacheCorrection(db,approver,proposal.id);
    const rehearsal=await rehearseCacheCorrection(db,approver,proposal.id);
    assert.equal(rehearsal.status,"rehearsed");assert.equal(db.prepare("SELECT paid FROM invoices WHERE id=?").get(id)!.paid,300);
    assert.equal((await rehearseCacheCorrection(db,approver,proposal.id)).backup_sha256,rehearsal.backup_sha256);
    applyCacheCorrection(db,approver,proposal.id);
    assert.equal(applyCacheCorrection(db,approver,proposal.id).duplicate,true);
    assert.deepEqual({...db.prepare("SELECT total,paid,status FROM invoices WHERE id=?").get(id)},{total:1000,paid:0,status:"cancelled"});
    const proof=db.prepare("SELECT backup_path,backup_sha256,rehearsal_json FROM financial_corrections WHERE id=?").get(proposal.id)!;
    assert.equal(fs.existsSync(String(proof.backup_path)),true);assert.equal(JSON.parse(String(proof.rehearsal_json)).restored,true);
    assert.throws(()=>db.prepare("UPDATE financial_corrections SET expected_paid=999 WHERE id=?").run(proposal.id),/immutable/);
    assert.throws(()=>db.prepare("DELETE FROM financial_corrections WHERE id=?").run(proposal.id),/cannot be deleted/);
  });
  it("rejects stale correction approval evidence without touching changed transactions",async()=>{
    const {proposeCacheCorrection,approveCacheCorrection,rehearseCacheCorrection}=await import("../src/lib/financial-corrections");
    const {createCustomerReceipt}=await import("../src/lib/customer-payments");
    const approver={user:{...owner.user,id:3}};
    const id=Number(db.prepare("INSERT INTO invoices(number,type,customer_id,branch_id,status,total,paid) VALUES('STALE-REVIEW','sale',1,1,'issued',1000,300)").run().lastInsertRowid);
    const proposal=proposeCacheCorrection(db,owner,id,"پیشنهاد مستقل که پس از تأیید منبع آن تغییر می‌کند");
    approveCacheCorrection(db,approver,proposal.id);
    createCustomerReceipt(db,owner,{invoice_id:id,amount:10,method:"cash"},1);
    await assert.rejects(rehearseCacheCorrection(db,approver,proposal.id),/مدارک مالی/);
    assert.equal(db.prepare("SELECT paid FROM invoices WHERE id=?").get(id)!.paid,10);
    assert.equal(db.prepare("SELECT status FROM financial_corrections WHERE id=?").get(proposal.id)!.status,"approved");
  });
  it("approves documented commission, records partial/full payouts once and blocks changed refund evidence",async()=>{
    const {ensureDefaultStatuses}=await import("../src/lib/repair");ensureDefaultStatuses();
    const {approveCommission,recordCommissionPayment}=await import("../src/lib/commission-settlement");
    const {durableOperation}=await import("../src/lib/idempotency");
    const device=Number(db.prepare("INSERT INTO devices(customer_id,type) VALUES(1,'mobile')").run().lastInsertRowid);
    const ticket=Number(db.prepare("INSERT INTO repair_tickets(number,branch_id,customer_id,device_id,status_id,technician_id,delivered_at) VALUES('COMMISSION-TEST',1,1,?,(SELECT id FROM repair_statuses WHERE name='Delivered'),2,datetime('now'))").run(device).lastInsertRowid);
    const run=Number(db.prepare("INSERT INTO payroll_runs(user_id,earned_commission,net_payable,status,source_ticket_id) VALUES(2,1000,1000,'pending',?)").run(ticket).lastInsertRowid);
    const body={amount:400,method:"cash",payment_date:"2026-10-24",document_reference:"CASH-COM-1",confirmed:true};
    assert.throws(()=>recordCommissionPayment(db,owner,run,body),/تأیید مستند/);
    assert.throws(()=>approveCommission(db,accountant,run),/یافت نشد|اجازه/);
    approveCommission(db,owner,run);
    assert.throws(()=>recordCommissionPayment(db,owner,run,{...body,confirmed:false}),/صریح تأیید/);
    const options={actorId:1,branchId:1,operation:"test_commission",key:"commission-replay",payload:body};
    const first=durableOperation(db,options,()=>recordCommissionPayment(db,owner,run,body));
    assert.deepEqual(durableOperation(db,options,()=>recordCommissionPayment(db,owner,run,body)),first);
    assert.equal(first.status,"partially_paid");assert.equal(first.remaining,600);
    assert.throws(()=>recordCommissionPayment(db,owner,run,body),/مرجع پرداخت/);
    assert.throws(()=>recordCommissionPayment(db,owner,run,{...body,amount:601,document_reference:"CASH-COM-2"}),/مانده/);
    const final=recordCommissionPayment(db,owner,run,{...body,amount:600,document_reference:"CASH-COM-2"});
    assert.equal(final.status,"paid");assert.equal(final.remaining,0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM commission_payments WHERE run_id=?").get(run)!.n,2);
    assert.throws(()=>recordCommissionPayment(db,owner,run,{...body,document_reference:"CASH-COM-3"}),/وضعیت دستمزد/);
    const invoice=Number(db.prepare("INSERT INTO invoices(number,type,ticket_id,customer_id,branch_id,status,total) VALUES('COM-REFUND','repair',?,1,1,'issued',1000)").run(ticket).lastInsertRowid);
    const payment=Number(db.prepare("INSERT INTO payments(number,customer_id,invoice_id,ticket_id,branch_id,amount,direction,method) VALUES('COM-RECEIPT',1,?,?,1,1000,'in','cash')").run(invoice,ticket).lastInsertRowid);
    db.prepare("INSERT INTO refunds(number,payment_id,invoice_id,customer_id,branch_id,amount,method) VALUES('COM-REF',?,?,1,1,100,'cash')").run(payment,invoice);
    assert.throws(()=>recordCommissionPayment(db,owner,run,{...body,amount:1,document_reference:"CASH-COM-4"}),/اصلاح مصوب/);
    assert.equal(db.prepare("SELECT SUM(amount) n FROM commission_payments WHERE run_id=?").get(run)!.n,1000); // Never erase completed payouts.
  });
  it("serializes independent commission writers without overpaying",async()=>{
    const {approveCommission}=await import("../src/lib/commission-settlement");
    const run=Number(db.prepare("INSERT INTO payroll_runs(user_id,branch_id,base_salary,net_payable,status) VALUES(2,2,1000,1000,'pending')").run().lastInsertRowid);
    approveCommission(db,owner,run);
    const worker=(key:string)=>new Promise<{status:number}>((resolve,reject)=>{
      const child=spawn(process.execPath,["--import","tsx","scripts/financial-contention-worker.ts",String(run),key,"700","commission"],
        {env:{...process.env,REPAID_DATA_DIR:directory,FINANCIAL_TEST_MODE:"1"},windowsHide:true});
      let output="",errors="";child.stdout.on("data",data=>output+=data);child.stderr.on("data",data=>errors+=data);
      child.on("error",reject);child.on("exit",code=>{if(code)reject(new Error(errors));else try{resolve(JSON.parse(output));}catch(e){reject(e);}});
    });
    const results=await Promise.all([worker("commission-writer-one"),worker("commission-writer-two")]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
    assert.equal(db.prepare("SELECT SUM(amount) amount FROM commission_payments WHERE run_id=?").get(run)!.amount,700);
    assert.equal(db.prepare("SELECT status FROM payroll_runs WHERE id=?").get(run)!.status,"partially_paid");
    assert.throws(()=>db.prepare("UPDATE payroll_runs SET status='paid' WHERE id=?").run(run),/actual settlement documents/);
    assert.throws(()=>db.prepare("INSERT INTO commission_payments(run_id,branch_id,user_id,amount,method,payment_date,document_reference,recorded_by) VALUES(?,2,2,400,'cash','2026-10-24','SQL-OVERPAY',1)").run(run),/approved capacity/);
    assert.throws(()=>db.prepare("UPDATE payroll_runs SET net_payable=999 WHERE id=?").run(run),/auditable adjustment/);
  });
  it("serializes concurrent posting into one immutable journal and one chain position",async()=>{
    const draft=createJournal(db,owner,input(45));
    const worker=(key:string)=>new Promise<{status:number}>((resolve,reject)=>{
      const child=spawn(process.execPath,["--import","tsx","scripts/financial-contention-worker.ts",String(draft.id),key,"0","journal"],{env:{...process.env,REPAID_DATA_DIR:directory,FINANCIAL_TEST_MODE:"1"},windowsHide:true});
      let output="",errors="";child.stdout.on("data",chunk=>output+=chunk);child.stderr.on("data",chunk=>errors+=chunk);
      child.on("error",reject);child.on("exit",code=>{if(code)reject(new Error(errors));else try{resolve(JSON.parse(output));}catch(e){reject(e);}});
    });
    const results=await Promise.all([worker("journal-writer-one"),worker("journal-writer-two")]);
    assert.deepEqual(results.map(r=>r.status),[200,200]);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity='accounting_journal' AND action='post' AND entity_id=?").get(draft.id)!.n,1);
    assert.equal(verifyLedger(db).valid,true);
  });
  it("rolls back journal, posting, approval and audit together when source-event review fails",async()=>{
    const {createCustomerReceipt}=await import("../src/lib/customer-payments");const {reviewFinancialEvent}=await import("../src/lib/accounting-events");
    const receipt=createCustomerReceipt(db,owner,{customer_id:1,amount:15,method:"cash"},1);
    const event=Number(db.prepare("SELECT id FROM accounting_events WHERE event_key=?").get(`payment:${receipt.id}:receipt`)!.id);
    const before=verifyLedger(db).count,headers=db.prepare("SELECT COUNT(*) n FROM accounting_journals").get()!.n;
    db.exec("CREATE TRIGGER fail_event_approval BEFORE INSERT ON audit_logs WHEN NEW.action='approve_event' BEGIN SELECT RAISE(ABORT,'review failure'); END");
    const review={posting_date:"2026-10-24",reason:"تأیید صریحِ پیش‌دریافت بر اساس مدرک",lines:[{account_code:"1000",debit:15},{account_code:"2010",credit:15}]};
    assert.throws(()=>reviewFinancialEvent(db,owner,event,review),/review failure/);
    assert.equal(verifyLedger(db).count,before);assert.equal(verifyLedger(db).valid,true);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM accounting_journals").get()!.n,headers);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM accounting_event_reviews WHERE event_id=?").get(event)!.n,0);
    db.exec("DROP TRIGGER fail_event_approval");reviewFinancialEvent(db,owner,event,review);
    assert.equal(verifyLedger(db).count,before+1);
  });
  it("restores the actual ledger, source events, payouts and guards and detects deliberate copied-data tampering",async()=>{
    const {verifiedSnapshot}=await import("../src/lib/backup");
    const bytes=await verifiedSnapshot(db),filename=path.join(directory,"verified-ledger-restore.db");
    fs.writeFileSync(filename,bytes);const restored=new DatabaseSync(filename);
    try{
      assert.deepEqual(verifyLedger(restored),verifyLedger(db));
      assert.equal(restored.prepare("SELECT COUNT(*) n FROM accounting_events").get()!.n,db.prepare("SELECT COUNT(*) n FROM accounting_events").get()!.n);
      assert.equal(restored.prepare("SELECT SUM(amount) n FROM commission_payments").get()!.n,1700);
      assert.throws(()=>restored.exec("UPDATE accounting_lines SET debit=debit+1 WHERE id=(SELECT MIN(l.id) FROM accounting_lines l JOIN accounting_journals j ON j.id=l.journal_id WHERE j.state='posted' AND l.debit>0)"),/immutable/);
      // Simulate privileged offline tampering ONLY on the disposable restored copy.
      restored.exec("DROP TRIGGER accounting_lines_update_guard; UPDATE accounting_lines SET debit=debit+1 WHERE id=(SELECT MIN(l.id) FROM accounting_lines l JOIN accounting_journals j ON j.id=l.journal_id WHERE j.state='posted' AND l.debit>0)");
      assert.equal(verifyLedger(restored).valid,false);
      assert.equal(verifyLedger(db).valid,true);
    }finally{restored.close();}
  });
  it("edits drafts with revision guards and voids mistakes without inventing financial postings",async()=>{
    const {editJournalDraft,voidJournalDraft}=await import("../src/lib/accounting-drafts");
    const draft=createJournal(db,owner,{...input(200),lines:[{account_code:"1000",debit:200,customer_id:1},{account_code:"4010",credit:200}]});
    const oldHash=String(db.prepare("SELECT request_hash FROM accounting_journals WHERE id=?").get(draft.id)!.request_hash);
    const revision=editJournalDraft(db,owner,draft.id,{posting_date:"2026-10-24",memo:"پیش‌نویس اصلاح‌شده با حفظ تفصیلی",expected_hash:oldHash,
      lines:[{account_code:"1000",debit:250,customer_id:1},{account_code:"4010",credit:250}]});
    assert.notEqual(revision.request_hash,oldHash);
    assert.equal(db.prepare("SELECT customer_id FROM accounting_lines WHERE journal_id=? AND debit>0").get(draft.id)!.customer_id,1);
    assert.throws(()=>editJournalDraft(db,owner,draft.id,{posting_date:"2026-10-24",memo:"نسخه کهنه",expected_hash:oldHash,lines:input(10).lines}),/نسخهٔ پیش‌نویس/);
    assert.throws(()=>postJournal(db,owner,draft.id,undefined,oldHash),/نسخهٔ پیش‌نویس/);
    postJournal(db,owner,draft.id,undefined,revision.request_hash);
    assert.equal(db.prepare("SELECT SUM(debit) amount FROM accounting_lines WHERE journal_id=?").get(draft.id)!.amount,250);
    assert.throws(()=>editJournalDraft(db,owner,draft.id,{posting_date:"2026-10-24",memo:"تغییر سند نهایی",expected_hash:revision.request_hash,lines:input(1).lines}),/فقط پیش‌نویس/);
    const period=createPeriod(db,owner,{name:"دورهٔ ابطال مستقل",start_date:"2027-01-01",end_date:"2027-12-31"});
    const mistaken=createJournal(db,owner,{...input(50),posting_date:"2027-01-02"});
    const count=verifyLedger(db).count;
    voidJournalDraft(db,owner,mistaken.id,"پیش‌نویس اشتباهی بدون رویداد اقتصادی");
    assert.equal(voidJournalDraft(db,owner,mistaken.id,"پیش‌نویس اشتباهی بدون رویداد اقتصادی").duplicate,true);
    assert.throws(()=>postJournal(db,owner,mistaken.id),/باطل شده/);
    assert.throws(()=>db.prepare("DELETE FROM accounting_lines WHERE journal_id=?").run(mistaken.id),/immutable/);
    assert.throws(()=>db.prepare("UPDATE accounting_journals SET memo='tamper' WHERE id=?").run(mistaken.id),/immutable/);
    setPeriodState(db,owner,period.id,"closed","پیش‌نویس اشتباه مستند باطل شد و گردش مالی ایجاد نشد");
    assert.equal(verifyLedger(db).count,count);assert.equal(verifyLedger(db).valid,true);
  });
  it("reconciles exact customer and supplier subledgers against source documents in an isolated branch",async()=>{
    const {createInvoice,addPaymentInTx}=await import("../src/lib/invoice");const {createCustomerReceipt}=await import("../src/lib/customer-payments");
    const {reviewFinancialEvent}=await import("../src/lib/accounting-events");const {reconcileSubledgers,eventCoverage}=await import("../src/lib/accounting-reports");
    db.exec("INSERT INTO branches(id,name,code) VALUES(3,'تطبیق مستقل','B3'); INSERT INTO customers(id,first_name,branch_id) VALUES(2,'مشتری مستقل تطبیق',3); INSERT INTO suppliers(id,name) VALUES(1,'تأمین‌کننده مستقل');");
    const sale=createInvoice(owner,{type:"sale",branch_id:3,customer_id:2,confirm:true,items:[{kind:"labor",name:"خدمت تطبیق",qty:1,unit_price:1000}]});
    const receipt=createCustomerReceipt(db,owner,{invoice_id:sale.id,amount:400,method:"cash"},3);
    const purchase=createInvoice(owner,{type:"purchase",branch_id:3,supplier_id:1,confirm:true,items:[{kind:"other",name:"خرید خدمت مستقل",qty:1,unit_price:600}]});
    const payment=addPaymentInTx(db,owner,db.prepare("SELECT * FROM invoices WHERE id=?").get(purchase.id),{amount:100,method:"cash"},3);
    const post=(type:string,id:number,debit:string,credit:string,amount:number)=>{
      const event=Number(db.prepare("SELECT id FROM accounting_events WHERE event_key=?").get(`${type}:${id}:${type==="invoice"?"confirm":"receipt"}`)!.id);
      reviewFinancialEvent(db,owner,event,{posting_date:"2026-10-24",reason:"شناسایی تعهدی صریح سناریوی مستقل تطبیق",lines:[{account_code:debit,debit:amount},{account_code:credit,credit:amount}]});
    };
    post("invoice",sale.id,"1100","4010",1000);post("payment",receipt.id,"1000","1100",400);
    post("invoice",purchase.id,"6000","2000",600);post("payment",payment.id,"2000","1000",100);
    const report=reconcileSubledgers(db,owner,3);
    assert.deepEqual(report.customers,[{id:2,operational:600,ledger:600,difference:0}]);
    assert.deepEqual(report.suppliers,[{id:1,operational:500,ledger:500,difference:0}]);
    assert.deepEqual(report.inventory,{operational:0,ledger:0,difference:0});
    assert.equal(report.requiresReview,false);assert.equal(report.coverage.missingSourceCount,0);
    assert.throws(()=>reconcileSubledgers(db,accountant,3),/شعبهٔ دیگر/);
    db.prepare("INSERT INTO payments(number,customer_id,invoice_id,branch_id,amount,method,direction) VALUES('BYPASSED-CAPTURE',2,?,3,5,'cash','in')").run(sale.id);
    const gaps=eventCoverage(db,3);assert.equal(gaps.missing.find(r=>r.source==="payment")!.count,1);
    assert.equal(reconcileSubledgers(db,owner,3).customers[0].difference,-5);
  });
  it("protects journal inspection and API replay across financial branches",async()=>{
    const {GET,POST}=await import("../src/app/api/accounting/route");const {NextRequest}=await import("next/server");
    const {createSession}=await import("../src/lib/auth");const ownerToken=createSession(1),staffToken=createSession(2);
    const url="http://app.test/api/accounting";
    assert.equal((await GET(new NextRequest(url))).status,401);
    const staffRequest=new NextRequest(`${url}?view=journal&journal_id=1`,{headers:{cookie:`repaid_session=${staffToken}`}});
    assert.equal((await GET(staffRequest)).status,404);
    const inspected=await GET(new NextRequest(`${url}?view=journal&journal_id=1`,{headers:{cookie:`repaid_session=${ownerToken}`}}));
    assert.equal(inspected.status,200);assert.equal((await inspected.json()).lines.length,2);
    const draft=createJournal(db,owner,input(60)),second=createJournal(db,owner,input(61));
    const request=(id:number)=>new NextRequest(url,{method:"POST",headers:{origin:"http://app.test","content-type":"application/json","idempotency-key":"api-journal-replay",cookie:`repaid_session=${ownerToken}`},body:JSON.stringify({action:"post",id,expected_hash:db.prepare("SELECT request_hash FROM accounting_journals WHERE id=?").get(id)!.request_hash})});
    assert.equal((await POST(request(draft.id))).status,200);
    assert.equal((await POST(request(draft.id))).status,200);
    assert.equal((await POST(request(second.id))).status,409);
    assert.equal(db.prepare("SELECT state FROM accounting_journals WHERE id=?").get(second.id)!.state,"draft");
  });
  it("paginates and filters an event queue beyond fifty real financial documents",async()=>{
    const {createCustomerReceipt}=await import("../src/lib/customer-payments");const {GET}=await import("../src/app/api/accounting/route");
    const {NextRequest}=await import("next/server"),{createSession}=await import("../src/lib/auth");
    let last=0;for(let n=0;n<55;n++)last=createCustomerReceipt(db,owner,{customer_id:1,amount:1,method:"cash"},1).id;
    const token=createSession(1),get=async(query:string)=>{const response=await GET(new NextRequest(`http://app.test/api/accounting?${query}`,{headers:{cookie:`repaid_session=${token}`}}));assert.equal(response.status,200);return response.json();};
    const first=await get("event_source=payment");assert.equal(first.events.length,50);assert.ok(first.nextEvent);
    const second=await get(`event_source=payment&events_after=${first.nextEvent}`);
    assert.ok(second.events.length>0);assert.ok(second.events.every((e:{id:number})=>e.id>first.nextEvent));
    const filtered=await get(`event_source=payment&event_source_id=${last}`);
    assert.equal(filtered.events.length,1);assert.equal(filtered.events[0].source_id,String(last));
  });
  it("keeps approved financial branch ownership when an employee moves",async()=>{
    const {approveCommission,commissionEvidence,recordCommissionPayment}=await import("../src/lib/commission-settlement");
    db.exec("INSERT INTO users(id,name,email,password_hash,role,branch_id) VALUES(4,'انتقال شعبه','moved@test','x','technician',1)");
    const unknown=Number(db.prepare("INSERT INTO payroll_runs(user_id,base_salary,net_payable,status) VALUES(4,100,100,'pending')").run().lastInsertRowid);
    assert.throws(()=>approveCommission(db,owner,unknown),/انتساب تاریخی/);
    const run=Number(db.prepare("INSERT INTO payroll_runs(user_id,branch_id,base_salary,net_payable,status) VALUES(4,1,1000,1000,'pending')").run().lastInsertRowid);
    approveCommission(db,owner,run);
    db.exec("UPDATE users SET branch_id=2 WHERE id=4");
    assert.equal(commissionEvidence(db,run).run.branch_id,1);
    assert.throws(()=>db.prepare("UPDATE payroll_runs SET branch_id=2 WHERE id=?").run(run),/Financial branch/);
    const paid=recordCommissionPayment(db,owner,run,{amount:100,method:"cash",payment_date:"2026-10-24",document_reference:"MOVED-EMPLOYEE-PAYMENT",confirmed:true},"1");
    assert.equal(paid.paid,100);
    assert.equal(db.prepare("SELECT branch_id FROM commission_payments WHERE id=?").get(paid.payment_id)!.branch_id,1);
    const {GET}=await import("../src/app/api/payroll/route");const {NextRequest}=await import("next/server"),{createSession}=await import("../src/lib/auth");
    const response=await GET(new NextRequest("http://app.test/api/payroll?user_id=4",{headers:{cookie:`repaid_session=${createSession(1)}; repaid_branch=2`}}));
    assert.equal(response.status,200);assert.equal((await response.json()).runs.length,0);
  });
});
