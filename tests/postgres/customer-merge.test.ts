import {before,after,it} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createPostgresDatabase} from '../../src/lib/db/postgres';
import {applyPostgresMigrations} from '../../src/lib/db/pg-migrations';
import {postgresSessionDigest} from '../../src/lib/db/pg-app-auth';
import {PostgresCustomersRepository} from '../../src/lib/db/pg-customers';
import {PostgresDevicesRepository,mutatePostgresCustomer} from '../../src/lib/db/pg-operational-profiles';
import {createPostgresInvoice,createPostgresCustomerReceipt,refundPostgresCustomerReceipt} from '../../src/lib/db/pg-customer-finance';
import {mergePostgresCustomer,postgresCustomerMergeHistory,postgresCustomerMergeStatements} from '../../src/lib/db/pg-customer-merge';
const url=process.env.REPAID_PG_TEST_URL??'',database=process.env.REPAID_PG_TEST_DATABASE??'';
if(!/^repaid_test_[a-f0-9]{24}$/.test(database)||new URL(url).pathname!=='/'+database)throw Error('Disposable PostgreSQL runner required');
const db=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true}),other=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true}),schema='repaid_integration_'+randomBytes(12).toString('hex'),t=(name:string)=>'"'+schema+'"."'+name+'"',owner=randomBytes(24).toString('hex'),staff=randomBytes(24).toString('hex'),peer=randomBytes(24).toString('hex');
const customers=new PostgresCustomersRepository(db,schema),devices=new PostgresDevicesRepository(db,schema),status=(n:number)=>(error:unknown)=>(error as {status?:number}).status===n;
let seq=0;async function customer(branch=1){const key='merge-customer-'+(++seq);return (await customers.create(owner,branch,{first_name:key},key)).id;}
async function device(id:number){return devices.create(owner,1,{customer_id:id,type:'mobile',serial:'MERGE-'+(++seq)},'merge-device-'+seq);}
before(async()=>{
 await applyPostgresMigrations(db,schema);
 if(!(await db.query('SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname=$2',[schema,'pg_customer_merge_guard'])).rowCount)await db.transaction(async()=>{for(const sql of postgresCustomerMergeStatements(schema))await db.query(sql);});
 await db.query(`INSERT INTO ${t('branches')}(id,name,code) VALUES(1,'One','ONE'),(2,'Two','TWO')`);
 await db.query(`INSERT INTO ${t('users')}(id,name,email,password_hash,role,branch_id) VALUES(1,'Owner','owner@merge.invalid','not-used','owner',1),(2,'Staff','staff@merge.invalid','not-used','reception',2),(3,'Peer','peer@merge.invalid','not-used','owner',1)`);
 for(const [token,id]of [[owner,1],[staff,2],[peer,3]] as const)await db.query(`INSERT INTO ${t('sessions')}(token,user_id,expires_at) VALUES($1,$2,$3)`,[postgresSessionDigest(token),id,new Date(Date.now()+3600000).toISOString()]);
});
after(async()=>{try{await db.query('DROP SCHEMA "'+schema+'" CASCADE');}finally{await other.close();await db.close();}});
it('merges nonfinancial source into established customer without rewriting financial or event history',async()=>{
 const source=await customer(),target=await customer(),item=await device(source);
 const invoice=await createPostgresInvoice(db,schema,owner,1,{type:'sale',customer_id:target,items:[{kind:'other',name:'Existing original',qty:1,unit_price:1000}],confirm:true},'merge-existing-invoice');
 await createPostgresCustomerReceipt(db,schema,owner,1,{invoice_id:invoice.id,amount:100,method:'cash'},'merge-existing-payment');
 const invoices=(await db.query(`SELECT * FROM ${t('invoices')} ORDER BY id`)).rows,payments=(await db.query(`SELECT * FROM ${t('payments')} ORDER BY id`)).rows,events=(await db.query(`SELECT * FROM ${t('customer_events')} WHERE customer_id=$1 ORDER BY id`,[source])).rows;
 const financialEvidence=new Map<string,Record<string,unknown>[]>();for(const name of ['accounting_events','accounting_journals','accounting_lines'])financialEvidence.set(name,(await db.query(`SELECT * FROM ${t(name)} ORDER BY id`)).rows);
 const args=[schema,owner,1,source,target,'merge-original-success'] as const;
 const [first,replay]=await Promise.all([mergePostgresCustomer(db,...args),mergePostgresCustomer(other,...args)]);assert.deepEqual(first,replay);assert.equal(first.moved_devices,1);
 assert.equal((await db.query(`SELECT customer_id FROM ${t('devices')} WHERE id=$1`,[item.id])).rows[0].customer_id,String(target));assert.equal((await db.query(`SELECT is_archived FROM ${t('customers')} WHERE id=$1`,[source])).rows[0].is_archived,'1');
 assert.deepEqual((await db.query(`SELECT * FROM ${t('invoices')} ORDER BY id`)).rows,invoices);assert.deepEqual((await db.query(`SELECT * FROM ${t('payments')} ORDER BY id`)).rows,payments);assert.deepEqual((await db.query(`SELECT * FROM ${t('customer_events')} WHERE customer_id=$1 ORDER BY id`,[source])).rows,events);
 for(const [name,rows]of financialEvidence)assert.deepEqual((await db.query(`SELECT * FROM ${t(name)} ORDER BY id`)).rows,rows);
 const history=await postgresCustomerMergeHistory(db,schema,owner,1,target);assert.equal(history.merges.length,1);assert.equal(history.merges[0].merged_id,source);assert.deepEqual(history.events.filter(row=>row.customer_id===String(source)).sort((a,b)=>Number(a.id)-Number(b.id)),events);
 for(const sql of [`UPDATE ${t('merge_log')} SET user_id=2`,`DELETE FROM ${t('merge_log')}`,`TRUNCATE ${t('merge_log')}`,`UPDATE ${t('customers')} SET is_archived=0 WHERE id=${source}`,`UPDATE ${t('devices')} SET customer_id=${source} WHERE id=${item.id}`])await assert.rejects(()=>db.query(sql));
 const otherTarget=await customer();await assert.rejects(()=>mergePostgresCustomer(db,schema,owner,1,source,otherTarget,'merge-original-success'),status(409));
});
it('blocks source draft and issued references, branch violations and unsafe device relinking',async()=>{
 const source=await customer(),target=await customer();await createPostgresInvoice(db,schema,owner,1,{type:'sale',customer_id:source,items:[{kind:'other',name:'Original draft',qty:1,unit_price:10}],confirm:false},'merge-source-draft');
 await assert.rejects(()=>mergePostgresCustomer(db,schema,owner,1,source,target,'merge-draft-blocked'),status(409));
 const one=await customer(),foreign=await customer(2),item=await device(one);
 await assert.rejects(()=>mergePostgresCustomer(db,schema,owner,null,one,foreign,'merge-cross-branch'),status(404));await assert.rejects(()=>mergePostgresCustomer(db,schema,staff,2,one,target,'merge-staff-denied'),status(404));
 await assert.rejects(()=>db.query(`UPDATE ${t('devices')} SET customer_id=$1 WHERE id=$2`,[target,item.id]));assert.equal((await db.query(`SELECT customer_id FROM ${t('devices')} WHERE id=$1`,[item.id])).rows[0].customer_id,String(one));
 const issuedSource=await customer();await createPostgresInvoice(db,schema,owner,1,{type:'sale',customer_id:issuedSource,items:[{kind:'other',name:'Issued original',qty:1,unit_price:50}],confirm:true},'merge-issued-original');await assert.rejects(()=>mergePostgresCustomer(db,schema,owner,1,issuedSource,target,'merge-issued-blocked'),status(409));
});
it('rolls immutable evidence, archive and devices back if audit insertion fails',async()=>{
 const source=await customer(),target=await customer(),item=await device(source);
 await db.query(`CREATE FUNCTION ${t('merge_audit_fail')}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='merge' THEN RAISE EXCEPTION 'Injected merge audit failure'; END IF;RETURN NEW;END$$`);await db.query(`CREATE TRIGGER merge_audit_fail BEFORE INSERT ON ${t('audit_logs')} FOR EACH ROW EXECUTE FUNCTION ${t('merge_audit_fail')}()`);
 try{await assert.rejects(()=>mergePostgresCustomer(db,schema,owner,1,source,target,'merge-audit-retry'));}finally{await db.query(`DROP TRIGGER merge_audit_fail ON ${t('audit_logs')}`);}
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('merge_log')} WHERE merged_id=$1`,[source])).rows[0].n,'0');assert.equal((await db.query(`SELECT is_archived FROM ${t('customers')} WHERE id=$1`,[source])).rows[0].is_archived,'0');assert.equal((await db.query(`SELECT customer_id FROM ${t('devices')} WHERE id=$1`,[item.id])).rows[0].customer_id,String(source));
 assert.equal((await mergePostgresCustomer(db,schema,owner,1,source,target,'merge-audit-retry')).moved_devices,1);
});
it('serializes independent-pool financial creation against merge and prevents merged-party reuse',async()=>{
 for(let attempt=0;attempt<3;attempt++){
  const source=await customer(),target=await customer();
  const results=await Promise.allSettled([mergePostgresCustomer(db,schema,owner,1,source,target,'merge-financial-race-'+attempt),createPostgresInvoice(other,schema,peer,1,{type:'sale',customer_id:source,items:[{kind:'other',name:'Racing original invoice',qty:1,unit_price:25}],confirm:true},'merge-racing-invoice-'+attempt)]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  const merged=results[0].status==='fulfilled';assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('invoices')} WHERE customer_id=$1`,[source])).rows[0].n,merged?'0':'1');
  if(merged){await assert.rejects(()=>createPostgresCustomerReceipt(other,schema,owner,1,{customer_id:source,amount:10,method:'cash'},'merge-source-receipt-'+attempt));await assert.rejects(()=>devices.create(owner,1,{customer_id:source,type:'other'},'merge-source-device-'+attempt));}
 }
});
it('concurrent device registration is either retained in merge evidence or rejected with no orphan',async()=>{
 const source=await customer(),target=await customer();
 const results=await Promise.allSettled([mergePostgresCustomer(db,schema,owner,1,source,target,'merge-device-race'),new PostgresDevicesRepository(other,schema).create(peer,1,{customer_id:source,type:'mobile',serial:'MERGE-RACING-DEVICE'},'merge-device-racing-create')]);
 assert.equal(results[0].status,'fulfilled');assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('devices')} WHERE customer_id=$1`,[source])).rows[0].n,'0');
 if(results[1].status==='fulfilled'){const id=results[1].value.id;assert.equal((await db.query(`SELECT customer_id FROM ${t('devices')} WHERE id=$1`,[id])).rows[0].customer_id,String(target));const history=await postgresCustomerMergeHistory(db,schema,owner,1,target);assert.ok((history.merges[0].evidence.device_ids as number[]).includes(id));}
});
it('keeps ordinary archived invoice settlements/refunds operational and does not erase safety warnings',async()=>{
 const party=await customer(),target=await customer(),invoice=await createPostgresInvoice(db,schema,owner,1,{type:'sale',customer_id:party,items:[{kind:'other',name:'Archived original',qty:1,unit_price:100}],confirm:true},'merge-ordinary-archive-invoice');
 await mutatePostgresCustomer(db,schema,owner,1,party,{action:'archive'},'merge-ordinary-archive');
 const payment=await createPostgresCustomerReceipt(db,schema,owner,1,{invoice_id:invoice.id,amount:30,method:'cash'},'merge-archived-settlement');
 await refundPostgresCustomerReceipt(db,schema,owner,1,{payment_id:payment.id,amount:10,reason:'Confirmed documented correction',method:'cash',confirmed:true,document_reference:'ARCHIVED-REFUND-10'},'merge-archived-refund');
 assert.equal((await db.query(`SELECT paid FROM ${t('invoices')} WHERE id=$1`,[invoice.id])).rows[0].paid,'20');assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('merge_log')} WHERE merged_id=$1`,[party])).rows[0].n,'0');
 const source=await customer();await mutatePostgresCustomer(db,schema,owner,1,source,{action:'blacklist',reason:'Original safety warning'},'merge-source-blacklist');
 await assert.rejects(()=>mergePostgresCustomer(db,schema,owner,1,source,target,'merge-safety-blocked'),status(409));assert.equal((await db.query(`SELECT is_archived FROM ${t('customers')} WHERE id=$1`,[source])).rows[0].is_archived,'0');
});
