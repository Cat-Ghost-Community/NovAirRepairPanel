import {before,after,describe,it} from 'node:test';import assert from 'node:assert/strict';import {createPostgresDatabase,safePostgresInteger} from '../../src/lib/db/postgres';
const url=process.env.REPAID_PG_TEST_URL??'',name=process.env.REPAID_PG_TEST_DATABASE??'';if(!/^repaid_test_[a-f0-9]{24}$/.test(name)||new URL(url).pathname!=='/'+name)throw new Error('Run through scripts/test-postgres.ts with a disposable database');
const db=createPostgresDatabase({connectionString:url,allowLocalPlaintext:['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname),maxConnections:3,statementTimeoutMs:2000,lockTimeoutMs:150}),other=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true,maxConnections:2,statementTimeoutMs:2000,lockTimeoutMs:150});
before(async()=>{assert.equal((await db.query('SELECT current_database() name')).rows[0].name,name);await db.query('CREATE TABLE database_test_rows(id bigint PRIMARY KEY,amount bigint NOT NULL CHECK(amount>=0),source text UNIQUE)');await db.query("INSERT INTO database_test_rows VALUES(1,1000,'original')");});after(async()=>{await other.close();await db.close();});
describe('real PostgreSQL transaction and connection safety',()=>{
 it('rejects trailing transaction commands before execution and preserves uncommitted ownership and rollback',async()=>{
  assert.equal((await db.query('SHOW standard_conforming_strings')).rows[0].standard_conforming_strings,'on');
  await assert.rejects(()=>db.transaction(async()=>{
   await db.query("INSERT INTO database_test_rows VALUES(98,11,'trailing-guard')");
   for(const sql of ['SELECT 1; COMMIT','SELECT 1; /* nested /* comment */ done */ ROLLBACK',"SELECT 'safe;COMMIT'; SET search_path=public"])await assert.rejects(()=>db.query(sql),/transaction boundary/);
   assert.equal((await other.query('SELECT COUNT(*) n FROM database_test_rows WHERE id=98')).rows[0].n,'0');
   assert.equal((await db.query("SELECT $آزمون$;COMMIT$آزمون$ AS literal")).rows[0].literal,';COMMIT');
   throw Error('rollback remains owned');
  }),/rollback remains owned/);
  assert.equal((await other.query('SELECT COUNT(*) n FROM database_test_rows WHERE id=98')).rows[0].n,'0');
 });
 it('rejects manual transaction escape and multi-statement execution',async()=>{
  await assert.rejects(()=>db.query('/* accidental bypass */ BEGIN'),/transaction boundary/);
  await assert.rejects(()=>db.query('SELECT 1; SELECT 2'),(error:unknown)=>(error as {code:string}).code==='42601');
 });
 it('does not report false success after transaction aliases, nested comments or empty-statement escapes',async()=>{
  await db.transaction(async()=>{await db.query("INSERT INTO database_test_rows VALUES(99,12,'transaction-guard')");
   for(const sql of ['ABORT',';; /* outer /* nested */ still outer */ COMMIT','-- prefix\r\n; BEGIN','START/* comment */TRANSACTION',"PREPARE TRANSACTION 'must-not-escape'",'SET TRANSACTION READ WRITE','RESET ALL','DISCARD ALL'])await assert.rejects(()=>db.query(sql),/transaction boundary/);
   assert.equal((await db.query('/* outer /* nested */ valid */ SELECT amount FROM database_test_rows WHERE id=99')).rows[0].amount,'12');
  });assert.equal((await db.query('SELECT amount FROM database_test_rows WHERE id=99')).rows[0].amount,'12');
 });
 it('keeps one backend through nested service transactions and rolls failed work back',async()=>{
  await db.transaction(async()=>{const pid=(await db.query('SELECT pg_backend_pid() id')).rows[0].id;await db.query("INSERT INTO database_test_rows VALUES(2,50,'parent')");
   await assert.rejects(()=>db.transaction(async()=>{assert.equal((await db.query('SELECT pg_backend_pid() id')).rows[0].id,pid);await db.query("INSERT INTO database_test_rows VALUES(3,20,'child')");throw new Error('injected nested failure');}),/injected/);
   assert.equal((await db.query('SELECT COUNT(*) n FROM database_test_rows WHERE id=3')).rows[0].n,'0');
  });assert.equal((await db.query('SELECT amount FROM database_test_rows WHERE id=2')).rows[0].amount,'50');
  await assert.rejects(()=>db.transaction(async()=>{await db.query("INSERT INTO database_test_rows VALUES(4,20,'rollback')");throw new Error('injected outer failure');}),/injected/);assert.equal((await db.query('SELECT COUNT(*) n FROM database_test_rows WHERE id=4')).rows[0].n,'0');
 });
 it('does not report success when a statement error was swallowed inside a transaction',async()=>{
  await assert.rejects(()=>db.transaction(async()=>{await db.query("INSERT INTO database_test_rows VALUES(5,5,'must-rollback')");try{await db.query('SELECT missing_column FROM database_test_rows');}catch{};}),/rolled back/);
  assert.equal((await db.query('SELECT COUNT(*) n FROM database_test_rows WHERE id=5')).rows[0].n,'0');
 });
 it('serializes competing writers without lost balances and enforces bounded lock waits',async()=>{
  const spend=(database:typeof db)=>database.transaction(async()=>{const r=await database.query('UPDATE database_test_rows SET amount=amount-700 WHERE id=1 AND amount>=700 RETURNING amount');return r.rowCount;});
  const results=await Promise.all([spend(db),spend(other)]);assert.equal(results.reduce<number>((n,v)=>n+Number(v),0),1);assert.equal((await db.query('SELECT amount FROM database_test_rows WHERE id=1')).rows[0].amount,'300');
  await db.transaction(async()=>{await db.query('SELECT id FROM database_test_rows WHERE id=1 FOR UPDATE');await assert.rejects(()=>other.transaction(async()=>{await other.query('UPDATE database_test_rows SET amount=0 WHERE id=1');}),(error:unknown)=>(error as {code:string}).code==='55P03');});
 });
 it('rejects overlapping nested transaction boundaries and detached late work',async()=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let late!:Promise<unknown>;
  await db.transaction(async()=>{const nested=db.transaction(async()=>{await gate;});await assert.rejects(()=>db.transaction(async()=>{}),/Overlapping/);release();await nested;
   late=new Promise(resolve=>setTimeout(()=>resolve(db.query('SELECT 1')),20));
  });await assert.rejects(()=>late,/ended/);
 });
 it('respects read-only/statement timeouts, exact BIGINT and pool limits',async()=>{
  await assert.rejects(()=>db.transaction(async()=>{await db.query('UPDATE database_test_rows SET amount=0 WHERE id=1');},{readOnly:true}),(error:unknown)=>(error as {code:string}).code==='25006');
  assert.equal(safePostgresInteger('9007199254740991'),9007199254740991);assert.throws(()=>safePostgresInteger('9007199254740992'));assert.throws(()=>safePostgresInteger('0.1'));
  await Promise.all(Array.from({length:10},()=>db.query('SELECT pg_sleep(0.01)')));assert.ok(db.metrics().total<=3);
  await assert.rejects(()=>db.query('SELECT pg_sleep(3)'),(error:unknown)=>(error as {code:string}).code==='57014');assert.equal((await db.query('SELECT 1 value')).rows[0].value,1);
 });
});
