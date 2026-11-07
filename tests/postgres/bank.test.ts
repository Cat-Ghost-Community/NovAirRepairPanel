import {before,after,describe,it} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fork} from 'node:child_process';import {once} from 'node:events';
import {createPostgresDatabase} from '../../src/lib/db/postgres';
import {importSqliteSnapshot,verifyPostgresSnapshot} from '../../src/lib/db/postgres-snapshot';
import {installPostgresLedgerGuards,verifyPostgresLedgerGuards} from '../../src/lib/db/postgres-ledger';
import {installPostgresOperationGuards} from '../../src/lib/db/postgres-operations';
import {installPostgresBankGuards,verifyPostgresBankGuards} from '../../src/lib/db/postgres-bank-schema';
import {postgresMutateBank,postgresBankPosition} from '../../src/lib/db/postgres-bank';
import {verifyPostgresLedgerEvidence} from '../../src/lib/db/postgres-ledger-proof';
import {DatabaseSync} from 'node:sqlite';

const url=process.env.REPAID_PG_TEST_URL??'',database=process.env.REPAID_PG_TEST_DATABASE??'';
if(!/^repaid_test_[a-f0-9]{24}$/.test(database)||new URL(url).pathname!=='/'+database)throw new Error('Disposable PostgreSQL bank test database required');
const db=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true}),other=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true}),directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-pg-bank-'));
let schema='',token='',second='',staff='',source:Awaited<ReturnType<typeof importSqliteSnapshot>>,legacy:unknown;const originalEngine=process.env.REPAID_DATABASE_ENGINE;
const table=(name:string)=>'"'+schema+'"."'+name+'"',body={action:'transfer',amount:100,from_account:1,to_account:2,date:'2026-10-30'};
const status=(n:number)=>(error:unknown)=>(error as {status:number}).status===n;
before(async()=>{
 process.env.REPAID_DATA_DIR=directory;process.env.REPAID_DEMO_MODE='0';const sourceModule=await import('../../src/lib/db/schema');assert.equal(sourceModule.DB_PATH,path.join(directory,'repaid.db'));const sqlite=sourceModule.getDb();
 sqlite.exec("INSERT INTO branches(id,name,code) VALUES(1,'ONE','ONE'),(2,'TWO','TWO');INSERT INTO users(id,name,email,password_hash,role,branch_id) VALUES(1,'Owner','o@test','x','owner',1),(2,'Other owner','a@test','x','admin',2),(3,'Staff','s@test','x','accountant',1);INSERT INTO bank_accounts(id,name,current_balance) VALUES(1,'Source',1000),(2,'Target',250),(3,'Range',9007199254740990)");
 sqlite.exec('BEGIN');const historical=sqlite.prepare("INSERT INTO bank_transactions(account_id,type,amount,date,user_id) VALUES(1,'deposit',1,'2026-09-01',1)");for(let n=0;n<104;n++)historical.run();sqlite.exec('COMMIT');
 const auth=await import('../../src/lib/auth'),ledger=await import('../../src/lib/accounting'),bank=await import('../../src/lib/bank'),operations=await import('../../src/lib/idempotency');token=auth.createSession(1);second=auth.createSession(2);staff=auth.createSession(3);
 const owner={user:{id:1,name:'Owner',email:'o@test',role:'owner',branch_id:1,avatar_color:'blue'}};
 ledger.initializeChart(sqlite,owner);ledger.createPeriod(sqlite,owner,{name:'Test year',start_date:'2026-01-01',end_date:'2026-12-31'});
 const input={...body,amount:17};legacy=operations.durableOperation(sqlite,{actorId:1,branchId:1,operation:'bank_mutation',scope:'business',key:'legacy-bank-operation',payload:input},()=>bank.mutateBank(sqlite,owner,input));sqlite.close();
 source=await importSqliteSnapshot(db,path.join(directory,'repaid.db'));schema=source.schema;
 await installPostgresLedgerGuards(db,schema);await installPostgresOperationGuards(db,schema);await installPostgresBankGuards(db,schema);
 process.env.REPAID_DATABASE_ENGINE='postgres';
});
after(async()=>{if(originalEngine==null)delete process.env.REPAID_DATABASE_ENGINE;else process.env.REPAID_DATABASE_ENGINE=originalEngine;await other.close();await db.close();const target=fs.realpathSync(directory),parent=fs.realpathSync(os.tmpdir());if(path.dirname(target)!==parent||!path.basename(target).startsWith('repaid-pg-bank-'))throw Error('Invalid disposable bank cleanup path');fs.rmSync(target,{recursive:true,force:true});});
async function balances(){return (await db.query(`SELECT id,current_balance FROM ${table('bank_accounts')} WHERE id IN (1,2) ORDER BY id`)).rows.map(row=>Number(row.current_balance));}
async function counts(){return Promise.all(['bank_transactions','accounting_events','audit_logs','operation_receipts','accounting_journals'].map(async name=>(await db.query(`SELECT COUNT(*) n FROM ${table(name)}`)).rows[0].n));}
describe('native PostgreSQL bank register with existing source events and durable transactions',()=>{
 it('preserves copied rows and legacy identities without inventing approved opening balances or old events',async()=>{
  assert.equal((await verifyPostgresSnapshot(db,source)).verified,true);assert.equal((await installPostgresBankGuards(db,schema)).replayed,true);assert.equal((await verifyPostgresLedgerGuards(db,schema)).verified,true);
  assert.deepEqual(await balances(),[983,267]);const before=await counts();assert.deepEqual(await postgresMutateBank(db,schema,token,'legacy-bank-operation',{...body,amount:17}),legacy);assert.deepEqual(await counts(),before);
  const report=await postgresBankPosition(db,schema,token);assert.equal(report.accounting_certified,false);assert.equal(report.accounts[0].baseline,983);assert.equal(report.accounts[0].missing_source_count,104);assert.equal(report.accounts[0].pending_posting_count,1);assert.equal(report.accounts[0].register_reconciled,true);assert.ok(report.accounts[0].flags.includes('legacy_baseline_unverified'));
 });
 it('records one exact reciprocal transfer, source snapshots, audit and operation identity atomically',async()=>{
  const result=await postgresMutateBank(db,schema,token,'native-bank-operation-001',body);assert.equal(result.ok,true);assert.equal(result.accounting_state,'pending_review');assert.equal(result.external_execution,false);assert.deepEqual(await balances(),[883,367]);
  const pair=(await db.query(`SELECT type,amount,account_id,to_account_id FROM ${table('bank_transactions')} WHERE operation_group=(SELECT operation_group FROM ${table('bank_transactions')} WHERE id=$1) ORDER BY id`,[result.id])).rows;
  assert.deepEqual(pair.map(row=>({...row})),[{type:'transfer_out',amount:'100',account_id:'1',to_account_id:'2'},{type:'transfer_in',amount:'100',account_id:'2',to_account_id:'1'}]);
  const before=await counts();assert.deepEqual(await postgresMutateBank(other,schema,token,'native-bank-operation-001',body),result);assert.deepEqual(await counts(),before);
  await db.query(`UPDATE ${table('users')} SET branch_id=2 WHERE id=1`);assert.deepEqual(await postgresMutateBank(db,schema,token,'native-bank-operation-001',body),result);await db.query(`UPDATE ${table('users')} SET branch_id=1 WHERE id=1`);
  assert.equal((await db.query(`SELECT COUNT(*) n FROM ${table('accounting_events')} WHERE source_type='bank' AND actor_id=1 AND branch_id=1`)).rows[0].n,'4');
  const report=await postgresBankPosition(db,schema,token);assert.equal(report.accounts[0].registered_balance,883);assert.equal(report.accounts[0].movement_delta,-100);assert.equal(report.accounts[0].ledger_balance,0);assert.equal(report.accounts[0].pending_posting_count,2);assert.equal((await verifyPostgresLedgerEvidence(db,schema)).valid,true);
 });
 it('rejects invalid money, same accounts, unsafe range, inactive/missing accounts and noncentral staff without mutation',async()=>{
  const before=await counts(),values=await balances();
  await assert.rejects(()=>postgresMutateBank(db,schema,staff,'denied-bank-operation',body),status(403));await assert.rejects(()=>postgresBankPosition(db,schema,staff),status(403));
  for(const extra of [{amount:1.5},{from_account:1,to_account:1},{type:'online',action:undefined},{date:'2027-02-30'},{ref:{bad:true}}])await assert.rejects(()=>postgresMutateBank(db,schema,token,'bad-bank-operation-001',{...body,...extra} as never),status(400));
  await assert.rejects(()=>postgresMutateBank(db,schema,token,'missing-bank-operation',{...body,to_account:999}),status(404));
  await assert.rejects(()=>postgresMutateBank(db,schema,token,'overflow-bank-operation',{...body,amount:2,to_account:3}),status(400));
  await assert.rejects(()=>postgresMutateBank(db,schema,token,'native-bank-operation-001',{...body,amount:99}),status(409));assert.deepEqual(await counts(),before);assert.deepEqual(await balances(),values);
 });
 it('prevents lost updates under opposing transfers from two independently authorized managers',async()=>{
  const before=await balances();const results=await Promise.all([postgresMutateBank(db,schema,token,'opposing-bank-operation-001',{...body,amount:31}),postgresMutateBank(other,schema,second,'opposing-bank-operation-002',{...body,amount:19,from_account:2,to_account:1})]);assert.notEqual(results[0].id,results[1].id);
  const after=await balances();assert.deepEqual(after,[before[0]-12,before[1]+12]);assert.equal(after[0]+after[1],1250);
 });
 it('commits one transfer across independent processes and recovers a killed writer before deferred commit',async()=>{
  const children:ReturnType<typeof fork>[]=[];
  const launch=async(key:string,interrupt=false)=>{const child=fork(path.resolve('tests/postgres/bank-worker.ts'),[],{execArgv:['--import','tsx'],env:process.env,stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});children.push(child);await once(child,'message',{signal:AbortSignal.timeout(10000)});const message=once(child,'message',{signal:AbortSignal.timeout(10000)}),exit=once(child,'exit',{signal:AbortSignal.timeout(15000)});child.send({schema,token,key,body:{...body,amount:7},interrupt});return {child,message,exit};};
  try{
   const values=await balances(),one=await launch('process-bank-operation-001'),two=await launch('process-bank-operation-001');
   const replies=await Promise.all([one,two].map(async item=>{const message=await item.message,exit=await item.exit;assert.equal(exit[0],0);assert.equal(message[0].ok,true);return message[0] as {id:number};}));assert.equal(replies[0].id,replies[1].id);assert.deepEqual(await balances(),[values[0]-7,values[1]+7]);
   const before=await counts(),beforeValues=await balances(),interrupted=await launch('interrupted-bank-operation-001',true);assert.equal((await interrupted.message)[0].mutated,true);assert.deepEqual(await balances(),beforeValues);interrupted.child.kill();await interrupted.exit;
   assert.deepEqual(await counts(),before);assert.deepEqual(await balances(),beforeValues);
   await postgresMutateBank(db,schema,token,'interrupted-bank-operation-001',{...body,amount:7});assert.deepEqual(await balances(),[beforeValues[0]-7,beforeValues[1]+7]);assert.equal((await verifyPostgresLedgerEvidence(db,schema)).valid,true);
  }finally{for(const child of children)if(child.exitCode==null&&child.signalCode==null){const ended=once(child,'exit');child.kill();await ended;}}
 });
 it('rolls account changes, both documents, events and identity back after incoming, audit and deferred source failures',async()=>{
  for(const kind of ['incoming','audit','source']){
   const values=await balances(),before=await counts(),key='failed-bank-'+kind+'-0001';
   const name='inject_bank_'+kind,relation=kind==='incoming'?'bank_transactions':kind==='audit'?'audit_logs':'accounting_events';
   const condition=kind==='incoming'?"NEW.type='transfer_in'":kind==='audit'?"NEW.entity='bank_transaction'":"NEW.source_type='bank'";
   await db.query(`CREATE FUNCTION ${table(name)}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN ${kind==='source'?'RETURN NULL;':"RAISE EXCEPTION 'injected bank failure';"} END$$`);
   await db.query(`CREATE TRIGGER ${name} BEFORE INSERT ON ${table(relation)} FOR EACH ROW WHEN (${condition}) EXECUTE FUNCTION ${table(name)}()`);
   try{await assert.rejects(()=>postgresMutateBank(db,schema,token,key,{...body,amount:3}),kind==='source'?/source event/:/injected bank failure/);}finally{await db.query(`DROP TRIGGER ${name} ON ${table(relation)}`);await db.query(`DROP FUNCTION ${table(name)}()`);}
   assert.deepEqual(await balances(),values);assert.deepEqual(await counts(),before);
   await postgresMutateBank(db,schema,token,key,{...body,amount:3});assert.deepEqual(await balances(),[values[0]-3,values[1]+3]);
  }
 });
 it('rejects unilateral or mismatched transfer commits and blocks cache, baseline and history rewrites',async()=>{
  const before=await counts(),values=await balances();
  for(const mismatch of [false,true])await assert.rejects(()=>db.transaction(async()=>{
    const group=(mismatch?'b':'a').repeat(32);
    await db.query(`INSERT INTO ${table('bank_transactions')}(account_id,type,amount,to_account_id,date,user_id,operation_group) VALUES(1,'transfer_out',5,2,'2026-10-30',1,$1)`,[group]);
    if(mismatch)await db.query(`INSERT INTO ${table('bank_transactions')}(account_id,type,amount,to_account_id,date,user_id,operation_group) VALUES(2,'transfer_in',6,1,'2026-10-30',1,$1)`,[group]);
  }),/reciprocal pair/);
  for(const sql of [`UPDATE ${table('bank_accounts')} SET current_balance=current_balance+1 WHERE id=1`,`UPDATE ${table('bank_accounts')} SET register_base_value=0 WHERE id=1`,`DELETE FROM ${table('bank_transactions')} WHERE id=1`,`UPDATE ${table('bank_transactions')} SET amount=2 WHERE id=1`,`TRUNCATE ${table('bank_transactions')}`])await assert.rejects(()=>db.query(sql),/immutable|documented movement/);
  assert.deepEqual(await balances(),values);assert.deepEqual(await counts(),before);
 });
 it('uses bounded account/history pagination and exposes legacy gaps instead of certifying the register as the ledger',async()=>{
  const one=await postgresBankPosition(db,schema,token,{page:1,size:1});assert.equal(one.has_more,true);assert.equal(one.accounts[0].id,1);assert.equal(one.transactions.length,100);assert.ok(one.next_before);
  const next=await postgresBankPosition(db,schema,token,{page:2,size:1,before:one.next_before!});assert.equal(next.accounts[0].id,2);assert.ok(next.transactions.every(row=>row.id<one.next_before!));assert.equal(new Set([...one.transactions,...next.transactions].map(row=>row.id)).size,one.transactions.length+next.transactions.length);
  const explicit=await db.query(`INSERT INTO ${table('bank_accounts')}(name,current_balance,is_active) VALUES('New explicit zero',0,1) RETURNING id`),id=Number(explicit.rows[0].id);const report=await postgresBankPosition(db,schema,token,{account_id:id});assert.equal(report.accounts[0].registered_balance,0);assert.equal(report.accounts[0].baseline_kind,'explicit_new_zero');assert.ok(report.accounts[0].flags.includes('opening_not_approved'));
  await assert.rejects(()=>db.query(`INSERT INTO ${table('bank_accounts')}(name,current_balance,is_active) VALUES('Invented opening',5,1)`),/reviewed opening/);assert.equal((await verifyPostgresBankGuards(db,schema)).verified,true);
 });
 it('detects disabled deferred checks and baseline tampering instead of trusting a migration marker',async()=>{
  await assert.rejects(()=>db.transaction(async()=>{await db.query(`ALTER TABLE ${table('bank_transactions')} DISABLE TRIGGER bank_port_proof`);await assert.rejects(()=>verifyPostgresBankGuards(db,schema),/provenance drift/);throw new Error('restore isolated alteration');}),/restore isolated alteration/);
  assert.equal((await verifyPostgresBankGuards(db,schema)).verified,true);
 });
 it('rejects unknown legacy balances and rolls failed DDL back before a verified retry on separate restored fixtures',async()=>{
  const bad=path.join(directory,'invalid-bank.db');fs.copyFileSync(path.join(directory,'repaid.db'),bad);const invalid=new DatabaseSync(bad);invalid.exec('UPDATE bank_accounts SET current_balance=NULL WHERE id=1');invalid.close();
  const broken=await importSqliteSnapshot(db,bad);await installPostgresLedgerGuards(db,broken.schema);await installPostgresOperationGuards(db,broken.schema);
  await assert.rejects(()=>installPostgresBankGuards(db,broken.schema),/evidence-based review/);assert.equal((await verifyPostgresSnapshot(db,broken)).verified,true);
  assert.equal((await db.query("SELECT COUNT(*) n FROM information_schema.columns WHERE table_schema=$1 AND column_name='register_base_value'",[broken.schema])).rows[0].n,'0');
  const restored=await importSqliteSnapshot(db,path.join(directory,'repaid.db')),q=(name:string)=>'"'+restored.schema+'"."'+name+'"';await installPostgresLedgerGuards(db,restored.schema);await installPostgresOperationGuards(db,restored.schema);
  await db.query(`CREATE FUNCTION ${q('bank_port_apply')}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW;END$$`);
  await assert.rejects(()=>installPostgresBankGuards(db,restored.schema),error=>(error as {code:string}).code==='42723');assert.equal((await verifyPostgresSnapshot(db,restored)).verified,true);
  assert.equal((await db.query("SELECT COUNT(*) n FROM information_schema.columns WHERE table_schema=$1 AND column_name='register_base_value'",[restored.schema])).rows[0].n,'0');
  await db.query(`DROP FUNCTION ${q('bank_port_apply')}()`);await installPostgresBankGuards(db,restored.schema);assert.equal((await verifyPostgresSnapshot(db,restored)).verified,true);
 });
});
