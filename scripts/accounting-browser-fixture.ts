/** Additional actors/source documents ONLY in an explicitly isolated browser DB. */
import path from "node:path";
import fs from "node:fs";
async function main(){
  const filename=path.resolve(process.env.E2E_DB??"");
  if(process.env.FINANCIAL_BROWSER_MUTATIONS!=="1"||!filename.startsWith(path.resolve(".qa-work")+path.sep))throw new Error("Isolated browser fixture required");
  process.env.REPAID_DATA_DIR=path.dirname(filename);
  const {getDb,DB_PATH}=await import("../src/lib/db/schema");
  if(DB_PATH!==filename)throw new Error("Fixture path mismatch");
  const {hashPassword}=await import("../src/lib/auth"),{atomic}=await import("../src/lib/db/transaction");
  const {computeTechnicianCommission}=await import("../src/lib/payroll");
  const db=getDb(),nonce=Date.now().toString(36),email=`approval-${nonce}@fixture.local`,password="fixture-approval-2026";
  try{
    const setup=atomic(db,()=>{
      const owner=Number(db.prepare("SELECT id FROM users WHERE email='owner@repaid.local'").get()!.id);
      const branch=Number(db.prepare("SELECT branch_id FROM users WHERE id=?").get(owner)!.branch_id);
      const approver=Number(db.prepare("INSERT INTO users(name,email,password_hash,role,branch_id) VALUES(?,?,?,'owner',?)").run(`تأییدکننده ${nonce}`,email,hashPassword(password),branch).lastInsertRowid);
      const technician=Number(db.prepare("INSERT INTO users(name,email,password_hash,role,branch_id) VALUES(?,?,?,'technician',?)").run(`تکنسین ${nonce}`,`tech-${nonce}@fixture.local`,hashPassword(password),branch).lastInsertRowid);
      db.prepare("INSERT INTO payroll_profiles(user_id,salary_type,percent_repair) VALUES(?,'percent',25)").run(technician);
      const customer=Number(db.prepare("SELECT id FROM customers ORDER BY id LIMIT 1").get()!.id);
      const device=Number(db.prepare("INSERT INTO devices(customer_id,type) VALUES(?,'mobile')").run(customer).lastInsertRowid);
      const ticket=Number(db.prepare(`INSERT INTO repair_tickets(number,branch_id,customer_id,device_id,status_id,technician_id,delivered_at)
        VALUES(?,?,?,?,(SELECT id FROM repair_statuses WHERE name='Delivered'),?,datetime('now'))`).run(`BROWSER-COM-${nonce}`,branch,customer,device,technician).lastInsertRowid);
      db.prepare("INSERT INTO ticket_items(ticket_id,kind,name,qty,unit_price,consumed) VALUES(?,'labor','اجرت مستقل مرورگر',1,4000,1)").run(ticket);
      computeTechnicianCommission(ticket,owner);
      const run=Number(db.prepare("SELECT id FROM payroll_runs WHERE source_ticket_id=?").get(ticket)!.id);
      const correctionInvoice=Number(db.prepare("INSERT INTO invoices(number,type,branch_id,customer_id,total,paid,status) VALUES(?,'sale',?,?,1000,300,'cancelled')").run(`BROWSER-CACHE-${nonce}`,branch,customer).lastInsertRowid);
      return {filename,approver,email,run,technician,technicianName:`تکنسین ${nonce}`,correctionInvoice,customer,nonce};
    });
    fs.writeFileSync(".qa-work/accounting-browser-fixture.json",JSON.stringify(setup,null,2));
    console.log("Isolated accounting actors and source documents prepared");
  }finally{db.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
