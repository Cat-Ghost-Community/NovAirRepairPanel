import {before,after,describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import path from 'node:path';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {createPostgresDatabase} from '../../src/lib/db/postgres';
import {applyPostgresMigrations,verifyPostgresMigrations} from '../../src/lib/db/pg-migrations';
import {postgresInitializeChart,postgresCreatePeriod,postgresSetPeriodState} from '../../src/lib/db/postgres-accounting';
import {postgresCreateExpense,postgresExpenses} from '../../src/lib/db/pg-expenses';
import {postgresMutateBank,postgresBankPosition} from '../../src/lib/db/postgres-bank';
import {postgresMutateCheck,postgresChecks} from '../../src/lib/db/pg-checks';
import {reviewPostgresFinancialEvent} from '../../src/lib/db/postgres-financial-events';
import {verifyPostgresLedgerEvidence} from '../../src/lib/db/postgres-ledger-proof';
import {verifyPostgresBankGuards} from '../../src/lib/db/postgres-bank-schema';
import {postgresCreateManualJournal,postgresEditManualJournal,postgresPostManualJournal,postgresReverseManualJournal,postgresVoidManualJournal} from '../../src/lib/db/postgres-journals';
import {postgresTrialBalance,postgresGeneralLedger,postgresFinancialStatements} from '../../src/lib/db/postgres-ledger-reports';

const url=process.env.REPAID_PG_TEST_URL??'',database=process.env.REPAID_PG_TEST_DATABASE??'';
if(!/^repaid_test_[a-f0-9]{24}$/.test(database)||new URL(url).pathname!=='/'+database)throw Error('Disposable PostgreSQL test database required');
const db=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true}),other=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true,lockTimeoutMs:300});
const schema='repaid_integration_'+randomBytes(12).toString('hex'),table=(name:string)=>'"'+schema+'"."'+name+'"';
const tokens=[randomBytes(24).toString('hex'),randomBytes(24).toString('hex'),randomBytes(24).toString('hex')],day=new Date().toISOString().slice(0,10);
const status=(expected:number)=>(error:unknown)=>(error as {status?:number}).status===expected;
const balances=async()=>(await db.query(`SELECT current_balance FROM ${table('bank_accounts')} ORDER BY id`)).rows.map(row=>Number(row.current_balance));
const counts=async()=>{const result=[];for(const name of ['expenses','checks','bank_transactions','accounting_events','accounting_journals','operation_receipts','audit_logs'])result.push((await db.query(`SELECT COUNT(*)::text n FROM ${table(name)}`)).rows[0].n);return result;};
before(async()=>{
 await applyPostgresMigrations(db,schema);await verifyPostgresMigrations(db,schema);
 await db.query(`INSERT INTO ${table('branches')}(id,name,code) VALUES(1,'Financial one','FN1'),(2,'Financial two','FN2')`);
 await db.query(`INSERT INTO ${table('users')}(id,name,email,password_hash,role,branch_id) VALUES(1,'Owner','one@finance.invalid','fixture-unused','owner',1),(2,'Other','two@finance.invalid','fixture-unused','admin',2),(3,'Scoped','staff@finance.invalid','fixture-unused','accountant',1)`);
 for(let index=0;index<tokens.length;index++)await db.query(`INSERT INTO ${table('sessions')}(token,user_id,expires_at) VALUES($1,$2,$3)`,['sha256:'+createHash('sha256').update(tokens[index]).digest('hex'),index+1,new Date(Date.now()+3600000).toISOString()]);
 for(const perm of ['finance.manage','finance.view','expenses.manage','expenses.view'])await db.query(`INSERT INTO ${table('user_permissions')}(user_id,perm,effect) VALUES(3,$1,'allow')`,[perm]);
 await postgresInitializeChart(db,schema,tokens[0]);await postgresCreatePeriod(db,schema,tokens[0],{name:'Financial current year',start_date:day.slice(0,4)+'-01-01',end_date:day.slice(0,4)+'-12-31'});
 await db.query(`INSERT INTO ${table('bank_accounts')}(id,name,current_balance) VALUES(1,'First',0),(2,'Second',0)`);
});
after(async()=>{try{await db.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');}finally{await other.close();await db.close();}});

describe('canonical PostgreSQL bank, cheque and expense source-to-ledger integration',()=>{
 it('starts an explicitly new zero register without imported baseline fiction and posts an exact reviewed source',async()=>{
  const result=await postgresMutateBank(db,schema,tokens[0],'financial-bank-deposit-001',{account_id:1,type:'deposit',amount:1000,date:day,ref:'synthetic-owner-contribution'});
  assert.deepEqual(await balances(),[1000,0]);assert.equal(result.external_execution,false);
  const event=(await db.query(`SELECT id,payload_json FROM ${table('accounting_events')} WHERE source_type='bank' AND source_id=$1`,[String(result.id)])).rows[0];assert.equal(JSON.parse(event.payload_json).control_amount,1000);
  await reviewPostgresFinancialEvent(db,schema,tokens[1],Number(event.id),{posting_date:day,reason:'Independently reviewed synthetic owner contribution',lines:[{account_code:'1020',debit:1000},{account_code:'3000',credit:1000}]});
  const report=await postgresBankPosition(db,schema,tokens[0]);assert.equal(report.accounts[0].registered_balance,1000);assert.equal(report.accounts[0].ledger_balance,1000);assert.equal(report.accounts[0].register_reconciled,true);assert.equal(report.accounts[0].baseline_kind,'explicit_new_zero');assert.equal(report.accounts[0].pending_posting_count,0);
  assert.equal((await verifyPostgresBankGuards(db,schema)).verified,true);assert.equal((await verifyPostgresLedgerEvidence(db,schema)).valid,true);
 });
 it('records reciprocal transfer exactly once and leaves unapproved pair recognition explicitly pending',async()=>{
  const input={action:'transfer',from_account:1,to_account:2,amount:101,date:day};
  const result=await postgresMutateBank(db,schema,tokens[0],'financial-bank-transfer-001',input),before=await counts();
  assert.deepEqual(await balances(),[899,101]);assert.deepEqual(await postgresMutateBank(other,schema,tokens[0],'financial-bank-transfer-001',input),result);assert.deepEqual(await counts(),before);
  await assert.rejects(()=>postgresMutateBank(other,schema,tokens[0],'financial-bank-transfer-001',{...input,amount:102}),status(409));
  const events=(await db.query(`SELECT e.id FROM ${table('accounting_events')} e JOIN ${table('bank_transactions')} b ON b.id::text=e.source_id WHERE e.source_type='bank' AND b.operation_group=(SELECT operation_group FROM ${table('bank_transactions')} WHERE id=$1)`,[result.id])).rows;
  assert.equal(events.length,2);for(const event of events)await assert.rejects(()=>reviewPostgresFinancialEvent(db,schema,tokens[1],Number(event.id),{posting_date:day,reason:'Cannot post a single transfer leg',lines:[{account_code:'1020',debit:101},{account_code:'3000',credit:101}]}),status(409));
 });
 it('records, reviews and reconciles a cash expense with exact immutable journal amounts',async()=>{
  const body={amount:400,category:'Synthetic operating expense',method:'cash',date:day};
  const result=await postgresCreateExpense(db,schema,tokens[0],1,'financial-expense-create-001',body),before=await counts();
  assert.deepEqual(await postgresCreateExpense(other,schema,tokens[0],1,'financial-expense-create-001',body),result);assert.deepEqual(await counts(),before);
  const event=(await db.query(`SELECT id FROM ${table('accounting_events')} WHERE source_type='expense' AND source_id=$1`,[String(result.id)])).rows[0];
  const reviewed=await reviewPostgresFinancialEvent(db,schema,tokens[1],Number(event.id),{posting_date:day,reason:'Independent synthetic cash expense evidence',lines:[{account_code:'6000',debit:400},{account_code:'1000',credit:400}]});
  const lines=(await db.query(`SELECT account_code,debit,credit FROM ${table('accounting_lines')} WHERE journal_id=$1 ORDER BY position`,[reviewed.journal_id])).rows;
  assert.deepEqual(lines,[{account_code:'6000',debit:'400',credit:'0'},{account_code:'1000',debit:'0',credit:'400'}]);
  await assert.rejects(()=>db.query(`UPDATE ${table('expenses')} SET amount=1 WHERE id=$1`,[result.id]));
  await assert.rejects(()=>db.query(`DELETE FROM ${table('accounting_lines')} WHERE journal_id=$1`,[reviewed.journal_id]));
 });
 it('does not count an uncleared cheque as cash and settles exactly one real linked bank movement',async()=>{
  const created=await postgresMutateCheck(db,schema,tokens[0],1,'financial-check-create-001',{amount:250,kind:'received',number:'TEST-CHEQUE-1',due_date:day});
  const before=await balances();await postgresMutateCheck(db,schema,tokens[0],1,'financial-check-deposit-001',{id:created.id,action:'deposit_bank',bank_account_id:1});assert.deepEqual(await balances(),before);
  const deposited=(await db.query(`SELECT payload_json FROM ${table('accounting_events')} WHERE event_key=$1`,['cheque:'+created.id+':deposit_bank'])).rows[0];assert.equal(JSON.parse(deposited.payload_json).control_amount,0);
  const settled=await postgresMutateCheck(db,schema,tokens[2],1,'financial-check-pass-001',{id:created.id,action:'pass'});assert.equal(settled.already,false);assert.deepEqual(await balances(),[before[0]+250,before[1]]);
  const movements=(await db.query(`SELECT id,amount,account_id FROM ${table('bank_transactions')} WHERE check_id=$1`,[created.id])).rows;assert.equal(movements.length,1);assert.equal(movements[0].amount,'250');
  const state=await counts();const repeated=await postgresMutateCheck(db,schema,tokens[0],1,'financial-check-pass-other-key',{id:created.id,action:'pass'});assert.equal(repeated.already,true);assert.equal((await counts())[2],state[2]);
  await assert.rejects(()=>postgresMutateCheck(db,schema,tokens[0],1,'financial-check-bounce-after-pass',{id:created.id,action:'bounce'}),status(409));
  const linked=(await db.query(`SELECT id FROM ${table('accounting_events')} WHERE source_type='bank' AND source_id=$1`,[String(movements[0].id)])).rows[0];
  await assert.rejects(()=>reviewPostgresFinancialEvent(db,schema,tokens[0],Number(linked.id),{posting_date:day,reason:'Must not recognize a cleared cheque twice',lines:[{account_code:'1020',debit:250},{account_code:'3000',credit:250}]}),status(409));
 });
 it('enforces branch scope even for direct commands and preserves centralized register restrictions',async()=>{
  const before=await counts();await assert.rejects(()=>postgresCreateExpense(db,schema,tokens[2],2,'financial-expense-cross-branch',{amount:1,category:'Denied'}),status(403));
  await assert.rejects(()=>postgresChecks(db,schema,tokens[2],2),status(403));await assert.rejects(()=>postgresBankPosition(db,schema,tokens[2]),status(403));
  const owned=await postgresExpenses(db,schema,tokens[2],1);assert.equal(owned.expenses.length,1);assert.ok(owned.expenses.every(row=>row.branch_id===1));assert.deepEqual(await counts(),before);
 });
 it('rejects a transferred employee retrying an old branch-scoped financial nonce in their new branch',async()=>{
  const body={amount:10,category:'Transferred request identity',method:'cash',date:day};await postgresCreateExpense(db,schema,tokens[2],1,'financial-transfer-expense-nonce',body);const before=await counts();
  await db.query(`UPDATE ${table('users')} SET branch_id=2 WHERE id=3`);
  try{await assert.rejects(()=>postgresCreateExpense(db,schema,tokens[2],2,'financial-transfer-expense-nonce',body),status(409));assert.deepEqual(await counts(),before);}finally{await db.query(`UPDATE ${table('users')} SET branch_id=1 WHERE id=3`);}
 });
 it('rolls source, bank, event and operation effects back after a real mid-operation audit failure',async()=>{
  const before=await counts(),values=await balances();
  await db.query(`CREATE FUNCTION ${table('test_financial_audit_failure')}() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN IF NEW.action IN ('bank_txn','create') THEN RAISE EXCEPTION 'Injected real audit failure'; END IF; RETURN NEW; END $fn$`);
  await db.query(`CREATE TRIGGER test_financial_audit_failure BEFORE INSERT ON ${table('audit_logs')} FOR EACH ROW EXECUTE FUNCTION ${table('test_financial_audit_failure')}()`);
  const input={account_id:1,type:'deposit',amount:9,date:day};try{
   await assert.rejects(()=>postgresMutateBank(db,schema,tokens[0],'financial-bank-audit-failure',input));
   await assert.rejects(()=>postgresCreateExpense(db,schema,tokens[0],1,'financial-expense-audit-failure',{amount:9,category:'Failed cost'}));
   assert.deepEqual(await counts(),before);assert.deepEqual(await balances(),values);
  }finally{await db.query(`DROP TRIGGER test_financial_audit_failure ON ${table('audit_logs')}`);await db.query(`DROP FUNCTION ${table('test_financial_audit_failure')}()`);}
  await postgresMutateBank(db,schema,tokens[0],'financial-bank-audit-failure',input);assert.deepEqual(await balances(),[values[0]+9,values[1]]);
 });
 it('bounds lock waits and safely retries the same unchanged financial identity after timeout',async()=>{
  let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});let locked!:()=>void;const ready=new Promise<void>(resolve=>{locked=resolve;});
  const holder=db.transaction(async()=>{await db.query(`SELECT id FROM ${table('bank_accounts')} WHERE id=1 FOR UPDATE`);locked();await barrier;});await ready;
  const input={account_id:1,type:'deposit',amount:7,date:day};try{await assert.rejects(()=>postgresMutateBank(other,schema,tokens[1],'financial-bank-lock-timeout',input),(error:unknown)=>(error as {code:string}).code==='55P03');}finally{release();await holder;}
  const result=await postgresMutateBank(other,schema,tokens[1],'financial-bank-lock-timeout',input);assert.equal(result.ok,true);
 });
 it('rejects a closed posting date and invalid exact amounts without losing the original pending source',async()=>{
  const period=await postgresCreatePeriod(db,schema,tokens[0],{name:'Closed future test',start_date:'2091-01-01',end_date:'2091-12-31'});await postgresSetPeriodState(db,schema,tokens[0],period.id,'closed','Explicit isolated period closure');
  const event=(await db.query(`SELECT id FROM ${table('accounting_events')} WHERE source_type='bank' AND event_type='movement' ORDER BY id DESC LIMIT 1`)).rows[0];const before=await counts();
  await assert.rejects(()=>reviewPostgresFinancialEvent(db,schema,tokens[0],Number(event.id),{posting_date:'2091-01-01',reason:'Closed period must preserve pending source',lines:[{account_code:'1020',debit:7},{account_code:'3000',credit:7}]}),status(409));
  for(const amount of [1.5,-1,Number.MAX_SAFE_INTEGER+1,'1e3'])await assert.rejects(()=>postgresCreateExpense(db,schema,tokens[0],1,'financial-invalid-expense',{amount,category:'Invalid'}),status(400));assert.deepEqual(await counts(),before);assert.equal((await verifyPostgresLedgerEvidence(db,schema)).valid,true);
 });
 it('edits only the current draft, preserves posted history and reverses exact lines in authoritative reports',async()=>{
  const input={branch_id:1,posting_date:day,memo:'Synthetic capital draft',source_type:'manual',source_id:'test',event_key:'financial-draft-correction-001',lines:[{account_code:'1000',debit:17},{account_code:'3000',credit:17}]};
  const draft=await postgresCreateManualJournal(db,schema,tokens[0],input);
  const change={posting_date:day,memo:'Independently corrected synthetic draft',expected_hash:draft.request_hash,lines:[{account_code:'1000',debit:19},{account_code:'3000',credit:19}]};
  const edited=await postgresEditManualJournal(db,schema,tokens[0],draft.id,change);
  await assert.rejects(()=>postgresPostManualJournal(db,schema,tokens[0],draft.id,{expectedHash:draft.request_hash}),status(409));
  await postgresPostManualJournal(db,schema,tokens[0],draft.id,{expectedHash:edited.request_hash});
  await assert.rejects(()=>postgresEditManualJournal(db,schema,tokens[0],draft.id,{...change,expected_hash:edited.request_hash}),status(409));
  const reversed=await postgresReverseManualJournal(db,schema,tokens[1],draft.id,day,'Independent reversal of synthetic capital');assert.equal(reversed.state,'posted');
  const original=(await db.query(`SELECT state,memo FROM ${table('accounting_journals')} WHERE id=$1`,[draft.id])).rows[0];assert.equal(original.state,'reversed');assert.equal(original.memo,change.memo);
  const trial=await postgresTrialBalance(db,schema,tokens[0],{branch_id:null,from:day.slice(0,4)+'-01-01',to:day});assert.equal(trial.balanced,true);assert.equal(trial.rows.find(row=>row.code==='1000')!.balance,-400);assert.equal(trial.rows.find(row=>row.code==='1020')!.balance,1000);assert.equal(trial.rows.find(row=>row.code==='6000')!.balance,400);assert.equal(trial.rows.find(row=>row.code==='3000')!.balance,-1000);
  const statements=await postgresFinancialStatements(db,schema,tokens[0],{from:day.slice(0,4)+'-01-01',to:day});assert.equal(statements.revenue,0);assert.equal(statements.expenses,400);assert.equal(statements.profit,-400);assert.equal(statements.assets,600);assert.equal(statements.balanceSheetBalanced,true);assert.match(statements.acceptance,/no_verified_opening/);
  const ledger=await postgresGeneralLedger(db,schema,tokens[0],{account_code:'1000',from:day.slice(0,4)+'-01-01',to:day,limit:1});assert.ok(ledger.rows.length>0);assert.equal((await verifyPostgresLedgerEvidence(db,schema)).valid,true);
  const voided=await postgresCreateManualJournal(db,schema,tokens[0],{...input,event_key:'financial-draft-void-001'});await postgresVoidManualJournal(db,schema,tokens[0],voided.id,'Unused synthetic draft cancelled');await assert.rejects(()=>postgresPostManualJournal(db,schema,tokens[0],voided.id,{expectedHash:voided.request_hash}),status(409));
 });
 it('commits one canonical transfer under simultaneous independent process retries',async()=>{
  const before=await balances(),count=Number((await db.query(`SELECT COUNT(*) n FROM ${table('bank_transactions')}`)).rows[0].n),children:ReturnType<typeof fork>[]=[];
  const launch=async()=>{const child=fork(path.resolve('tests/postgres/bank-worker.ts'),[],{execArgv:['--import','tsx'],env:process.env,stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});children.push(child);await once(child,'message',{signal:AbortSignal.timeout(10000)});const message=once(child,'message',{signal:AbortSignal.timeout(10000)}),exit=once(child,'exit',{signal:AbortSignal.timeout(15000)});child.send({schema,token:tokens[0],key:'financial-process-retry-001',body:{action:'transfer',from_account:1,to_account:2,amount:3,date:day},interrupt:false});return {message,exit};};
  try{const runs=await Promise.all([launch(),launch()]),messages=await Promise.all(runs.map(async run=>(await run.message)[0]));assert.deepEqual(messages[0],messages[1]);assert.equal(messages[0].ok,true);for(const run of runs)assert.equal((await run.exit)[0],0);assert.deepEqual(await balances(),[before[0]-3,before[1]+3]);assert.equal(Number((await db.query(`SELECT COUNT(*) n FROM ${table('bank_transactions')}`)).rows[0].n),count+2);}finally{for(const child of children)if(child.exitCode==null)child.kill();}
 });
 it('streams a thousand posted journals and keeps aggregate rials exact beyond the JavaScript safe integer range',{timeout:120000},async()=>{
  await db.transaction(async()=>{for(let index=0;index<1000;index++){const draft=await postgresCreateManualJournal(db,schema,tokens[0],{branch_id:1,posting_date:day,memo:'Synthetic historical capital',source_type:'manual',source_id:String(index),event_key:'large-history-'+index,lines:[{account_code:'1000',debit:1},{account_code:'3000',credit:1}]});await postgresPostManualJournal(db,schema,tokens[0],draft.id,{expectedHash:draft.request_hash});}});
  const amount=Number.MAX_SAFE_INTEGER-1;for(let index=0;index<2;index++){const draft=await postgresCreateManualJournal(db,schema,tokens[0],{branch_id:1,posting_date:day,memo:'Exact large synthetic capital',source_type:'manual',source_id:String(index),event_key:'large-capital-'+index,lines:[{account_code:'1000',debit:amount},{account_code:'3000',credit:amount}]});await postgresPostManualJournal(db,schema,tokens[0],draft.id,{expectedHash:draft.request_hash});}
  const expected=BigInt(2)*BigInt(amount)+BigInt(600),trial=await postgresTrialBalance(db,schema,tokens[0],{to:day});assert.equal(trial.rows.find(row=>row.code==='1000')!.balance,expected.toString());assert.equal(trial.balanced,true);assert.equal(typeof trial.debit,'string');assert.equal(BigInt(trial.debit)-BigInt(trial.credit),BigInt(0));
  const seen=new Set<number>();let after=0,lastBalance:number|string=0;for(let page=0;page<20;page++){const result=await postgresGeneralLedger(db,schema,tokens[0],{account_code:'1000',from:day.slice(0,4)+'-01-01',to:day,after,limit:137});for(const row of result.rows){assert.equal(seen.has(row.id),false);seen.add(row.id);lastBalance=row.balance;}if(result.next==null)break;after=result.next;}
  assert.equal(seen.size,1005);assert.equal(lastBalance,expected.toString());const statements=await postgresFinancialStatements(db,schema,tokens[0],{from:day.slice(0,4)+'-01-01',to:day});assert.equal(statements.assets,(expected+BigInt(1000)).toString());assert.equal(statements.profit,-400);assert.equal(statements.balanceSheetBalanced,true);const proof=await verifyPostgresLedgerEvidence(db,schema);assert.equal(proof.valid,true);assert.equal(proof.count,1006);
 });
});
