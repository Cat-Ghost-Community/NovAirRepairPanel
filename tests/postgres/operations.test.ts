import {after,before,describe,it} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fork} from 'node:child_process';import {once} from 'node:events';
import {createPostgresDatabase} from '../../src/lib/db/postgres';
import {importSqliteSnapshot,verifyPostgresSnapshot} from '../../src/lib/db/postgres-snapshot';
import {installPostgresLedgerGuards,verifyPostgresLedgerGuards} from '../../src/lib/db/postgres-ledger';
import {installPostgresOperationGuards,verifyPostgresOperationGuards,postgresDurableOperation} from '../../src/lib/db/postgres-operations';
import {postgresCreateManualJournal,postgresPostManualJournal} from '../../src/lib/db/postgres-journals';
import {verifyPostgresLedgerEvidence} from '../../src/lib/db/postgres-ledger-proof';
import {postgresTrialBalance} from '../../src/lib/db/postgres-ledger-reports';
import {operationHash} from '../../src/lib/operation-identity';

const url=process.env.REPAID_PG_TEST_URL??'',database=process.env.REPAID_PG_TEST_DATABASE??'';
if(!/^repaid_test_[a-f0-9]{24}$/.test(database)||new URL(url).pathname!=='/'+database)throw new Error('Disposable PostgreSQL database required');
const db=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true}),other=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true}),directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-pg-operations-'));
let schema='',token='',staffToken='';const table=(name:string)=>'"'+schema+'"."'+name+'"';
before(async()=>{
  process.env.REPAID_DATA_DIR=directory;process.env.REPAID_DEMO_MODE='0';const source=await import('../../src/lib/db/schema');assert.equal(source.DB_PATH,path.join(directory,'repaid.db'));const sqlite=source.getDb();
  sqlite.exec("INSERT INTO branches(id,name,code) VALUES(1,'ONE','ONE'),(2,'TWO','TWO'); INSERT INTO users(id,name,email,password_hash,role,branch_id) VALUES(1,'Owner','owner@test','x','owner',1),(2,'Accountant','staff@test','x','accountant',1)");
  const {createSession}=await import('../../src/lib/auth'),ledger=await import('../../src/lib/accounting');token=createSession(1);staffToken=createSession(2);const owner={user:{id:1,name:'Owner',email:'owner@test',role:'owner',branch_id:1,avatar_color:'blue'}};
  ledger.initializeChart(sqlite,owner);ledger.createPeriod(sqlite,owner,{name:'Test open period',start_date:'2026-10-01',end_date:'2026-10-31'});
  sqlite.prepare("INSERT INTO operation_receipts(actor_id,branch_id,operation,operation_key,request_hash,result_json,scope) VALUES(1,1,'legacy_operation','legacy-key-0001',?,'{\"id\":77}','business')").run(operationHash({amount:77}));sqlite.close();
  const imported=await importSqliteSnapshot(db,path.join(directory,'repaid.db'));schema=imported.schema;
  await installPostgresLedgerGuards(db,schema);assert.equal((await installPostgresOperationGuards(db,schema)).replayed,false);assert.equal((await verifyPostgresSnapshot(db,imported)).verified,true);
});
after(async()=>{await other.close();await db.close();fs.rmSync(directory,{recursive:true,force:true});});
const options=(key:string)=>({permission:'finance.manage',branchId:1,operation:'manual_post',key,payload:{amount:23},scope:'business' as const});
async function post(client:typeof db,key:string){const draft=await postgresCreateManualJournal(client,schema,token,{branch_id:1,posting_date:'2026-10-30',source_type:'manual',source_id:key,event_key:key,memo:'Documented manual operation',lines:[{account_code:'1000',debit:23},{account_code:'4010',credit:23}]});await postgresPostManualJournal(client,schema,token,draft.id,{expectedHash:draft.request_hash});return {id:draft.id,amount:23};}
const status=(wanted:number)=>(error:unknown)=>(error as {status:number}).status===wanted;

