import {before,after,it} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import type {QueryResultRow} from 'pg';
import {createPostgresDatabase,type PostgresDatabase} from '../../src/lib/db/postgres';
import {applyPostgresMigrations,verifyPostgresMigrations} from '../../src/lib/db/pg-migrations';
import {postgresSessionDigest} from '../../src/lib/db/pg-app-auth';
import {savePostgresWorkflow} from '../../src/lib/db/pg-repair-workflow';
import {assignPostgresRepairs} from '../../src/lib/db/pg-repair-assignment';
import {createPostgresRepairIntake} from '../../src/lib/db/pg-repair-intake';
import {mutatePostgresRepairWork,readPostgresRepairTime,type RepairWorkKind} from '../../src/lib/db/pg-repair-work';
import {verifyPostgresRepairWorkGuards} from '../../src/lib/db/pg-repair-work-guards';
const url=process.env.REPAID_PG_TEST_URL??'',name=process.env.REPAID_PG_TEST_DATABASE??'';
if(!/^repaid_test_[a-f0-9]{24}$/.test(name)||new URL(url).pathname!=='/'+name)throw Error('Disposable PostgreSQL repair fixture required');
const db=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true}),peer=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true}),schema='repaid_integration_'+randomBytes(12).toString('hex'),t=(n:string)=>'"'+schema+'"."'+n+'"',tokens=Array.from({length:5},()=>randomBytes(24).toString('hex')),owner=tokens[1],tech=tokens[2],foreign=tokens[3],other=tokens[4],status=(n:number)=>(e:unknown)=>(e as {status?:number}).status===n;
let revision=1;
before(async()=>{
 await applyPostgresMigrations(db,schema,{targetVersion:1});
 await db.query(`INSERT INTO ${t('branches')}(id,name,code) VALUES(1,'One','WORK1'),(2,'Two','WORK2')`);
 await db.query(`INSERT INTO ${t('users')}(id,name,email,password_hash,role,branch_id) VALUES(1,'Owner','owner@work.invalid','unused','owner',1),(2,'Tech','tech@work.invalid','unused','technician',1),(3,'Foreign','foreign@work.invalid','unused','technician',2),(4,'Other','other@work.invalid','unused','technician',1)`);
 await db.query(`INSERT INTO ${t('customers')}(id,code,first_name,branch_id) VALUES(1,'WORK1','Customer',1)`);
 await db.query(`INSERT INTO ${t('devices')}(id,customer_id,type,branch_id) VALUES(1,1,'mobile',1)`);
 const states=[['New','["Received"]'],['Received','["Diagnosing"]'],['Diagnosing','["In Repair","Quality Control"]'],['In Repair','["Quality Control"]'],['Quality Control','["Ready for Pickup","In Repair"]'],['Ready for Pickup','["Delivered"]'],['Delivered','[]'],['Cancelled','[]']];
 for(let i=0;i<states.length;i++)await db.query(`INSERT INTO ${t('repair_statuses')}(id,name,allowed_next,category,color,is_open,notify_customer) VALUES($1,$2,$3,$4,'blue',$5,1)`,[i+1,...states[i],i<6?'progress':'closed',i<6?1:0]);
 await db.query(`INSERT INTO ${t('repair_tickets')}(id,number,branch_id,customer_id,device_id,status_id,technician_id,checklist,created_by) VALUES(100,'WORK-PRESERVED',1,1,1,3,2,'[{"label":"Original check","required":true,"done":false}]',1),(101,'WORK-OLDER-TIMER',1,1,1,3,2,'[]',1)`);
 await db.query(`INSERT INTO ${t('time_entries')}(id,ticket_id,user_id,started_at) VALUES(100,101,2,$1)`,[new Date(Date.now()-98000).toISOString()]);
 await db.query(`INSERT INTO ${t('time_entries')}(ticket_id,user_id,started_at,ended_at,minutes_active,is_manual,note) SELECT 101,2,'2025-01-01 00:00:00','2025-01-01 00:00:00',3,1,'Preserved manual work' FROM generate_series(1,61)`);
 await db.query(`INSERT INTO ${t('branch_repair_workflows')}(branch_id,mode,revision,updated_by) VALUES(1,'legacy',1,1)`);
 await applyPostgresMigrations(db,schema);
 for(let id=1;id<=4;id++)await db.query(`INSERT INTO ${t('sessions')}(token,user_id,expires_at) VALUES($1,$2,$3)`,[postgresSessionDigest(tokens[id]),id,new Date(Date.now()+3600000).toISOString()]);
 revision=(await savePostgresWorkflow(db,schema,owner,{branch_id:1,mode:'managed',revision,supervisors:[]},'work-managed')).revision;
});
after(async()=>{await peer.close();await db.query('DROP SCHEMA "'+schema+'" CASCADE');await db.close();});
async function intake(key:string){key='fixture-'+key;const ticket=await createPostgresRepairIntake(db,schema,owner,1,{customer_id:1,device_id:1,problem:'Real technical work'},key);const assigned=await assignPostgresRepairs(db,schema,owner,1,{items:[{id:ticket.id,expect:null,version:0,workflow_revision:revision}],technician_id:2},key+'-assign');assert.equal(assigned.summary.ok,1);return ticket.id;}
const work=(id:number,kind:RepairWorkKind,input:Record<string,unknown>,key:string,token=tech,database=db)=>mutatePostgresRepairWork(database,schema,token,1,id,kind,input,key);
const snapshot=async(id:number)=>(await db.query(`SELECT status_id,diagnosis,qc_status,work_version FROM ${t('repair_tickets')} WHERE id=$1`,[id])).rows[0];

