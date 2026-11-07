import {before,after,describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createPostgresDatabase} from '../../src/lib/db/postgres';
import {applyPostgresMigrations} from '../../src/lib/db/pg-migrations';
import {hashLoginPassword} from '../../src/lib/credential-verification';
import {postgresSessionDigest} from '../../src/lib/db/pg-app-auth';
import {DuplicatePostgresCustomer,PostgresCustomersRepository,requestedPostgresBranch} from '../../src/lib/db/pg-customers';

const url=process.env.REPAID_PG_TEST_URL??'',name=process.env.REPAID_PG_TEST_DATABASE??'';
if(!/^repaid_test_[a-f0-9]{24}$/.test(name)||new URL(url).pathname!=='/'+name)throw Error('Run through scripts/test-postgres.ts with a disposable database');
const db=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true,maxConnections:4,statementTimeoutMs:30000,lockTimeoutMs:3000}),other=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true,maxConnections:3,statementTimeoutMs:30000,lockTimeoutMs:3000});
const schema='repaid_integration_'+randomBytes(12).toString('hex'),table=(value:string)=>'"'+schema+'"."'+value+'"',repository=new PostgresCustomersRepository(db,schema),otherRepository=new PostgresCustomersRepository(other,schema);
const owner=randomBytes(24).toString('hex'),staffOne=randomBytes(24).toString('hex'),staffTwo=randomBytes(24).toString('hex'),peer=randomBytes(24).toString('hex'),technician=randomBytes(24).toString('hex');
const status=(expected:number)=>(error:unknown)=>(error as {status?:number}).status===expected;
let firstId=0;
async function state(){return (await db.query(`SELECT (SELECT COUNT(*) FROM ${table('customers')}) customers,(SELECT COALESCE(MAX(value),0) FROM ${table('counters')} WHERE key='customer') counter,(SELECT COUNT(*) FROM ${table('audit_logs')} WHERE entity='customer') audit,(SELECT COUNT(*) FROM ${table('customer_events')}) events,(SELECT COUNT(*) FROM ${table('operation_receipts')} WHERE operation='customer.create') operations,(SELECT COUNT(*) FROM ${table('accounting_journals')}) journals`)).rows[0];}

before(async()=>{
 await applyPostgresMigrations(db,schema);
 await db.query(`INSERT INTO ${table('branches')}(id,name,code) VALUES(1,'Branch one','AUTH_ONE'),(2,'Branch two','AUTH_TWO')`);
 const passwordHash=await hashLoginPassword('Disposable customer test credential 275');
 await db.query(`INSERT INTO ${table('users')}(id,name,email,password_hash,role,branch_id) VALUES(1,'Owner','owner@customers.invalid',$1,'owner',1),(2,'Branch one staff','one@customers.invalid',$1,'reception',1),(3,'Branch two staff','two@customers.invalid',$1,'reception',2),(4,'Peer owner','peer@customers.invalid',$1,'owner',1),(5,'Technician','tech@customers.invalid',$1,'technician',1)`,[passwordHash]);
 for(const [token,user] of [[owner,1],[staffOne,2],[staffTwo,3],[peer,4],[technician,5]] as const)await db.query(`INSERT INTO ${table('sessions')}(token,user_id,expires_at) VALUES($1,$2,$3)`,[postgresSessionDigest(token),user,new Date(Date.now()+86400000).toISOString()]);
 await db.query(`INSERT INTO ${table('settings')}(key,value) VALUES('default_credit_limit','1500000')`);
});
after(async()=>{await db.query('DROP SCHEMA "'+schema+'" CASCADE');await other.close();await db.close();});

