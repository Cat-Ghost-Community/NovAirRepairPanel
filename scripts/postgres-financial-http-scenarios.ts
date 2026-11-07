import assert from 'node:assert/strict';
import type {PostgresDatabase} from '../src/lib/db/postgres';
import {postgresRelation} from '../src/lib/db/postgres-auth';
import {operationHash} from '../src/lib/operation-identity';

type Request=(route:string,method?:string,body?:unknown,cookie?:string,key?:string)=>Promise<Response>;
/** Real HTTP commands + independent exact persisted outcomes. No fake provider,
 * policy approval, historical fixture or SQLite service participates. */
export async function postgresFinancialHttpScenarios(db:PostgresDatabase,schema:string,request:Request,owner:string,reviewer:string,foreignStaff:string,customer:number,check:(message:string)=>void){
 const t=(name:string)=>postgresRelation(schema,name),day=new Date().toISOString().slice(0,10);
 const command=async(route:string,body:unknown,key:string)=>{const response=await request(route,'POST',body,owner,key);assert.ok([200,201].includes(response.status),'Financial HTTP command failed: '+route+' '+await response.clone().text());return response.json();};
 assert.equal((await request('/api/accounting')).status,401);assert.equal((await request('/api/invoices')).status,401);
 await command('/api/accounting',{action:'initialize_chart'},'http-finance-chart');await command('/api/accounting',{action:'create_period',period:{name:'Synthetic HTTP accounting year',start_date:day.slice(0,4)+'-01-01',end_date:day.slice(0,4)+'-12-31'}},'http-finance-period');
 const invoice=await command('/api/invoices',{type:'sale',customer_id:customer,confirm:true,items:[{kind:'other',name:'Synthetic service obligation',qty:1,unit_price:1000}]},'http-finance-invoice');
 const payment=await command('/api/payments',{invoice_id:invoice.id,amount:400,method:'cash',reference:'Synthetic confirmed counter receipt'},'http-finance-receipt');
 assert.equal((await request('/api/invoices/'+invoice.id,'GET',undefined,foreignStaff)).status,404);
 const review=async(type:string,id:number,amount:number,lines:unknown[])=>{
  const response=await request('/api/accounting?event_source='+type+'&event_source_id='+id,'GET',undefined,owner);assert.equal(response.status,200);const queue=await response.json();assert.equal(queue.events.length,1);const event=queue.events[0];assert.equal(JSON.parse(event.payload_json).control_amount,amount);
  return command('/api/accounting',{action:'review_event',id:event.id,posting_date:day,reason:'Explicit review of disposable HTTP source evidence',lines},'http-finance-review-'+type+'-'+id);
 };
 await review('invoice',invoice.id,1000,[{account_code:'1100',debit:1000},{account_code:'4010',credit:1000}]);await review('payment',payment.id,400,[{account_code:'1000',debit:400},{account_code:'1100',credit:400}]);
 const refund=await command('/api/payments/refund',{payment_id:payment.id,amount:100,reason:'Synthetic documented partial settlement refund'},'http-finance-refund');await review('refund',refund.id,100,[{account_code:'1100',debit:100},{account_code:'1000',credit:100}]);
 const replay=await command('/api/payments',{invoice_id:invoice.id,amount:400,method:'cash',reference:'Synthetic confirmed counter receipt'},'http-finance-receipt');assert.equal(replay.id,payment.id);
 const state=(await db.query(`SELECT original_total,credit_total,total,paid FROM ${t('effective_invoices')} WHERE id=$1`,[invoice.id])).rows[0];assert.deepEqual(state,{original_total:'1000',credit_total:'0',total:'1000',paid:'300'});
 const original=(await db.query(`SELECT amount FROM ${t('payments')} WHERE id=$1`,[payment.id])).rows[0];assert.equal(original.amount,'400');
 const lines=(await db.query(`SELECT l.account_code,SUM(l.debit-l.credit)::text balance FROM ${t('accounting_lines')} l JOIN ${t('accounting_journals')} j ON j.id=l.journal_id WHERE j.state IN ('posted','reversed') GROUP BY l.account_code ORDER BY l.account_code`)).rows;
 assert.deepEqual(lines,[{account_code:'1000',balance:'300'},{account_code:'1100',balance:'700'},{account_code:'4010',balance:'-1000'}]);
 const report=await(await request('/api/accounting','GET',undefined,owner)).json();assert.equal(report.trial.balanced,true);assert.equal(report.statements.revenue,1000);assert.equal(report.statements.profit,1000);assert.equal(report.statements.assets,1000);assert.equal(report.statements.balanceSheetBalanced,true);assert.match(report.statements.acceptance,/no_verified_opening/);
 const ledger=await request('/api/accounting?view=ledger&account=1100','GET',undefined,owner);assert.equal(ledger.status,200);assert.equal((await ledger.json()).rows.at(-1).balance,700);
 const detail=await(await request('/api/invoices/'+invoice.id,'GET',undefined,owner)).json();assert.equal(detail.invoice.total,1000);assert.equal(detail.invoice.paid,300);
 const filtered=await(await request('/api/invoices?status=unpaid&party_id='+customer+'&from='+day+'&to='+day,'GET',undefined,owner)).json();assert.equal(filtered.invoices.length,1);assert.equal(filtered.invoices[0].id,invoice.id);assert.equal(typeof filtered.invoices[0].first_name,'string');
 const filteredPayments=await(await request('/api/payments?q='+encodeURIComponent('Synthetic confirmed counter receipt'),'GET',undefined,owner)).json();assert.equal(filteredPayments.payments.length,1);assert.equal(filteredPayments.payments[0].id,payment.id);
 check('real PostgreSQL financial HTTP: invoice1000 receipt400 refund100; exact AR700 cash300 revenue1000 and balanced ledger');
 const expense=await command('/api/expenses',{amount:25,category:'Synthetic actual cash expense',date:day},'http-finance-expense');await review('expense',expense.id,25,[{account_code:'6000',debit:25},{account_code:'1000',credit:25}]);
 const after=await(await request('/api/accounting','GET',undefined,owner)).json();assert.equal(after.statements.profit,975);assert.equal(after.trial.balanced,true);
 assert.equal((await request('/api/accounting?branch_id=1','GET',undefined,foreignStaff)).status,403);
 assert.equal((await request('/api/accounting','POST',{action:'apply_opening',id:1,confirm:true},owner,'http-unsupported-opening')).status,503);
 check('expense source and journal atomic HTTP integration; branch denial and incomplete opening explicitly blocked');
 // Explicitly new empty account metadata, never a fabricated historical opening.
 await db.query(`INSERT INTO ${t('bank_accounts')}(id,name,current_balance) VALUES(1,'Synthetic HTTP bank',0)`);
 const bank=await command('/api/bank',{account_id:1,type:'deposit',amount:10,date:day,ref:'Synthetic owner contribution'},'http-finance-bank-deposit');await review('bank',bank.id,10,[{account_code:'1020',debit:10,bank_account_id:1},{account_code:'3000',credit:10}]);
 const chequePayment=await command('/api/payments',{invoice_id:invoice.id,amount:100,method:'check',cheque:{due_date:day}},'http-finance-cheque-receipt');
 let position=(await db.query(`SELECT paid FROM ${t('effective_invoices')} WHERE id=$1`,[invoice.id])).rows[0];assert.equal(position.paid,'300');
 const cheque=(await db.query(`SELECT id FROM ${t('checks')} WHERE payment_id=$1`,[chequePayment.id])).rows[0];await command('/api/checks',{id:Number(cheque.id),action:'pass',bank_account_id:1},'http-finance-cheque-clear');
 await review('cheque',Number(cheque.id),100,[{account_code:'1020',debit:100,bank_account_id:1},{account_code:'1100',credit:100,customer_id:customer}]);
 position=(await db.query(`SELECT paid FROM ${t('effective_invoices')} WHERE id=$1`,[invoice.id])).rows[0];assert.equal(position.paid,'400');const register=await(await request('/api/bank','GET',undefined,owner)).json();assert.equal(register.total,110);assert.equal(register.total_exact,'110');assert.equal(register.accounts[0].ledger_balance,110);assert.equal((await request('/api/bank','GET',undefined,foreignStaff)).status,403);
 check('HTTP cheque reserves but does not settle before clearance; one exact bank movement and one recognition after clearance');
 const po=await command('/api/purchase-orders',{supplier_id:1,items:[{part_id:1,name:'HTTP purchased part',qty:1,unit_cost:30}]},'http-finance-purchase-order');
 const item=(await db.query(`SELECT id FROM ${t('purchase_order_items')} WHERE po_id=$1`,[po.id])).rows[0];
 for(let index=0;index<2;index++)await command('/api/purchase-orders/'+po.id,{action:'receive',items:[{item_id:Number(item.id),qty:0.5}]},'http-finance-receive-'+index);
 const preview=await request('/api/purchase-orders/'+po.id+'/preview','GET',undefined,owner);assert.equal(preview.status,200);assert.equal((await preview.json()).source_totals.total,30);
 const supplierInvoice=await command('/api/invoices',{type:'purchase',purchase_order_id:po.id,supplier_id:1,confirm:true},'http-finance-supplier-invoice');
 const stocks=(await db.query(`SELECT id FROM ${t('inventory_movements')} ORDER BY id`)).rows;assert.equal(stocks.length,2);for(const stock of stocks)await review('stock',Number(stock.id),15,[{account_code:'1110',debit:15,part_id:1},{account_code:'2100',credit:15}]);
 await review('invoice',supplierInvoice.id,30,[{account_code:'2100',debit:30},{account_code:'2000',credit:30,supplier_id:1}]);
 const supplierPayment=await command('/api/payments',{invoice_id:supplierInvoice.id,amount:10,method:'cash'},'http-finance-supplier-payment');await review('payment',supplierPayment.id,10,[{account_code:'2000',debit:10,supplier_id:1},{account_code:'1000',credit:10}]);
 const final=await(await request('/api/accounting','GET',undefined,owner)).json();assert.equal(final.trial.balanced,true);assert.equal(final.statements.assets,1005);assert.equal(final.statements.liabilities,20);assert.equal(final.statements.profit,975);assert.equal(final.statements.balanceSheetBalanced,true);assert.equal((await db.query(`SELECT qty::text FROM ${t('inventory_stock')} WHERE part_id=1`)).rows[0].qty,'1');
 check('HTTP partial goods receipts, supplier invoice and partial settlement reconcile inventory30/AP20 and mixed ledger assets1005');
 const invoiceCount=(await db.query(`SELECT COUNT(*) n FROM ${t('invoices')}`)).rows[0].n;
 const duplicate=await request('/api/invoices','POST',{type:'sale',customer_id:customer,confirm:true,items:[{kind:'other',name:'Synthetic service obligation',qty:1,unit_price:1000}]},owner,'http-finance-invoice');assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).duplicate,true);assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('invoices')}`)).rows[0].n,invoiceCount);
 const proposal=await command('/api/installments',{action:'propose',invoice_id:invoice.id,reason:'Explicit synthetic installment agreement',evidence_reference:'Disposable signed agreement 001',lines:[{amount:200,due_date:'2090-01-31'},{amount:200,due_date:'2090-02-28'},{amount:200,due_date:'2090-03-31'}]},'http-finance-installment-propose');
 const decision={action:'decide',id:proposal.id,decision:'approve',reason:'Independent review of exact remaining obligation'};assert.equal((await request('/api/installments','POST',decision,owner,'http-finance-installment-self')).status,403);assert.equal((await request('/api/installments','POST',decision,reviewer,'http-finance-installment-approve')).status,200);
 const term=(await db.query(`SELECT id FROM ${t('installments')} WHERE schedule_id=$1 ORDER BY seq LIMIT 1`,[proposal.id])).rows[0];
 const payBody={action:'pay',id:Number(term.id),amount:50,method:'cash',confirmed:true,reference:'Synthetic actual installment receipt'},paymentResult=await command('/api/installments',payBody,'http-finance-installment-pay');await review('payment',paymentResult.payment_id,50,[{account_code:'1000',debit:50},{account_code:'1100',credit:50}]);
 const paymentCount=(await db.query(`SELECT COUNT(*) n FROM ${t('payments')}`)).rows[0].n;
 // Retained legacy transport evidence in this disposable fixture only. It
 // references the real receipt above; replay must never create another one.
 await db.query(`INSERT INTO ${t('operation_receipts')}(actor_id,branch_id,operation,operation_key,request_hash,result_json,scope) VALUES(1,1,'installments','legacy-http-installment-replay',$1,$2,'business')`,[operationHash(payBody),JSON.stringify({status:200,body:paymentResult})]);
 const legacy=await command('/api/installments',payBody,'legacy-http-installment-replay');assert.deepEqual(legacy,paymentResult);assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('payments')}`)).rows[0].n,paymentCount);assert.equal((await request('/api/installments','POST',{...payBody,amount:51},owner,'legacy-http-installment-replay')).status,409);
 const revised=await command('/api/installments',{action:'propose',invoice_id:invoice.id,reason:'Reviewed revised agreement for unpaid balance',evidence_reference:'Disposable revised agreement 002',lines:[{amount:550,due_date:'2090-05-31'}]},'http-finance-installment-revise');assert.equal((await request('/api/installments','POST',{...decision,id:revised.id},reviewer,'http-finance-installment-reapprove')).status,200);
 assert.equal((await db.query(`SELECT status FROM ${t('installment_schedules')} WHERE id=$1`,[proposal.id])).rows[0].status,'superseded');assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('installment_allocations')} WHERE payment_id=$1`,[paymentResult.payment_id])).rows[0].n,'1');assert.equal((await db.query(`SELECT paid FROM ${t('effective_invoices')} WHERE id=$1`,[invoice.id])).rows[0].paid,'450');
 check('HTTP independently approved installment versions preserve payment history and replay legacy evidence without a second receipt');
 const installmentHistory=await(await request('/api/installments?view=history&invoice_id='+invoice.id,'GET',undefined,owner)).json();assert.equal(installmentHistory.allocations.length,1);assert.equal(installmentHistory.position.outstanding,550);
 const creditInvoice=await command('/api/invoices',{type:'sale',customer_id:customer,confirm:true,items:[{kind:'other',name:'Synthetic credit destination',qty:1,unit_price:120}]},'http-credit-invoice');
 await review('invoice',creditInvoice.id,120,[{account_code:'1100',debit:120},{account_code:'4010',credit:120}]);
 const advance=await command('/api/payments',{customer_id:customer,amount:100,method:'cash',reference:'Synthetic verified unallocated cash'},'http-credit-source');
 await review('payment',advance.id,100,[{account_code:'1000',debit:100},{account_code:'2010',credit:100}]);
 const creditProposal={action:'propose',payment_id:advance.id,invoice_id:creditInvoice.id,amount:60,posting_date:day,reason:'Reviewed partial allocation of verified credit',evidence_reference:'Disposable allocation approval 001'};
 const credit=await command('/api/customer-credit',creditProposal,'http-credit-propose');
 assert.equal((await request('/api/customer-credit','POST',{...creditProposal,reason:{invalid:'object'}},owner,'http-credit-invalid-reason')).status,400);
 assert.equal((await request('/api/customer-credit','POST',{action:'approve',id:credit.id},owner,'http-credit-self-approve')).status,403);
 assert.equal((await request('/api/customer-credit','POST',{action:'approve',id:credit.id},reviewer,'http-credit-approve')).status,200);
 const posted=await command('/api/customer-credit',{action:'post',id:credit.id},'http-credit-post');assert.equal(posted.state,'posted');
 assert.deepEqual(await command('/api/customer-credit',{action:'post',id:credit.id},'http-credit-post'),posted);
 assert.equal((await request('/api/customer-credit','POST',{...creditProposal,amount:61},owner,'http-credit-propose')).status,409);
 assert.equal((await request('/api/customer-credit?branch_id=1&customer_id='+customer,'GET',undefined,foreignStaff)).status,403);
 const sources=await(await request('/api/customer-credit?branch_id=1&customer_id='+customer,'GET',undefined,owner)).json();
 assert.equal(sources.sources.find((row:{id:number})=>row.id===advance.id).available,40);
 const operations=await(await request('/api/customer-credit?branch_id=1&customer_id='+customer+'&view=operations','GET',undefined,owner)).json();assert.equal(operations.operations[0].id,credit.id);assert.equal(operations.operations[0].state,'posted');
 const receiptsBeforeRefund=(await db.query(`SELECT COUNT(*) n FROM ${t('payments')}`)).rows[0].n;
 await command('/api/customer-credit',{action:'refund',payment_id:advance.id,amount:40,reason:'Return of remaining verified customer credit',document_reference:'Disposable cash refund voucher 002',confirmed:true},'http-credit-refund');
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('payments')}`)).rows[0].n,receiptsBeforeRefund);
 assert.equal((await db.query(`SELECT paid FROM ${t('effective_invoices')} WHERE id=$1`,[creditInvoice.id])).rows[0].paid,'60');
 const creditTotals=(await db.query(`SELECT l.account_code,SUM(l.debit-l.credit)::text balance FROM ${t('accounting_lines')} l JOIN ${t('accounting_journals')} j ON j.id=l.journal_id WHERE j.state IN ('posted','reversed') AND l.customer_id=$1 AND l.account_code IN ('1100','2010') GROUP BY l.account_code ORDER BY l.account_code`,[customer])).rows;
 assert.deepEqual(creditTotals,[{account_code:'1100',balance:'610'},{account_code:'2010',balance:'0'}]);
 const creditReport=await(await request('/api/accounting','GET',undefined,owner)).json();assert.equal(creditReport.trial.balanced,true);assert.equal(creditReport.statements.assets,1125);assert.equal(creditReport.statements.liabilities,20);assert.equal(creditReport.statements.profit,1095);
 check('HTTP verified credit100 allocated60 and refunded40 with independent approval, exact AR610/advances0, replay and no artificial receipt');
}