describe('PostgreSQL persistent operation identity and real ledger transaction integration',()=>{
  it('verifies native uniqueness/immutability and replays original SQLite identities without executing business work',async()=>{
    assert.equal((await installPostgresOperationGuards(db,schema)).replayed,true);assert.equal((await verifyPostgresLedgerGuards(db,schema)).verified,true);
    let called=false;assert.deepEqual(await postgresDurableOperation(db,schema,token,{...options('legacy-key-0001'),operation:'legacy_operation',payload:{amount:77}},async()=>{called=true;return {id:0};}),{id:77});assert.equal(called,false);
    for(const sql of [`UPDATE ${table('operation_receipts')} SET result_json='{}'`,`DELETE FROM ${table('operation_receipts')}`,`TRUNCATE ${table('operation_receipts')}`])await assert.rejects(()=>db.query(sql),/immutable/);
    await assert.rejects(()=>db.query(`INSERT INTO ${table('operation_receipts')}(actor_id,branch_id,operation,operation_key,request_hash,result_json,scope,created_at) VALUES(1,1,'invalid_result','invalid-json-key',$1,'invalid JSON','branch','2026-10-30')`,[operationHash({amount:23})]),error=>(error as {code:string}).code==='22P02');
  });
  it('posts one exact journal and one durable result across simultaneous independent connections',async()=>{
    let calls=0;const key='concurrent-operation-001',results=await Promise.all([db,other].map(client=>postgresDurableOperation(client,schema,token,options(key),async()=>{calls++;return post(client,key);})));assert.equal(calls,1);assert.deepEqual(results[0],results[1]);
    assert.equal((await db.query(`SELECT count(*) n FROM ${table('accounting_journals')} WHERE event_key=$1 AND state='posted'`,[key])).rows[0].n,'1');
    assert.equal((await db.query(`SELECT count(*) n FROM ${table('audit_logs')} WHERE entity_id=$1 AND entity='accounting_journal' AND action='post'`,[results[0].id])).rows[0].n,'1');
    const report=await postgresTrialBalance(db,schema,token,{branch_id:1,to:'2026-10-31'});assert.equal(report.balanced,true);assert.equal(report.debit,23);assert.equal(report.credit,23);
  });
  it('rejects changed payloads or branches and checks current permissions even for an already completed result',async()=>{
    const key='concurrent-operation-001',work=async()=>{throw new Error('Unauthorized replay must not execute');};
    await assert.rejects(()=>postgresDurableOperation(db,schema,token,{...options(key),payload:{amount:24}},work),status(409));
    assert.equal(typeof (await postgresDurableOperation<{id:number}>(db,schema,token,{...options(key),branchId:2},work)).id,'number');
    await assert.rejects(()=>postgresDurableOperation(db,schema,staffToken,{...options('foreign-branch-key'),branchId:2},work),status(403));
    await postgresDurableOperation(db,schema,staffToken,options('staff-operation-001'),async()=>({approved:true}));
    await db.query(`UPDATE ${table('users')} SET branch_id=2 WHERE id=2`);
    await assert.rejects(()=>postgresDurableOperation(db,schema,staffToken,options('staff-operation-001'),work),status(403));
    await assert.rejects(()=>postgresDurableOperation(db,schema,staffToken,{...options('staff-operation-001'),branchId:2},work),status(409));
    await db.query(`UPDATE ${table('users')} SET branch_id=1 WHERE id=2`);await db.query(`INSERT INTO ${table('user_permissions')}(user_id,perm,effect) VALUES(2,'finance.*','deny')`);
    await assert.rejects(()=>postgresDurableOperation(db,schema,staffToken,options('staff-operation-001'),work),status(403));
  });
  it('rolls back posted journal, chain, audit and identity if business work or durable receipt persistence fails',async()=>{
    const key='rollback-operation-001',before=(await db.query(`SELECT count(*) n FROM ${table('audit_logs')}`)).rows[0].n;
    await assert.rejects(()=>postgresDurableOperation(db,schema,token,options(key),async()=>{await post(db,key);throw new Error('injected interruption');}),/injected interruption/);
    assert.equal((await db.query(`SELECT count(*) n FROM ${table('accounting_journals')} WHERE event_key=$1`,[key])).rows[0].n,'0');assert.equal((await db.query(`SELECT count(*) n FROM ${table('audit_logs')}`)).rows[0].n,before);
    await db.query(`CREATE FUNCTION ${table('fail_operation_write')}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'injected receipt failure'; END$$`);
    await db.query(`CREATE TRIGGER fail_operation_write BEFORE INSERT ON ${table('operation_receipts')} FOR EACH ROW EXECUTE FUNCTION ${table('fail_operation_write')}()`);
    try{await assert.rejects(()=>postgresDurableOperation(db,schema,token,options(key),()=>post(db,key)),/injected receipt failure/);}finally{await db.query(`DROP TRIGGER fail_operation_write ON ${table('operation_receipts')}`);await db.query(`DROP FUNCTION ${table('fail_operation_write')}()`);}
    assert.equal((await db.query(`SELECT count(*) n FROM ${table('accounting_journals')} WHERE event_key=$1`,[key])).rows[0].n,'0');
    await postgresDurableOperation(db,schema,token,options(key),()=>post(db,key));assert.equal((await verifyPostgresLedgerEvidence(db,schema)).valid,true);
  });
  it('commits once across separate processes and recovers after a process dies before its transaction commits',async()=>{
    async function launch(key:string,interrupt=false){const child=fork(path.resolve('tests/postgres/operation-worker.ts'),[],{execArgv:['--import','tsx'],env:process.env,stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});
      await once(child,'message',{signal:AbortSignal.timeout(10000)});const message=once(child,'message',{signal:AbortSignal.timeout(10000)}),exit=once(child,'exit',{signal:AbortSignal.timeout(15000)});child.send({schema,token,key,interrupt});return {child,message,exit};}
    const one=await launch('process-operation-001'),two=await launch('process-operation-001');
    const output=await Promise.all([one,two].map(async item=>{const result=await item.message;const exited=await item.exit;assert.equal(exited[0],0);assert.equal(typeof result[0].id,'number');return result[0] as {id:number};}));assert.equal(output[0].id,output[1].id);
    const interrupted=await launch('process-interrupted-001',true);const message=await interrupted.message;assert.equal(message[0].mutated,true);interrupted.child.kill();await interrupted.exit;
    await postgresDurableOperation(db,schema,token,options('process-interrupted-001'),()=>post(db,'process-interrupted-001'));
    assert.equal((await db.query(`SELECT count(*) n FROM ${table('accounting_journals')} WHERE event_key='process-interrupted-001'`)).rows[0].n,'1');assert.equal((await verifyPostgresLedgerEvidence(db,schema)).valid,true);
  });
  it('rejects altered uniqueness predicates and disabled evidence guards instead of trusting an installation marker',async()=>{
    await assert.rejects(()=>db.transaction(async()=>{await db.query(`DROP INDEX "${schema}".operation_receipt_business_key`);await assert.rejects(()=>verifyPostgresOperationGuards(db,schema),/uniqueness/);throw new Error('restore test alterations');}),/restore test alterations/);
    await assert.rejects(()=>db.transaction(async()=>{await db.query(`DROP INDEX "${schema}".operation_receipt_business_key`);await db.query(`CREATE UNIQUE INDEX operation_receipt_business_key ON ${table('operation_receipts')}(actor_id DESC,operation,operation_key) WHERE scope='business'`);await assert.rejects(()=>verifyPostgresOperationGuards(db,schema),/uniqueness/);throw new Error('restore test alterations');}),/restore test alterations/);
    await assert.rejects(()=>db.transaction(async()=>{await db.query(`ALTER TABLE ${table('operation_receipts')} DISABLE TRIGGER operation_receipt_history`);await assert.rejects(()=>installPostgresOperationGuards(db,schema),/trigger/);throw new Error('restore test alterations');}),/restore test alterations/);
    assert.equal((await verifyPostgresOperationGuards(db,schema)).verified,true);
  });
});
