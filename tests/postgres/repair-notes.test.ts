import {before,after,it} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createPostgresDatabase} from '../../src/lib/db/postgres';
import {applyPostgresMigrations} from '../../src/lib/db/pg-migrations';
import {postgresSessionDigest} from '../../src/lib/db/pg-app-auth';
import {PostgresRepairNotes} from '../../src/lib/db/pg-repair-notes';
import {postgresRepairNotesStatements,verifyPostgresRepairNotesGuards} from '../../src/lib/db/pg-repair-notes-guards';
const url=process.env.REPAID_PG_TEST_URL??'',database=process.env.REPAID_PG_TEST_DATABASE??'';if(!/^repaid_test_[a-f0-9]{24}$/.test(database)||new URL(url).pathname!=='/'+database)throw Error('Disposable PostgreSQL fixture required');
const db=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true}),other=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true}),schema='repaid_integration_'+randomBytes(12).toString('hex'),t=(name:string)=>'"'+schema+'"."'+name+'"',tokens=Array.from({length:5},()=>randomBytes(24).toString('hex')),service=new PostgresRepairNotes(db,schema),parallel=new PostgresRepairNotes(other,schema),status=(n:number)=>(e:unknown)=>(e as {status?:number}).status===n;
let savedId=0;
before(async()=>{
 await applyPostgresMigrations(db,schema,{targetVersion:1});
 await db.query(`INSERT INTO ${t('branches')}(id,name,code) VALUES(1,'One','NOTE1'),(2,'Two','NOTE2')`);
 await db.query(`INSERT INTO ${t('users')}(id,name,email,password_hash,role,branch_id) VALUES(1,'Owner','owner@notes.invalid','unused','owner',1),(2,'Manager','manager@notes.invalid','unused','manager',1),(3,'Assigned','assigned@notes.invalid','unused','technician',1),(4,'Other technician','other@notes.invalid','unused','technician',1),(5,'Other branch','branch@notes.invalid','unused','manager',2)`);
 await db.query(`INSERT INTO ${t('customers')}(id,first_name,branch_id) VALUES(1,'First',1),(2,'Second',2)`);
 await db.query(`INSERT INTO ${t('devices')}(id,customer_id,type,branch_id,brand,model) VALUES(1,1,'mobile',1,'Original brand','Device'),(2,2,'mobile',2,'Hidden branch','Secret')`);
 await db.query(`INSERT INTO ${t('repair_statuses')}(id,name,color,category) VALUES(1,'Received','#123456','intake')`);
 await db.query(`INSERT INTO ${t('repair_tickets')}(id,number,branch_id,customer_id,device_id,status_id,technician_id,problem) VALUES(1,'NOTE-ONE',1,1,1,1,3,'Original problem'),(2,'NOTE-TWO',1,1,1,1,3,'Similar original problem'),(3,'NOTE-OTHER-TECH',1,1,1,1,4,'Similar other technician'),(4,'NOTE-FOREIGN',2,2,2,1,NULL,'Hidden problem')`);
 await db.query(`INSERT INTO ${t('branch_repair_workflows')}(branch_id,mode,revision,updated_by) VALUES(1,'managed',1,1)`);
 await db.query(`INSERT INTO ${t('repair_notes')}(id,ticket_id,user_id,body,kind,created_at) VALUES(1,1,3,'Original private legacy evidence','private','2020-01-01 00:00:00'),(2,2,3,'Similar internal experience','internal','2020-01-02 00:00:00'),(3,2,4,'Similar private hidden experience','private','2020-01-03 00:00:00'),(4,3,4,'Similar unassigned hidden experience','internal','2020-01-04 00:00:00'),(5,4,5,'Similar foreign hidden experience','public','2020-01-05 00:00:00')`);
 await applyPostgresMigrations(db,schema);
 if(!(await db.query(`SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname='pg_repair_note_guard'`,[schema])).rowCount)await db.transaction(async()=>{for(const sql of postgresRepairNotesStatements(schema))await db.query(sql);});
 await verifyPostgresRepairNotesGuards(db,schema);
 for(let i=0;i<tokens.length;i++)await db.query(`INSERT INTO ${t('sessions')}(token,user_id,expires_at) VALUES($1,$2,$3)`,[postgresSessionDigest(tokens[i]),i+1,new Date(Date.now()+3600000).toISOString()]);
});
after(async()=>{try{await db.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');}finally{await other.close();await db.close();}});
it('preserves imported note evidence and creates exact immutable audited notes without financial effects',async()=>{
 const legacy=(await db.query(`SELECT body,user_id,created_at,branch_id FROM ${t('repair_notes')} WHERE id=1`)).rows[0];assert.deepEqual(legacy,{body:'Original private legacy evidence',user_id:'3',created_at:'2020-01-01 00:00:00',branch_id:null});
 const created=await service.create(tokens[2],1,1,{body:'  عیب‌یابی واقعی و بررسی مدار انجام شد  ',kind:'internal'},'notes_actual_once');savedId=created.id;assert.equal(created.ok,true);assert.equal(created.ticket_id,1);
 const record=(await service.list(tokens[2],1,1)).notes.find(n=>n.id===created.id);assert.equal(record?.body,'عیب‌یابی واقعی و بررسی مدار انجام شد');assert.equal(record?.user_id,3);assert.equal(record?.branch_id,1);assert.equal(record?.kind,'internal');assert.ok(record?.created_at);
 const audit=(await db.query(`SELECT user_id,branch_id,"after"::jsonb->>'body' body FROM ${t('audit_logs')} WHERE entity='repair_note' AND entity_id=$1`,[savedId])).rows;assert.deepEqual(audit,[{user_id:'3',branch_id:'1',body:'عیب‌یابی واقعی و بررسی مدار انجام شد'}]);
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('accounting_events')}`)).rows[0].n,'0');assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('accounting_journals')}`)).rows[0].n,'0');
 for(const sql of [`UPDATE ${t('repair_notes')} SET body='rewritten' WHERE id=${savedId}`,`DELETE FROM ${t('repair_notes')} WHERE id=${savedId}`,`TRUNCATE ${t('repair_notes')}`])await assert.rejects(db.query(sql),(error:unknown)=>(error as {code?:string}).code==='55000');
});
it('enforces strict kinds/text, current assignment, branch scope and personal permission denial',async()=>{
 for(const payload of [{body:''},{body:'x',kind:'unexpected'},{body:'x'.repeat(10001)},{body:'x\0'},{body:'x',user_id:1}])await assert.rejects(service.create(tokens[2],1,1,payload,'notes_invalid'),status(400));
 await assert.rejects(service.create(tokens[2],1,1,{body:'No identity'},null),status(400));
 await assert.rejects(service.create(tokens[3],1,1,{body:'Not assigned'},'notes_unassigned'),status(403));
 await assert.rejects(service.list(tokens[4],2,1),status(404));await assert.rejects(service.create(tokens[4],2,1,{body:'Foreign'},'notes_foreign'),status(404));
 await db.query(`INSERT INTO ${t('user_permissions')}(user_id,perm,effect) VALUES(3,'repairs.notes','deny')`);try{await assert.rejects(service.create(tokens[2],1,1,{body:'Denied'},'notes_denied'),status(403));assert.equal(await service.canWrite(tokens[2],1,1),false);}finally{await db.query(`DELETE FROM ${t('user_permissions')} WHERE user_id=3 AND perm='repairs.notes'`);}
});
it('lists private notes only for author or privileged staff and similar search is scoped and paginated',async()=>{
 assert.equal((await service.list(tokens[2],1,1)).notes.some(n=>n.body==='Original private legacy evidence'),true);
 assert.equal((await service.list(tokens[1],1,2)).notes.some(n=>n.body==='Similar private hidden experience'),true);
 const found=await service.list(tokens[2],1,1,{q:'Similar',perPage:1});assert.equal(found.total,1);assert.equal(found.notes[0].body,'Similar internal experience');assert.equal(found.notes[0].ticket_number,'NOTE-TWO');assert.equal(found.hasMore,false);
 assert.equal((await service.list(tokens[0],null,1,{q:'Similar'})).total,3);assert.equal((await service.list(tokens[0],1,1,{q:'Similar'})).total,2);
 for(let i=0;i<23;i++)await service.create(tokens[2],1,2,{body:'Paginated similar note '+i,kind:'internal'},'notes_paged_'+i);
 const first=await service.list(tokens[2],1,1,{q:'Paginated',perPage:20}),second=await service.list(tokens[2],1,1,{q:'Paginated',perPage:20,page:2});assert.equal(first.total,23);assert.equal(first.hasMore,true);assert.equal(second.notes.length,3);assert.equal(second.hasMore,false);assert.equal(new Set([...first.notes,...second.notes].map(n=>n.id)).size,23);
 await assert.rejects(service.list(tokens[2],1,1,{q:'a'.repeat(201)}),status(400));await assert.rejects(service.list(tokens[2],1,1,{perPage:101}),status(400));
});
it('two independent pools replay one durable identity and reject changed payloads without duplicate history',async()=>{
 const payload={body:'Concurrent real note',kind:'private'},results=await Promise.all([service.create(tokens[2],1,1,payload,'notes_parallel_once'),parallel.create(tokens[2],1,1,payload,'notes_parallel_once')]);assert.deepEqual(results[0],results[1]);assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('repair_notes')} WHERE body=$1`,[payload.body])).rows[0].n,'1');assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('audit_logs')} WHERE entity='repair_note' AND entity_id=$1`,[results[0].id])).rows[0].n,'1');await assert.rejects(service.create(tokens[2],1,1,{body:'Changed',kind:'private'},'notes_parallel_once'),status(409));
 await db.query(`UPDATE ${t('users')} SET branch_id=2 WHERE id=3`);try{await assert.rejects(service.create(tokens[2],1,1,payload,'notes_parallel_once'),status(403));}finally{await db.query(`UPDATE ${t('users')} SET branch_id=1 WHERE id=3`);}
 assert.deepEqual(await service.create(tokens[2],1,1,payload,'notes_parallel_once'),results[0]);
});
it('database audit failure rolls back the note and operation receipt and a safe retry succeeds',async()=>{
 await db.query(`CREATE FUNCTION ${t('note_audit_fault')}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.entity='repair_note' THEN RAISE EXCEPTION 'injected note audit failure';END IF;RETURN NEW;END$$`);await db.query(`CREATE TRIGGER note_audit_fault BEFORE INSERT ON ${t('audit_logs')} FOR EACH ROW EXECUTE FUNCTION ${t('note_audit_fault')}()`);
 try{await assert.rejects(service.create(tokens[2],1,1,{body:'Atomic rollback note'},'notes_rollback_key'),/injected note audit failure/);}finally{await db.query(`DROP TRIGGER note_audit_fault ON ${t('audit_logs')}`);await db.query(`DROP FUNCTION ${t('note_audit_fault')}()`);}
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('repair_notes')} WHERE body='Atomic rollback note'`)).rows[0].n,'0');assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('operation_receipts')} WHERE operation_key='notes_rollback_key'`)).rows[0].n,'0');assert.equal((await service.create(tokens[2],1,1,{body:'Atomic rollback note'},'notes_rollback_key')).ok,true);
});
it('cached private-note result is not returned after the author loses current object access',async()=>{
 const payload={body:'Owner private source before role downgrade',kind:'private'},result=await service.create(tokens[0],1,1,payload,'notes_owner_downgrade');
 await db.query(`UPDATE ${t('users')} SET role='technician' WHERE id=1`);try{await assert.rejects(service.create(tokens[0],1,1,payload,'notes_owner_downgrade'),status(403));await assert.rejects(service.list(tokens[0],1,1),status(403));}finally{await db.query(`UPDATE ${t('users')} SET role='owner' WHERE id=1`);}
 assert.deepEqual(await service.create(tokens[0],1,1,payload,'notes_owner_downgrade'),result);assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('repair_notes')} WHERE body=$1`,[payload.body])).rows[0].n,'1');
});
it('rejects direct inserts without durable proof and detects conditional guard tampering',async()=>{
 await assert.rejects(db.transaction(async()=>{await db.query(`SELECT set_config('repaid.repair_note_actor','3',true)`);await db.query(`INSERT INTO ${t('repair_notes')}(ticket_id,user_id,body,kind,created_at,branch_id) VALUES(1,3,'Unproved insertion','internal',$1,1)`,[new Date().toISOString()]);}),(error:unknown)=>(error as {code?:string}).code==='23514');
 await db.query(`DROP TRIGGER pg_repair_note_guard ON ${t('repair_notes')}`);await db.query(`CREATE TRIGGER pg_repair_note_guard BEFORE INSERT OR UPDATE OR DELETE ON ${t('repair_notes')} FOR EACH ROW WHEN(false) EXECUTE FUNCTION ${t('pg_repair_note_guard')}()`);try{await assert.rejects(verifyPostgresRepairNotesGuards(db,schema),/trigger missing or altered/);}finally{await db.query(`DROP TRIGGER pg_repair_note_guard ON ${t('repair_notes')}`);await db.query(`CREATE TRIGGER pg_repair_note_guard BEFORE INSERT OR UPDATE OR DELETE ON ${t('repair_notes')} FOR EACH ROW EXECUTE FUNCTION ${t('pg_repair_note_guard')}()`);}await verifyPostgresRepairNotesGuards(db,schema);
});
