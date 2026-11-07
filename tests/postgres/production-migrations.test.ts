import {after,it} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import type {QueryResultRow} from 'pg';
import {spawnSync} from 'node:child_process';
import {createPostgresDatabase,type PostgresDatabase} from '../../src/lib/db/postgres';
import {applyPostgresMigrations,verifyPostgresMigrations,POSTGRES_SCHEMA_VERSION} from '../../src/lib/db/pg-migrations';
import {productionSchemaCoverage} from '../../src/lib/db/pg-production-schema';

const url=process.env.REPAID_PG_TEST_URL??'',database=process.env.REPAID_PG_TEST_DATABASE??'';
if(!/^repaid_test_[a-f0-9]{24}$/.test(database)||new URL(url).pathname!=='/'+database)throw Error('Disposable PostgreSQL database required');
const db=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true,lockTimeoutMs:10000}),other=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true,lockTimeoutMs:10000});
const namespace=()=> 'repaid_integration_'+randomBytes(12).toString('hex');
const table=(schema:string,name:string)=>'"'+schema+'"."'+name+'"';
const code=(expected:string)=>(error:unknown)=>(error as {code?:string}).code===expected;
after(async()=>{await other.close();await db.close();});
async function seed(schema:string){
 await db.query(`INSERT INTO ${table(schema,'branches')}(id,name,code) VALUES(9,'شعبهٔ آزمایش','FOUNDATION')`);
 await db.query(`INSERT INTO ${table(schema,'users')}(id,name,email,password_hash,role,branch_id) VALUES(9001,'مدیر آزمون','foundation@test.invalid','fixture-unused-for-auth','owner',9)`);
}

