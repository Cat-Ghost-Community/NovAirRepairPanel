import {before,after,it} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createPostgresDatabase} from '../../src/lib/db/postgres';
import {applyPostgresMigrations} from '../../src/lib/db/pg-migrations';
import {actualRepairIssueCost} from '../../src/lib/db/pg-repair-cost';
import {postgresSessionDigest} from '../../src/lib/db/pg-app-auth';
import {createPostgresInvoice,confirmPostgresInvoice} from '../../src/lib/db/pg-customer-finance';
import {capturePostgresFinancialDocument} from '../../src/lib/db/postgres-financial-events';
const url=process.env.REPAID_PG_TEST_URL??'',name=process.env.REPAID_PG_TEST_DATABASE??'';
if(!/^repaid_test_[a-f0-9]{24}$/.test(name)||new URL(url).pathname!=='/'+name)throw Error('Disposable PostgreSQL runner required');
const db=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true}),schema='repaid_integration_'+randomBytes(12).toString('hex'),t=(n:string)=>'"'+schema+'"."'+n+'"',status=(n:number)=>(e:unknown)=>(e as {status?:number}).status===n,owner=randomBytes(24).toString('hex');
const cost=(ticket:number,branch=1)=>db.transaction(()=>actualRepairIssueCost(db,schema,ticket,branch));
before(async()=>{
 await applyPostgresMigrations(db,schema,{targetVersion:1});
 await db.query(`INSERT INTO ${t('branches')}(id,name,code) VALUES(1,'One','ONE'),(2,'Two','TWO')`);
 await db.query(`INSERT INTO ${t('users')}(id,name,email,password_hash,role,branch_id) VALUES(1,'Owner','owner@repaircost.invalid','not-used','owner',1),(2,'Reviewer','review@repaircost.invalid','not-used','owner',1)`);
 await db.query(`INSERT INTO ${t('customers')}(id,code,first_name,branch_id,created_by) VALUES(1,'RC001','Preserved legacy customer',1,1)`);
 await db.query(`INSERT INTO ${t('devices')}(id,customer_id,type,branch_id) VALUES(1,1,'mobile',1)`);
 await db.query(`INSERT INTO ${t('repair_statuses')}(id,name,color) VALUES(1,'Received','blue')`);
 for(let ticket=100;ticket<=109;ticket++)await db.query(`INSERT INTO ${t('repair_tickets')}(id,number,branch_id,customer_id,device_id,status_id) VALUES($1,$2,1,1,1,1)`,[ticket,'RC-'+ticket]);
 await db.query(`INSERT INTO ${t('parts')}(id,name,avg_cost,purchase_price,quantity_precision) VALUES(1,'Exact fractional component',99999,99999,6),(2,'Two-decimal component',88888,88888,2)`);
 await db.query(`INSERT INTO ${t('inventory_locations')}(id,name,branch_id,is_default) VALUES(1,'Source warehouse',1,1),(2,'Foreign warehouse',2,1)`);
 for(const [id,ticket,part,qty,consumed]of [[1001,100,1,'0.75',0],[1011,101,1,'0.5',1],[1021,102,1,'0.5',0],[1031,103,1,'0.5',0],[1051,105,2,'0.5',0],[1061,106,1,'0.5',0],[1071,107,1,'0.5',0],[1081,108,1,'0.5',0],[1091,109,1,'1',1]] as const)await db.query(`INSERT INTO ${t('ticket_items')}(id,ticket_id,kind,ref_id,name,qty,unit_price,cost,consumed,added_by) VALUES($1,$2,'part',$3,'Original quoted part',$4,9000,7777,$5,1)`,[id,ticket,part,qty,consumed]);
 await db.query(`INSERT INTO ${t('ticket_items')}(id,ticket_id,kind,name,qty,unit_price,cost,consumed) VALUES(1041,104,'labor','Quoted labor is not performed cost',1,10000,5000,0)`);
 // Deliberately populated legacy records are seeded before native guards, then
 // upgraded. They are historical evidence fixtures, never new production writes.
 const rows:[number,number,string,string,number,number|null,number|null,string,number,number][]=[
  [1,1,'100','purchase',1,1,100,'opening-fixture',1,1],[2,2,'100','purchase',1,1,100,'opening-fixture',2,1],
  [10001,1,'-0.75','repair_consumption',1,43,32,'ticket_item',1001,1],
  [10002,2,'-0.25','repair_consumption',1,101,null,'ticket',100,1],
  [10003,1,'-0.5','repair_consumption',1,101,null,'repair',100,1],
  [10201,1,'-0.5','repair_consumption',1,null,null,'ticket_item',1021,1],
  [10301,1,'-0.5','repair_consumption',1,40,20,'ticket_item',1031,2],
  [10501,2,'-0.5','repair_consumption',1,101,51,'ticket_item',1051,1],
  [10601,1,'0.5','return',1,40,20,'ticket_item',1061,1],
  [10701,1,'-0.5','repair_consumption',1,40,null,'ticket_item',1071,1],
  [10801,1,'-0.5','repair_consumption',1,9999,51,'ticket_item',1081,1],
  [10901,1,'-1','repair_consumption',1,31,31,'ticket_item',1091,1],
  [10902,1,'0.5','return',1,31,16,'business_return',1,1],
 ];
 for(const [id,part,qty,type,location,unit,extended,ref,reference,branch]of rows)await db.query(`INSERT INTO ${t('inventory_movements')}(id,part_id,qty,type,location_id,unit_cost,extended_cost,ref_type,ref_id,branch_id,user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1)`,[id,part,qty,type,location,unit,extended,ref,reference,branch]);
 await db.query(`INSERT INTO ${t('inventory_stock')}(part_id,location_id,qty,reserved) SELECT part_id,location_id,SUM(qty),0 FROM ${t('inventory_movements')} GROUP BY part_id,location_id`);
 await db.query(`INSERT INTO ${t('accounting_recognition_policies')}(id,branch_id,kind,reason,effective_date,proposed_by,approved_by,approved_at,min_event_id,status) VALUES(1,1,'inventory_carrying_v1','Synthetic retained source policy','2026-01-01',1,2,'2026-01-01',0,'approved')`);
 await db.query(`UPDATE ${t('inventory_movements')} SET valuation_json=$1 WHERE id=10801`,[JSON.stringify({method:'location_carrying_v1',policy_id:1,before_qty_micro:1000000,after_qty_micro:500000,before_value:101,after_value:50,amount:51})]);
 await db.query(`UPDATE ${t('inventory_movements')} SET valuation_json=$1 WHERE id=10701`,[JSON.stringify({method:'location_carrying_v1',policy_id:1,amount:20})]);
 await db.query(`INSERT INTO ${t('invoices')}(id,number,type,customer_id,ticket_id,branch_id,status,subtotal,total) VALUES(1,'LEGACY-RC109','repair',1,109,1,'issued',100,100)`);
 await db.query(`INSERT INTO ${t('invoice_items')}(id,invoice_id,kind,ref_id,name,qty,unit_price,cost,total) VALUES(1,1,'part',1,'Original billed component',1,100,31,100)`);
 await db.query(`INSERT INTO ${t('business_returns')}(id,number,invoice_id,branch_id,kind,reason,delivery_reference,requested_by,state) VALUES(1,'LEGACY-RETURN109',1,1,'customer','Original physical return','Original delivery',1,'disposed')`);
 await db.query(`INSERT INTO ${t('business_return_lines')}(id,return_id,invoice_item_id,part_id,qty_micro,unit_price,unit_cost,gross_limit,disposition,location_id,movement_id,cost_amount) VALUES(1,1,1,1,500000,100,31,50,'restock',1,10902,16)`);
 await db.query(`INSERT INTO ${t('invoices')}(id,number,type,customer_id,ticket_id,branch_id,status,subtotal,total) VALUES(2,'RETIRED-RC105','repair',1,105,1,'issued',100,100)`);
 const retired=JSON.stringify({document:{id:2,type:'repair',customer_id:1,supplier_id:null,branch_id:1,ticket_id:105,sale_id:null,purchase_order_id:null,status:'issued',subtotal:100,discount:0,tax:0,total:100},lines:[],bank_evidence:[],repair_cost_lines:[],control_amount:51,currency:'IRR',policy:'review_required',branch_basis:'source_document',quantity_format:'decimal_text_v1'});
 await db.query(`INSERT INTO ${t('accounting_events')}(event_key,source_type,source_id,branch_id,event_type,payload_json,payload_hash,actor_id) VALUES('invoice:2:repair_cost_recognition','invoice','2',1,'repair_cost_recognition',$1,$2,1)`,[retired,createHash('sha256').update(retired).digest('hex')]);
 const original=(await db.query(`SELECT * FROM ${t('inventory_movements')} ORDER BY id`)).rows;await applyPostgresMigrations(db,schema);assert.deepEqual((await db.query(`SELECT * FROM ${t('inventory_movements')} ORDER BY id`)).rows,original);
 await db.query(`SELECT setval(pg_get_serial_sequence($1,'id'),(SELECT MAX(id) FROM ${t('invoices')}),true)`,[schema+'.invoices']);
 await db.query(`SELECT setval(pg_get_serial_sequence($1,'id'),(SELECT MAX(id) FROM ${t('invoice_items')}),true)`,[schema+'.invoice_items']);
 await db.query(`INSERT INTO ${t('sessions')}(token,user_id,expires_at) VALUES($1,1,$2)`,[postgresSessionDigest(owner),new Date(Date.now()+3600000).toISOString()]);
});
after(async()=>{try{await db.query('DROP SCHEMA "'+schema+'" CASCADE');}finally{await db.close();}});
it('counts each proven reference once with independent exact fractional expectations, even consumed=0',async()=>{
 const result=await cost(100);assert.equal(result.amount,108);assert.deepEqual(result.movement_ids,[10001,10002,10003]);assert.equal(result.snapshot.movements[0].amount,32);assert.equal(result.snapshot.movements[1].amount,25);assert.equal(result.snapshot.movements[2].amount,51);assert.equal(result.requires_accounting_review,true);assert.deepEqual(await cost(100),result);
 assert.equal((await db.query(`SELECT consumed,cost FROM ${t('ticket_items')} WHERE id=1001`)).rows[0].consumed,'0');
});
it('uses preserved carrying extended value instead of current catalog or recorded unit display cost',async()=>{
 const exact=await cost(108);assert.equal(exact.cost,51);assert.equal(exact.snapshot.movements[0].basis,'recorded_extended_cost');assert.equal(exact.snapshot.movements[0].valuation?.before_value,101);assert.equal((await cost(105)).amount,51);
});
it('rejects phantom quote costs, missing evidence, cross-branch movements and unsupported return netting',async()=>{
 for(const ticket of [101,102,103,106,107,109])await assert.rejects(()=>cost(ticket),status(409));await assert.rejects(()=>cost(100,2),status(404));assert.equal((await cost(104)).cost,0);assert.deepEqual((await cost(104)).movement_ids,[]);
});
it('requires caller transaction and leaves original source/history and all journals untouched',async()=>{
 await assert.rejects(()=>actualRepairIssueCost(db,schema,100,1),/authoritative transaction/);
 const original=new Map<string,Record<string,unknown>[]>();for(const name of ['inventory_movements','ticket_items','repair_tickets','accounting_events','accounting_journals','accounting_lines','audit_logs'])original.set(name,(await db.query(`SELECT * FROM ${t(name)} ORDER BY id`)).rows);
 await assert.rejects(()=>db.transaction(async()=>{assert.equal((await actualRepairIssueCost(db,schema,100,1)).cost,108);await db.query(`INSERT INTO ${t('audit_logs')}(user_id,action,entity,entity_id,branch_id) VALUES(1,'cost_inspection','repair_ticket',100,1)`);throw Error('Injected transaction failure');}),/Injected transaction failure/);
 for(const [name,rows]of original)assert.deepEqual((await db.query(`SELECT * FROM ${t(name)} ORDER BY id`)).rows,rows);
 await assert.rejects(()=>db.query(`UPDATE ${t('inventory_movements')} SET unit_cost=999 WHERE id=10002`));
});
it('confirms a real repair invoice atomically with exact108 source cost, no second stock deduction or fabricated journal',async()=>{
 const invoice=await createPostgresInvoice(db,schema,owner,1,{type:'repair',customer_id:1,ticket_id:100,items:[{kind:'labor',name:'Final documented repair',qty:1,unit_price:5000}],confirm:false},'repair-cost-draft-invoice');
 const movements=(await db.query(`SELECT * FROM ${t('inventory_movements')} ORDER BY id`)).rows,parts=(await db.query(`SELECT * FROM ${t('ticket_items')} ORDER BY id`)).rows;
 await db.query(`CREATE FUNCTION ${t('repair_cost_capture_failure')}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event_type='repair_cost_recognition' THEN RAISE EXCEPTION 'Injected repair cost source failure'; END IF;RETURN NEW;END$$`);await db.query(`CREATE TRIGGER repair_cost_capture_failure BEFORE INSERT ON ${t('accounting_events')} FOR EACH ROW EXECUTE FUNCTION ${t('repair_cost_capture_failure')}()`);
 try{await assert.rejects(()=>confirmPostgresInvoice(db,schema,owner,1,invoice.id,[],'repair-cost-confirm-retry'));}finally{await db.query(`DROP TRIGGER repair_cost_capture_failure ON ${t('accounting_events')}`);}
 assert.equal((await db.query(`SELECT status FROM ${t('invoices')} WHERE id=$1`,[invoice.id])).rows[0].status,'draft');assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('accounting_events')} WHERE source_type='invoice' AND source_id=$1`,[String(invoice.id)])).rows[0].n,'0');
 const confirmed=await confirmPostgresInvoice(db,schema,owner,1,invoice.id,[],'repair-cost-confirm-retry');assert.deepEqual(await confirmPostgresInvoice(db,schema,owner,1,invoice.id,[],'repair-cost-confirm-retry'),confirmed);
 const event=(await db.query(`SELECT * FROM ${t('accounting_events')} WHERE source_type='invoice' AND source_id=$1 AND event_type='repair_cost_recognition'`,[String(invoice.id)])).rows;assert.equal(event.length,1);const payload=JSON.parse(event[0].payload_json);assert.equal(payload.control_amount,108);assert.deepEqual(payload.repair_issue_cost.movements.map((row:{id:number})=>row.id),[10001,10002,10003]);assert.equal(payload.repair_issue_cost_hash,(await cost(100)).source_hash);assert.equal(payload.repair_cost_provenance,'legacy_issue_evidence_requires_review');
 assert.deepEqual((await db.query(`SELECT * FROM ${t('inventory_movements')} ORDER BY id`)).rows,movements);assert.deepEqual((await db.query(`SELECT * FROM ${t('ticket_items')} ORDER BY id`)).rows,parts);assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('accounting_journals')}`)).rows[0].n,'0');assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('accounting_event_reviews')} WHERE event_id=$1`,[event[0].id])).rows[0].n,'0');
 await assert.rejects(()=>db.transaction(()=>capturePostgresFinancialDocument(db,schema,'invoice',invoice.id,'repair_cost_recognition',1,1,109)),status(409));
 const before=(await db.query(`SELECT * FROM ${t('accounting_events')} WHERE id=$1`,[event[0].id])).rows[0];await db.transaction(()=>capturePostgresFinancialDocument(db,schema,'invoice',invoice.id,'repair_cost_recognition',1,1));assert.deepEqual((await db.query(`SELECT * FROM ${t('accounting_events')} WHERE id=$1`,[event[0].id])).rows[0],before);
});
it('rejects retired cost payload recapture without rewriting immutable source evidence',async()=>{
 const before=(await db.query(`SELECT * FROM ${t('accounting_events')} WHERE event_key='invoice:2:repair_cost_recognition'`)).rows[0];
 await assert.rejects(()=>db.transaction(()=>capturePostgresFinancialDocument(db,schema,'invoice',2,'repair_cost_recognition',1,1)),status(409));
 assert.deepEqual((await db.query(`SELECT * FROM ${t('accounting_events')} WHERE id=$1`,[before.id])).rows[0],before);
});
