/** Disposable, independently approved financial sources for compiled HTTP load. */
import fs from 'node:fs';
import path from 'node:path';
import type {Session} from '../src/lib/auth';

async function main(){
 if(process.env.FINANCIAL_HTTP_QA!=='1')throw Error('Explicit financial HTTP fixture mode required');
 const count=Number(process.env.LOAD_REGISTERED_USERS??20);
 if(![20,200,3000].includes(count))throw Error('Unsupported registered-user fixture');
 const filename=path.resolve(`.freebuff/fixture-${count}.json`),manifest=JSON.parse(fs.readFileSync(filename,'utf8'));
 const directory=fs.realpathSync(manifest.directory),root=fs.realpathSync('.freebuff/fixtures');
 if(!directory.startsWith(root+path.sep))throw Error('Disposable fixture directory required');
 process.env.REPAID_DATA_DIR=directory;process.env.REPAID_DEMO_MODE='0';
 const {getDb,DB_PATH}=await import('../src/lib/db/schema');
 if(DB_PATH!==path.join(directory,'repaid.db'))throw Error('Fixture database mismatch');
 const db=getDb();
 try{
  const auth=await import('../src/lib/auth'),ledger=await import('../src/lib/accounting'),opening=await import('../src/lib/accounting-opening'),policy=await import('../src/lib/accounting-policy'),{createInvoice}=await import('../src/lib/invoice');
  const owner={user:db.prepare("SELECT id,name,email,role,branch_id,avatar_color FROM users WHERE email='owner@repaid.local'").get()} as unknown as Session;
  if(!owner.user)throw Error('Fixture owner missing');
  if(db.prepare("SELECT id FROM branches WHERE code='HTTP-FIN-A'").get())throw Error('Fresh disposable fixture required');
  for(const key of ['vat_enabled','tax_rate','duty_rate','round_to'])db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,'0');
  const date=new Date().toISOString().slice(0,10),password='isolated-http-cashier-only';
  const reviewerId=Number(db.prepare("INSERT INTO users(name,email,password_hash,role,branch_id) VALUES('Independent fixture reviewer','http-review@test.local',?,'owner',1)").run(auth.hashPassword(password)).lastInsertRowid);
  const reviewer={user:db.prepare('SELECT id,name,email,role,branch_id,avatar_color FROM users WHERE id=?').get(reviewerId)} as unknown as Session;
  ledger.initializeChart(db,owner);
  if(!db.prepare("SELECT id FROM accounting_periods WHERE status='open' AND ? BETWEEN start_date AND end_date").get(date))ledger.createPeriod(db,owner,{name:'HTTP fixture year',start_date:date.slice(0,4)+'-01-01',end_date:date.slice(0,4)+'-12-31'});
  const branches=[];
  for(let index=0;index<2;index++){
   const branch=Number(db.prepare('INSERT INTO branches(name,code) VALUES(?,?)').run('شعبهٔ آزمون HTTP '+index,'HTTP-FIN-'+(index?'B':'A')).lastInsertRowid);
   const proposal=opening.proposeOpening(db,owner,{branch_id:branch,mode:'new_business',cutover_date:date,memo:'Explicit independent empty branch opening',lines:[],controls:opening.openingControlCodes.map(account_code=>({account_code,balance:0,reference:'Independently checked empty synthetic branch'})),evidence:['Disposable HTTP acceptance source']});
   opening.decideOpening(db,reviewer,proposal.id,'approved');await opening.rehearseOpening(db,owner,proposal.id);opening.applyOpening(db,owner,proposal.id);
   for(const kind of ['service_invoice_v1','cash_receivable_v1'] as const){const p=policy.proposeRecognitionPolicy(db,owner,{branch_id:branch,kind,effective_date:date,reason:'Independently approved no-tax service/cash acceptance policy'});policy.changeRecognitionPolicy(db,reviewer,p.id,'approve');}
   const email=`http-cashier-${index}@test.local`,user=Number(db.prepare('INSERT INTO users(name,email,password_hash,role,branch_id) VALUES(?,?,?,?,?)').run('صندوقدار آزمون '+index,email,auth.hashPassword(password),'accountant',branch).lastInsertRowid);
   for(const permission of ['payments.create','payments.view','finance.view','invoices.view','customers.view','repairs.view'])db.prepare("INSERT INTO user_permissions(user_id,perm,effect) VALUES(?,?,'allow')").run(user,permission);
   const customer=Number(db.prepare('INSERT INTO customers(first_name,last_name,branch_id) VALUES(?,?,?)').run('مشتری','آزمون HTTP '+index,branch).lastInsertRowid);
   const invoices=[];
   for(let lane=0;lane<8;lane++){const invoice=createInvoice(owner,{type:'sale',customer_id:customer,branch_id:branch,confirm:true,date,client_key:`http-fixture-${index}-${lane}`,items:[{kind:'labor',name:'خدمت قطعی آزمون',qty:1,unit_price:1000000}]},String(branch));invoices.push(invoice.id);}
   branches.push({id:branch,user,email,password,customer,invoices});
  }
  manifest.http={branches,date,invoiceAmount:1000000,paymentAmount:100,registeredUsers:Number(db.prepare('SELECT COUNT(*) n FROM users').get()!.n),baselinePayments:Number(db.prepare('SELECT COUNT(*) n FROM payments').get()!.n),ledgerProof:ledger.verifyLedger(db)};
  if(!manifest.http.ledgerProof.valid)throw Error('Fixture journals do not verify');
  fs.writeFileSync(filename,JSON.stringify(manifest,null,2),{mode:0o600});
  console.log(JSON.stringify({prepared:true,registeredUsers:manifest.http.registeredUsers,existingRepairs:Number(db.prepare('SELECT COUNT(*) n FROM repair_tickets').get()!.n),loadBranches:branches.length,postedInvoices:16,productionDataChanged:false}));
 }finally{db.close();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'HTTP fixture preparation failed');process.exitCode=1;});
