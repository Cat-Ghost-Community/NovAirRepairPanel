import {before,after,it} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import QRCode from 'qrcode';
import {NextRequest} from 'next/server';
import {customerDisplayName} from '../src/lib/customer-identity';
import {trackingExample} from '../src/lib/tracking-example';
import {payrollQuery,payrollRunFilter} from '../src/lib/payroll-query';

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-reception-experience-'));
process.env.REPAID_DATA_DIR=directory;process.env.REPAID_DEMO_MODE='0';
let db:ReturnType<typeof import('../src/lib/db/schema').getDb>;
const tokens:Record<number,string>={};let customer=0,device=0,ticket=0,signature='';
function request(user:number,url:string,body?:unknown){return new NextRequest('http://app.test'+url,{method:body===undefined?'GET':'POST',headers:{cookie:'repaid_session='+tokens[user]+'; repaid_branch=all',origin:'http://app.test','Content-Type':'application/json','Idempotency-Key':randomUUID()},...(body===undefined?{}:{body:JSON.stringify(body)})});}
before(async()=>{
 const {getDb}=await import('../src/lib/db/schema'),{createSession}=await import('../src/lib/auth');db=getDb();
 db.exec("INSERT INTO branches(id,name,code) VALUES(1,'One','ONE'),(2,'Two','TWO');INSERT INTO users(id,name,email,password_hash,role,branch_id) VALUES(1,'Owner','owner@test.invalid','unused','owner',1),(2,'Other manager','manager@test.invalid','unused','manager',2),(3,'Technician','technician@test.invalid','unused','technician',1),(4,'Reception','reception@test.invalid','unused','reception',1)");
 for(const id of [1,2,3,4])tokens[id]=createSession(id);
 db.exec(`INSERT INTO repair_statuses(id,name,color,allowed_next,customer_visible,category) VALUES(1,'Ready','#00aa00','["Delivered"]',1,'ready'),(2,'Delivered','#0000aa','[]',1,'closed')`);
 signature=await QRCode.toDataURL('Synthetic signature evidence',{width:120});
});
after(()=>{db?.close();fs.rmSync(directory,{recursive:true,force:true});});