describe('real PostgreSQL customer vertical slice on the production migration schema',()=>{
 it('creates exact persisted contact, counter, branch, audit and event without manufacturing a financial journal',async()=>{
  const result=await repository.create(staffOne,1,{first_name:'مشتری',last_name:'آزمایشی',mobile:'+98 912 345 6789',credit_limit:'9007199254740991',tags:['خدمات'],is_vip:true},'first_customer_275');
  firstId=result.id;assert.equal(result.code,'C0001');assert.equal(result.redirect,'/customers/'+result.id);
  const actual=(await db.query(`SELECT id,code,first_name,mobile,credit_limit,tags,branch_id,created_by,is_vip FROM ${table('customers')} WHERE id=$1`,[firstId])).rows[0];
  assert.deepEqual(actual,{id:String(firstId),code:'C0001',first_name:'مشتری',mobile:'09123456789',credit_limit:'9007199254740991',tags:'["خدمات"]',branch_id:'1',created_by:'2',is_vip:'1'});
  const audit=(await db.query(`SELECT user_id,action,entity,entity_id,"after",branch_id FROM ${table('audit_logs')} WHERE entity='customer' AND entity_id=$1`,[firstId])).rows[0];
  assert.equal(audit.user_id,'2');assert.equal(audit.action,'create');assert.equal(audit.branch_id,'1');assert.deepEqual(JSON.parse(audit.after),{code:'C0001',branch_id:1});
  const event=(await db.query(`SELECT customer_id,type,user_id,branch_id FROM ${table('customer_events')} WHERE customer_id=$1`,[firstId])).rows[0];assert.deepEqual(event,{customer_id:String(firstId),type:'customer',user_id:'2',branch_id:'1'});
  assert.deepEqual(await state(),{customers:'1',counter:'1',audit:'1',events:'1',operations:'1',journals:'0'});
  const protectedRead=await repository.get(staffOne,1,firstId);assert.equal(protectedRead.code,'C0001');assert.equal(protectedRead.credit_limit,Number.MAX_SAFE_INTEGER);assert.equal(protectedRead.branch_id,1);assert.equal(protectedRead.balance,null);assert.equal((await repository.list(staffOne,1)).customers[0].balance,null);
 });
 it('replays an identical request durably and rejects changed payload without repeating any side effect',async()=>{
  const payload={first_name:'Replay fixture',email:'replay@customers.invalid'},key='replay_customer_275',result=await repository.create(staffOne,1,payload,key),before=await state();
  assert.deepEqual(await otherRepository.create(staffOne,1,payload,key),result);assert.deepEqual(await state(),before);
  await assert.rejects(()=>otherRepository.create(staffOne,1,{...payload,first_name:'Changed request'},key),status(409));assert.deepEqual(await state(),before);
 });
 it('rejects malformed exact money, typed options, NUL text and unsupported financial referral without persistence',async()=>{
  const before=await state();for(const payload of [{first_name:'Invalid credit',credit_limit:'-1'},{first_name:'Invalid credit',credit_limit:'1.5'},{first_name:'Invalid credit',credit_limit:'9007199254740992'},{first_name:'Invalid option',is_vip:'true'},{first_name:'Invalid tags',tags:[3]},{first_name:'Invalid\0text'},{first_name:'Invalid tag text',tags:['bad\0tag']},{first_name:'No key'}])await assert.rejects(()=>repository.create(staffOne,1,payload,payload.first_name==='No key'?null:'invalid_customer_275'),status(400));
  await assert.rejects(()=>repository.create(staffOne,1,{first_name:'Unsupported referral',referrer_customer_id:1},'referral_customer_275'),status(409));assert.deepEqual(await state(),before);
 });
 it('serializes same-key requests across independent pools and binds operation identity to the actual actor',async()=>{
  const payload={first_name:'Concurrent replay contact'},key='concurrent_customer_275',before=await state(),results=await Promise.all([repository.create(staffOne,1,payload,key),otherRepository.create(staffOne,1,payload,key)]);
  assert.equal(results[0].id,results[1].id);const after=await state();for(const field of ['customers','counter','audit','events','operations'] as const)assert.equal(BigInt(after[field])-BigInt(before[field]),BigInt(1));assert.equal(after.journals,'0');
  const actorPayload={first_name:'Independent actor identity',force:true},actorKey='actor_identity_customer_275',differentActors=await Promise.all([repository.create(owner,1,actorPayload,actorKey),otherRepository.create(peer,1,actorPayload,actorKey)]);assert.notEqual(differentActors[0].id,differentActors[1].id);
  const receipts=(await db.query(`SELECT actor_id,result_json FROM ${table('operation_receipts')} WHERE operation_key=$1 ORDER BY actor_id`,[actorKey])).rows;assert.deepEqual(receipts.map(row=>row.actor_id),['1','4']);assert.notEqual(JSON.parse(receipts[0].result_json).id,JSON.parse(receipts[1].result_json).id);
 });
 it('rejects duplicate contacts within the authorized scope and protects simultaneous different-key creation',async()=>{
  const before=await state();await assert.rejects(()=>repository.create(staffOne,1,{first_name:'Duplicate fixture',mobile:'09123456789'},'duplicate_customer_275'),(error:unknown)=>error instanceof DuplicatePostgresCustomer&&error.duplicates.some(row=>row.id===firstId));assert.deepEqual(await state(),before);
  const input={first_name:'Concurrent email duplication',email:'concurrent-dupe@customers.invalid'},results=await Promise.allSettled([repository.create(owner,1,input,'duplicate_race_customer_a'),otherRepository.create(peer,1,input,'duplicate_race_customer_b')]);assert.equal(results.filter(row=>row.status==='fulfilled').length,1);const rejected=results.find(row=>row.status==='rejected') as PromiseRejectedResult;assert.ok(rejected.reason instanceof DuplicatePostgresCustomer);
  assert.equal((await db.query(`SELECT COUNT(*) n FROM ${table('customers')} WHERE email=$1`,[input.email])).rows[0].n,'1');
  const branchTwo=await repository.create(staffTwo,2,{first_name:'Same phone independent branch',mobile:'09123456789'},'branch_two_same_contact_275');assert.equal((await repository.get(staffTwo,2,branchTwo.id)).branch_id,2);
 });
 it('enforces current employment, explicit denies, object scope and direct forged-branch/token rejection',async()=>{
  const before=await state();await assert.rejects(()=>repository.get(staffTwo,2,firstId),status(404));await assert.rejects(()=>repository.get(staffOne,2,firstId),status(403));await assert.rejects(()=>repository.list(staffOne,2),status(403));await assert.rejects(()=>repository.create(staffOne,1,{first_name:'Forged branch',branch_id:2},'forged_branch_customer_275'),status(403));await assert.rejects(()=>repository.create(technician,1,{first_name:'Denied technician'},'forbidden_customer_275'),status(403));await assert.rejects(()=>repository.list('forged-token',1),status(401));assert.deepEqual(await state(),before);
  const owned=await repository.create(staffOne,1,{first_name:'Employment replay fixture'},'employment_customer_275');await db.query(`UPDATE ${table('users')} SET branch_id=2 WHERE id=2`);
  try{await assert.rejects(()=>repository.create(staffOne,1,{first_name:'Employment replay fixture'},'employment_customer_275'),status(403));await assert.rejects(()=>repository.get(staffOne,null,owned.id),status(404));assert.equal((await repository.get(owner,null,owned.id)).id,owned.id);}finally{await db.query(`UPDATE ${table('users')} SET branch_id=1 WHERE id=2`);}
  await db.query(`INSERT INTO ${table('user_permissions')}(user_id,perm,effect) VALUES(2,'customers.*','deny')`);try{await assert.rejects(()=>repository.list(staffOne,1),status(403));}finally{await db.query(`DELETE FROM ${table('user_permissions')} WHERE user_id=2 AND perm='customers.*'`);}
 });
 it('rechecks duplicate visibility after a real mid-request owner downgrade waits on the actor lock',async()=>{
  const contact='role-downgrade@customers.invalid',hidden=await repository.create(staffTwo,2,{first_name:'Hidden second-branch contact',email:contact},'downgrade_hidden_customer_275');
  let markReady!:()=>void,markFailed!:(error:unknown)=>void,release!:()=>void;
  const ready=new Promise<void>((resolve,reject)=>{markReady=resolve;markFailed=reject;}),resume=new Promise<void>(resolve=>{release=resolve;});
  const holding=other.transaction(async()=>{await other.query(`UPDATE ${table('users')} SET role='reception' WHERE id=1`);markReady();await resume;});
  void holding.catch(markFailed);await ready;
  let pending:Promise<{value?:{id:number};error?:unknown}>|undefined;
  try{
   // MVCC preauthorization sees the old owner role; the later authoritative
   // FOR UPDATE must wait for the uncommitted downgrade above.
   pending=repository.create(owner,null,{first_name:'First-branch contact after downgrade',email:contact},'downgrade_create_customer_275').then(value=>({value}),error=>({error}));
   let blocked=false;const deadline=Date.now()+2000;
   while(Date.now()<deadline){
    const waiting=await db.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1 AND query LIKE '%FOR UPDATE OF u,s%'`,['%'+schema+'%']);
    if(waiting.rowCount){blocked=true;break;}
    await new Promise(resolve=>setTimeout(resolve,20));
   }
   assert.equal(blocked,true,'Authoritative creation must be observed waiting on the real user-row lock');
   release();await holding;const result=await pending;assert.equal(result.error,undefined);assert.ok(result.value);
   const own=await repository.get(owner,null,result.value.id);assert.equal(own.branch_id,1);assert.equal(own.created_by,1);
   await assert.rejects(()=>repository.get(owner,null,hidden.id),status(404));
   assert.equal((await db.query(`SELECT COUNT(*) n FROM ${table('customers')} WHERE email=$1`,[contact])).rows[0].n,'2');
  }finally{release();await holding;if(pending)await pending;await db.query(`UPDATE ${table('users')} SET role='owner' WHERE id=1`);}
 });
 it('rolls actual customer/counter/audit/event/receipt changes back on injected database failure and permits safe retry',async()=>{
  const before=await state();await db.query(`CREATE FUNCTION "${schema}".customer_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $fault$ BEGIN IF NEW.entity='customer' THEN RAISE EXCEPTION 'Injected customer audit failure' USING ERRCODE='23514'; END IF; RETURN NEW; END $fault$`);await db.query(`CREATE TRIGGER customer_audit_failure BEFORE INSERT ON ${table('audit_logs')} FOR EACH ROW EXECUTE FUNCTION "${schema}".customer_audit_failure()`);
  const payload={first_name:'Rollback contact'},key='rollback_customer_275';try{await assert.rejects(()=>repository.create(staffOne,1,payload,key),(error:unknown)=>(error as {code?:string}).code==='23514');assert.deepEqual(await state(),before);}finally{await db.query(`DROP TRIGGER customer_audit_failure ON ${table('audit_logs')}`);await db.query(`DROP FUNCTION "${schema}".customer_audit_failure()`);}
  const result=await otherRepository.create(staffOne,1,payload,key);assert.equal((await repository.get(staffOne,1,result.id)).first_name,payload.first_name);const after=await state();assert.equal(BigInt(after.counter),BigInt(before.counter)+BigInt(1));assert.equal(BigInt(after.operations),BigInt(before.operations)+BigInt(1));
 });
 it('paginates more than fifty persisted customer operations and preserves protected exact read results',async()=>{
  for(let index=0;index<55;index++)await repository.create(staffOne,1,{first_name:'Pagination fixture '+String(index).padStart(2,'0'),credit_limit:'0'},'pagination_customer_'+index);
  const first=await repository.list(staffOne,1,{q:'Pagination fixture'}),second=await repository.list(staffOne,1,{q:'pAGINATION fixture',page:2});assert.equal(first.total,55);assert.equal(first.customers.length,50);assert.equal(second.total,55);assert.equal(second.customers.length,5);assert.equal(new Set([...first.customers,...second.customers].map(row=>row.id)).size,55);assert.ok(first.customers.every(row=>row.balance===null));assert.equal((await repository.list(staffTwo,2,{q:'Pagination fixture'})).total,0);
  assert.equal((await repository.list(owner,null,{q:'Pagination fixture'})).total,55);assert.equal((await repository.list(owner,null,{q:"' OR 1=1 --"})).total,0);assert.equal((await db.query(`SELECT COUNT(*) n FROM ${table('accounting_journals')}`)).rows[0].n,'0');
  assert.equal(requestedPostgresBranch('all'),null);assert.equal(requestedPostgresBranch('2'),2);assert.throws(()=>requestedPostgresBranch('2 OR 1=1'),status(400));await assert.rejects(()=>repository.list(staffOne,1,{page:0}),status(400));await assert.rejects(()=>repository.list(staffOne,1,{perPage:101}),status(400));
 });
});