it('creates the canonical PostgreSQL schema with native exact types, constraints, views and immutable migration history',async()=>{
 const schema=namespace(),result=await applyPostgresMigrations(db,schema);assert.deepEqual(result.applied,Array.from({length:POSTGRES_SCHEMA_VERSION},(_,i)=>i+1));assert.equal(result.coverage.baseline_tables,110);assert.equal(result.coverage.read_views,10);
 const tables=await db.query('SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type=$2',[schema,'BASE TABLE']);assert.equal(tables.rowCount,121);
 const frozen=JSON.parse(readFileSync('tests/fixtures/postgres-m8-checksums.json','utf8')) as {checksums:string[]};assert.equal(frozen.checksums.length,8);
 assert.deepEqual((await db.query(`SELECT checksum FROM ${table(schema,'_repaid_migrations')} WHERE version<=8 ORDER BY version`)).rows.map(row=>String(row.checksum)),frozen.checksums,'Previously verified migration1–8 identities must remain unchanged');
 const columns=(await db.query(`SELECT data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name='accounting_lines' AND column_name='debit'`,[schema])).rows;assert.equal(columns[0].data_type,'bigint');
 assert.equal((await db.query(`SELECT data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name='inventory_stock' AND column_name='qty'`,[schema])).rows[0].data_type,'numeric');
 assert.equal((await verifyPostgresMigrations(db,schema)).verified,true);assert.deepEqual((await applyPostgresMigrations(other,schema)).applied,[]);
 await assert.rejects(db.query(`UPDATE ${table(schema,'_repaid_migrations')} SET checksum=$1 WHERE version=1`,['0'.repeat(64)]),code('23514'));
 await assert.rejects(db.query(`TRUNCATE ${table(schema,'_repaid_migrations')}`),code('23514'));
});
it('upgrades populated schema without changing preserved identities or Persian evidence and advances identity sequences transactionally',async()=>{
 const schema=namespace();await applyPostgresMigrations(db,schema,{targetVersion:1});await seed(schema);
 await db.query(`INSERT INTO ${table(schema,'customers')}(id,code,first_name,branch_id,created_by,referrer_commission_value) VALUES(7001,'PRESERVED-7001','شاهد اصلی',9,9001,$1)`,['0.123456']);
 await db.query(`INSERT INTO ${table(schema,'parts')}(id,name) VALUES(1,'قطعهٔ کسری')`);
 await db.query(`INSERT INTO ${table(schema,'inventory_locations')}(id,name,branch_id) VALUES(1,'انبار',9)`);
 await db.query(`INSERT INTO ${table(schema,'inventory_stock')}(part_id,location_id,qty,carrying_value) VALUES(1,1,$1,17)`,['0.1']);
 await db.query(`UPDATE ${table(schema,'inventory_stock')} SET qty=qty+$1,carrying_value=carrying_value+34`,['0.2']);
 const before=(await db.query(`SELECT * FROM ${table(schema,'customers')}`)).rows;assert.equal(before[0].referrer_commission_value,'0.123456');
 await applyPostgresMigrations(db,schema,{targetVersion:2});assert.deepEqual((await db.query(`SELECT * FROM ${table(schema,'customers')}`)).rows,before);
 assert.deepEqual((await db.query(`SELECT qty,carrying_value FROM ${table(schema,'inventory_stock')}`)).rows,[{qty:'0.3',carrying_value:'51'}]);
 await assert.rejects(db.query(`UPDATE ${table(schema,'inventory_stock')} SET qty=qty-0.1`),code('55000'));
 const inserted=await db.query(`INSERT INTO ${table(schema,'customers')}(code,first_name,branch_id,created_by) VALUES('NEXT','جدید',9,9001) RETURNING id`);assert.equal(inserted.rows[0].id,'7002');
 assert.equal((await db.query(`SELECT COUNT(*)::int count FROM ${table(schema,'customer_branch_access')} WHERE branch_id=9`)).rows[0].count,2);
 await assert.rejects(verifyPostgresMigrations(db,schema),/Current PostgreSQL schema migrations/);
 // Enabling the new carrying engine must not invent missing movement evidence
 // for populated legacy stock. Preserve v2 and require a reviewed migration.
 await assert.rejects(applyPostgresMigrations(db,schema),/Legacy stock positions require/);
 assert.deepEqual((await db.query(`SELECT qty,carrying_value FROM ${table(schema,'inventory_stock')}`)).rows,[{qty:'0.3',carrying_value:'51'}]);
 assert.equal((await db.query(`SELECT MAX(version)::int version FROM ${table(schema,'_repaid_migrations')}`)).rows[0].version,2);
});
it('serializes concurrent fresh migrations from independent pools without duplicate versions',async()=>{
 const schema=namespace(),results=await Promise.all([applyPostgresMigrations(db,schema),applyPostgresMigrations(other,schema)]);
 assert.equal(results.filter(r=>r.applied.length===POSTGRES_SCHEMA_VERSION).length,1);assert.equal(results.filter(r=>r.replayed).length,1);
 assert.equal((await db.query(`SELECT COUNT(*)::int count FROM ${table(schema,'_repaid_migrations')}`)).rows[0].count,POSTGRES_SCHEMA_VERSION);
});
it('rolls back real mid-DDL database failures completely and allows a verified retry',async()=>{
 const schema=namespace();let injected=false;
 const failing:PostgresDatabase={...db,query:async<Row extends QueryResultRow=QueryResultRow>(text:string,values:unknown[]=[])=>{if(!injected&&text.startsWith('CREATE VIEW')){injected=true;return db.query<Row>('SELECT 1/0',values);}return db.query<Row>(text,values);}};
 await assert.rejects(applyPostgresMigrations(failing,schema),code('22012'));assert.equal(injected,true);
 assert.equal((await db.query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[schema])).rowCount,0);
 assert.deepEqual((await applyPostgresMigrations(db,schema)).applied,Array.from({length:POSTGRES_SCHEMA_VERSION},(_,i)=>i+1));
});
it('detects schema drift and rejects unmanaged adoption or migration downgrades',async()=>{
 const schema=namespace();await applyPostgresMigrations(db,schema);
 await assert.rejects(applyPostgresMigrations(db,schema,{targetVersion:1}),/downgrade/);
 await db.query(`ALTER TABLE ${table(schema,'customers')} ADD COLUMN unreviewed text`);
 await assert.rejects(verifyPostgresMigrations(db,schema),/drift/);await assert.rejects(applyPostgresMigrations(db,schema),/drift/);
 const unmanaged=namespace();await db.query('CREATE SCHEMA "'+unmanaged+'"');await db.query(`CREATE TABLE ${table(unmanaged,'evidence')}(id bigint)`);
 await assert.rejects(applyPostgresMigrations(db,unmanaged),/Unmanaged/);assert.equal((await db.query('SELECT to_regclass($1) found',[table(unmanaged,'evidence')])).rows[0].found,unmanaged+'.evidence');
});
it('preserves branch ownership, audit history, foreign keys and rejects unported-domain writes',async()=>{
 const schema=namespace();await applyPostgresMigrations(db,schema);await seed(schema);
 await db.query(`INSERT INTO ${table(schema,'customers')}(id,code,first_name,branch_id,created_by) VALUES(1,'BRANCH','مشتری',9,9001)`);
 await assert.rejects(db.query(`INSERT INTO ${table(schema,'customers')}(id,code,branch_id) VALUES(2,'ORPHAN',999)`),code('23503'));
 await assert.rejects(db.query(`UPDATE ${table(schema,'customers')} SET branch_id=NULL WHERE id=1`),code('23514'));
 await db.query(`INSERT INTO ${table(schema,'audit_logs')}(user_id,branch_id,action,entity,entity_id) VALUES(9001,9,'create','customer',1)`);
 await assert.rejects(db.query(`DELETE FROM ${table(schema,'audit_logs')}`),code('23514'));
 await assert.rejects(db.query(`INSERT INTO ${table(schema,'invoices')} DEFAULT VALUES`),code('23514'));
 await assert.rejects(db.query(`INSERT INTO ${table(schema,'payroll_runs')} DEFAULT VALUES`),code('55000'));
 assert.equal((await db.query(`SELECT COUNT(*)::int count FROM ${table(schema,'invoices')}`)).rows[0].count,0);
 assert.ok(productionSchemaCoverage().fenced_tables.includes('payments'));
});
it('reuses native ledger guards to reject unbalanced posting on the production baseline',async()=>{
 const schema=namespace();await applyPostgresMigrations(db,schema);await seed(schema);
 await db.query(`INSERT INTO ${table(schema,'accounting_accounts')}(code,name,classification,normal_side) VALUES('1000','نقد','asset','debit'),('4010','درآمد','revenue','credit')`);
 const period=(await db.query(`INSERT INTO ${table(schema,'accounting_periods')}(name,start_date,end_date,created_by) VALUES('آبان','2026-11-01','2026-11-30',9001) RETURNING id`)).rows[0].id;
 const journal=(await db.query(`INSERT INTO ${table(schema,'accounting_journals')}(branch_id,period_id,posting_date,source_type,source_id,event_key,memo,request_hash,created_by) VALUES(9,$1,'2026-11-06','manual','foundation','foundation','تراز نادرست',$2,9001) RETURNING id`,[period,'a'.repeat(64)])).rows[0].id;
 await db.query(`INSERT INTO ${table(schema,'accounting_lines')}(journal_id,position,account_code,debit,credit) VALUES($1,1,'1000',17,0),($1,2,'4010',0,16)`,[journal]);
 await assert.rejects(db.query(`UPDATE ${table(schema,'accounting_journals')} SET state='posted',posted_by=9001,posted_at='2026-11-06T00:00:00Z',posted_sequence=1,previous_hash='',digest=$2 WHERE id=$1`,[journal,'b'.repeat(64)]),code('23514'));
 assert.equal((await db.query(`SELECT state FROM ${table(schema,'accounting_journals')} WHERE id=$1`,[journal])).rows[0].state,'draft');
});
it('runs explicit administrative migration CLI apply/replay/verify without leaking connection credentials',()=>{
 const schema=namespace(),run=(args:string[])=>spawnSync(process.execPath,['--import','tsx','scripts/migrate-postgres.ts',...args],{encoding:'utf8',windowsHide:true,timeout:60000,env:{...process.env,REPAID_PG_URL:url,REPAID_PG_ALLOW_LOCAL_PLAINTEXT:'1'}});
 const first=run(['--apply','--schema',schema]);assert.equal(first.status,0,first.stderr);const result=JSON.parse(first.stdout);assert.deepEqual(result.applied,Array.from({length:POSTGRES_SCHEMA_VERSION},(_,i)=>i+1));assert.equal(result.production_cutover_performed,false);assert.equal(result.baseline_tables,110);
 const repeated=run(['--apply','--schema',schema]);assert.equal(repeated.status,0,repeated.stderr);assert.equal(JSON.parse(repeated.stdout).replayed,true);
 const verified=run(['--verify','--schema',schema]);assert.equal(verified.status,0,verified.stderr);assert.equal(JSON.parse(verified.stdout).verified,true);
 const rejected=run(['--apply','--verify','--schema',schema]);assert.notEqual(rejected.status,0);assert.equal(rejected.stdout,'');assert.equal(rejected.stderr.includes(url),false);const password=new URL(url).password;if(password)assert.equal(rejected.stderr.includes(password),false);
});
it('rolls the entire operational upgrade back when populated legacy merge evidence requires review',async()=>{
 const schema=namespace(),t=(name:string)=>table(schema,name);
 await applyPostgresMigrations(db,schema,{targetVersion:1});await seed(schema);
 await db.query(`INSERT INTO ${t('customers')}(id,code,first_name,branch_id,is_archived) VALUES(71,'LEGACY-SOURCE','Preserved source',9,1),(72,'LEGACY-TARGET','Preserved target',9,0)`);
 await db.query(`INSERT INTO ${t('merge_log')}(id,master_id,merged_id,moved_counts,user_id,created_at) VALUES(555,72,71,'{"devices":1}',9001,'2025-01-03 12:00:00')`);
 await db.query(`INSERT INTO ${t('devices')}(id,customer_id,type,branch_id) VALUES(888,72,'mobile',9)`);
 const before=await Promise.all(['customers','devices','merge_log'].map(async name=>(await db.query(`SELECT * FROM ${t(name)} ORDER BY id`)).rows));
 await applyPostgresMigrations(db,schema,{targetVersion:5});
 await assert.rejects(()=>applyPostgresMigrations(db,schema),/Populated legacy merge evidence requires reviewed migration/);
 assert.equal((await db.query(`SELECT MAX(version) v FROM ${t('_repaid_migrations')}`)).rows[0].v,5);
 assert.equal((await db.query('SELECT to_regclass($1) object',[t('pg_device_blacklist_revocations')])).rows[0].object,null);
 assert.deepEqual(await Promise.all(['customers','devices','merge_log'].map(async name=>(await db.query(`SELECT * FROM ${t(name)} ORDER BY id`)).rows)),before);
 assert.equal((await applyPostgresMigrations(db,schema,{targetVersion:5})).replayed,true);
 await assert.rejects(()=>db.query(`UPDATE ${t('merge_log')} SET moved_counts='{}' WHERE id=555`),code('55000'));
});
