import fs from "node:fs";
import path from "node:path";

async function main() {
  if(process.env.LOAD_TEST_MODE!=="1") throw new Error("Test fixtures require LOAD_TEST_MODE=1.");
  const employees=Number(process.env.LOAD_REGISTERED_USERS||20);
  if(![20,200,3000].includes(employees)) throw new Error("Supported registered employee counts: 20, 200, 3000");
  const root=path.resolve(".qa-work/fixtures");
  fs.mkdirSync(root,{recursive:true});
  const directory=fs.mkdtempSync(path.join(root,`${employees}-`));
  process.env.REPAID_DATA_DIR=directory;
  process.env.REPAID_DEMO_MODE="1";
  // Fixture generation is always isolated from production initialization rules.
  Object.assign(process.env,{NODE_ENV:"test"});
  const {seedIfEmpty}=await import("../src/lib/seed");
  const {getDb}=await import("../src/lib/db/schema");
  const {hashPassword}=await import("../src/lib/auth");
  const {atomic}=await import("../src/lib/db/transaction");
  seedIfEmpty();
  const db=getDb();
  try {
    const passwordHash=hashPassword("fixture-password-2026");
    atomic(db,()=>{
      const existing=Number(db.prepare("SELECT COUNT(*) n FROM users").get()?.n);
      const user=db.prepare("INSERT INTO users(name,email,password_hash,role,branch_id) VALUES(?,?,?,'technician',1)");
      for(let index=existing;index<employees;index++) user.run(`کاربر آزمون ${index}`,`load-${index}@test.local`,passwordHash);
      const customer=db.prepare("INSERT INTO customers(first_name,last_name,mobile,branch_id) VALUES('آزمون',?,?,1)");
      const device=db.prepare("INSERT INTO devices(customer_id,type,brand,model) VALUES(?,'mobile','Test','Fixture')");
      const ticket=db.prepare("INSERT INTO repair_tickets(number,branch_id,customer_id,device_id,status_id,technician_id,problem) VALUES(?,1,?,?,(SELECT id FROM repair_statuses WHERE name='New'),?,'test workload')");
      const invoice=db.prepare("INSERT INTO invoices(number,customer_id,branch_id,total,paid,status,type) VALUES(?,?,1,100000,0,'issued','repair')");
      for(let index=0;index<employees*10;index++) {
        const customerId=customer.run(`test-${index}`,`0912${String(index).padStart(7,'0')}`).lastInsertRowid;
        const deviceId=device.run(customerId).lastInsertRowid;
        ticket.run(`LOAD-${index}`,customerId,deviceId,1+index%employees);
        if(index%10===0) invoice.run(`LOAD-INV-${index}`,customerId);
      }
    });
    const counts=Object.fromEntries(["users","customers","devices","repair_tickets","invoices"].map(table=>[table,Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n)]));
    const manifest={directory,employees,counts};
    fs.writeFileSync(`.qa-work/fixture-${employees}.json`,JSON.stringify(manifest,null,2)+'\n');
    console.log(JSON.stringify(manifest));
  } finally {db.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
