import {before,after,it} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import type {QueryResultRow} from 'pg';
import {createPostgresDatabase,type PostgresDatabase} from '../../src/lib/db/postgres';
import {applyPostgresMigrations} from '../../src/lib/db/pg-migrations';
import {postgresSessionDigest} from '../../src/lib/db/pg-app-auth';
import {createPostgresInvoice,confirmPostgresInvoice,createPostgresCustomerReceipt,refundPostgresCustomerReceipt,postgresInvoicePosition} from '../../src/lib/db/pg-customer-finance';
const url=process.env.REPAID_PG_TEST_URL??'',name=process.env.REPAID_PG_TEST_DATABASE??'';
if(!/^repaid_test_[a-f0-9]{24}$/.test(name)||new URL(url).pathname!=='/'+name)throw Error('Disposable PostgreSQL runner required');
const db=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true,lockTimeoutMs:5000}),other=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true,lockTimeoutMs:5000}),schema='repaid_integration_'+randomBytes(12).toString('hex'),t=(n:string)=>'"'+schema+'"."'+n+'"',owner=randomBytes(24).toString('hex'),peer=randomBytes(24).toString('hex');
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}
function fundsBarrier(database:PostgresDatabase,stop:RegExp){
 const entered=deferred(),release=deferred(),attempted=deferred();let funds=false,paused=false,pid=0;
 const wrapped:PostgresDatabase={...database,async query<Row extends QueryResultRow=QueryResultRow>(sql:string,values:unknown[]=[]){
  const isFunds=sql.startsWith('SELECT pg_advisory_xact_lock')&&String(values[1]).startsWith('customer-funds:');
  if(isFunds){pid=Number((await database.query('SELECT pg_backend_pid() pid')).rows[0].pid);attempted.resolve();}
  if(!paused&&stop.test(sql)){assert.equal(funds,true,'Customer funds must be acquired before parent/invoice row locks');paused=true;entered.resolve();await release.promise;}
  const result=await database.query<Row>(sql,values);if(isFunds)funds=true;return result;
 }};
 return {db:wrapped,entered,release,attempted,pid:()=>pid};
}
async function waiting(pid:number){for(let n=0;n<100;n++){const row=(await db.query('SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0];if(row?.wait_event_type==='Lock'&&row.wait_event==='advisory')return;await new Promise(r=>setTimeout(r,10));}assert.fail('Independent operation did not demonstrably wait on customer funds');}
const body=(ticket:number,confirm=false)=>({type:'repair',customer_id:1,ticket_id:ticket,items:[{kind:'labor',name:'Documented repair service',qty:1,unit_price:1000}],confirm});
before(async()=>{
 await applyPostgresMigrations(db,schema,{targetVersion:1});
 await db.query(`INSERT INTO ${t('branches')}(id,name,code) VALUES(1,'One','ONE'),(2,'Two','TWO')`);
 await db.query(`INSERT INTO ${t('users')}(id,name,email,password_hash,role,branch_id) VALUES(1,'Owner','owner@locks.invalid','not-used','owner',1),(2,'Peer','peer@locks.invalid','not-used','owner',1)`);
 await db.query(`INSERT INTO ${t('customers')}(id,code,first_name,branch_id,created_by) VALUES(1,'LOCK001','Lock customer',1,1)`);
 await db.query(`INSERT INTO ${t('devices')}(id,customer_id,type,branch_id) VALUES(1,1,'mobile',1)`);
 await db.query(`INSERT INTO ${t('repair_statuses')}(id,name,color) VALUES(1,'Received','blue')`);
 for(const id of [10,11,12])await db.query(`INSERT INTO ${t('repair_tickets')}(id,number,branch_id,customer_id,device_id,status_id) VALUES($1,$2,1,1,1,1)`,[id,'LOCK-R'+id]);
 await applyPostgresMigrations(db,schema);
 for(const [token,id]of [[owner,1],[peer,2]] as const)await db.query(`INSERT INTO ${t('sessions')}(token,user_id,expires_at) VALUES($1,$2,$3)`,[postgresSessionDigest(token),id,new Date(Date.now()+3600000).toISOString()]);
});
after(async()=>{try{await db.query('DROP SCHEMA "'+schema+'" CASCADE');}finally{await other.close();await db.close();}});
it('confirmation holds funds before invoice and a different actor receipt waits then settles the confirmed obligation', {timeout:15000},async()=>{
 const inv=await createPostgresInvoice(db,schema,owner,1,body(10),'lock_draft');
 await assert.rejects(()=>createPostgresCustomerReceipt(other,schema,peer,1,{invoice_id:inv.id,amount:400,method:'cash'},'lock_unconfirmed'),(e:unknown)=>(e as {status?:number}).status===409);
 const first=fundsBarrier(db,/SELECT id FROM .*\."invoices" WHERE id=\$1 FOR UPDATE/),second=fundsBarrier(other,/$a/);
 const confirm=confirmPostgresInvoice(first.db,schema,owner,1,inv.id,[],'lock_confirm');
 const receiptStart=first.entered.promise.then(()=>createPostgresCustomerReceipt(second.db,schema,peer,1,{invoice_id:inv.id,amount:400,method:'cash'},'lock_receipt'));
 try{await first.entered.promise;await second.attempted.promise;await waiting(second.pid());}finally{first.release.resolve();}
 const [,receipt]=await Promise.all([confirm,receiptStart]);
 const position=await postgresInvoicePosition(db,schema,inv.id);assert.equal(position.net_paid,400);assert.equal(position.outstanding,600);
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('payments')} WHERE invoice_id=$1`,[inv.id])).rows[0].n,'1');
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('accounting_events')} WHERE source_type='invoice' AND source_id=$1 AND event_type='confirm'`,[String(inv.id)])).rows[0].n,'1');
 assert.deepEqual(await createPostgresCustomerReceipt(other,schema,peer,1,{invoice_id:inv.id,amount:400,method:'cash'},'lock_receipt'),receipt);
});
it('constructor locks funds before ticket; queued advance rechecks newly committed invoice instead of creating an orphan advance',{timeout:15000},async()=>{
 const first=fundsBarrier(db,/FROM .*\."repair_tickets" WHERE id=\$1 AND branch_id=\$2 FOR UPDATE/),second=fundsBarrier(other,/$a/);
 const construct=createPostgresInvoice(first.db,schema,owner,1,body(11,true),'lock_construct');
 const receiptStart=first.entered.promise.then(()=>createPostgresCustomerReceipt(second.db,schema,peer,1,{ticket_id:11,amount:250,method:'cash'},'lock_advance'));
 try{await first.entered.promise;await second.attempted.promise;await waiting(second.pid());}finally{first.release.resolve();}
 const [invoice,receipt]=await Promise.all([construct,receiptStart]);
 const payment=(await db.query(`SELECT invoice_id,ticket_id,amount FROM ${t('payments')} WHERE id=$1`,[receipt.id])).rows[0];assert.equal(payment.invoice_id,String(invoice.id));assert.equal(payment.ticket_id,'11');assert.equal(payment.amount,'250');
 assert.equal((await postgresInvoicePosition(db,schema,invoice.id)).outstanding,750);
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('invoices')} WHERE ticket_id=11`)).rows[0].n,'1');
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('inventory_movements')}`)).rows[0].n,'0');
});
it('failed refund rolls back all effects; same nonce retry and replay preserve source receipt and exact balances',async()=>{
 const inv=await createPostgresInvoice(db,schema,owner,1,body(12,true),'lock_refund_invoice'),receipt=await createPostgresCustomerReceipt(db,schema,peer,1,{invoice_id:inv.id,amount:400,method:'cash'},'lock_refund_receipt');
 await db.query(`CREATE FUNCTION ${t('lock_test_failure')}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.entity='payment' AND NEW.action='refund' THEN RAISE EXCEPTION 'Injected refund audit failure';END IF;RETURN NEW;END$$`);
 await db.query(`CREATE TRIGGER lock_test_failure BEFORE INSERT ON ${t('audit_logs')} FOR EACH ROW EXECUTE FUNCTION ${t('lock_test_failure')}()`);
 const payload={payment_id:receipt.id,amount:100,reason:'Documented correction and real refund'};
 try{await assert.rejects(()=>refundPostgresCustomerReceipt(other,schema,peer,1,payload,'lock_refund'));}finally{await db.query(`DROP TRIGGER lock_test_failure ON ${t('audit_logs')}`);}
 assert.equal((await postgresInvoicePosition(db,schema,inv.id)).net_paid,400);
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('refunds')} WHERE payment_id=$1`,[receipt.id])).rows[0].n,'0');
 const result=await refundPostgresCustomerReceipt(other,schema,peer,1,payload,'lock_refund');assert.deepEqual(await refundPostgresCustomerReceipt(db,schema,peer,1,payload,'lock_refund'),result);
 assert.equal((await postgresInvoicePosition(db,schema,inv.id)).net_paid,300);assert.equal((await postgresInvoicePosition(db,schema,inv.id)).outstanding,700);
 assert.equal((await db.query(`SELECT amount FROM ${t('payments')} WHERE id=$1`,[receipt.id])).rows[0].amount,'400');
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('accounting_events')} WHERE source_type='refund' AND source_id=$1`,[String(result.id)])).rows[0].n,'1');
});
