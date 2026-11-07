import {before,after,it} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createPostgresDatabase} from '../../src/lib/db/postgres';
import {applyPostgresMigrations} from '../../src/lib/db/pg-migrations';
import {postgresCreatePurchaseOrder,postgresPurchaseAction,postgresPurchasePreview,postgresPurchaseOrders} from '../../src/lib/db/pg-purchasing';
import {createPostgresInvoice,createPostgresCustomerReceipt,postgresInvoicePosition} from '../../src/lib/db/pg-customer-finance';
import {postgresInitializeChart,postgresCreatePeriod} from '../../src/lib/db/postgres-accounting';
import {reviewPostgresFinancialEvent} from '../../src/lib/db/postgres-financial-events';
import {postgresInventoryValue} from '../../src/lib/db/postgres-inventory';
import {verifyPostgresLedgerEvidence} from '../../src/lib/db/postgres-ledger-proof';
const url=process.env.REPAID_PG_TEST_URL??'',name=process.env.REPAID_PG_TEST_DATABASE??'';if(!/^repaid_test_[a-f0-9]{24}$/.test(name)||new URL(url).pathname!=='/'+name)throw Error('Disposable PostgreSQL purchasing fixture required');
const db=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true}),other=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true}),schema='repaid_integration_'+randomBytes(12).toString('hex'),t=(name:string)=>'"'+schema+'"."'+name+'"',owner=randomBytes(24).toString('hex'),staff=randomBytes(24).toString('hex'),day=new Date().toISOString().slice(0,10);
before(async()=>{
 // Preserve real metadata through the populated upgrade; no historical stock
 // movement or financial amount is invented to evade native evidence guards.
 await applyPostgresMigrations(db,schema,{targetVersion:1});await db.query(`INSERT INTO ${t('branches')}(id,name,code) VALUES(1,'Purchase one','PO1'),(2,'Purchase two','PO2')`);await db.query(`INSERT INTO ${t('users')}(id,name,email,password_hash,role,branch_id) VALUES(1,'Owner','owner@po.invalid','unused','owner',1),(2,'Scoped','staff@po.invalid','unused','reception',2)`);
 await db.query(`INSERT INTO ${t('suppliers')}(id,name) VALUES(1,'Synthetic supplier')`);await db.query(`INSERT INTO ${t('parts')}(id,name,quantity_precision,avg_cost,purchase_price) VALUES(1,'Fractional purchased part',6,0,0)`);await db.query(`INSERT INTO ${t('inventory_locations')}(id,name,branch_id,is_default) VALUES(1,'First warehouse',1,1)`);await applyPostgresMigrations(db,schema);
 for(const [token,id]of [[owner,1],[staff,2]] as const)await db.query(`INSERT INTO ${t('sessions')}(token,user_id,expires_at) VALUES($1,$2,$3)`,['sha256:'+createHash('sha256').update(token).digest('hex'),id,new Date(Date.now()+3600000).toISOString()]);await db.query(`INSERT INTO ${t('settings')}(key,value) VALUES('vat_enabled','0')`);await db.query(`INSERT INTO ${t('user_permissions')}(user_id,perm,effect) VALUES(2,'purchasing.manage','allow')`);await postgresInitializeChart(db,schema,owner);await postgresCreatePeriod(db,schema,owner,{name:'Purchasing test year',start_date:day.slice(0,4)+'-01-01',end_date:day.slice(0,4)+'-12-31'});
});
after(async()=>{try{await db.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');}finally{await other.close();await db.close();}});
it('receives fractional goods in parts, matches one supplier invoice, pays partially and independently reconciles stock, AP and journals',async()=>{
 const po=await postgresCreatePurchaseOrder(db,schema,owner,1,'po-fraction-create',{supplier_id:1,items:[{part_id:1,name:'Fractional purchased part',qty:1.5,unit_cost:101}]});
 const line=(await db.query(`SELECT id FROM ${t('purchase_order_items')} WHERE po_id=$1`,[po.id])).rows[0];
 const firstBody={action:'receive',items:[{item_id:Number(line.id),qty:0.5}]},first=await postgresPurchaseAction(db,schema,owner,1,po.id,'po-receive-half',firstBody);assert.deepEqual(await postgresPurchaseAction(other,schema,owner,1,po.id,'po-receive-half',firstBody),first);
 await postgresPurchaseAction(db,schema,owner,1,po.id,'po-receive-rest',{action:'receive',items:[{item_id:Number(line.id),qty:1}]});
 const preview=await postgresPurchasePreview(db,schema,owner,1,po.id);assert.equal(preview.source_totals!.total,152);assert.equal(preview.items[0].qty,1.5);assert.equal((await db.query(`SELECT qty::text FROM ${t('inventory_stock')} WHERE part_id=1`)).rows[0].qty,'1.5');assert.equal(await postgresInventoryValue(db,schema,1),152);
 const receiptLines=(await db.query(`SELECT qty_micro::text,movement_id FROM ${t('pg_purchase_receipt_lines')} ORDER BY receipt_id`)).rows;assert.deepEqual(receiptLines.map(row=>row.qty_micro),['500000','1000000']);assert.ok(receiptLines.every(row=>row.movement_id));
 const invoice=await createPostgresInvoice(db,schema,owner,1,{type:'purchase',purchase_order_id:po.id,supplier_id:1,confirm:true},'po-matched-invoice');assert.equal(invoice.total,152);assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('inventory_movements')}`)).rows[0].n,'2');
 const review=async(type:string,id:number,lines:unknown[])=>{const event=(await db.query(`SELECT id FROM ${t('accounting_events')} WHERE source_type=$1 AND source_id=$2 ORDER BY id DESC LIMIT 1`,[type,String(id)])).rows[0];return reviewPostgresFinancialEvent(db,schema,owner,Number(event.id),{posting_date:day,reason:'Explicit reviewed synthetic receipt and supplier matching',lines:lines as Parameters<typeof reviewPostgresFinancialEvent>[4]['lines']});};
 const movements=(await db.query(`SELECT id,qty::text FROM ${t('inventory_movements')} ORDER BY id`)).rows;
 await review('stock',Number(movements[0].id),[{account_code:'1110',debit:51,part_id:1},{account_code:'2100',credit:51}]);await review('stock',Number(movements[1].id),[{account_code:'1110',debit:101,part_id:1},{account_code:'2100',credit:101}]);
 await review('invoice',invoice.id,[{account_code:'2100',debit:152},{account_code:'2000',credit:152,supplier_id:1}]);
 const payment=await createPostgresCustomerReceipt(db,schema,owner,1,{invoice_id:invoice.id,amount:100,method:'cash'},'po-supplier-partial-payment');await review('payment',payment.id,[{account_code:'2000',debit:100,supplier_id:1},{account_code:'1000',credit:100}]);
 assert.equal((await postgresInvoicePosition(db,schema,invoice.id)).outstanding,52);
 const supplier=(await db.query(`SELECT SUM(amount)::text balance FROM ${t('party_balance_events')} WHERE kind='supplier' AND party_id=1 AND branch_id=1`)).rows[0];assert.equal(supplier.balance,'52');
 const ledger=(await db.query(`SELECT l.account_code,SUM(l.debit-l.credit)::text balance FROM ${t('accounting_lines')} l JOIN ${t('accounting_journals')} j ON j.id=l.journal_id WHERE j.state IN ('posted','reversed') GROUP BY l.account_code ORDER BY l.account_code`)).rows;
 assert.deepEqual(ledger,[{account_code:'1000',balance:'-100'},{account_code:'1110',balance:'152'},{account_code:'2000',balance:'-52'},{account_code:'2100',balance:'0'}]);assert.equal((await verifyPostgresLedgerEvidence(db,schema)).valid,true);
});
it('blocks ambiguous partial freight allocation and rolls receipt, stock, events and operation back on a real audit failure',async()=>{
 const po=await postgresCreatePurchaseOrder(db,schema,owner,1,'po-freight-create',{supplier_id:1,shipping:10,items:[{part_id:1,name:'Fractional purchased part',qty:2,unit_cost:50}]}),line=(await db.query(`SELECT id FROM ${t('purchase_order_items')} WHERE po_id=$1`,[po.id])).rows[0],body={action:'receive',items:[{item_id:Number(line.id),qty:1}]};
 await postgresPurchaseAction(db,schema,owner,1,po.id,'po-partial-freight',body);await assert.rejects(()=>postgresPurchasePreview(db,schema,owner,1,po.id),(error:unknown)=>(error as {status?:number}).status===409);
 const before=(await db.query(`SELECT qty::text FROM ${t('inventory_stock')} WHERE part_id=1`)).rows[0].qty;
 await db.query(`CREATE FUNCTION ${t('po_test_audit_failure')}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.entity='purchase_order' AND NEW.action='receive' THEN RAISE EXCEPTION 'Injected receipt audit failure'; END IF; RETURN NEW; END$$`);await db.query(`CREATE TRIGGER po_test_audit_failure BEFORE INSERT ON ${t('audit_logs')} FOR EACH ROW EXECUTE FUNCTION ${t('po_test_audit_failure')}()`);
 try{await assert.rejects(()=>postgresPurchaseAction(db,schema,owner,1,po.id,'po-receive-audit-failure',body));assert.equal((await db.query(`SELECT qty::text FROM ${t('inventory_stock')} WHERE part_id=1`)).rows[0].qty,before);assert.equal((await db.query(`SELECT received_qty::text FROM ${t('purchase_order_items')} WHERE id=$1`,[line.id])).rows[0].received_qty,'1');assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('operation_receipts')} WHERE operation_key='po-receive-audit-failure'`)).rows[0].n,'0');}finally{await db.query(`DROP TRIGGER po_test_audit_failure ON ${t('audit_logs')}`);await db.query(`DROP FUNCTION ${t('po_test_audit_failure')}()`);}
 await postgresPurchaseAction(db,schema,owner,1,po.id,'po-receive-audit-failure',body);assert.equal((await postgresPurchasePreview(db,schema,owner,1,po.id)).source_totals!.total,110);await assert.rejects(()=>postgresPurchaseAction(db,schema,staff,2,po.id,'po-forbidden-branch',{action:'cancel'}),(error:unknown)=>(error as {status?:number}).status===404);assert.equal((await postgresPurchaseOrders(db,schema,owner,null)).purchase_orders.length,2);
});
