import {before,after,it} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createPostgresDatabase,type PostgresDatabase} from '../../src/lib/db/postgres';
import {applyPostgresMigrations,verifyPostgresMigrations} from '../../src/lib/db/pg-migrations';
import {postgresSessionDigest} from '../../src/lib/db/pg-app-auth';
import {PostgresDevicesRepository,PostgresSuppliersRepository,mutatePostgresCustomer,DuplicatePostgresDevice} from '../../src/lib/db/pg-operational-profiles';
import {PostgresCustomersRepository} from '../../src/lib/db/pg-customers';
import {postgresCreatePurchaseOrder} from '../../src/lib/db/pg-purchasing';
import type {QueryResultRow} from 'pg';
import {listPostgresBranches,mutatePostgresBranch} from '../../src/lib/db/pg-branches';
import {createPostgresInvoice,postgresInvoicePosition} from '../../src/lib/db/pg-customer-finance';

const url=process.env.REPAID_PG_TEST_URL??'',name=process.env.REPAID_PG_TEST_DATABASE??'';
if(!/^repaid_test_[a-f0-9]{24}$/.test(name)||new URL(url).pathname!=='/'+name)throw Error('Disposable PostgreSQL operations fixture required');
const db=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true}),other=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true}),schema='repaid_integration_'+randomBytes(12).toString('hex'),t=(name:string)=>'"'+schema+'"."'+name+'"';
const owner=randomBytes(24).toString('hex'),one=randomBytes(24).toString('hex'),two=randomBytes(24).toString('hex'),tech=randomBytes(24).toString('hex');
const devices=new PostgresDevicesRepository(db,schema),suppliers=new PostgresSuppliersRepository(db,schema),status=(n:number)=>(error:unknown)=>(error as {status?:number}).status===n;
before(async()=>{
 await applyPostgresMigrations(db,schema,{targetVersion:1});
 await db.query(`INSERT INTO ${t('branches')}(id,name,code) VALUES(1,'شعبه یک','ONE'),(2,'شعبه دو','TWO')`);
 await db.query(`INSERT INTO ${t('users')}(id,name,email,password_hash,role,branch_id) VALUES(1,'Owner','owner@ops.invalid','not-used','owner',1),(2,'One','one@ops.invalid','not-used','reception',1),(3,'Two','two@ops.invalid','not-used','reception',2),(4,'Tech','tech@ops.invalid','not-used','technician',1),(5,'Peer tech','peer@ops.invalid','not-used','technician',1)`);
 await db.query(`INSERT INTO ${t('branch_repair_workflows')}(branch_id,mode,revision,updated_by) VALUES(1,'legacy',1,1)`);await db.query(`INSERT INTO ${t('repair_workflow_supervisors')}(branch_id,user_id,granted_by) VALUES(1,5,1)`);
 await db.query(`INSERT INTO ${t('customers')}(id,code,first_name,branch_id,created_by) VALUES(500,'LEGACY500','مشتری قدیمی',1,1),(501,'LEGACY501','مشتری شعبه دوم',2,1),(502,'LEGACY502','مشتری قدیمی بدون مالکیت صریح',NULL,1),(503,'LEGACY503','نمایه مشترک قدیمی',NULL,1)`);
 await db.query(`INSERT INTO ${t('devices')}(id,customer_id,type,brand,serial,branch_id) VALUES(500,500,'mobile','برند قدیمی','ORIGINAL500',1)`);
 await db.query(`INSERT INTO ${t('devices')}(id,customer_id,type,brand,branch_id) VALUES(502,502,'mobile','بدون شعبه صریح',NULL),(503,503,'mobile','نمایه مشترک',NULL)`);
 await db.query(`INSERT INTO ${t('repair_statuses')}(id,name,color) VALUES(1,'در انتظار','amber')`);
 await db.query(`INSERT INTO ${t('repair_tickets')}(id,number,branch_id,customer_id,device_id,status_id,technician_id) VALUES(500,'LEGACY-R500',1,500,500,1,4),(501,'LEGACY-R501',1,500,500,1,5)`);
 await db.query(`INSERT INTO ${t('repair_tickets')}(id,number,branch_id,customer_id,device_id,status_id) VALUES(502,'LEGACY-R502',1,502,502,1),(503,'LEGACY-R503',1,503,503,1),(504,'LEGACY-R504',2,503,503,1)`);
 await db.query(`INSERT INTO ${t('parts')}(id,name,quantity_precision) VALUES(1,'قطعه تست',6)`);
 await db.query(`INSERT INTO ${t('inventory_locations')}(id,name,branch_id,is_default) VALUES(1,'انبار یک',1,1)`);
 const original=(await db.query(`SELECT * FROM ${t('devices')} ORDER BY id`)).rows;
 await applyPostgresMigrations(db,schema,{targetVersion:4});
 let injected=false;
 const failing:PostgresDatabase={...db,query:async<Row extends QueryResultRow=QueryResultRow>(sql:string,values:unknown[]=[])=>{if(!injected&&sql.startsWith('CREATE TRIGGER pg_operational_profile_guard')){injected=true;return db.query<Row>('SELECT 1/0');}return db.query<Row>(sql,values);}};
 await assert.rejects(()=>applyPostgresMigrations(failing,schema));assert.equal(injected,true);assert.equal((await db.query(`SELECT MAX(version) v FROM ${t('_repaid_migrations')}`)).rows[0].v,4);
 await applyPostgresMigrations(db,schema);assert.equal((await verifyPostgresMigrations(db,schema)).verified,true);assert.deepEqual((await db.query(`SELECT * FROM ${t('devices')} ORDER BY id`)).rows,original);
 for(const [token,id]of [[owner,1],[one,2],[two,3],[tech,4]] as const)await db.query(`INSERT INTO ${t('sessions')}(token,user_id,expires_at) VALUES($1,$2,$3)`,[postgresSessionDigest(token),id,new Date(Date.now()+3600000).toISOString()]);
});
after(async()=>{try{await db.query('DROP SCHEMA "'+schema+'" CASCADE');}finally{await other.close();await db.close();}});

