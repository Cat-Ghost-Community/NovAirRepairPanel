import {before,after,it} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {createPostgresDatabase} from '../../src/lib/db/postgres';
import {applyPostgresMigrations,verifyPostgresMigrations} from '../../src/lib/db/pg-migrations';
import {postgresInitializeChart,postgresCreatePeriod} from '../../src/lib/db/postgres-accounting';
import {postgresCreateManualJournal,postgresPostManualJournal} from '../../src/lib/db/postgres-journals';
import {rehearsePostgresOpeningBackup,verifyPostgresOpeningBackup} from '../../src/lib/db/postgres-opening-backup';
const url=process.env.REPAID_PG_TEST_URL??'',name=process.env.REPAID_PG_TEST_DATABASE??'';
if(!/^repaid_test_[a-f0-9]{24}$/.test(name)||new URL(url).pathname!=='/'+name)throw Error('Disposable PostgreSQL recovery fixture required');
const db=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true}),schema='repaid_integration_'+randomBytes(12).toString('hex'),table=(name:string)=>'"'+schema+'"."'+name+'"',token=randomBytes(24).toString('hex');
before(async()=>{
 await applyPostgresMigrations(db,schema);await db.query(`INSERT INTO ${table('branches')}(id,name,code) VALUES(1,'شعبهٔ بازیابی','RESTORE')`);await db.query(`INSERT INTO ${table('users')}(id,name,email,password_hash,role,branch_id) VALUES(1,'Recovery owner','recovery@test.invalid','unused','owner',1)`);
 await db.query(`INSERT INTO ${table('sessions')}(token,user_id,expires_at) VALUES($1,1,$2)`,['sha256:'+createHash('sha256').update(token).digest('hex'),new Date(Date.now()+3600000).toISOString()]);
 await postgresInitializeChart(db,schema,token);const year=new Date().toISOString().slice(0,4);await postgresCreatePeriod(db,schema,token,{name:'Restore test year',start_date:year+'-01-01',end_date:year+'-12-31'});
 await db.query(`INSERT INTO ${table('customers')}(id,code,first_name,branch_id,created_by) VALUES(701,'RESTORE-701','شاهد فارسی بازیابی',1,1)`);
});
after(async()=>{try{await db.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');}finally{await db.close();}});
it('uses an actual native dump and separate database restore before testing a journal mutation, preserving the source',async()=>{
 const original=(await db.query(`SELECT id,code,first_name FROM ${table('customers')} ORDER BY id`)).rows,sourceHash=createHash('sha256').update(JSON.stringify(original)).digest('hex'),before=(await db.query(`SELECT COUNT(*)::text n FROM ${table('accounting_journals')}`)).rows[0].n;
 const result=await rehearsePostgresOpeningBackup(db,schema,{openingId:1,sourceHash,verifySource:async restored=>{assert.equal((await verifyPostgresMigrations(restored,schema)).verified,true);assert.deepEqual((await restored.query(`SELECT id,code,first_name FROM ${table('customers')} ORDER BY id`)).rows,original);},applyOnRestored:async restored=>{const draft=await postgresCreateManualJournal(restored,schema,token,{branch_id:1,posting_date:new Date().toISOString().slice(0,10),memo:'Synthetic restored recovery proof',source_type:'manual',source_id:'recovery',event_key:'restore-proof-001',lines:[{account_code:'1000',debit:17},{account_code:'3000',credit:17}]});return postgresPostManualJournal(restored,schema,token,draft.id,{expectedHash:draft.request_hash});}});
 assert.equal(result.rehearsal.restored,true);assert.equal(result.rehearsal.ledger.valid,true);assert.equal(result.rehearsal.ledger.count,1);assert.equal(await verifyPostgresOpeningBackup(result.backup_path,result.backup_hash),true);
 assert.equal((await db.query(`SELECT COUNT(*)::text n FROM ${table('accounting_journals')}`)).rows[0].n,before);assert.deepEqual((await db.query(`SELECT id,code,first_name FROM ${table('customers')} ORDER BY id`)).rows,original);
 const parent=path.dirname(result.backup_path),copy=path.join(parent,'opening-2-'+randomBytes(12).toString('hex')+'.dump');fs.copyFileSync(result.backup_path,copy,fs.constants.COPYFILE_EXCL);try{fs.appendFileSync(copy,Buffer.from('tampered'));await assert.rejects(()=>verifyPostgresOpeningBackup(copy,result.backup_hash),/changed|incomplete/);}finally{fs.unlinkSync(copy);}
});
it('rejects external recovery inside a source financial transaction before any native process executes',async()=>{
 await assert.rejects(()=>db.transaction(()=>rehearsePostgresOpeningBackup(db,schema,{openingId:2,sourceHash:'a'.repeat(64),verifySource:async()=>{},applyOnRestored:async()=>{throw Error('Must not execute');}})),/cannot run inside/);
});
