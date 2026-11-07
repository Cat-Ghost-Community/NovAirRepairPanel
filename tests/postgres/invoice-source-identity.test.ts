import {before,after,it} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {fork,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import path from 'node:path';
import {createPostgresDatabase} from '../../src/lib/db/postgres';
import {applyPostgresMigrations} from '../../src/lib/db/pg-migrations';
import {postgresInvoiceSourceIdentityStatements,verifyPostgresInvoiceSourceIdentityGuards} from '../../src/lib/db/pg-invoice-source-identity';
import {postgresSessionDigest} from '../../src/lib/db/pg-app-auth';
import {createPostgresInvoice} from '../../src/lib/db/pg-customer-finance';
import {postgresInitializeChart,postgresCreatePeriod} from '../../src/lib/db/postgres-accounting';
import {reviewPostgresFinancialEvent} from '../../src/lib/db/postgres-financial-events';
const url=process.env.REPAID_PG_TEST_URL??'',name=process.env.REPAID_PG_TEST_DATABASE??'';if(!/^repaid_test_[a-f0-9]{24}$/.test(name)||new URL(url).pathname!=='/'+name)throw Error('Disposable PostgreSQL runner required');
const db=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true}),other=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true}),schema='repaid_integration_'+randomBytes(12).toString('hex'),t=(n:string)=>'"'+schema+'"."'+n+'"',owner=randomBytes(24).toString('hex'),peer=randomBytes(24).toString('hex'),foreign=randomBytes(24).toString('hex'),status=(n:number)=>(e:unknown)=>(e as {status?:number}).status===n;
const body=(ticket:number)=>({type:'repair',customer_id:1,ticket_id:ticket,items:[{kind:'labor',name:'Documented source service',qty:1,unit_price:1000}],confirm:true});
before(async()=>{
 await applyPostgresMigrations(db,schema,{targetVersion:1});
 await db.query(`INSERT INTO ${t('branches')}(id,name,code) VALUES(1,'One','ONE'),(2,'Two','TWO')`);await db.query(`INSERT INTO ${t('users')}(id,name,email,password_hash,role,branch_id) VALUES(1,'Owner','owner@source.invalid','not-used','owner',1),(2,'Peer','peer@source.invalid','not-used','owner',1),(3,'Foreign','foreign@source.invalid','not-used','reception',2)`);
 await db.query(`INSERT INTO ${t('customers')}(id,code,first_name,branch_id,created_by) VALUES(1,'IS001','Source customer',1,1),(2,'IS002','Foreign customer',2,1)`);await db.query(`INSERT INTO ${t('devices')}(id,customer_id,type,branch_id) VALUES(1,1,'mobile',1),(2,2,'mobile',2)`);await db.query(`INSERT INTO ${t('repair_statuses')}(id,name,color) VALUES(1,'Received','blue'),(500,'Cancelled','gray')`);
 for(const id of [10,11,12,13,99])await db.query(`INSERT INTO ${t('repair_tickets')}(id,number,branch_id,customer_id,device_id,status_id) VALUES($1,$2,1,1,1,1)`,[id,'IS-R'+id]);
 for(const id of [14,15])await db.query(`INSERT INTO ${t('repair_tickets')}(id,number,branch_id,customer_id,device_id,status_id) VALUES($1,$2,1,1,1,500)`,[id,'IS-CANCELLED-'+id]);
 await db.query(`INSERT INTO ${t('parts')}(id,name,quantity_precision,price,avg_cost) VALUES(1,'Previously issued fractional part',6,200,100)`);await db.query(`INSERT INTO ${t('inventory_locations')}(id,name,branch_id,is_default) VALUES(1,'Original warehouse',1,1)`);
 await db.query(`INSERT INTO ${t('ticket_items')}(id,ticket_id,kind,ref_id,name,qty,unit_price,cost,consumed,added_by) VALUES(500,10,'part',1,'Original physical issue',0.5,200,100,0,1)`);
 await db.query(`INSERT INTO ${t('inventory_movements')}(id,part_id,location_id,qty,type,unit_cost,extended_cost,ref_type,ref_id,branch_id,user_id) VALUES(1,1,1,1,'purchase',100,100,'opening-fixture',1,1,1),(2,1,1,-0.5,'repair_consumption',100,50,'ticket_item',500,1,1)`);await db.query(`INSERT INTO ${t('inventory_stock')}(part_id,location_id,qty,reserved) VALUES(1,1,0.5,0)`);
 for(const id of [20,21,99]){await db.query(`INSERT INTO ${t('sales')}(id,number,branch_id,customer_id,subtotal,discount,tax,total,paid,status) VALUES($1,$2,1,1,1000,0,0,1000,0,'credit')`,[id,'IS-S'+id]);await db.query(`INSERT INTO ${t('sale_items')}(sale_id,kind,name,qty,unit_price,cost) VALUES($1,'other','Original source service',1,1000,0)`,[id]);}
 for(const [id,ticket,sale]of [[900,99,null],[901,99,null],[902,null,99],[903,null,99]] as const)await db.query(`INSERT INTO ${t('invoices')}(id,number,type,customer_id,branch_id,ticket_id,sale_id,status,subtotal,total) VALUES($1,$2,$3,1,1,$4,$5,'issued',1000,1000)`,[id,'IS-AMBIGUOUS-'+id,ticket?'repair':'sale',ticket,sale]);
 await db.query(`INSERT INTO ${t('invoices')}(id,number,type,customer_id,branch_id,ticket_id,status,subtotal,total) VALUES(904,'CANCELLED-LEGACY-INVOICE','repair',1,1,15,'draft',1000,1000)`);
 await applyPostgresMigrations(db,schema);
 if(!(await db.query('SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname=$2',[schema,'pg_invoice_source_identity'])).rowCount)await db.transaction(async()=>{for(const sql of postgresInvoiceSourceIdentityStatements(schema))await db.query(sql);});
 assert.equal((await verifyPostgresInvoiceSourceIdentityGuards(db,schema)).verified,true);
 await db.query(`SELECT setval(pg_get_serial_sequence($1,'id'),904,true)`,[schema+'.invoices']);
 for(const [token,id]of [[owner,1],[peer,2],[foreign,3]] as const)await db.query(`INSERT INTO ${t('sessions')}(token,user_id,expires_at) VALUES($1,$2,$3)`,[postgresSessionDigest(token),id,new Date(Date.now()+3600000).toISOString()]);
 await postgresInitializeChart(db,schema,owner);const year=new Date().getUTCFullYear();await postgresCreatePeriod(db,schema,owner,{name:'Isolated source identity year',start_date:year+'-01-01',end_date:year+'-12-31'});
});
after(async()=>{try{await db.query('DROP SCHEMA "'+schema+'" CASCADE');}finally{await other.close();await db.close();}});
it('different actors/nonces/pools converge on one authoritative repair obligation and one reviewed journal',async()=>{
 const stock=(await db.query(`SELECT COUNT(*) n FROM ${t('inventory_movements')}`)).rows[0].n;
 const results=await Promise.all([createPostgresInvoice(db,schema,owner,1,body(10),'source-repair-owner'),createPostgresInvoice(other,schema,peer,1,body(10),'source-repair-peer')]);assert.equal(results[0].id,results[1].id);assert.deepEqual(results.map(r=>r.duplicate).sort(),[false,true]);
 const invoice=(await db.query(`SELECT * FROM ${t('invoices')} WHERE ticket_id=10`)).rows;assert.equal(invoice.length,1);assert.equal(invoice[0].total,'1000');const events=(await db.query(`SELECT * FROM ${t('accounting_events')} WHERE source_type='invoice' AND source_id=$1 AND event_type='confirm'`,[String(results[0].id)])).rows;assert.equal(events.length,1);
 const reviewer=invoice[0].created_by==='1'?peer:owner;await reviewPostgresFinancialEvent(db,schema,reviewer,Number(events[0].id),{posting_date:new Date().toISOString().slice(0,10),reason:'Independent source identity fixture review',lines:[{account_code:'1100',debit:1000,customer_id:1},{account_code:'4010',credit:1000}]});
 const saved=await createPostgresInvoice(db,schema,owner,1,{...body(10),items:[{kind:'labor',name:'Unapplied changed line',qty:1,unit_price:9999}]},'source-repair-third');assert.equal(saved.id,results[0].id);assert.equal(saved.total,1000);assert.equal(saved.duplicate,true);
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('accounting_event_reviews')} WHERE event_id=$1`,[events[0].id])).rows[0].n,'1');assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('accounting_journals')} WHERE state='posted'`)).rows[0].n,'1');assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('inventory_movements')}`)).rows[0].n,stock);
 assert.equal((await db.query(`SELECT (qty*1000000)::bigint qty_micro FROM ${t('inventory_stock')} WHERE part_id=1 AND location_id=1`)).rows[0].qty_micro,'500000');assert.equal((await db.query(`SELECT payload_json::jsonb->>'control_amount' amount FROM ${t('accounting_events')} WHERE source_type='invoice' AND source_id=$1 AND event_type='repair_cost_recognition'`,[String(saved.id)])).rows[0].amount,'50');
 await assert.rejects(()=>createPostgresInvoice(db,schema,owner,1,{...body(10),notes:'Conflicting original payload'},'source-repair-owner'),status(409));
});
it('two independent Node processes with different actors and keys cannot create a second source invoice',async()=>{
 const children:ChildProcess[]=[];
 const launch=async(token:string,key:string)=>{const child=fork(path.resolve('tests/postgres/invoice-source-identity-worker.ts'),[],{execArgv:['--import','tsx'],env:process.env,stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});children.push(child);await once(child,'message',{signal:AbortSignal.timeout(10000)});const message=once(child,'message',{signal:AbortSignal.timeout(10000)}),exit=once(child,'exit',{signal:AbortSignal.timeout(15000)});child.send({schema,token,key,ticket:11});return {message,exit};};
 try{const runs=await Promise.all([launch(owner,'source-process-owner'),launch(peer,'source-process-peer')]),results=await Promise.all(runs.map(async run=>(await run.message)[0]));assert.equal(results[0].id,results[1].id);for(const run of runs)assert.equal((await run.exit)[0],0);}finally{for(const child of children)if(child.exitCode==null)child.kill();}
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('invoices')} WHERE ticket_id=11`)).rows[0].n,'1');assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('accounting_events')} e JOIN ${t('invoices')} i ON e.source_type='invoice' AND e.source_id=i.id::text WHERE i.ticket_id=11 AND e.event_type='confirm'`)).rows[0].n,'1');
});
it('sale-backed draft creation also reuses the source; legacy source duplicates remain untouched and blocked',async()=>{
 const payload={type:'sale',sale_id:20,customer_id:1,confirm:false};const [one,two]=await Promise.all([createPostgresInvoice(db,schema,owner,1,payload,'source-sale-owner'),createPostgresInvoice(other,schema,peer,1,payload,'source-sale-peer')]);assert.equal(one.id,two.id);assert.equal(one.status,'draft');assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('invoices')} WHERE sale_id=20`)).rows[0].n,'1');
 const original=(await db.query(`SELECT * FROM ${t('invoices')} WHERE id BETWEEN 900 AND 903 ORDER BY id`)).rows;
 await assert.rejects(()=>createPostgresInvoice(db,schema,owner,1,body(99),'source-ambiguous-repair'),status(409));await assert.rejects(()=>createPostgresInvoice(db,schema,owner,1,{type:'sale',sale_id:99,customer_id:1},'source-ambiguous-sale'),status(409));assert.deepEqual((await db.query(`SELECT * FROM ${t('invoices')} WHERE id BETWEEN 900 AND 903 ORDER BY id`)).rows,original);
});
it('native insert guards enforce source identity and branch; failed work rolls back before safe retry',async()=>{
 await assert.rejects(()=>createPostgresInvoice(db,schema,owner,2,body(12),'source-wrong-branch'),status(404));await assert.rejects(()=>createPostgresInvoice(db,schema,foreign,1,body(12),'source-foreign-staff'),status(403));
 await assert.rejects(()=>db.query(`INSERT INTO ${t('invoices')}(number,type,customer_id,branch_id,ticket_id,status,total,subtotal) VALUES('FORGED-SOURCE','repair',2,2,12,'draft',1000,1000)`));await assert.rejects(()=>db.query(`INSERT INTO ${t('invoices')}(number,type,customer_id,branch_id,ticket_id,status,total,subtotal) VALUES('DUPLICATE-SOURCE','repair',1,1,10,'draft',1000,1000)`));
 await db.query(`CREATE FUNCTION ${t('source_invoice_audit_failure')}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.entity='invoice' AND NEW.action='create' THEN RAISE EXCEPTION 'Injected source invoice failure';END IF;RETURN NEW;END$$`);await db.query(`CREATE TRIGGER source_invoice_audit_failure BEFORE INSERT ON ${t('audit_logs')} FOR EACH ROW EXECUTE FUNCTION ${t('source_invoice_audit_failure')}()`);
 try{await assert.rejects(()=>createPostgresInvoice(db,schema,owner,1,body(13),'source-invoice-retry'));}finally{await db.query(`DROP TRIGGER source_invoice_audit_failure ON ${t('audit_logs')}`);}
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('invoices')} WHERE ticket_id=13`)).rows[0].n,'0');const saved=await createPostgresInvoice(db,schema,owner,1,body(13),'source-invoice-retry');assert.equal(saved.duplicate,false);assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('invoices')} WHERE ticket_id=13`)).rows[0].n,'1');
});
it('startup verifier rejects disabled source triggers and altered function bodies without leaving schema drift',async()=>{
 await assert.rejects(()=>db.transaction(async()=>{await db.query(`ALTER TABLE ${t('invoices')} DISABLE TRIGGER pg_invoice_source_identity`);await assert.rejects(()=>verifyPostgresInvoiceSourceIdentityGuards(db,schema),/trigger/);throw Error('Rollback temporary guard test');}),/Rollback temporary guard test/);
 await assert.rejects(()=>db.transaction(async()=>{await db.query(`CREATE OR REPLACE FUNCTION ${t('pg_invoice_source_identity')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN RETURN NEW;END$$`);await assert.rejects(()=>verifyPostgresInvoiceSourceIdentityGuards(db,schema),/function/);throw Error('Rollback temporary function test');}),/Rollback temporary function test/);
 assert.equal((await verifyPostgresInvoiceSourceIdentityGuards(db,schema)).verified,true);
});
it('fails closed for source-linked snapshot-isolation writes while standalone invoice drafts remain supported',async()=>{
 for(const isolation of ['repeatable read','serializable'] as const){
  const before=(await db.query(`SELECT COUNT(*) n FROM ${t('invoices')}`)).rows[0].n;
  await assert.rejects(()=>db.transaction(()=>db.query(`INSERT INTO ${t('invoices')}(number,type,customer_id,branch_id,ticket_id,status,total,subtotal) VALUES($1,'repair',1,1,12,'draft',1000,1000)`,['ISOLATION-'+isolation]),{isolation}),(error:unknown)=>(error as {code?:string}).code==='55000');
  assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('invoices')}`)).rows[0].n,before);
  await db.transaction(()=>db.query(`INSERT INTO ${t('invoices')}(number,type,customer_id,branch_id,status,total,subtotal) VALUES($1,'sale',1,1,'draft',1000,1000)`,['STANDALONE-'+isolation]),{isolation});
 }
});
it('rejects known Cancelled repair before draft creation or existing invoice acknowledgement without financial side effects',async()=>{
 const order=(name:string)=>name==='counters'?'key':name==='accounting_event_reviews'?'event_id':name==='operation_receipts'?'actor_id,branch_id,operation,operation_key,scope':'id';
 const original=new Map<string,Record<string,unknown>[]>();for(const name of ['invoices','counters','accounting_events','accounting_event_reviews','accounting_journals','inventory_movements','audit_logs','operation_receipts'])original.set(name,(await db.query(`SELECT * FROM ${t(name)} ORDER BY ${order(name)}`)).rows);
 for(const ticket of [14,15])for(const confirm of [false,true])await assert.rejects(()=>createPostgresInvoice(db,schema,owner,1,{...body(ticket),confirm},'cancelled-source-'+ticket+'-'+confirm),status(409));
 for(const ticket of [14,15])await assert.rejects(()=>db.query(`INSERT INTO ${t('invoices')}(id,number,type,customer_id,branch_id,ticket_id,status,total,subtotal) VALUES($1,$2,'repair',1,1,$3,'draft',1000,1000)`,[99000+ticket,'NATIVE-CANCELLED-'+ticket,ticket]),(error:unknown)=>(error as {code?:string}).code==='23514');
 for(const [name,rows]of original)assert.deepEqual((await db.query(`SELECT * FROM ${t(name)} ORDER BY ${order(name)}`)).rows,rows);
});