it('creates a real scoped device with audit and customer event, never a financial journal',async()=>{
 const body={customer_id:500,type:'mobile',brand:'Persian brand',model:'تست',serial:'OPS-SAFE-001'},saved=await devices.create(one,1,body,'device-real-create');
 assert.equal((await devices.detail(one,1,saved.id)).device.customer_id,500);
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('audit_logs')} WHERE entity='device' AND entity_id=$1`,[saved.id])).rows[0].n,'1');
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('customer_events')} WHERE customer_id=500 AND type='device'`)).rows[0].n,'1');
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('accounting_journals')}`)).rows[0].n,'0');
 await assert.rejects(()=>devices.create(one,1,{...body,customer_id:501},'device-forbidden-customer'),status(404));
 await assert.rejects(()=>devices.detail(two,2,saved.id),status(404));await assert.rejects(()=>devices.list(one,2),status(403));
 assert.equal((await devices.detail(owner,null,saved.id)).device.id,saved.id);
});
it('serializes independent-pool replay and binds changed payload without duplicate devices or evidence',async()=>{
 const body={customer_id:500,type:'laptop',serial:'OPS-CONCURRENT'},peer=new PostgresDevicesRepository(other,schema);
 const rows=await Promise.all([devices.create(one,1,body,'device-concurrent'),peer.create(one,1,body,'device-concurrent')]);assert.deepEqual(rows[0],rows[1]);
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('devices')} WHERE serial='OPS-CONCURRENT'`)).rows[0].n,'1');
 await assert.rejects(()=>peer.create(one,1,{...body,serial:'OTHER'},'device-concurrent'),status(409));
 await assert.rejects(()=>devices.create(one,1,body,'device-same-serial-new-key'),error=>error instanceof DuplicatePostgresDevice&&error.duplicates.length===1);
});
it('rolls device, customer event and operation back on an actual audit failure and safely retries',async()=>{
 await db.query(`CREATE FUNCTION "${schema}".ops_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.entity='device' THEN RAISE EXCEPTION 'injected device audit failure' USING ERRCODE='23514'; END IF; RETURN NEW; END$$`);
 await db.query(`CREATE TRIGGER ops_fail_audit BEFORE INSERT ON ${t('audit_logs')} FOR EACH ROW EXECUTE FUNCTION "${schema}".ops_fail_audit()`);
 const body={customer_id:500,type:'tablet',serial:'OPS-ROLLBACK'},before=(await db.query(`SELECT COUNT(*) n FROM ${t('customer_events')}`)).rows[0].n;
 try{await assert.rejects(()=>devices.create(one,1,body,'device-audit-failure'));assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('devices')} WHERE serial='OPS-ROLLBACK'`)).rows[0].n,'0');assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('customer_events')}`)).rows[0].n,before);assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('operation_receipts')} WHERE operation_key='device-audit-failure'`)).rows[0].n,'0');}
 finally{await db.query(`DROP TRIGGER ops_fail_audit ON ${t('audit_logs')}`);await db.query(`DROP FUNCTION "${schema}".ops_fail_audit()`);}
 const result=await devices.create(one,1,body,'device-audit-failure');assert.equal((await devices.detail(one,1,result.id)).device.serial,'OPS-ROLLBACK');
});
it('preserves legacy repair history and applies the existing assignment restriction to device and warranty reads',async()=>{
 let history=await devices.detail(tech,1,500);assert.equal(history.repairs.length,2);
 await db.query(`INSERT INTO ${t('settings')}(key,value) VALUES('flag:repairs.only_assigned','1')`);
 history=await devices.detail(tech,1,500);assert.equal(history.repairs.length,1);assert.equal(history.repairs[0].number,'LEGACY-R500');
 assert.equal((await devices.detail(owner,null,500)).repairs.length,2);
 await assert.rejects(()=>db.query(`UPDATE ${t('devices')} SET customer_id=501 WHERE id=500`));await assert.rejects(()=>db.query(`UPDATE ${t('devices')} SET branch_id=2 WHERE id=500`));await assert.rejects(()=>db.query(`DELETE FROM ${t('devices')} WHERE id=500`));
});
it('pages a larger collection through the real service without missing or duplicating records',async()=>{
 await db.transaction(async()=>{for(let i=0;i<125;i++)await devices.create(one,1,{customer_id:500,type:'other',model:'PagingOnly',serial:'PAGING-'+i},'device-paging-'+i);});
 const seen=new Set<number>();for(let page=1;page<=3;page++){const data=await devices.list(one,1,{q:'PagingOnly',page,perPage:50});assert.equal(data.total,125);assert.equal(data.devices.length,page===3?25:50);for(const row of data.devices){assert.equal(seen.has(Number(row.id)),false);seen.add(Number(row.id));}}
 assert.equal(seen.size,125);await assert.rejects(()=>devices.list(one,1,{perPage:201}),status(400));
});
it('updates and archives customer metadata atomically without moving financial identity or losing history',async()=>{
 const customer=await new PostgresCustomersRepository(db,schema).create(one,1,{first_name:'Editable original'},'ops-edit-customer');
 const result=await mutatePostgresCustomer(db,schema,one,1,customer.id,{action:'update',first_name:'نام تازه',mobile:'۰۹۱۲۰۰۸۸۰۰۱'},'ops-profile-update');
 assert.equal((await new PostgresCustomersRepository(db,schema).get(one,1,customer.id)).mobile,'09120088001');
 const audit=(await db.query(`SELECT "before","after" FROM ${t('audit_logs')} WHERE entity='customer' AND entity_id=$1 AND action='update'`,[customer.id])).rows[0];assert.equal(JSON.parse(audit.before).first_name,'Editable original');assert.equal(JSON.parse(audit.after).first_name,'نام تازه');
 await assert.rejects(()=>mutatePostgresCustomer(db,schema,one,1,customer.id,{action:'update',credit_limit:0},'ops-profile-no-fake-credit-update'),status(409));
 await assert.rejects(()=>mutatePostgresCustomer(db,schema,one,1,customer.id,{action:'update',first_name:'Stale',expected_updated_at:null},'ops-profile-stale'),status(409));
 await assert.rejects(()=>mutatePostgresCustomer(db,schema,two,2,customer.id,{action:'archive'},'ops-profile-foreign'),status(404));
 await assert.rejects(()=>mutatePostgresCustomer(db,schema,one,1,customer.id,{action:'update',branch_id:2},'ops-profile-move'),status(409));
 const archived=await mutatePostgresCustomer(db,schema,one,1,customer.id,{action:'archive',expected_updated_at:result.updated_at},'ops-profile-archive');assert.deepEqual(archived,await mutatePostgresCustomer(other,schema,one,1,customer.id,{action:'archive',expected_updated_at:result.updated_at},'ops-profile-archive'));
 assert.equal((await db.query(`SELECT is_archived FROM ${t('customers')} WHERE id=$1`,[customer.id])).rows[0].is_archived,'1');assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('customer_events')} WHERE customer_id=$1`,[customer.id])).rows[0].n,'3');await assert.rejects(()=>db.query(`DELETE FROM ${t('customers')} WHERE id=$1`,[customer.id]));
});
it('creates a central supplier directory record and uses it in the authoritative scoped purchasing service',async()=>{
 const saved=await suppliers.create(owner,1,{name:'تأمین‌کننده واقعی تست',credit_limit:'9007199254740991'},'ops-supplier-create');
 assert.deepEqual(await suppliers.create(owner,1,{name:'تأمین‌کننده واقعی تست',credit_limit:'9007199254740991'},'ops-supplier-create'),saved);
 const directory=await suppliers.list(owner,null,{q:'تأمین‌کننده'});assert.equal(directory.suppliers.length,1);assert.equal(directory.suppliers[0].credit_limit,Number.MAX_SAFE_INTEGER);
 await assert.rejects(()=>suppliers.create(tech,1,{name:'Forbidden supplier'},'ops-supplier-forbidden'),status(403));
 const po=await postgresCreatePurchaseOrder(db,schema,owner,1,'ops-supplier-po',{supplier_id:saved.id,items:[{part_id:1,name:'Actual linked part',qty:2,unit_cost:101}]});
 assert.equal((await db.query(`SELECT supplier_id,total FROM ${t('purchase_orders')} WHERE id=$1`,[po.id])).rows[0].supplier_id,String(saved.id));assert.equal((await db.query(`SELECT total FROM ${t('purchase_orders')} WHERE id=$1`,[po.id])).rows[0].total,'202');
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('accounting_journals')}`)).rows[0].n,'0');
});
it('keeps branch management company-only while the manager sees all branches and staff see current employment only',async()=>{
 assert.equal((await listPostgresBranches(db,schema,owner,null)).branches.length,2);
 assert.deepEqual((await listPostgresBranches(db,schema,one,1)).branches.map(branch=>branch.id),[1]);
 await assert.rejects(()=>listPostgresBranches(db,schema,one,2),status(403));
 await db.query(`INSERT INTO ${t('user_permissions')}(user_id,perm,effect) VALUES(2,'settings.edit','allow')`);
 await assert.rejects(()=>mutatePostgresBranch(db,schema,one,1,'POST',{name:'Not company administrator',code:'DENIED'},'ops-branch-denied'),status(403));
 const body={name:'شعبه سوم',code:'THREE'};
 const results=await Promise.all([mutatePostgresBranch(db,schema,owner,1,'POST',body,'ops-branch-create'),mutatePostgresBranch(other,schema,owner,1,'POST',body,'ops-branch-create')]);assert.deepEqual(results[0],results[1]);
 assert.equal((await listPostgresBranches(db,schema,owner,null)).branches.length,3);
 await mutatePostgresBranch(db,schema,owner,null,'PATCH',{id:2,name:'نام به‌روز شعبه دوم'},'ops-branch-edit');
 assert.equal((await listPostgresBranches(db,schema,two,2)).branches[0].name,'نام به‌روز شعبه دوم');
 await assert.rejects(()=>db.query(`UPDATE ${t('branches')} SET id=99 WHERE id=2`));
});
it('rolls branch metadata and durable result back when audit persistence fails',async()=>{
 await db.query(`CREATE FUNCTION "${schema}".ops_branch_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.entity='branch' THEN RAISE EXCEPTION 'injected branch audit failure' USING ERRCODE='23514'; END IF; RETURN NEW; END$$`);await db.query(`CREATE TRIGGER ops_branch_audit_failure BEFORE INSERT ON ${t('audit_logs')} FOR EACH ROW EXECUTE FUNCTION "${schema}".ops_branch_audit_failure()`);
 try{await assert.rejects(()=>mutatePostgresBranch(db,schema,owner,1,'PATCH',{id:1,name:'Must roll back'},'ops-branch-rollback'));assert.equal((await listPostgresBranches(db,schema,one,1)).branches[0].name,'شعبه یک');assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('operation_receipts')} WHERE operation_key='ops-branch-rollback'`)).rows[0].n,'0');}
 finally{await db.query(`DROP TRIGGER ops_branch_audit_failure ON ${t('audit_logs')}`);await db.query(`DROP FUNCTION "${schema}".ops_branch_audit_failure()`);}
});
it('edits proven legacy NULL ownership without assigning it to a branch and protects shared profiles',async()=>{
 await mutatePostgresCustomer(db,schema,one,1,502,{action:'update',notes:'Local documented profile correction'},'ops-legacy-local-update');
 assert.equal((await db.query(`SELECT branch_id FROM ${t('customers')} WHERE id=502`)).rows[0].branch_id,null);
 await assert.rejects(()=>mutatePostgresCustomer(db,schema,one,1,503,{action:'blacklist'},'ops-legacy-shared-denied'),status(403));
 await assert.rejects(()=>mutatePostgresCustomer(db,schema,owner,null,503,{action:'blacklist'},'ops-legacy-context-required'),status(409));
 await mutatePostgresCustomer(db,schema,owner,1,503,{action:'blacklist'},'ops-legacy-shared-reviewed');assert.equal((await db.query(`SELECT branch_id FROM ${t('customers')} WHERE id=503`)).rows[0].branch_id,null);
});
it('prevents final-to-draft reopening, false paid caches and original draft source identity rewriting',async()=>{
 const invoice=await createPostgresInvoice(db,schema,owner,1,{type:'sale',customer_id:500,confirm:true,items:[{kind:'other',name:'Immutable source obligation',qty:1,unit_price:37}]},'ops-immutable-invoice');
 for(const sql of ["status='draft'","status='paid',paid=37","status='not-a-valid-state'"])await assert.rejects(()=>db.query(`UPDATE ${t('invoices')} SET ${sql} WHERE id=$1`,[invoice.id]));
 await assert.rejects(()=>db.query(`DELETE FROM ${t('invoice_items')} WHERE invoice_id=$1`,[invoice.id]));
 assert.equal((await postgresInvoicePosition(db,schema,invoice.id)).outstanding,37);
 const draft=await createPostgresInvoice(db,schema,owner,1,{type:'sale',customer_id:500,items:[{kind:'other',name:'Draft original identity',qty:1,unit_price:40}]},'ops-original-draft');
 await assert.rejects(()=>db.query(`UPDATE ${t('invoices')} SET number='TAMPERED' WHERE id=$1`,[draft.id]));
 await assert.rejects(()=>db.query(`UPDATE ${t('invoices')} SET customer_id=502 WHERE id=$1`,[draft.id]));
 assert.equal((await postgresInvoicePosition(db,schema,draft.id)).customer_id,500);
});
it('revokes supervisor grants on employment changes and never resurrects them on a later return',async()=>{
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('repair_workflow_supervisors')} WHERE user_id=5`)).rows[0].n,'1');
 await db.query(`UPDATE ${t('users')} SET branch_id=2 WHERE id=5`);await db.query(`UPDATE ${t('users')} SET branch_id=1 WHERE id=5`);
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('repair_workflow_supervisors')} WHERE user_id=5`)).rows[0].n,'0');
 const audit=(await db.query(`SELECT user_id,branch_id FROM ${t('audit_logs')} WHERE action='employment_revocation' AND entity_id=5`)).rows;assert.deepEqual(audit,[{user_id:null,branch_id:'1'}]);
 await assert.rejects(()=>db.query(`INSERT INTO ${t('repair_workflow_supervisors')}(branch_id,user_id,granted_by) VALUES(1,5,1)`));
});
it('keeps archived identifier warnings and rejects forged device branch attribution',async()=>{
 const body={customer_id:500,type:'mobile',serial:'ARCHIVED-PHYSICAL-IDENTITY'},saved=await devices.create(one,1,body,'ops-original-archived-device');
 await db.query(`UPDATE ${t('devices')} SET is_archived=1 WHERE id=$1`,[saved.id]);
 await assert.rejects(()=>devices.create(one,1,body,'ops-archived-warning'),error=>error instanceof DuplicatePostgresDevice&&error.duplicates[0].id===saved.id);
 await assert.rejects(()=>devices.create(one,1,{...body,serial:'FORGED-BRANCH',branch_id:2},'ops-device-forged-branch'),status(403));
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('devices')} WHERE serial='FORGED-BRANCH'`)).rows[0].n,'0');
});
