import {before,after,describe,it} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {NextRequest} from 'next/server';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-legacy-financial-'));process.env.REPAID_DATA_DIR=directory;process.env.REPAID_DEMO_MODE='0';
let db:ReturnType<typeof import('../src/lib/db/schema').getDb>,owner='',staff='',serials:typeof import('../src/app/api/serials/route'),bulk:typeof import('../src/app/api/repairs/bulk/route'),index=0;
const request=(url:string,body?:unknown,token=owner,key='legacy-path-'+(++index),branch='1',method='POST')=>new NextRequest('http://app.test'+url,{method:body===undefined?'GET':method,headers:{origin:'http://app.test','content-type':'application/json','idempotency-key':key,cookie:`repaid_session=${token}; repaid_branch=${branch}`},body:body===undefined?undefined:JSON.stringify(body)});
const count=(table:string)=>Number(db.prepare('SELECT COUNT(*) n FROM '+table).get()!.n);
before(async()=>{
 const source=await import('../src/lib/db/schema');assert.equal(source.DB_PATH,path.join(directory,'repaid.db'));db=source.getDb();
 db.exec("INSERT INTO branches(id,name,code) VALUES(1,'ONE','ONE'),(2,'TWO','TWO');INSERT INTO users(id,name,email,password_hash,role,branch_id) VALUES(1,'Owner','o@test','x','owner',1),(2,'Staff','s@test','x','accountant',1);INSERT INTO user_permissions(user_id,perm,effect) VALUES(2,'inventory.edit','allow'),(2,'inventory.view','allow'),(2,'repairs.create','allow');INSERT INTO customers(id,first_name,branch_id) VALUES(1,'ONE',1),(2,'TWO',2);INSERT INTO inventory_locations(id,name,branch_id,is_default) VALUES(1,'ONE',1,1),(2,'TWO',2,1);INSERT INTO parts(id,name,price,purchase_price,avg_cost,is_active) VALUES(1,'Serialized part',100,17,17,1);INSERT INTO repair_statuses(id,name,sort) VALUES(1,'Received',1);INSERT INTO settings(key,value) VALUES('vat_enabled','0'),('tax_rate','0'),('duty_rate','0'),('round_to','0')");
 db.exec("INSERT INTO users(id,name,email,password_hash,role,branch_id) VALUES(3,'Technician','t@test','x','technician',1)");
 const auth=await import('../src/lib/auth');owner=auth.createSession(1);staff=auth.createSession(2);serials=await import('../src/app/api/serials/route');bulk=await import('../src/app/api/repairs/bulk/route');
});
after(()=>{db?.close();const target=fs.realpathSync(directory),parent=fs.realpathSync(os.tmpdir());if(path.dirname(target)!==parent||!path.basename(target).startsWith('repaid-legacy-financial-'))throw Error('Invalid disposable legacy cleanup path');fs.rmSync(target,{recursive:true,force:true});});
describe('real legacy intake and serialized inventory integrity boundaries',()=>{
 it('reports bank totals beyond the per-document range exactly and flags unknown balances without inventing zero',async()=>{
  const bank=await import('../src/app/api/bank/route');const insert=db.prepare('INSERT INTO bank_accounts(name,current_balance) VALUES(?,?)');insert.run('Aggregate one',Number.MAX_SAFE_INTEGER);insert.run('Aggregate two',Number.MAX_SAFE_INTEGER-1);
  const result=await bank.GET(request('/api/bank',undefined));assert.equal(result.status,200);const report=await result.json();assert.equal(report.total,null);assert.equal(report.total_exact,'18014398509481981');assert.equal(report.total_state,'exceeds_number_range');
  const unknown=Number(insert.run('Unknown legacy balance',null).lastInsertRowid),review=await (await bank.GET(request('/api/bank',undefined))).json();assert.equal(review.total_exact,null);assert.equal(review.total_state,'review_required');assert.equal(db.prepare('SELECT current_balance FROM bank_accounts WHERE id=?').get(unknown)!.current_balance,null);assert.equal((await bank.GET(request('/api/bank',undefined,staff))).status,403);
 });
 it('rejects an unconnected group advance before creating devices, tickets, receipts or audit success',async()=>{
  const before=['devices','repair_tickets','payments','audit_logs'].map(count),body={customer_id:1,deposit:15,devices:[{type:'phone',brand:'A',model:'A',problem:'A'},{type:'phone',brand:'B',model:'B',problem:'B'}]};
  const rejected=await bulk.POST(request('/api/repairs/bulk',body));assert.equal(rejected.status,409);assert.deepEqual(['devices','repair_tickets','payments','audit_logs'].map(count),before);
  const malformed=await bulk.POST(request('/api/repairs/bulk',{...body,deposit:0.5}));assert.equal(malformed.status,400);assert.deepEqual(['devices','repair_tickets','payments','audit_logs'].map(count),before);
 });
 it('creates a zero-advance group once, preserves its identity on retry and denies another branch customer',async()=>{
  const body={customer_id:1,deposit:0,technician_id:3,devices:[{type:'phone',brand:'A',model:'A',problem:'A'},{type:'phone',brand:'B',model:'B',problem:'B'}]},key='group-intake-identity-001';
  const first=await bulk.POST(request('/api/repairs/bulk',body,owner,key)),result=await first.json();assert.equal(first.status,200);assert.equal(result.tickets.length,2);
  for(const ticket of result.tickets)assert.equal(db.prepare('SELECT technician_id FROM repair_tickets WHERE id=?').get(ticket.id)!.technician_id,3);
  const before=['devices','repair_tickets','payments','audit_logs'].map(count);assert.deepEqual(await (await bulk.POST(request('/api/repairs/bulk',body,owner,key))).json(),result);assert.deepEqual(['devices','repair_tickets','payments','audit_logs'].map(count),before);
  const deniedAssignment=await bulk.POST(request('/api/repairs/bulk',body,staff));assert.equal(deniedAssignment.status,403);assert.deepEqual(['devices','repair_tickets','payments','audit_logs'].map(count),before);
  const foreign=await bulk.POST(request('/api/repairs/bulk',{...body,customer_id:2,technician_id:undefined},staff));assert.equal(foreign.status,404);assert.deepEqual(['devices','repair_tickets','payments','audit_logs'].map(count),before);
 });
 it('validates costs and warehouse scope, preserves company-wide access and commits serial plus audit once',async()=>{
  const payload={part_id:1,serial:'SERIAL-ONE',cost:15,location_id:1},key='serial-creation-identity-001';
  const first=await serials.POST(request('/api/serials',payload,staff,key)),result=await first.json();assert.equal(first.status,200);assert.equal(db.prepare('SELECT cost FROM serialized_parts WHERE id=?').get(result.id)!.cost,15);
  assert.deepEqual(await (await serials.POST(request('/api/serials',payload,staff,key))).json(),result);assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity='serialized_part' AND entity_id=?").get(result.id)!.n),1);
  const before=count('serialized_parts');assert.equal((await serials.POST(request('/api/serials',{...payload,serial:'FOREIGN',location_id:2},staff))).status,404);assert.equal((await serials.POST(request('/api/serials',{...payload,serial:'BAD-MONEY',cost:1.5}))).status,400);assert.equal((await serials.POST(request('/api/serials',{...payload,serial:'BAD-DATE',warranty_until:'2027-02-30'}))).status,400);assert.equal(count('serialized_parts'),before);
  const company=await serials.POST(request('/api/serials',{...payload,serial:'SERIAL-TWO',cost:null,location_id:2},owner,undefined,'all')),second=await company.json();assert.equal(company.status,200);assert.equal(db.prepare('SELECT cost FROM serialized_parts WHERE id=?').get(second.id)!.cost,null);assert.equal(db.prepare("SELECT branch_id FROM audit_logs WHERE entity='serialized_part' AND entity_id=?").get(second.id)!.branch_id,2);
 });
 it('rolls serial creation back after audit failure and keeps retries safe',async()=>{
  const before=count('serialized_parts'),body={part_id:1,serial:'AUDIT-RETRY',cost:0,location_id:1},key='serial-audit-failure-001';
  db.exec("CREATE TRIGGER fail_serial_audit BEFORE INSERT ON audit_logs WHEN NEW.entity='serialized_part' BEGIN SELECT RAISE(ABORT,'injected serial audit failure'); END");try{assert.equal((await serials.POST(request('/api/serials',body,owner,key))).status,500);}finally{db.exec('DROP TRIGGER fail_serial_audit');}
  assert.equal(count('serialized_parts'),before);assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM operation_receipts WHERE operation_key=?').get(key)!.n),0);assert.equal((await serials.POST(request('/api/serials',body,owner,key))).status,200);
 });
 it('only links serials to actual delivered stock and never fabricates another stock deduction or receipt',async()=>{
  const ids=db.prepare("SELECT id FROM serialized_parts WHERE location_id=1 ORDER BY id").all().map(row=>Number(row.id));assert.ok(ids.length>=2);
  const {moveStock}=await import('../src/lib/inventory');moveStock({part_id:1,location_id:1,qty:2,type:'purchase',unit_cost:17,branch_id:1,user_id:1});
  const {POST:sell}=await import('../src/app/api/sales/route');const sale=await sell(request('/api/sales',{customer_id:1,method:'cash',items:[{kind:'part',ref_id:1,qty:1,unit_price:100}]})),sold=await sale.json();assert.equal(sale.status,200);
  const before=[count('inventory_movements'),count('payments'),Number(db.prepare('SELECT qty FROM inventory_stock WHERE part_id=1 AND location_id=1').get()!.qty)];
  assert.equal((await serials.PATCH(request('/api/serials',{id:ids[0],action:'sell'},owner,undefined,'1','PATCH'))).status,409);
  db.exec("CREATE TRIGGER fail_serial_link_audit BEFORE INSERT ON audit_logs WHEN NEW.entity='serialized_part' AND NEW.action='edit' BEGIN SELECT RAISE(ABORT,'injected serial link failure'); END");
  try{assert.equal((await serials.PATCH(request('/api/serials',{id:ids[0],action:'sell',sale_id:sold.id},owner,undefined,'1','PATCH'))).status,500);}finally{db.exec('DROP TRIGGER fail_serial_link_audit');}
  assert.equal(db.prepare('SELECT status FROM serialized_parts WHERE id=?').get(ids[0])!.status,'in_stock');assert.equal(db.prepare('SELECT sale_id FROM serialized_parts WHERE id=?').get(ids[0])!.sale_id,null);
  const change=await serials.PATCH(request('/api/serials',{id:ids[0],action:'sell',sale_id:sold.id},owner,undefined,'1','PATCH'));assert.equal(change.status,200);assert.equal(db.prepare('SELECT status FROM serialized_parts WHERE id=?').get(ids[0])!.status,'sold');
  assert.equal((await serials.PATCH(request('/api/serials',{id:ids[1],action:'sell',sale_id:sold.id},owner,undefined,'1','PATCH'))).status,409);
  assert.equal((await serials.PATCH(request('/api/serials',{id:ids[0],status:'returned'},owner,undefined,'1','PATCH'))).status,409);
  assert.deepEqual([count('inventory_movements'),count('payments'),Number(db.prepare('SELECT qty FROM inventory_stock WHERE part_id=1 AND location_id=1').get()!.qty)],before);
 });
 it('paginates all scoped serial history beyond the former 300-row cutoff with stable identities',async()=>{
  db.exec('BEGIN IMMEDIATE');const insert=db.prepare("INSERT INTO serialized_parts(part_id,serial,location_id,status) VALUES(1,?,1,'in_stock')");for(let n=0;n<305;n++)insert.run('PAGED-'+String(n).padStart(4,'0'));db.exec('COMMIT');
  const first=await (await serials.GET(request('/api/serials?q=PAGED-&page=1&perPage=200',undefined,staff))).json(),second=await (await serials.GET(request('/api/serials?q=PAGED-&page=2&perPage=200',undefined,staff))).json();
  assert.equal(first.total,305);assert.equal(first.serials.length,200);assert.equal(second.serials.length,105);assert.equal(new Set([...first.serials,...second.serials].map((row:{id:number})=>row.id)).size,305);assert.ok([...first.serials,...second.serials].every((row:{location_id:number})=>row.location_id===1));
 });
});
