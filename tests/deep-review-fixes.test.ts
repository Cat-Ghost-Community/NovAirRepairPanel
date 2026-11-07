import {before,after,describe,it} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {NextRequest} from 'next/server';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-review-fixes-'));
process.env.REPAID_DATA_DIR=directory;process.env.REPAID_DEMO_MODE='0';
let db:ReturnType<typeof import('../src/lib/db/schema').getDb>;
const ids:Record<string,number>={},tokens:Record<string,string>={};
function req(actor:string|null,url:string,body?:unknown,headers:Record<string,string>={}){return new NextRequest('http://audit.test'+url,{method:body===undefined?'GET':'POST',headers:{origin:'http://audit.test','content-type':'application/json',...(actor?{cookie:`repaid_session=${tokens[actor]}; repaid_branch=all`}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});}
before(async()=>{
 const {getDb}=await import('../src/lib/db/schema');const {createSession}=await import('../src/lib/auth');db=getDb();
 db.exec("INSERT INTO branches(id,name,code) VALUES(1,'ONE','ONE'),(2,'TWO','TWO')");
 for(const [name,role,branch]of [['owner','owner',1],['manager','manager',1],['employee','technician',1],['foreign','manager',2]] as const){ids[name]=Number(db.prepare("INSERT INTO users(name,email,password_hash,role,branch_id) VALUES(?,?,'invalid',?,?)").run(name,name+'@audit.test',role,branch).lastInsertRowid);tokens[name]=createSession(ids[name]);}
 ids.customer=Number(db.prepare("INSERT INTO customers(first_name,branch_id) VALUES('AUDIT',1)").run().lastInsertRowid);
});
after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
describe('deep review corrections against isolated real SQLite',()=>{
 it('separates report authorship from review and archives re-signed corrections immutably',async()=>{
  const api=await import('../src/app/api/daily-reports/route'),qr=(await import('qrcode')).default;
  const original=await qr.toDataURL('Original report'),replacement=await qr.toDataURL('New signed correction');
  const body={report_date:'2026-10-28',status:'submitted',summary:'Original employee narrative',signature_data:original};
  assert.equal((await api.POST(req('employee','/api/daily-reports',body))).status,200);
  const prior=db.prepare('SELECT * FROM daily_reports WHERE user_id=?').get(ids.employee)!;
  assert.equal((await api.POST(req('manager','/api/daily-reports',{...body,user_id:ids.employee,revision:0,signature_data:replacement}))).status,403);
  assert.equal((await api.POST(req('employee','/api/daily-reports',{...body,revision:0,status:'draft'}))).status,409);
  assert.equal((await api.POST(req('employee','/api/daily-reports',{...body,revision:0,summary:'Changing signed content without signing'}))).status,409);
  assert.deepEqual(db.prepare('SELECT * FROM daily_reports WHERE id=?').get(prior.id),prior);
  const correction={...body,revision:0,resign:true,signature_data:replacement,correction_reason:'Correcting the narrative with retained original',summary:'The corrected employee narrative'};
  assert.equal((await api.POST(req('employee','/api/daily-reports',correction))).status,200);
  const current=db.prepare('SELECT * FROM daily_reports WHERE id=?').get(prior.id)!;assert.equal(current.revision,1);assert.equal(current.signature_data,replacement);
  const versions=db.prepare('SELECT * FROM daily_report_versions WHERE report_id=? ORDER BY revision').all(prior.id);assert.equal(versions.length,2);assert.deepEqual(JSON.parse(String(versions[0].snapshot_json)),{...prior});
  assert.throws(()=>db.prepare("UPDATE daily_report_versions SET reason='tamper' WHERE id=?").run(versions[0].id),/immutable/);
  assert.throws(()=>db.prepare('DELETE FROM daily_report_versions WHERE id=?').run(versions[0].id),/cannot be deleted/);
  assert.equal((await api.POST(req('employee','/api/daily-reports',correction))).status,409);
  const history=await api.GET(req('manager',`/api/daily-reports?history=2026-10-28&user_id=${ids.employee}`));assert.equal(history.status,200);assert.equal((await history.json()).versions.length,2);
  assert.equal((await api.GET(req('foreign',`/api/daily-reports?history=2026-10-28&user_id=${ids.employee}`))).status,404);
  db.exec("CREATE TRIGGER fail_report_audit BEFORE INSERT ON audit_logs WHEN NEW.entity='daily_report' BEGIN SELECT RAISE(ABORT,'Injected audit failure'); END");
  try{assert.equal((await api.POST(req('employee','/api/daily-reports',{...correction,revision:1,signature_data:original}))).status,500);assert.deepEqual(db.prepare('SELECT * FROM daily_reports WHERE id=?').get(prior.id),current);assert.equal(db.prepare('SELECT COUNT(*) n FROM daily_report_versions WHERE report_id=?').get(prior.id)!.n,2);}finally{db.exec('DROP TRIGGER fail_report_audit');}
 });
 it('rejects stale draft saves and invalid calendar dates',async()=>{
  const api=await import('../src/app/api/daily-reports/route'),body={report_date:'2026-10-27',status:'draft',summary:'Draft one'};
  assert.equal((await api.POST(req('employee','/api/daily-reports',body))).status,200);
  assert.equal((await api.POST(req('employee','/api/daily-reports',{...body,revision:0,summary:'Draft two'}))).status,200);
  assert.equal((await api.POST(req('employee','/api/daily-reports',{...body,revision:0,summary:'Stale draft'}))).status,409);
  assert.equal((await api.POST(req('employee','/api/daily-reports',{...body,report_date:'2026-99-99'}))).status,400);
 });
 it('uses clearance dates and excludes instruments from cash totals until collected',async()=>{
  const {createCustomerReceipt}=await import('../src/lib/customer-payments'),{getSessionByToken}=await import('../src/lib/auth');const {settledCashTotals}=await import('../src/lib/payment-state');
  const payment=createCustomerReceipt(db,getSessionByToken(tokens.owner)!,{customer_id:ids.customer,amount:700,method:'check',cheque:{due_date:'2099-01-01'}},1);
  const today=new Date().toISOString().slice(0,10),until=new Date(Date.now()+86400000).toISOString().slice(0,10);
  assert.equal(settledCashTotals(db,1,today,until).inflow,0);
  db.prepare("UPDATE payments SET created_at='2025-01-01 10:00:00' WHERE id=?").run(payment.id);
  const {POST}=await import('../src/app/api/checks/route');const cheque=db.prepare('SELECT id FROM checks WHERE payment_id=?').get(payment.id)!;
  const bank=Number(db.prepare("INSERT INTO bank_accounts(name,current_balance) VALUES('Audit bank',0)").run().lastInsertRowid);
  const passed=await POST(req('owner','/api/checks',{id:cheque.id,action:'pass',bank_account_id:bank},{'idempotency-key':'audit-clearance-001'}));assert.equal(passed.status,200);
  assert.equal(settledCashTotals(db,1,today,until).inflow,700);assert.equal(settledCashTotals(db,2,today,until).inflow,0);
 });
 it('provides stable scoped and searchable payment pagination',async()=>{
  const {GET}=await import('../src/app/api/payments/route');
  const insert=db.prepare("INSERT INTO payments(number,customer_id,branch_id,amount,direction) VALUES(?,?,?,1,'in')");for(let i=0;i<206;i++)insert.run('PAGE-'+String(i).padStart(3,'0'),ids.customer,1);insert.run('FOREIGN',ids.customer,2);
  const first=await(await GET(req('manager','/api/payments?limit=100&page=1&q=PAGE-'))).json(),second=await(await GET(req('manager','/api/payments?limit=100&page=2&q=PAGE-'))).json();
  assert.equal(first.total,206);assert.equal(first.payments.length,100);assert.equal(second.payments.length,100);assert.equal(first.hasMore,true);
  assert.equal(new Set([...first.payments,...second.payments].map(p=>p.id)).size,200);assert.ok([...first.payments,...second.payments].every(p=>p.branch_id===1));
  const last=await(await GET(req('manager','/api/payments?limit=100&page=3&q=PAGE-'))).json();assert.equal(last.payments.length,6);assert.equal(last.hasMore,false);
  assert.equal((await GET(req('manager','/api/payments?limit=1000'))).status,400);
 });
 it('bounds rotated invalid-token traffic and expires obsolete public throttle records',async()=>{
  db.exec("DELETE FROM login_attempts WHERE key LIKE 'track:%'");
  db.prepare('INSERT INTO login_attempts(key,count,window_start) VALUES(?,1,0)').run('track:obsolete');const {POST}=await import('../src/app/api/track/estimate/route');
  for(let i=0;i<300;i++)assert.equal((await POST(req(null,'/api/track/estimate',{token:'invalid-'+i,action:'approve'}))).status,404);
  assert.equal((await POST(req(null,'/api/track/estimate',{token:'another-invalid',action:'approve'}))).status,429);
  assert.equal(db.prepare("SELECT key FROM login_attempts WHERE key='track:obsolete'").get(),undefined);
  assert.ok(Number(db.prepare("SELECT COUNT(*) n FROM login_attempts WHERE key LIKE 'track:%'").get()!.n)<=301);
 });
 it('never trusts forwarded IP text by default and validates explicitly trusted proxy IPs',async()=>{
  const {trustedClientIp}=await import('../src/lib/public-request-security');const saved=process.env.REPAID_TRUST_PROXY;
  try{delete process.env.REPAID_TRUST_PROXY;assert.equal(trustedClientIp(req(null,'/api/track/estimate',{}, {'x-forwarded-for':'1.2.3.4','x-real-ip':'1.2.3.4'})),null);
   db.exec("DELETE FROM login_attempts WHERE key LIKE 'track:%'");
   const {POST}=await import('../src/app/api/track/estimate/route'),image=await(await import('qrcode')).default.toDataURL('Actual signed estimate');
   const id=Number(db.prepare("INSERT INTO estimates(number,customer_id,status,public_token) VALUES('AUDIT-PUBLIC',?,'sent','audit-public-evidence')").run(ids.customer).lastInsertRowid);
   assert.equal((await POST(req(null,'/api/track/estimate',{token:'audit-public-evidence',action:'approve',signature:image,signed_name:'Audit Customer'},{'x-forwarded-for':'not-an-ip-user-controlled'}))).status,200);
   assert.equal(db.prepare('SELECT signed_ip FROM estimates WHERE id=?').get(id)!.signed_ip,null);
   process.env.REPAID_TRUST_PROXY='1';assert.equal(trustedClientIp(req(null,'/api/track/estimate',{}, {'x-real-ip':'not-an-ip'})),null);assert.equal(trustedClientIp(req(null,'/api/track/estimate',{}, {'x-real-ip':'2001:db8::1','x-forwarded-for':'forged'})),'2001:db8::1');
   for(let i=0;i<30;i++)assert.equal((await POST(req(null,'/api/track/estimate',{token:'client-rotation-'+i},{'x-real-ip':'198.51.100.2'}))).status,404);
   assert.equal((await POST(req(null,'/api/track/estimate',{token:'client-over-limit'},{'x-real-ip':'198.51.100.2'}))).status,429);
  }finally{if(saved===undefined)delete process.env.REPAID_TRUST_PROXY;else process.env.REPAID_TRUST_PROXY=saved;}
 });
});