it('creates surname-only customers with persisted titles and rejects blank surnames',async()=>{
 const {POST}=await import('../src/app/api/customers/route');
 const invalid=await POST(request(1,'/api/customers',{first_name:'Optional',last_name:'  '}));assert.equal(invalid.status,400);
 const response=await POST(request(1,'/api/customers',{last_name:'رضایی',first_name:'',salutation:'ms',mobile:'09123456789'}));
 assert.equal(response.status,200,JSON.stringify(await response.clone().json()));customer=(await response.json()).id;
 const stored=db.prepare('SELECT * FROM customers WHERE id=?').get(customer)!;assert.equal(stored.salutation,'ms');assert.equal(customerDisplayName(stored),'خانم رضایی');
});
it('edits complete customer profiles with branch authorization and stale-update protection',async()=>{
 const {POST}=await import('../src/app/api/customers/[id]/route'),params={params:Promise.resolve({id:String(customer)})};
 assert.equal((await POST(request(2,'/api/customers/'+customer,{action:'update',last_name:'Forbidden'}),params)).status,404);
 const response=await POST(request(1,'/api/customers/'+customer,{action:'update',first_name:'',last_name:'رضایی',salutation:'mr',job:'مهندس',nickname:'مشتری',referral_source:'معرف',expected_updated_at:null}),params);
 assert.equal(response.status,200);assert.equal(db.prepare('SELECT job FROM customers WHERE id=?').get(customer)!.job,'مهندس');
 assert.equal((await POST(request(1,'/api/customers/'+customer,{action:'update',last_name:'Stale',expected_updated_at:null}),params)).status,409);
 assert.equal((await POST(request(1,'/api/customers/'+customer,{action:'update',last_name:''}),params)).status,400);
});
it('edits accepted device details without changing ownership or losing retired custom data',async()=>{
 const {POST:create}=await import('../src/app/api/devices/route');
 const created=await create(request(1,'/api/devices',{customer_id:customer,type:'mobile',brand:'Brand',model:'Original'}));assert.equal(created.status,200);device=(await created.json()).id;
 db.prepare('UPDATE devices SET specs=? WHERE id=?').run(JSON.stringify({'custom_old:مشخصه قدیمی':'preserve'}),device);
 const {POST}=await import('../src/app/api/devices/[id]/route'),params={params:Promise.resolve({id:String(device)})};
 assert.equal((await POST(request(2,'/api/devices/'+device,{model:'Forbidden'}),params)).status,404);
 assert.equal((await POST(request(1,'/api/devices/'+device,{type:'mobile',brand:'Brand',model:'Corrected',serial:'SERIAL-42',battery_health:88,expected_updated_at:null}),params)).status,200);
 const row=db.prepare('SELECT * FROM devices WHERE id=?').get(device)!;assert.equal(row.model,'Corrected');assert.equal(row.customer_id,customer);assert.equal(JSON.parse(String(row.specs))['custom_old:مشخصه قدیمی'],'preserve');
 assert.equal((await POST(request(1,'/api/devices/'+device,{customer_id:999,model:'Other'}),params)).status,404);
 assert.equal((await POST(request(1,'/api/devices/'+device,{model:'Stale',expected_updated_at:null}),params)).status,409);
});
it('requires an authorized delivery request and customer consent, then retains one immutable signature',async()=>{
 ticket=Number(db.prepare("INSERT INTO repair_tickets(number,branch_id,customer_id,device_id,status_id,technician_id) VALUES('R9001',1,?,?,1,3)").run(customer,device).lastInsertRowid);
 const delivery=await import('../src/lib/delivery-signature'),{getSessionByToken}=await import('../src/lib/auth');
 assert.throws(()=>delivery.signTrackedDelivery(db,ticket,{signature,signed_name:'Customer',consent:true},null),{status:409});
 assert.throws(()=>delivery.requestDeliverySignature(db,getSessionByToken(tokens[2])!,ticket),{status:404});
 delivery.requestDeliverySignature(db,getSessionByToken(tokens[1])!,ticket);
 const {POST:requestSignature}=await import('../src/app/api/repairs/[id]/delivery-request/route');
 const originalOrigin=process.env.APP_ORIGIN;
 try{
  process.env.APP_ORIGIN='http://app.test';
  const normalizedRequest=new NextRequest('http://localhost/api/repairs/'+ticket+'/delivery-request',{method:'POST',headers:{host:'app.test',origin:'http://app.test',cookie:'repaid_session='+tokens[1]}});
  const response=await requestSignature(normalizedRequest,{params:Promise.resolve({id:String(ticket)})});
  assert.equal(response.status,200);assert.equal(new URL((await response.json()).tracking_url).origin,'http://app.test');
 }finally{if(originalOrigin===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=originalOrigin;}
 assert.throws(()=>delivery.signTrackedDelivery(db,ticket,{signature,signed_name:'Customer',consent:false},null),{status:400});
 assert.throws(()=>delivery.signTrackedDelivery(db,ticket,{signature:'corrupt',signed_name:'Customer',consent:true},null),{status:400});
 assert.equal(delivery.signTrackedDelivery(db,ticket,{signature,signed_name:'Customer',consent:true},'127.0.0.1').ok,true);
 const row=db.prepare('SELECT * FROM repair_tickets WHERE id=?').get(ticket)!;assert.equal(row.status_id,2);assert.equal(row.delivery_signature,signature);
 assert.equal(delivery.signTrackedDelivery(db,ticket,{signature,signed_name:'Customer',consent:true},null).duplicate,true);
 assert.throws(()=>delivery.signTrackedDelivery(db,ticket,{signature,signed_name:'Different person',consent:true},null),{status:409});
 assert.equal(db.prepare('SELECT signed_ip FROM repair_delivery_requests WHERE ticket_id=?').get(ticket)!.signed_ip,'127.0.0.1');
});
it('announces new notifications once across polls without marking them read or exposing another branch',async()=>{
 const {POST}=await import('../src/app/api/notifications/deliveries/route');
 assert.deepEqual((await (await POST(request(4,'/api/notifications/deliveries',{}))).json()).notifications,[]);
 const id=Number(db.prepare("INSERT INTO notifications(user_id,title,body,link,branch_id) VALUES(4,'New notice','Message','/',1)").run().lastInsertRowid);
 db.prepare("INSERT INTO notifications(user_id,title,body,link,branch_id) VALUES(4,'Foreign','Private','/repairs/999',2)").run();
 const responses=await Promise.all([POST(request(4,'/api/notifications/deliveries',{})),POST(request(4,'/api/notifications/deliveries',{}))]);
 const batches=await Promise.all(responses.map(response=>response.json()));assert.deepEqual(batches.flatMap(batch=>batch.notifications.map((row:{id:number})=>row.id)),[id]);
 assert.equal(db.prepare('SELECT read FROM notifications WHERE id=?').get(id)!.read,0);
 assert.deepEqual((await (await POST(request(4,'/api/notifications/deliveries',{}))).json()).notifications,[]);
});
it('cancels only unapproved commission drafts and preserves original amounts and audit evidence',async()=>{
 const {getSessionByToken}=await import('../src/lib/auth'),{cancelPendingCommission,approveCommission}=await import('../src/lib/commission-settlement');
 const run=Number(db.prepare("INSERT INTO payroll_runs(user_id,branch_id,source_ticket_id,earned_commission,net_payable,status) VALUES(3,1,?,500,500,'pending')").run(ticket).lastInsertRowid);
 assert.throws(()=>cancelPendingCommission(db,getSessionByToken(tokens[2])!,run,{reason:'Documented decision',reference:'Review-001'}),{status:404});
 cancelPendingCommission(db,getSessionByToken(tokens[1])!,run,{reason:'Documented cancellation decision',reference:'Review-001'});
 const stored=db.prepare('SELECT * FROM payroll_runs WHERE id=?').get(run)!;assert.equal(stored.status,'cancelled');assert.equal(stored.earned_commission,500);
 assert.ok(db.prepare("SELECT 1 FROM audit_logs WHERE entity='commission' AND action='cancel' AND entity_id=?").get(run));
 assert.throws(()=>approveCommission(db,getSessionByToken(tokens[1])!,run),{status:409});
});
it('synchronizes read markers without marking later messages read and does not replay bootstrap history',async()=>{
 const chat=await import('../src/lib/chat'),{getSessionByToken}=await import('../src/lib/auth');
 const recipient=getSessionByToken(tokens[4])!,sender=getSessionByToken(tokens[2])!;
 const conversation=chat.ensureDirectConversation(db,sender,4),member=chat.requireConversation(db,conversation,2);
 const first=chat.postMessage(db,sender,member.conv,member.member,{body:'First cross-branch message'}).message;
 const second=chat.postMessage(db,sender,member.conv,member.member,{body:'Second cross-branch message'}).message;
 chat.markRead(db,recipient,conversation,first.id);
 assert.equal(db.prepare('SELECT read FROM notifications WHERE user_id=4 AND chat_message_id=?').get(first.id)!.read,1);
 assert.equal(db.prepare('SELECT read FROM notifications WHERE user_id=4 AND chat_message_id=?').get(second.id)!.read,0);
 const snapshot=chat.fetchEvents(db,recipient,0,null,true);assert.deepEqual(snapshot.events,[]);assert.ok(snapshot.cursor>0);
 const third=chat.postMessage(db,sender,member.conv,member.member,{body:'Third cross-branch message'}).message;
 assert.ok(chat.fetchEvents(db,recipient,snapshot.cursor,null).events.some(event=>event.payload.message_id===third.id));
 const {GET}=await import('../src/app/api/notifications/route');
 const visible=await (await GET(request(4,'/api/notifications'))).json();assert.ok(visible.notifications.some((row:{chat_message_id:number})=>row.chat_message_id===third.id));
 assert.ok(!visible.notifications.some((row:{title:string})=>row.title==='Foreign'));
});
it('gives branch managers payroll controls without granting journal approval or payment authority',async()=>{
 const {getSessionByToken,canUser}=await import('../src/lib/auth'),{canManagePayroll}=await import('../src/lib/payroll-permissions');
 const manager=getSessionByToken(tokens[2])!;assert.equal(canManagePayroll(manager),true);assert.equal(canUser(manager,'finance.manage'),false);assert.equal(canUser(manager,'team.manage'),false);
 db.prepare("INSERT INTO users(id,name,email,password_hash,role,branch_id) VALUES(5,'Branch employee','branch-employee@test.invalid','unused','technician',2)").run();
 const {POST}=await import('../src/app/api/payroll/route');
 const profile=await POST(request(2,'/api/payroll',{action:'save_profile',user_id:5,salary_type:'percent',percent_repair:12,percent_parts:0,fixed_monthly:0,is_active:0}));
 assert.equal(profile.status,200,JSON.stringify(await profile.clone().json()));assert.equal(db.prepare('SELECT is_active FROM payroll_profiles WHERE user_id=5').get()!.is_active,0);
 const run=Number(db.prepare("INSERT INTO payroll_runs(user_id,branch_id,base_salary,earned_commission,net_payable,status) VALUES(5,2,100,0,100,'pending')").run().lastInsertRowid);
 assert.equal((await POST(request(2,'/api/payroll',{action:'approve_run',id:run}))).status,403);
 assert.equal((await POST(request(2,'/api/payroll',{action:'pay_run',id:run,amount:100,confirmed:true}))).status,403);
 assert.equal((await POST(request(2,'/api/payroll',{action:'cancel_run',id:run,reason:'Recorded branch manager decision',reference:'Manager-002'}))).status,200);
 assert.equal(db.prepare('SELECT status FROM payroll_runs WHERE id=?').get(run)!.status,'cancelled');
 db.prepare("INSERT INTO user_permissions(user_id,perm,effect) VALUES(2,'payroll.manage','deny')").run();
 assert.equal(canManagePayroll(manager),false);
 assert.equal((await POST(request(2,'/api/payroll',{action:'save_profile',user_id:5,fixed_monthly:999}))).status,403);
});
it('derives accurate tracking examples and rejects invalid payroll reporting filters',()=>{
 assert.equal(trackingExample({}),'مثلاً R0001');assert.equal(trackingExample({ticket_prefix:'RP-',ticket_suffix:'-A'}),'مثلاً RP-0001-A');
 assert.equal(trackingExample({tracking_ticket_example:'پذیرش RP-0123'}),'پذیرش RP-0123');
 assert.throws(()=>payrollQuery({from:'2026-02-30'}),{status:400});assert.throws(()=>payrollQuery({from:'2026-11-03',to:'2026-11-01'}),{status:400});
 assert.deepEqual(payrollRunFilter(payrollQuery({employee:'3',status:'paid'})).params,[3,'paid']);
});
