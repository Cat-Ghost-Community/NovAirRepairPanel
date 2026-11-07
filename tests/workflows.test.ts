import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "repaid-workflows-"));
process.env.REPAID_DATA_DIR = directory;
process.env.REPAID_DEMO_MODE = "0";
let db: ReturnType<typeof import("../src/lib/db/schema").getDb>;
let ownerToken: string;
let technicianToken: string;
let part: number;
let ticket: number;
let customer: number;

function request(url: string, body: unknown, token = ownerToken) {
  return new NextRequest("http://app.test" + url, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID(), origin: "http://app.test", cookie: `repaid_session=${token}` }, body: JSON.stringify(body) });
}
const count = (table: string) => Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n);

describe("integrated repair financial settlement", () => {
  it("allocates net refunded advances and pending cheques without marking uncollected money paid", async () => {
    const { POST: pay } = await import("../src/app/api/payments/route");
    const { POST: refund } = await import("../src/app/api/payments/refund/route");
    const { POST: issue } = await import("../src/app/api/repairs/[id]/invoice/route");
    const dev = db.prepare("SELECT device_id FROM repair_tickets WHERE id=?").get(ticket)!.device_id;
    const id = Number(db.prepare("INSERT INTO repair_tickets(number,branch_id,customer_id,device_id,status_id) VALUES('R-ADVANCES',1,?,?,(SELECT id FROM repair_statuses WHERE name='New'))").run(customer,dev).lastInsertRowid);
    db.prepare("INSERT INTO ticket_items(ticket_id,kind,name,qty,unit_price,consumed) VALUES(?,'labor','اجرت',1,1000,1)").run(id);
    const receipt = await pay(request('/api/payments',{ticket_id:id,customer_id:customer,amount:300,method:'cash'}));
    assert.equal(receipt.status,200);
    const paymentId = (await receipt.json()).id;
    assert.equal((await refund(request('/api/payments/refund',{payment_id:paymentId,amount:100}))).status,200);
    assert.equal((await pay(request('/api/payments',{ticket_id:id,customer_id:customer,amount:400,method:'check',cheque:{due_date:'2027-01-01'}}))).status,200);
    const result = await issue(request(`/api/repairs/${id}/invoice`,{}),{params:Promise.resolve({id:String(id)})});
    assert.equal(result.status,200);
    const invoice = (await result.json()).id;
    assert.equal(db.prepare("SELECT paid FROM invoices WHERE id=?").get(invoice)!.paid,200);
    assert.equal(db.prepare("SELECT invoice_id FROM refunds WHERE payment_id=?").get(paymentId)!.invoice_id,invoice);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM checks WHERE invoice_id=? AND status='in_hand'").get(invoice)!.n,1);
    assert.equal((await pay(request('/api/payments',{ticket_id:id,customer_id:customer,amount:401,method:'cash'}))).status,400);
    assert.equal((await pay(request('/api/payments',{ticket_id:id,customer_id:customer,amount:400,method:'cash'}))).status,200);
    assert.equal(db.prepare("SELECT paid FROM invoices WHERE id=?").get(invoice)!.paid,600);
  });
  it("allocates an original deposit, consumes stock once, invoices once and settles through delivery", async () => {
    const { POST: items } = await import("../src/app/api/repairs/[id]/items/route");
    const { POST: settle } = await import("../src/app/api/repairs/[id]/settle/route");
    const { POST: issue } = await import("../src/app/api/repairs/[id]/invoice/route");
    const { transitionTicket } = await import("../src/lib/repair");
    const { moveStock, getTotalQty } = await import("../src/lib/inventory");
    const part = Number(db.prepare("INSERT INTO parts(name,sku,price,purchase_price,avg_cost) VALUES('قطعه مستقل','REPAIR-INTEGRATED',500,100,100)").run().lastInsertRowid);
    const dev = db.prepare("SELECT device_id FROM repair_tickets WHERE id=?").get(ticket)!.device_id;
    db.exec("INSERT INTO payroll_profiles(user_id,salary_type,percent_repair) VALUES(3,'mixed',25)");
    const id = Number(db.prepare("INSERT INTO repair_tickets(number,branch_id,customer_id,device_id,status_id,technician_id) VALUES('R-INTEGRATED',1,?,?,(SELECT id FROM repair_statuses WHERE name='New'),3)").run(customer,dev).lastInsertRowid);
    const params = { params: Promise.resolve({id:String(id)}) };
    moveStock({part_id:part,qty:2,type:"purchase",unit_cost:100,branch_id:1});
    const stock = getTotalQty(part);
    const deposit = await settle(request(`/api/repairs/${id}/settle`,{amount:200,method:"cash",mark_delivered:false}),params);
    assert.equal(deposit.status,200);
    const paymentId = (await deposit.json()).payment_id;
    const body = { items:[{kind:"part",ref_id:part,qty:1},{kind:"labor",name:"اجرت مستقل",qty:1,unit_price:500}] };
    const req = () => new NextRequest(`http://app.test/api/repairs/${id}/items`, {method:"POST",headers:{origin:"http://app.test","content-type":"application/json","idempotency-key":"repair-batch-replay",cookie:`repaid_session=${ownerToken}`},body:JSON.stringify(body)});
    assert.equal((await items(req(),params)).status,200);
    assert.equal((await items(req(),params)).status,200);
    assert.equal(getTotalQty(part),stock-1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM ticket_items WHERE ticket_id=?").get(id)!.n,2);
    const invoice = await issue(request(`/api/repairs/${id}/invoice`,{}),params);
    assert.equal(invoice.status,200);
    const invoiceId = (await invoice.json()).id;
    assert.equal(db.prepare("SELECT invoice_id FROM payments WHERE id=?").get(paymentId)!.invoice_id,invoiceId);
    assert.deepEqual(db.prepare("SELECT total,paid,status FROM invoices WHERE id=?").get(invoiceId),Object.assign(Object.create(null),{total:1000,paid:200,status:"partially_paid"}));
    assert.equal(getTotalQty(part),stock-1);
    const before = count("payments");
    const invalid = await settle(request(`/api/repairs/${id}/settle`,{amount:800,method:"cash",mark_delivered:true}),params);
    assert.equal(invalid.status,400);
    assert.equal(count("payments"),before); // Failed delivery rolls the receipt back.
    for (const status of ["Received","Diagnosing","Waiting for Customer Approval","Approved","In Repair","Quality Control","Ready for Pickup"]) transitionTicket(id,status,1);
    const finalBody = {amount:800,method:"cash",mark_delivered:true};
    const finalReq = () => new NextRequest(`http://app.test/api/repairs/${id}/settle`,{method:"POST",headers:{origin:"http://app.test","content-type":"application/json","idempotency-key":"repair-final-replay",cookie:`repaid_session=${ownerToken}`},body:JSON.stringify(finalBody)});
    assert.equal((await settle(finalReq(),params)).status,200);
    assert.equal((await settle(finalReq(),params)).status,200);
    assert.equal(count("payments"),before+1);
    assert.equal(db.prepare("SELECT paid FROM invoices WHERE id=?").get(invoiceId)!.paid,1000);
    assert.equal(db.prepare("SELECT s.name FROM repair_tickets t JOIN repair_statuses s ON s.id=t.status_id WHERE t.id=?").get(id)!.name,"Delivered");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity='invoice' AND entity_id=? AND action='allocate_advances'").get(invoiceId)!.n,1);
    // Explicit test-only accrual decisions; production automatic policy remains unapproved.
    const {getSessionByToken}=await import("../src/lib/auth");
    const session=getSessionByToken(ownerToken)!;
    const {initializeChart,createPeriod,trialBalance,financialStatements,verifyLedger}=await import("../src/lib/accounting");
    const {reviewFinancialEvent}=await import("../src/lib/accounting-events");
    const {approveCommission,recordCommissionPayment}=await import("../src/lib/commission-settlement");
    initializeChart(db,session);createPeriod(db,session,{name:"سناریوی مالی مستقل",start_date:"2026-01-01",end_date:"2026-12-31"});
    const post=(eventId:number,debit:string,credit:string,amount:number)=>{
      const result=reviewFinancialEvent(db,session,eventId,{posting_date:"2026-10-24",reason:"تصمیم تعهدی صریح و مستقل سناریوی پذیرش مالی",lines:[{account_code:debit,debit:amount},{account_code:credit,credit:amount}]});
      assert.deepEqual(db.prepare("SELECT account_code,debit,credit FROM accounting_lines WHERE journal_id=? ORDER BY position").all(result.journal_id).map(l=>({...l})),[
        {account_code:debit,debit:amount,credit:0},{account_code:credit,debit:0,credit:amount}]);
    };
    const event=(type:string,source:number,action:string)=>Number(db.prepare("SELECT id FROM accounting_events WHERE source_type=? AND source_id=? AND event_type=?").get(type,String(source),action)!.id);
    const movements=db.prepare("SELECT id,type FROM inventory_movements WHERE part_id=? ORDER BY id").all(part);
    post(event("stock",Number(movements[0].id),"movement"),"1110","2100",200);
    post(event("payment",paymentId,"receipt"),"1000","2010",200);
    post(event("stock",Number(movements[1].id),"movement"),"1120","1110",100);
    post(event("invoice",invoiceId,"confirm"),"1100","4010",1000);
    post(event("invoice",invoiceId,"advance_allocation"),"2010","1100",200);
    const finalPayment=Number(db.prepare("SELECT id FROM payments WHERE ticket_id=? AND id!=?").get(id,paymentId)!.id);
    post(event("payment",finalPayment,"receipt"),"1000","1100",800);
    post(event("invoice",invoiceId,"repair_cost_recognition"),"5010","1120",100);
    const run=db.prepare("SELECT id,net_payable,branch_id FROM payroll_runs WHERE source_ticket_id=?").get(id)!;
    assert.equal(run.net_payable,125);
    assert.equal(run.branch_id,1);
    assert.throws(()=>db.prepare("UPDATE payroll_runs SET branch_id=2 WHERE id=?").run(run.id),/Financial branch/);
    post(event("commission",Number(run.id),"accrual"),"6010","2030",125);
    approveCommission(db,session,Number(run.id));
    const payout=recordCommissionPayment(db,session,Number(run.id),{amount:125,method:"cash",payment_date:"2026-10-24",document_reference:"REPAIR-COMMISSION-RECEIPT",confirmed:true});
    post(event("commission_payment",payout.payment_id,"disbursement"),"2030","1000",125);
    const trial=trialBalance(db,session,{branch_id:1,to:"2026-12-31"});
    const balance=(account:string)=>trial.rows.find(r=>r.code===account)!.balance;
    assert.equal(trial.debit,2850);assert.equal(trial.credit,2850);
    assert.equal(balance("1000"),875);assert.equal(balance("1100"),0);assert.equal(balance("2010"),0);assert.equal(balance("2030"),0);
    assert.equal(balance("1110"),100);assert.equal(balance("1120"),0);assert.equal(balance("2100"),-200);
    const statements=financialStatements(db,session,{branch_id:1,from:"2026-01-01",to:"2026-12-31"});
    assert.equal(statements.revenue,1000);assert.equal(statements.cogs,100);assert.equal(statements.expenses,125);assert.equal(statements.profit,775);
    assert.equal(statements.assets,975);assert.equal(statements.liabilities,200);assert.equal(statements.balanceSheetBalanced,true);
    assert.equal(verifyLedger(db).count,9);assert.equal(verifyLedger(db).valid,true);
  });
});

before(async () => {
  const { getDb } = await import("../src/lib/db/schema");
  const { createSession } = await import("../src/lib/auth");
  const { ensureDefaultStatuses } = await import("../src/lib/repair");
  db = getDb();
  ensureDefaultStatuses();
  db.exec("INSERT INTO branches(id,name,code) VALUES(1,'مرکزی','MAIN'),(2,'دوم','SECOND');");
  db.exec("INSERT INTO users(id,name,email,password_hash,role,branch_id) VALUES(1,'مالک','owner@test.local','x','owner',1),(2,'تکنسین','tech@test.local','x','technician',2),(3,'تکنسین مستقل','isolated-tech@test.local','x','technician',1);");
  db.exec("INSERT INTO inventory_locations(name,branch_id,is_default) VALUES('اصلی',1,1); INSERT INTO settings(key,value) VALUES('vat_enabled','0');");
  customer = Number(db.prepare("INSERT INTO customers(first_name,last_name,mobile) VALUES('تست','گردش کار','09123456789')").run().lastInsertRowid);
  const device = db.prepare("INSERT INTO devices(customer_id,type) VALUES(?,'mobile')").run(customer).lastInsertRowid;
  ticket = Number(db.prepare("INSERT INTO repair_tickets(number,branch_id,customer_id,device_id,status_id,technician_id) VALUES('R-TEST',1,?,?,(SELECT id FROM repair_statuses WHERE name='New'),1)").run(customer,device).lastInsertRowid);
  part = Number(db.prepare("INSERT INTO parts(name,sku,price,purchase_price,avg_cost) VALUES('قطعه','WORKFLOW',500,100,100)").run().lastInsertRowid);
  ownerToken = createSession(1);
  technicianToken = createSession(2);
});
after(() => { db?.close(); fs.rmSync(directory,{recursive:true,force:true}); });

describe("stock and money workflows against real SQLite", () => {
  it("uses weighted inventory cost and rolls back a failed multi-item sale", async () => {
    const { moveStock, getTotalQty } = await import("../src/lib/inventory");
    const { POST } = await import("../src/app/api/sales/route");
    moveStock({ part_id: part, qty:10, type:"purchase", unit_cost:100 });
    moveStock({ part_id: part, qty:10, type:"purchase", unit_cost:300 });
    assert.equal(db.prepare("SELECT avg_cost FROM parts WHERE id=?").get(part)?.avg_cost,200);
    const before = { sales:count("sales"), items:count("sale_items"), payments:count("payments"), movements:count("inventory_movements") };
    const response = await POST(request("/api/sales",{customer_id:customer,items:[{kind:"part",ref_id:part,qty:2,unit_price:500},{kind:"part",ref_id:part,qty:100,unit_price:500}]}));
    assert.equal(response.status,400);
    assert.equal(getTotalQty(part),20);
    assert.deepEqual({sales:count("sales"),items:count("sale_items"),payments:count("payments"),movements:count("inventory_movements")},before);
  });
  it("rolls back a repair item when stock consumption fails", async () => {
    const { POST } = await import("../src/app/api/repairs/[id]/items/route");
    const before=count("ticket_items");
    const response=await POST(request(`/api/repairs/${ticket}/items`,{kind:"part",ref_id:part,qty:100,unit_price:500}),{params:Promise.resolve({id:String(ticket)})});
    assert.equal(response.status,400);
    assert.equal(count("ticket_items"),before);
  });
  it("rejects direct access to another branch even with an otherwise valid role", async () => {
    const { POST } = await import("../src/app/api/repairs/[id]/items/route");
    const response=await POST(request(`/api/repairs/${ticket}/items`,{kind:"labor",name:"کار",unit_price:100},technicianToken),{params:Promise.resolve({id:String(ticket)})});
    assert.equal(response.status,404);
  });
  it("refunds reopen the invoice and cannot exceed the original payment", async () => {
    const { POST:pay }=await import("../src/app/api/payments/route");
    const { POST:refund }=await import("../src/app/api/payments/refund/route");
    const { paidOf }=await import("../src/lib/invoice");
    const invoice=Number(db.prepare("INSERT INTO invoices(number,type,customer_id,branch_id,status,total,paid) VALUES('INV-TEST','sale',?,1,'issued',1000,0)").run(customer).lastInsertRowid);
    const response=await pay(request("/api/payments",{invoice_id:invoice,amount:1000,method:"cash"}));
    assert.equal(response.status,200);
    const payment=await response.json();
    assert.equal(db.prepare("SELECT status FROM invoices WHERE id=?").get(invoice)?.status,"paid");
    assert.equal((await refund(request("/api/payments/refund",{payment_id:payment.id,amount:400}))).status,200);
    assert.equal(db.prepare("SELECT paid FROM invoices WHERE id=?").get(invoice)?.paid,600);
    assert.equal(paidOf(db,invoice,"sale"),600);
    assert.equal((await refund(request("/api/payments/refund",{payment_id:payment.id,amount:601}))).status,400);
    assert.equal(db.prepare("SELECT status FROM invoices WHERE id=?").get(invoice)?.status,"partially_paid");
  });
  it("computes commission after delivery exactly once", async () => {
    const { transitionTicket }=await import("../src/lib/repair");
    db.prepare("UPDATE repair_tickets SET status_id=(SELECT id FROM repair_statuses WHERE name='Ready for Pickup') WHERE id=?").run(ticket);
    db.prepare("INSERT INTO payroll_profiles(user_id,salary_type,percent_repair) VALUES(1,'mixed',25)").run();
    db.prepare("INSERT INTO ticket_items(ticket_id,kind,name,qty,unit_price,consumed) VALUES(?,'labor','اجرت',1,1000,1)").run(ticket);
    transitionTicket(ticket,"Delivered",1);
    transitionTicket(ticket,"Delivered",1);
    assert.equal(db.prepare("SELECT earned_commission FROM payroll_runs WHERE source_ticket_id=?").get(ticket)?.earned_commission,250);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM payroll_runs WHERE source_ticket_id=?").get(ticket)?.n,1);
  });
});

describe("customer portal capabilities", () => {
  it("keeps verified tracking tokens but rejects customer messaging even with a valid token", async () => {
    const { POST:verify }=await import("../src/app/api/track/verify/route");
    const { POST:message }=await import("../src/app/api/track/message/route");
    const { resolveTrackingToken }=await import("../src/lib/tracking");
    assert.equal((await verify(request("/api/track/verify",{ticket:"R-TEST",phone:"3456789"}))).status,403);
    const response=await verify(request("/api/track/verify",{ticket:"R-TEST",phone:"۰۹۱۲۳۴۵۶۷۸۹"}));
    assert.equal(response.status,200);
    const {token}=await response.json();
    assert.equal(resolveTrackingToken(token),ticket);
    assert.equal(db.prepare("SELECT token_hash FROM tracking_tokens WHERE token_hash=?").get(token),undefined);
    const before=Number(db.prepare("SELECT COUNT(*) n FROM messages").get()!.n);
    assert.equal((await message(request("/api/track/message",{ticket:"R-TEST",body:"جعلی"}))).status,410);
    assert.equal((await message(request("/api/track/message",{token,body:"پیام واقعی"}))).status,410);
    assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM messages").get()!.n),before);
    db.prepare("UPDATE tracking_tokens SET expires_at=0").run();
    assert.equal(resolveTrackingToken(token),null);
  });
});

describe("settings and integration failure contracts", () => {
  it("rolls back all settings when a later entry is invalid", async () => {
    const { POST }=await import("../src/app/api/settings/route");
    const response=await POST(request("/api/settings",{values:{business_name:"نباید ثبت شود",unrecognized_key:"invalid"}}));
    assert.equal(response.status,400);
    assert.equal(db.prepare("SELECT value FROM settings WHERE key='business_name'").get(),undefined);
  });
  it("encrypts provider credentials and excludes their value from audit records", async () => {
    const { POST }=await import("../src/app/api/settings/route");
    const secret="fixture-provider-private-value";
    const response=await POST(request("/api/settings",{values:{sms_provider:"none",sms_api_key:secret}}));
    assert.equal(response.status,200);
    assert.match(String(db.prepare("SELECT value FROM settings WHERE key='sms_api_key'").get()?.value),/^v2\./);
    const logs=db.prepare("SELECT before,after FROM audit_logs WHERE entity='settings'").all();
    assert.equal(JSON.stringify(logs).includes(secret),false);
  });
  it("rejects unapproved outbound destinations before changing settings", async () => {
    const { POST }=await import("../src/app/api/settings/route");
    const response=await POST(request("/api/settings",{values:{sms_webhook_url:"http://127.0.0.1/private"}}));
    assert.equal(response.status,400);
    assert.equal(db.prepare("SELECT value FROM settings WHERE key='sms_webhook_url'").get(),undefined);
  });
  it("does not mark a message sent when its provider is unavailable", async () => {
    const { PATCH }=await import("../src/app/api/messages/dispatch/route");
    const message=db.prepare("INSERT INTO messages(customer_id,direction,channel,body,status) VALUES(?,'out','sms','fixture only','queued')").run(customer).lastInsertRowid;
    const response=await PATCH(new NextRequest("http://app.test/api/messages/dispatch",{method:"PATCH",headers:{"content-type":"application/json",cookie:`repaid_session=${ownerToken}`},body:JSON.stringify({id:Number(message),action:"send_now"})}));
    assert.equal(response.status,200);
    assert.equal((await response.json()).sent,false);
    assert.equal(db.prepare("SELECT status FROM messages WHERE id=?").get(message)?.status,"failed");
  });
});
