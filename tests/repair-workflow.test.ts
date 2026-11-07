import {before,after,describe,it} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {NextRequest} from 'next/server';
import {spawn} from 'node:child_process';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-workflow-test-'));process.env.REPAID_DATA_DIR=directory;process.env.REPAID_DEMO_MODE='0';
let db:ReturnType<typeof import('../src/lib/db/schema').getDb>;
let workflow:typeof import('../src/lib/repair-workflow');let auth:typeof import('../src/lib/auth');
const ids:Record<string,number>={},tokens:Record<string,string>={};let seq=0;
const session=(actor:string)=>auth.getSessionByToken(tokens[actor])!;
const request=(actor:string,url:string,body?:unknown,key=crypto.randomUUID())=>new NextRequest('http://workflow.test'+url,{method:body===undefined?'GET':'POST',headers:{cookie:`repaid_session=${tokens[actor]}`,origin:'http://workflow.test','content-type':'application/json','idempotency-key':key},...(body===undefined?{}:{body:JSON.stringify(body)})});
function ticket(branch=1,primary:number|null=null,secondary:number|null=null){return Number(db.prepare("INSERT INTO repair_tickets(number,branch_id,customer_id,device_id,status_id,technician_id,technician2_id) VALUES(?,?,?,?,(SELECT id FROM repair_statuses WHERE name='Received'),?,?)").run('WF-'+ ++seq,branch,ids['customer'+branch],ids['device'+branch],primary,secondary).lastInsertRowid);}
function config(mode:'legacy'|'managed'|'shared',branch=1,supervisors:number[]=[]){return workflow.saveWorkflow(db,session('owner'),{branch_id:branch,mode,revision:workflow.repairWorkflow(db,branch).revision,supervisors,key:crypto.randomUUID()});}
function assign(id:number,target:number,actor='manager',extra:Partial<import('../src/lib/repair-workflow').AssignmentInput>={}){const row=db.prepare('SELECT technician_id,branch_id,assignment_version FROM repair_tickets WHERE id=?').get(id)!;return workflow.changeRepairAssignment(db,session(actor),{ticketId:id,targetId:target,expect:row.technician_id as number|null,version:Number(row.assignment_version),workflowRevision:workflow.repairWorkflow(db,Number(row.branch_id)).revision,...extra});}
before(async()=>{
 const {getDb}=await import('../src/lib/db/schema');db=getDb();auth=await import('../src/lib/auth');workflow=await import('../src/lib/repair-workflow');const {ensureDefaultStatuses}=await import('../src/lib/repair');ensureDefaultStatuses();
 db.exec("INSERT INTO branches(id,name,code) VALUES(1,'First','FIRST'),(2,'Second','SECOND')");
 for(const [actor,role,branch] of [['owner','owner',1],['manager','manager',1],['manager2','manager',2],['tech','technician',1],['tech2','technician',1],['foreign','technician',2],['reception','reception',1],['supervisor','technician',1]] as const){ids[actor]=Number(db.prepare('INSERT INTO users(name,email,password_hash,role,branch_id) VALUES(?,?,?, ?,?)').run(actor,actor+'@workflow.test','invalid',role,branch).lastInsertRowid);tokens[actor]=auth.createSession(ids[actor]);}
 for(const branch of [1,2]){ids['customer'+branch]=Number(db.prepare("INSERT INTO customers(first_name,last_name,mobile,branch_id) VALUES('Workflow','Customer',?,?)").run('0912000000'+branch,branch).lastInsertRowid);ids['device'+branch]=Number(db.prepare("INSERT INTO devices(customer_id,type,branch_id) VALUES(?,'mobile',?)").run(ids['customer'+branch],branch).lastInsertRowid);}
});
after(()=>db.close());
describe('three repair workflows on real SQLite',()=>{
 it('defaults to existing behavior without creating a policy or altering assignments',()=>{const id=ticket(1,ids.tech);assert.deepEqual(workflow.repairWorkflow(db,1),{mode:'legacy',revision:0});assert.equal(workflow.repairReadAssignedOnly(session('tech2')),false);assert.equal(db.prepare('SELECT assignment_version FROM repair_tickets WHERE id=?').get(id)?.assignment_version,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM branch_repair_workflows').get()?.n,0);});
 it('saves only the selected branch, requires company authority and protects stale configuration',()=>{const first=config('managed');assert.equal(first.revision,1);assert.equal(workflow.repairWorkflow(db,2).mode,'legacy');assert.throws(()=>workflow.saveWorkflow(db,session('manager'),{branch_id:1,mode:'shared',revision:1,supervisors:[],key:crypto.randomUUID()}));assert.throws(()=>workflow.saveWorkflow(db,session('owner'),{branch_id:1,mode:'shared',revision:0,supervisors:[],key:crypto.randomUUID()}));assert.equal(workflow.repairWorkflow(db,1).mode,'managed');});
 it('denies technician self-assignment even with a broad permission template',()=>{const id=ticket();db.prepare("INSERT INTO user_permissions(user_id,perm,effect) VALUES(?,'repairs.*','allow')").run(ids.tech);assert.throws(()=>assign(id,ids.tech,'tech'),/مدیر|سرپرست/);assert.equal(db.prepare('SELECT technician_id FROM repair_tickets WHERE id=?').get(id)?.technician_id,null);db.prepare('DELETE FROM user_permissions WHERE user_id=?').run(ids.tech);});
 it('blocks unassigned direct work and old transfer mutations without changing state',async()=>{const id=ticket();const {POST}=await import('../src/app/api/repairs/[id]/diagnosis/route');assert.equal((await POST(request('tech',`/api/repairs/${id}/diagnosis`,{diagnosis:'not allowed'}),{params:Promise.resolve({id:String(id)})})).status,403);const transfers=await import('../src/app/api/repairs/transfers/route');assert.equal((await transfers.POST(request('manager','/api/repairs/transfers',{ticket_id:id,to_user_id:ids.tech}))).status,409);assert.equal(db.prepare('SELECT diagnosis FROM repair_tickets WHERE id=?').get(id)?.diagnosis,null);});
 it('records manager assignment and enables only the assigned worker',async()=>{const id=ticket();assign(id,ids.tech);assert.equal(db.prepare('SELECT COUNT(*) n FROM repair_assignments WHERE ticket_id=?').get(id)?.n,1);assert.doesNotThrow(()=>workflow.enforceRepairWorkflow(session('tech'),id,true));assert.throws(()=>workflow.enforceRepairWorkflow(session('tech2'),id,true));const {POST}=await import('../src/app/api/repairs/[id]/diagnosis/route');assert.equal((await POST(request('tech',`/api/repairs/${id}/diagnosis`,{diagnosis:'Actual diagnosis'}),{params:Promise.resolve({id:String(id)})})).status,200);assert.equal(db.prepare('SELECT diagnosis FROM repair_tickets WHERE id=?').get(id)?.diagnosis,'Actual diagnosis');});
 it('uses canonical assignment and history during intake and rejects unauthorized supplied workers',async()=>{const {POST}=await import('../src/app/api/repairs/route');const body={customer_id:ids.customer1,device_id:ids.device1,problem:'Actual intake',technician_id:ids.tech};const before=db.prepare('SELECT COUNT(*) n FROM repair_tickets').get()!.n;assert.equal((await POST(request('reception','/api/repairs',body))).status,403);assert.equal(db.prepare('SELECT COUNT(*) n FROM repair_tickets').get()!.n,before);const response=await POST(request('manager','/api/repairs',body));assert.equal(response.status,200);const {id}=await response.json();assert.equal(db.prepare('SELECT to_user_id FROM repair_assignments WHERE ticket_id=?').get(id)?.to_user_id,ids.tech);});
 it('permits explicitly designated local supervisors, never self-delegation or cross-branch assignment',()=>{config('managed',1,[ids.supervisor]);assert.equal(auth.canUser(session('supervisor'),'repairs.assign'),true);assign(ticket(),ids.tech,'supervisor');assert.throws(()=>assign(ticket(),ids.supervisor,'supervisor'),/خودش/);assert.throws(()=>assign(ticket(2),ids.foreign,'supervisor'),/شعبه/);config('managed');assert.throws(()=>assign(ticket(),ids.tech,'supervisor'),/سرپرست/);});
 it('invalidates supervisor authority immediately after employment transfer',()=>{config('managed',1,[ids.supervisor]);db.prepare('UPDATE users SET branch_id=2 WHERE id=?').run(ids.supervisor);assert.equal(auth.canUser(session('supervisor'),'repairs.assign'),false);assert.throws(()=>assign(ticket(),ids.tech,'supervisor'));db.prepare('UPDATE users SET branch_id=1 WHERE id=?').run(ids.supervisor);config('managed');});
 it('requires explicit timer handover and preserves previous labor during reassignment',()=>{const id=ticket(1,ids.tech);db.prepare("INSERT INTO time_entries(ticket_id,user_id,started_at) VALUES(?,?,datetime('now','-20 minutes'))").run(id,ids.tech);assert.throws(()=>assign(id,ids.tech2,'manager',{reason:'Handover'}),/زمان/);assert.equal(db.prepare('SELECT technician_id FROM repair_tickets WHERE id=?').get(id)?.technician_id,ids.tech);assign(id,ids.tech2,'manager',{reason:'Handover',pauseTimers:true});const time=db.prepare('SELECT ended_at,minutes_active,user_id FROM time_entries WHERE ticket_id=?').get(id)!;assert.ok(time.ended_at);assert.equal(time.minutes_active,20);assert.equal(time.user_id,ids.tech);assert.throws(()=>workflow.enforceRepairWorkflow(session('tech'),id,true));assert.doesNotThrow(()=>workflow.enforceRepairWorkflow(session('tech2'),id,true));});
 it('rejects stale A-B-A versions and closed assignments',()=>{const id=ticket(1,ids.tech);assign(id,ids.tech2,'manager',{reason:'First change'});assign(id,ids.tech,'manager',{reason:'Second change'});assert.throws(()=>assign(id,ids.tech2,'manager',{reason:'Old tab',version:0}),/تغییر/);db.prepare("UPDATE repair_tickets SET status_id=(SELECT id FROM repair_statuses WHERE name='Delivered') WHERE id=?").run(id);assert.throws(()=>assign(id,ids.tech2,'manager',{reason:'Closed'}),/بسته|تحویل/);});
 it('rolls assignment, timer, notification and history back on injected audit failure',()=>{const id=ticket(1,ids.tech);db.prepare("INSERT INTO time_entries(ticket_id,user_id,started_at) VALUES(?,?,datetime('now','-10 minutes'))").run(id,ids.tech);const count=db.prepare('SELECT COUNT(*) n FROM notifications').get()!.n;db.exec("CREATE TRIGGER workflow_fail BEFORE INSERT ON audit_logs WHEN NEW.action='assign' BEGIN SELECT RAISE(ABORT,'injected failure'); END");try{assert.throws(()=>assign(id,ids.tech2,'manager',{reason:'Failure test',pauseTimers:true}));}finally{db.exec('DROP TRIGGER workflow_fail');}assert.equal(db.prepare('SELECT technician_id FROM repair_tickets WHERE id=?').get(id)?.technician_id,ids.tech);assert.equal(db.prepare('SELECT ended_at FROM time_entries WHERE ticket_id=?').get(id)?.ended_at,null);assert.equal(db.prepare('SELECT COUNT(*) n FROM repair_assignments WHERE ticket_id=?').get(id)?.n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get()!.n,count);});
 it('filters queues by current employment and includes explicit secondary assignments',async()=>{const old=ticket(2,ids.tech),secondary=ticket(1,ids.tech2,ids.tech);const {myQueue}=await import('../src/lib/repair-assign');const result=myQueue(session('tech'));const all=[...result.not_started,...result.in_progress,...result.ready].map(t=>t.id);assert.equal(all.includes(old),false);assert.equal(all.includes(secondary),true);});
 it('starts work atomically once with the actual assigned worker',async()=>{const id=ticket(1,ids.tech);db.prepare("UPDATE repair_tickets SET status_id=(SELECT id FROM repair_statuses WHERE name='Diagnosing') WHERE id=?").run(id);const {startRepair}=await import('../src/lib/repair-assign');assert.equal(startRepair(session('tech'),id).timer_started,true);assert.equal(startRepair(session('tech'),id).timer_started,false);assert.equal(db.prepare('SELECT COUNT(*) n FROM time_entries WHERE ticket_id=?').get(id)?.n,1);});
 it('shared queue exposes only local unassigned stock and claim commits once with durable replay',async()=>{config('shared');const id=ticket(),foreign=ticket(2);const {GET}=await import('../src/app/api/repairs/available/route');const listed=await (await GET(request('tech','/api/repairs/available'))).json();assert.ok(listed.tickets.some((t:{id:number})=>t.id===id));assert.equal(listed.tickets.some((t:{id:number})=>t.id===foreign),false);assert.equal(listed.tickets.some((t:Record<string,unknown>)=>'customer_mobile' in t),false);const {POST}=await import('../src/app/api/repairs/claim/route');const body={ticket_id:id,version:0,workflow_revision:workflow.repairWorkflow(db,1).revision},key=crypto.randomUUID();assert.equal((await POST(request('tech','/api/repairs/claim',body,key))).status,200);assert.equal((await POST(request('tech','/api/repairs/claim',body,key))).status,200);assert.equal(db.prepare('SELECT COUNT(*) n FROM repair_assignments WHERE ticket_id=?').get(id)?.n,1);assert.equal((await POST(request('tech2','/api/repairs/claim',body))).status,409);assert.equal((await POST(request('tech','/api/repairs/claim',{...body,ticket_id:ticket()},key))).status,409);});
 it('managed mode blocks claims and ignores the old visibility toggle',async()=>{config('managed');db.prepare("INSERT INTO settings(key,value) VALUES('flag:repairs.only_assigned','0') ON CONFLICT(key) DO UPDATE SET value='0'").run();assert.equal(workflow.repairReadAssignedOnly(session('tech')),true);const {POST}=await import('../src/app/api/repairs/claim/route');assert.equal((await POST(request('tech','/api/repairs/claim',{ticket_id:ticket(),version:0,workflow_revision:workflow.repairWorkflow(db,1).revision}))).status,409);});
 it('preserves all financial records and legacy mode can be selected again',()=>{for(const table of ['payments','refunds','journal_entries','inventory_movements']){if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n,0);}config('legacy');assert.equal(workflow.repairReadAssignedOnly(session('tech')),false);assert.equal(workflow.repairWorkflow(db,2).mode,'legacy');});
});

describe('workflow concurrency, recovery and paging',()=>{
 it('allows exactly one independent process to claim the remaining assignment',async()=>{
  config('shared');const id=ticket(),revision=workflow.repairWorkflow(db,1).revision;
  const run=(actor:string)=>new Promise<number>((resolve,reject)=>{const child=spawn(process.execPath,['--import','tsx','tests/repair-workflow-race-worker.ts',directory,tokens[actor],String(id),String(revision),crypto.randomUUID()],{cwd:process.cwd(),windowsHide:true});let output='',errors='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>errors+=c);child.on('error',reject);child.on('close',code=>{if(code)reject(Error(errors));else resolve(JSON.parse(output.trim()).status);});});
  assert.deepEqual((await Promise.all([run('tech'),run('tech2')])).sort(),[200,409]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM repair_assignments WHERE ticket_id=?').get(id)?.n,1);
 });
 it('makes manager assignment replay durable and payload-bound',async()=>{
  config('managed');const id=ticket(),revision=workflow.repairWorkflow(db,1).revision;
  const {POST}=await import('../src/app/api/repairs/assign/route');const key=crypto.randomUUID(),body={items:[{id,expect:null,version:0,workflow_revision:revision}],technician_id:ids.tech,operation_key:key};
  const first=await POST(request('manager','/api/repairs/assign',body));assert.equal(first.status,200);assert.equal((await first.json()).summary.ok,1);
  const replay=await POST(request('manager','/api/repairs/assign',body));assert.equal((await replay.json()).summary.ok,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM repair_assignments WHERE ticket_id=?').get(id)?.n,1);
  assert.equal((await POST(request('manager','/api/repairs/assign',{...body,technician_id:ids.tech2}))).status,409);
 });
 it('rolls status and timer creation back together on a timer insert failure',async()=>{
  config('managed');const id=ticket(1,ids.tech);const status=db.prepare("SELECT id FROM repair_statuses WHERE name='Diagnosing'").get()!.id;db.prepare('UPDATE repair_tickets SET status_id=? WHERE id=?').run(status,id);
  db.exec("CREATE TRIGGER fail_workflow_timer BEFORE INSERT ON time_entries BEGIN SELECT RAISE(ABORT,'injected timer failure'); END");
  const {startRepair}=await import('../src/lib/repair-assign');try{assert.throws(()=>startRepair(session('tech'),id));}finally{db.exec('DROP TRIGGER fail_workflow_timer');}
  assert.equal(db.prepare('SELECT status_id FROM repair_tickets WHERE id=?').get(id)?.status_id,status);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM time_entries WHERE ticket_id=?').get(id)?.n,0);
 });
 it('keeps grouped intake atomic when a supplied target belongs to another branch',async()=>{
  const {POST}=await import('../src/app/api/repairs/bulk/route');const before=db.prepare('SELECT COUNT(*) n FROM repair_tickets').get()!.n;
  const response=await POST(request('manager','/api/repairs/bulk',{customer_id:ids.customer1,devices:[{device_id:ids.device1,technician_id:ids.tech},{device_id:ids.device1,technician_id:ids.foreign}]}));
  assert.equal(response.status,400);assert.equal(db.prepare('SELECT COUNT(*) n FROM repair_tickets').get()!.n,before);
 });
 it('supports later assignment/queue pages and paginated supervisor search',async()=>{
  config('managed');for(let i=0;i<65;i++)ticket(1,ids.tech);
  const {myQueue,assignmentDashboard}=await import('../src/lib/repair-assign');const first=myQueue(session('tech'),null,{page:'1'}),second=myQueue(session('tech'),null,{page:'2'});
  const list=(r:typeof first)=>[...r.not_started,...r.in_progress,...r.ready].map(x=>x.id);assert.ok(second.paging.totalPages>=2);assert.equal(list(first).some(id=>list(second).includes(id)),false);
  assert.ok(assignmentDashboard(session('manager'),{page:'2'}).paging.page===2);
  for(let i=0;i<25;i++)db.prepare("INSERT INTO users(name,email,password_hash,role,branch_id) VALUES(?,?,'invalid','reception',1)").run('Paged employee '+String(i).padStart(2,'0'),'paged'+i+'@workflow.test');
  const staff=workflow.workflowSettings(db,session('owner'),1,'Paged employee',2);assert.equal(staff.employee_total,25);assert.equal(staff.employee_page,2);assert.equal(staff.employees.length,5);
 });
 it('never resurrects an old supervisor grant after an employee returns to the branch',()=>{
  config('managed',1,[ids.supervisor]);db.prepare('UPDATE users SET branch_id=2 WHERE id=?').run(ids.supervisor);db.prepare('UPDATE users SET branch_id=1 WHERE id=?').run(ids.supervisor);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM repair_workflow_supervisors WHERE user_id=?').get(ids.supervisor)?.n,0);
  assert.equal(workflow.canAssignRepair(session('supervisor'),1),false);
 });
});

describe('workflow handover and request recovery',()=>{
 it('starts fresh assigned intake with receipt and diagnosis, then replays without new timers',async()=>{
  config('managed');const id=ticket(1,ids.tech);db.prepare("UPDATE repair_tickets SET status_id=(SELECT id FROM repair_statuses WHERE name='New') WHERE id=?").run(id);
  const {POST}=await import('../src/app/api/repairs/[id]/start/route');const key=crypto.randomUUID(),body={version:0,workflow_revision:workflow.repairWorkflow(db,1).revision},params={params:Promise.resolve({id:String(id)})};
  const first=await POST(request('tech',`/api/repairs/${id}/start`,body,key),params);assert.equal(first.status,200);assert.equal((await first.json()).status,'Diagnosing');
  const replay=await POST(request('tech',`/api/repairs/${id}/start`,body,key),params);assert.equal(replay.status,200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM time_entries WHERE ticket_id=?').get(id)?.n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM repair_status_history WHERE ticket_id=?').get(id)?.n,2);
 });
 it('makes time recording payload-bound and rejects stale timer contexts',async()=>{
  const id=ticket(1,ids.tech);const {POST}=await import('../src/app/api/repairs/[id]/time/route');const params={params:Promise.resolve({id:String(id)})},key=crypto.randomUUID(),body={action:'manual',minutes:15,note:'Actual work',previous_entry_id:0};
  assert.equal((await POST(request('tech',`/api/repairs/${id}/time`,body,key),params)).status,200);
  assert.equal((await POST(request('tech',`/api/repairs/${id}/time`,body,key),params)).status,200);
  assert.equal(db.prepare('SELECT SUM(minutes_active) n FROM time_entries WHERE ticket_id=?').get(id)?.n,15);
  assert.equal((await POST(request('tech',`/api/repairs/${id}/time`,{...body,minutes:30},key),params)).status,409);
  assert.equal((await POST(request('tech',`/api/repairs/${id}/time`,body),params)).status,409);
 });
 it('records helper ownership changes and blocks supervisor self-assignment through helper field',()=>{
  const id=ticket(1,ids.tech2);assign(id,ids.tech2,'manager',{helperId:ids.tech,reason:'Explicit helper'});
  assert.equal(db.prepare('SELECT to_helper_id FROM repair_assignments WHERE ticket_id=?').get(id)?.to_helper_id,ids.tech);
  assert.ok(db.prepare('SELECT 1 FROM notifications WHERE user_id=? AND link=?').get(ids.tech,`/repairs/${id}`));
  assign(id,ids.tech2,'manager',{helperId:null,reason:'Helper released'});assert.throws(()=>workflow.enforceRepairWorkflow(session('tech'),id,true));
  config('managed',1,[ids.supervisor]);assert.throws(()=>assign(ticket(),ids.tech,'supervisor',{helperId:ids.supervisor}),/خودش/);config('managed');
 });
 it('rejects a workflow change while an authorized request body is still streaming',async()=>{
  config('managed');const id=ticket(1,ids.tech);const {POST}=await import('../src/app/api/repairs/[id]/diagnosis/route');let controller!:ReadableStreamDefaultController<Uint8Array>;
  const body=new ReadableStream<Uint8Array>({start(c){controller=c;}});const init={method:'POST',body,duplex:'half' as const,headers:{cookie:`repaid_session=${tokens.tech}`,origin:'http://workflow.test','content-type':'application/json'}};
  const pending=POST(new NextRequest(`http://workflow.test/api/repairs/${id}/diagnosis`,init),{params:Promise.resolve({id:String(id)})});await new Promise(resolve=>setImmediate(resolve));config('shared');controller.enqueue(new TextEncoder().encode(JSON.stringify({diagnosis:'Stale request'})));controller.close();
  assert.equal((await pending).status,409);assert.equal(db.prepare('SELECT diagnosis FROM repair_tickets WHERE id=?').get(id)?.diagnosis,null);config('managed');
 });
 it('keeps similar-work notes within branch and explicit assignment scope',async()=>{
  const current=ticket(1,ids.tech),own=ticket(1,ids.tech),unassigned=ticket(),foreign=ticket(2);
  for(const id of [own,unassigned,foreign])db.prepare("INSERT INTO repair_notes(ticket_id,user_id,body,kind) VALUES(?,?,'Unique workflow knowledge','internal')").run(id,ids.tech2);
  const {GET}=await import('../src/app/api/repairs/[id]/notes/route');const response=await GET(request('tech',`/api/repairs/${current}/notes?q=Unique`),{params:Promise.resolve({id:String(current)})});assert.equal(response.status,200);assert.equal((await response.json()).notes.length,1);
 });
 it('replays settings approval without a second configuration revision',()=>{
  const revision=workflow.repairWorkflow(db,1).revision,input={branch_id:1,mode:'shared' as const,revision,supervisors:[],key:crypto.randomUUID()};
  const first=workflow.saveWorkflow(db,session('owner'),input),again=workflow.saveWorkflow(db,session('owner'),input);assert.equal(first.revision,again.revision);assert.equal(workflow.repairWorkflow(db,1).revision,revision+1);
 });
});

describe('workflow worker-time boundaries',()=>{
 it('uses the same receipt/diagnosis start from the detail timer and denies manager labor attribution',async()=>{
  config('managed');const id=ticket(1,ids.tech);db.prepare("UPDATE repair_tickets SET status_id=(SELECT id FROM repair_statuses WHERE name='New') WHERE id=?").run(id);
  const {POST}=await import('../src/app/api/repairs/[id]/time/route');const params={params:Promise.resolve({id:String(id)})};
  assert.equal((await POST(request('manager',`/api/repairs/${id}/time`,{action:'start'}),params)).status,403);
  const key=crypto.randomUUID(),body={action:'start',previous_entry_id:0};assert.equal((await POST(request('tech',`/api/repairs/${id}/time`,body,key),params)).status,200);assert.equal((await POST(request('tech',`/api/repairs/${id}/time`,body,key),params)).status,200);
  assert.equal(db.prepare('SELECT s.name FROM repair_tickets t JOIN repair_statuses s ON s.id=t.status_id WHERE t.id=?').get(id)?.name,'Diagnosing');assert.equal(db.prepare('SELECT COUNT(*) n FROM time_entries WHERE ticket_id=?').get(id)?.n,1);
 });
 it('rejects invalid manual time instead of fabricating a minute of labor',async()=>{
  const id=ticket(1,ids.tech),{POST}=await import('../src/app/api/repairs/[id]/time/route'),params={params:Promise.resolve({id:String(id)})};
  for(const minutes of [-5,0,1.5,'invalid'])assert.equal((await POST(request('tech',`/api/repairs/${id}/time`,{action:'manual',minutes}),params)).status,400);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM time_entries WHERE ticket_id=?').get(id)?.n,0);
 });
 it('counts and filters inbox stages across every scoped page rather than only loaded cards',async()=>{
  config('managed');
  const awaiting=ticket(1);db.prepare('UPDATE repair_tickets SET number=? WHERE id=?').run('INBOX-SUM-WAIT',awaiting);
  for(let i=0;i<60;i++){const id=ticket(1,ids.tech);db.prepare('UPDATE repair_tickets SET number=? WHERE id=?').run(`INBOX-SUM-${i}`,id);}
  const progress=ticket(1,ids.tech);db.prepare("UPDATE repair_tickets SET number='INBOX-SUM-WORK',status_id=(SELECT id FROM repair_statuses WHERE name='Diagnosing') WHERE id=?").run(progress);
  const foreign=ticket(2,ids.foreign);db.prepare("UPDATE repair_tickets SET number='INBOX-SUM-FOREIGN' WHERE id=?").run(foreign);
  const {assignmentDashboard}=await import('../src/lib/repair-assign');
  const first=assignmentDashboard(session('manager'),{q:'INBOX-SUM',perPage:'20'});
  assert.deepEqual(first.summary,{awaiting:1,assigned:60,in_progress:1});assert.equal(first.paging.total,62);assert.equal(first.awaiting.length,0);
  const filtered=assignmentDashboard(session('manager'),{q:'INBOX-SUM',phase:'awaiting',page:'5'});
  assert.equal(filtered.paging.total,1);assert.equal(filtered.paging.page,1);assert.equal(filtered.awaiting[0].id,awaiting);assert.deepEqual(filtered.summary,first.summary);
  assert.throws(()=>assignmentDashboard(session('manager'),{phase:'invalid'}),/فیلتر مرحله نامعتبر/);
 });
 it('offers delegated supervisors only eligible coworkers while preserving legacy choices',async()=>{
  const {GET}=await import('../src/app/api/repairs/technicians/route');
  config('managed',1,[ids.supervisor]);
  const response=await GET(request('supervisor','/api/repairs/technicians'));
  assert.equal(response.status,200);
  const data=await response.json();
  assert.ok(data.technicians.some((t:{id:number})=>t.id===ids.tech));
  assert.ok(data.technicians.every((t:{id:number;branch_id:number})=>t.id!==ids.supervisor&&t.branch_id===1));
  config('legacy');
  const legacy=await GET(request('manager','/api/repairs/technicians'));
  assert.ok((await legacy.json()).technicians.some((t:{id:number})=>t.id===ids.supervisor));
 });
 it('returns scoped branch and helper identity for inbox cards and rejects reversed date filters',async()=>{
  config('managed');
  const id=ticket(1,ids.tech,ids.tech2),foreign=ticket(2,ids.foreign);
  const {assignmentDashboard}=await import('../src/lib/repair-assign');
  const number=String(db.prepare('SELECT number FROM repair_tickets WHERE id=?').get(id)!.number);
  const data=assignmentDashboard(session('manager'),{q:number});
  assert.equal(data.paging.total,1);
  const card=[...data.awaiting,...data.assigned][0];
  assert.equal(card.id,id);assert.equal(card.branch_name,'First');assert.equal(card.technician2_name,'tech2');
  assert.ok(!data.assigned.some(c=>c.id===foreign));
  const {GET}=await import('../src/app/api/repairs/assignment/route');
  assert.equal((await GET(request('manager','/api/repairs/assignment?date_from=2026-12-01&date_to=2026-01-01'))).status,400);
 });
});
