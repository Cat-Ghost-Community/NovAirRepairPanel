import {before,after,it} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createPostgresDatabase} from '../../src/lib/db/postgres';
import {applyPostgresMigrations} from '../../src/lib/db/pg-migrations';
import {postgresSessionDigest} from '../../src/lib/db/pg-app-auth';
import {readPostgresDeviceCatalog,savePostgresDeviceCatalog} from '../../src/lib/db/pg-device-catalog';
import {PostgresDevicesRepository} from '../../src/lib/db/pg-operational-profiles';
import {customDeviceSpecs} from '../../src/lib/device-catalog';
import {verifyPostgresDeviceCatalogGuard} from '../../src/lib/db/pg-device-catalog-guards';
const url=process.env.REPAID_PG_TEST_URL??'',name=process.env.REPAID_PG_TEST_DATABASE??'';
if(!/^repaid_test_[a-f0-9]{24}$/.test(name)||new URL(url).pathname!=='/'+name)throw Error('Disposable PostgreSQL catalog fixture required');
const db=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true}),peer=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true}),schema='repaid_integration_'+randomBytes(12).toString('hex'),t=(n:string)=>'"'+schema+'"."'+n+'"';
const owner=randomBytes(24).toString('hex'),one=randomBytes(24).toString('hex'),two=randomBytes(24).toString('hex'),admin=randomBytes(24).toString('hex'),devices=new PostgresDevicesRepository(db,schema),status=(n:number)=>(e:unknown)=>(e as {status?:number}).status===n;
let deviceId:number;
const payload={customer_id:1,type:'industrial',custom_fields:{custom_voltage:'220.5',custom_mode:'AC'}};
before(async()=>{
 await applyPostgresMigrations(db,schema,{targetVersion:1});
 await db.query(`INSERT INTO ${t('branches')}(id,name,code) VALUES(1,'One','CAT1'),(2,'Two','CAT2')`);
 await db.query(`INSERT INTO ${t('users')}(id,name,email,password_hash,role,branch_id) VALUES(1,'Owner','owner@catalog.invalid','unused','owner',1),(2,'One','one@catalog.invalid','unused','reception',1),(3,'Two','two@catalog.invalid','unused','reception',2),(4,'Admin','admin@catalog.invalid','unused','admin',1)`);
 for(const [token,id] of [[owner,1],[one,2],[two,3],[admin,4]] as const)await db.query(`INSERT INTO ${t('sessions')}(token,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '1 hour')`,[postgresSessionDigest(token),id]);
 await db.query(`INSERT INTO ${t('customers')}(id,first_name,last_name,branch_id) VALUES(1,'First','Customer',1),(2,'Second','Customer',2)`);
 await db.query(`INSERT INTO ${t('devices')}(id,customer_id,type,brand,model,branch_id,is_archived) VALUES(10,1,'mobile','A','B',1,0),(11,2,'console','C','D',2,0),(12,1,'printer','E','F',1,1)`);
 await applyPostgresMigrations(db,schema,{targetVersion:9});const original=(await db.query(`SELECT * FROM ${t('devices')} ORDER BY id`)).rows;
 await applyPostgresMigrations(db,schema);assert.deepEqual((await db.query(`SELECT * FROM ${t('devices')} ORDER BY id`)).rows,original);assert.equal((await verifyPostgresDeviceCatalogGuard(db,schema)).verified,true);
});
after(async()=>{try{await db.query('DROP SCHEMA "'+schema+'" CASCADE');}finally{await peer.close();await db.close();}});
it('only the company owner can persist global versioned type/field definitions',async()=>{
 const initial=await readPostgresDeviceCatalog(db,schema);assert.equal(initial.revision,0);
 await assert.rejects(()=>savePostgresDeviceCatalog(db,schema,admin,initial),status(403));await assert.rejects(()=>savePostgresDeviceCatalog(db,schema,one,initial),status(403));
 initial.types.push({id:'industrial',label:'تجهیز صنعتی',icon:'plug',active:true,fields:[{id:'custom_voltage',label:'ولتاژ',kind:'number',required:true},{id:'custom_mode',label:'حالت',kind:'select',required:true,options:['AC','DC']}]});
 const saved=await savePostgresDeviceCatalog(db,schema,owner,initial);assert.equal(saved.revision,1);assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('audit_logs')} WHERE entity='device_catalog'`)).rows[0].n,'1');
 await assert.rejects(()=>savePostgresDeviceCatalog(db,schema,owner,initial),status(409));
});
it('real device registration enforces configured fields and branch ownership atomically with exact retry identity',async()=>{
 const before=(await db.query(`SELECT COUNT(*) n FROM ${t('devices')}`)).rows[0].n;
 await assert.rejects(()=>devices.create(one,1,{...payload,custom_fields:{custom_voltage:'220.5'}},'catalog-missing'),status(400));
 await assert.rejects(()=>devices.create(one,1,{...payload,customer_id:2},'catalog-foreign'),status(404));
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('devices')}`)).rows[0].n,before);
 const saved=await devices.create(one,1,payload,'catalog-create');deviceId=saved.id;assert.deepEqual(await devices.create(one,1,payload,'catalog-create'),saved);
 const device=(await devices.detail(one,1,saved.id)).device;assert.equal(device.type,'industrial');assert.equal(device.brand,null);assert.deepEqual(customDeviceSpecs(device.specs),[{label:'ولتاژ',value:'220.5'},{label:'حالت',value:'AC'}]);await assert.rejects(()=>devices.detail(two,2,saved.id),status(404));
});
it('facets reveal no unrelated branch categories and retain historical retired-type access',async()=>{
 assert.deepEqual((await devices.list(one,1)).facets.map(f=>f.id),['industrial','mobile']);assert.deepEqual((await devices.list(two,2)).facets.map(f=>f.id),['console']);assert.equal((await devices.list(owner,null)).facets.length,3);
 const catalog=await readPostgresDeviceCatalog(db,schema);catalog.types.find(type=>type.id==='industrial')!.active=false;const saved=await savePostgresDeviceCatalog(db,schema,owner,catalog);
 assert.equal((await devices.list(one,1,{type:'industrial'})).devices.length,1);assert.equal((await devices.detail(one,1,deviceId)).catalog.types.find(t=>t.id==='industrial')!.label,'تجهیز صنعتی');
 await assert.rejects(()=>devices.create(one,1,payload,'catalog-retired-new'),status(400));assert.equal((await devices.create(one,1,payload,'catalog-create')).id,deviceId);assert.equal(saved.revision,2);
});
it('independent connections cannot overwrite the same catalog version and audit failure rolls the entire update back',async()=>{
 const original=await readPostgresDeviceCatalog(db,schema),a=structuredClone(original),b=structuredClone(original);a.types[0].label='One edit';b.types[0].label='Other edit';
 const outcomes=await Promise.allSettled([savePostgresDeviceCatalog(db,schema,owner,a),savePostgresDeviceCatalog(peer,schema,owner,b)]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);const rejected=outcomes.find(r=>r.status==='rejected') as PromiseRejectedResult;assert.equal(rejected.reason.status,409);
 const current=await readPostgresDeviceCatalog(db,schema);
 await db.query(`CREATE FUNCTION ${t('reject_catalog_audit')}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity='device_catalog' THEN RAISE EXCEPTION 'injected catalog audit failure';END IF;RETURN NEW;END $$`);await db.query(`CREATE TRIGGER reject_catalog_audit BEFORE INSERT ON ${t('audit_logs')} FOR EACH ROW EXECUTE FUNCTION ${t('reject_catalog_audit')}()`);
 const changed=structuredClone(current);changed.types[0].label='Must roll back';try{await assert.rejects(()=>savePostgresDeviceCatalog(db,schema,owner,changed),/injected catalog/);assert.deepEqual(await readPostgresDeviceCatalog(db,schema),current);}finally{await db.query(`DROP TRIGGER reject_catalog_audit ON ${t('audit_logs')}`);}
});
it('native registry guards reject raw unknown/retired types and detect tampering without weakening identity checks',async()=>{
 for(const type of ['unknown','industrial'])await assert.rejects(()=>db.query(`INSERT INTO ${t('devices')}(customer_id,type,branch_id) VALUES(1,$1,1)`,[type]),/device type/);
 await assert.rejects(()=>db.query(`UPDATE ${t('devices')} SET customer_id=2 WHERE id=$1`,[deviceId]),/ownership is immutable/);
 await assert.rejects(()=>db.transaction(async()=>{await db.query(`CREATE OR REPLACE FUNCTION ${t('pg_operational_profile_guard')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RETURN NEW;END $$`);await assert.rejects(()=>verifyPostgresDeviceCatalogGuard(db,schema),/function missing or altered/);throw Error('intentional catalog guard rollback');}),/intentional catalog guard rollback/);
 assert.equal((await verifyPostgresDeviceCatalogGuard(db,schema)).verified,true);
});