it('assigned start preserves one timer, two real transitions, queued notices, audit and durable exact replay',async()=>{
 const id=await intake('work-start');const body={expected_work_version:0,version:1,workflow_revision:revision};
 const result=await work(id,'start',body,'work-start-command');assert.equal(result.status,'Diagnosing');assert.equal(result.timer_started,true);assert.equal(result.work_version,1);
 assert.deepEqual(await work(id,'start',body,'work-start-command'),result);
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('time_entries')} WHERE ticket_id=$1`,[id])).rows[0].n,'1');
 assert.deepEqual((await db.query(`SELECT from_status,to_status FROM ${t('repair_status_history')} WHERE ticket_id=$1 AND work_command_id IS NOT NULL ORDER BY id`,[id])).rows,[{from_status:'1',to_status:'2'},{from_status:'2',to_status:'3'}]);
 assert.deepEqual((await db.query(`SELECT status,COUNT(*) n FROM ${t('messages')} WHERE ticket_id=$1 GROUP BY status`,[id])).rows,[{status:'queued',n:'2'}]);
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('audit_logs')} WHERE entity='repair_work' AND entity_id=$1`,[result.work_id])).rows[0].n,'1');
 await assert.rejects(()=>work(id,'start',{...body,version:2},'work-start-command'),status(409));
 const state=await readPostgresRepairTime(db,schema,tech,1,id);assert.equal(state.running?.id,result.id);assert.equal(state.work_version,1);
 const stopped=await work(id,'time.stop',{expected_work_version:1,previous_entry_id:result.id},'work-stop');assert.equal(stopped.minutes,1);assert.equal((await readPostgresRepairTime(db,schema,tech,1,id)).totalMinutes,1);
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('accounting_journals')}`)).rows[0].n,'0','No fabricated labor wages, WIP or revenue');
});
it('diagnosis, status and QC preserve exact versioned source state and restrict financial completion',async()=>{
 const id=await intake('work-qc');await work(id,'diagnosis',{expected_work_version:0,diagnosis:'Confirmed cause',diagnosis_outcome:'repairable',root_cause:'Actual evidence'},'work-diagnosis');
 await assert.rejects(()=>work(id,'diagnosis',{expected_work_version:0,diagnosis:'Stale'},'work-stale'),status(409));
 await assert.rejects(()=>work(id,'checklist',{expected_work_version:1,index:100,done:true},'work-bad-checklist'),status(400));
 await assert.rejects(()=>work(id,'qc',{expected_work_version:1,result:'pass'},'work-premature-qc'),status(409));
 await work(id,'start',{expected_work_version:1,version:1,workflow_revision:revision},'work-qc-start');
 await work(id,'status',{expected_work_version:2,status:'Quality Control'},'work-to-qc');
 await work(id,'qc',{expected_work_version:3,result:'fail',notes:'Needs correction'},'work-qc-fail');
 assert.equal((await snapshot(id)).qc_status,'failed');assert.equal((await snapshot(id)).status_id,'4');
 await work(id,'status',{expected_work_version:4,status:'Quality Control'},'work-to-qc-again');await work(id,'qc',{expected_work_version:5,result:'pass',notes:'Verified'},'work-qc-pass');
 assert.deepEqual(await snapshot(id),{status_id:'6',diagnosis:'Confirmed cause',qc_status:'passed',work_version:'6'});
 await assert.rejects(()=>work(id,'status',{expected_work_version:6,status:'Delivered'},'work-unsafe-delivery'),status(409));
 assert.equal((await snapshot(id)).work_version,'6');
});
it('branch, assignment and explicit deny apply both to new commands and cached replay',async()=>{
 const id=await intake('work-permission'),body={expected_work_version:0,diagnosis:'Protected evidence'};
 await assert.rejects(()=>mutatePostgresRepairWork(db,schema,foreign,1,id,'diagnosis',body,'work-foreign'),status(403));
 await assert.rejects(()=>work(id,'diagnosis',body,'work-other',other),status(403));
 await assert.rejects(()=>work(id,'time.manual',{expected_work_version:0,minutes:10},'work-unassigned-owner',owner),status(403));
 await work(id,'diagnosis',body,'work-replay-permission');await db.query(`INSERT INTO ${t('user_permissions')}(user_id,perm,effect) VALUES(2,'repairs.edit','deny')`);
 try{await assert.rejects(()=>work(id,'diagnosis',body,'work-replay-permission'),status(403));}finally{await db.query(`DELETE FROM ${t('user_permissions')} WHERE user_id=2 AND perm='repairs.edit'`);}
});
it('failure after all technical effects rolls back timer, status, message, audit and operation before safe retry',async()=>{
 const id=await intake('work-rollback'),body={expected_work_version:0,version:1,workflow_revision:revision};let injected=false;
 const failing:PostgresDatabase={...db,query:async<Row extends QueryResultRow=QueryResultRow>(sql:string,values:unknown[]=[])=>{if(sql.includes('INSERT INTO')&&sql.includes('operation_receipts')&&values[2]==='repair.work.start'){injected=true;return db.query<Row>('SELECT 1/0');}return db.query<Row>(sql,values);}};
 await assert.rejects(()=>work(id,'start',body,'work-injected',tech,failing));assert.equal(injected,true);assert.equal((await snapshot(id)).work_version,'0');
 for(const table of ['messages','time_entries','pg_repair_work_commands'])assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t(table)} WHERE ticket_id=$1`,[id])).rows[0].n,'0');
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('repair_status_history')} WHERE ticket_id=$1`,[id])).rows[0].n,'1');
 assert.equal((await work(id,'start',body,'work-injected')).work_version,1);
});
it('concurrent stale technical writes commit only one source version and never duplicate time',async()=>{
 const id=await intake('work-concurrent'),body={expected_work_version:0,minutes:17,note:'Actual performed labor'};
 const results=await Promise.allSettled([work(id,'time.manual',body,'work-race-one'),work(id,'time.manual',body,'work-race-two',tech,peer)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await readPostgresRepairTime(db,schema,tech,1,id)).totalMinutes,17);assert.equal((await snapshot(id)).work_version,'1');
});
it('native guards reject raw edits and startup detects disabled source-proof triggers',async()=>{
 const id=await intake('work-guards');await assert.rejects(()=>db.query(`UPDATE ${t('repair_tickets')} SET diagnosis='tampered' WHERE id=$1`,[id]));
 await assert.rejects(()=>db.query(`INSERT INTO ${t('time_entries')}(ticket_id,user_id,started_at) VALUES($1,2,$2)`,[id,new Date().toISOString()]));
 await db.query(`ALTER TABLE ${t('pg_repair_work_commands')} DISABLE TRIGGER pg_repair_work_command_commit`);
 try{await assert.rejects(()=>verifyPostgresRepairWorkGuards(db,schema),/trigger missing or altered/);}finally{await db.query(`ALTER TABLE ${t('pg_repair_work_commands')} ENABLE TRIGGER pg_repair_work_command_commit`);}
 assert.equal((await verifyPostgresMigrations(db,schema)).verified,true);
});
it('preserves checklist definitions and finds an older open timer beyond fifty newer entries',async()=>{
 await work(100,'checklist',{expected_work_version:0,index:0,done:true},'work-real-checklist');
 assert.deepEqual(JSON.parse(String((await db.query(`SELECT checklist FROM ${t('repair_tickets')} WHERE id=100`)).rows[0].checklist)),[{label:'Original check',required:true,done:true}]);
 const state=await readPostgresRepairTime(db,schema,tech,1,101);assert.equal(state.entries.length,50);assert.equal(state.total,62);assert.equal(state.totalPages,2);assert.equal(state.running?.id,100);assert.equal(state.totalMinutes,183);
 const stopped=await work(101,'time.stop',{expected_work_version:0,previous_entry_id:state.lastEntryId},'work-old-timer-stop');assert.ok(stopped.minutes!>=2);assert.equal((await readPostgresRepairTime(db,schema,tech,1,101)).totalMinutes,183+stopped.minutes!);
 assert.equal((await readPostgresRepairTime(db,schema,tech,1,101,2)).entries.length,12);
});
it('controlled reassignment safely closes a timer originally created by technical work without rewriting its provenance',async()=>{
 const id=await intake('work-reassigned-timer'),started=await work(id,'start',{expected_work_version:0,version:1,workflow_revision:revision},'work-reassigned-start');
 const assignment={items:[{id,expect:2,version:1,workflow_revision:revision}],technician_id:4,reason:'Documented handover',pause_timers:true};
 assert.equal((await assignPostgresRepairs(db,schema,owner,1,assignment,'work-reassigned-close')).summary.ok,1);
 const time=(await db.query(`SELECT work_created_id,work_closed_id,ended_at,minutes_active FROM ${t('time_entries')} WHERE id=$1`,[started.id])).rows[0];assert.equal(time.work_created_id,String(started.work_id));assert.equal(time.work_closed_id,null);assert.ok(time.ended_at);assert.equal(time.minutes_active,'1');
 await assert.rejects(()=>work(id,'start',{expected_work_version:0,version:1,workflow_revision:revision},'work-reassigned-start'),status(403));
});
it('independent Node processes cannot commit conflicting versions or duplicate performed labor',async()=>{
 const id=await intake('work-processes');
 const run=(key:string)=>new Promise<{ok:boolean;status?:number;code?:string}>((resolve,reject)=>{
  const child=spawn(process.execPath,['--import','tsx','tests/postgres/repair-work-worker.ts'],{env:process.env,windowsHide:true,stdio:['pipe','pipe','pipe']});let output='',errors='';
  const timeout=setTimeout(()=>{child.kill();reject(Error('Independent repair process timed out'));},30000);
  child.stdout.on('data',chunk=>{output+=String(chunk);});child.stderr.on('data',chunk=>{errors+=String(chunk);});child.on('error',error=>{clearTimeout(timeout);reject(error);});
  child.on('close',code=>{clearTimeout(timeout);try{assert.equal(code,0,errors.slice(0,300));resolve(JSON.parse(output));}catch(error){reject(error);}});
  child.stdin.end(JSON.stringify({schema,token:tech,id,key}));
 });
 const results=await Promise.all([run('work-process-one'),run('work-process-two')]);assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.filter(r=>!r.ok&&(r.status===409||r.code==='55P03')).length,1);
 assert.equal((await readPostgresRepairTime(db,schema,tech,1,id)).totalMinutes,23);assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('time_entries')} WHERE ticket_id=$1`,[id])).rows[0].n,'1');
});
