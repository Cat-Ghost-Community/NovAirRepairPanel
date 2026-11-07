import fs from 'node:fs';
import path from 'node:path';
import type { Session } from '../src/lib/auth';
const filename=path.resolve(process.env.E2E_DB??'');
if(process.env.FINANCIAL_BROWSER_MUTATIONS!=='1'||!filename.startsWith(path.resolve('.freebuff')+path.sep))throw new Error('Explicit disposable financial browser fixture required');
process.env.REPAID_DATA_DIR=path.dirname(filename);
async function main(){
 const schema=await import('../src/lib/db/schema');if(schema.DB_PATH!==filename)throw new Error('Isolated DB mismatch');const db=schema.getDb();
 try{
  const {hashPassword}=await import('../src/lib/auth'),{initializeChart,createPeriod,createJournal,postJournal}=await import('../src/lib/accounting');
  const {proposeOpening,decideOpening,rehearseOpening,applyOpening,openingControlCodes}=await import('../src/lib/accounting-opening');
  const {proposeRecognitionPolicy,changeRecognitionPolicy}=await import('../src/lib/accounting-policy');
  const {createInvoice,addPaymentInTx}=await import('../src/lib/invoice'),{createCustomerReceipt}=await import('../src/lib/customer-payments');
  const {moveStock}=await import('../src/lib/inventory'),{reviewFinancialEvent}=await import('../src/lib/accounting-events');
  const nonce=Date.now().toString(36),date=new Date().toISOString().slice(0,10),email=`return-approver-${nonce}@fixture.local`,password='fixture-return-approval-2026';
  const owner={user:db.prepare("SELECT id,name,email,role,branch_id,avatar_color FROM users WHERE email='owner@repaid.local'").get()} as Session;
  const branch=Number(db.prepare('INSERT INTO branches(name,code) VALUES(?,?)').run('شعبهٔ مستقل مرجوعی',`RET-${nonce}`).lastInsertRowid);
  const approverId=Number(db.prepare("INSERT INTO users(name,email,password_hash,role,branch_id) VALUES(?,?,?,'owner',?)").run('تأییدکنندهٔ مستقل مرجوعی',email,hashPassword(password),branch).lastInsertRowid);
  const approver={user:db.prepare('SELECT id,name,email,role,branch_id,avatar_color FROM users WHERE id=?').get(approverId)} as Session;
  const customer=Number(db.prepare('INSERT INTO customers(first_name,last_name,branch_id) VALUES(?,?,?)').run('مشتری','آزمون مرجوعی',branch).lastInsertRowid);
  const supplier=Number(db.prepare('INSERT INTO suppliers(name) VALUES(?)').run('تأمین‌کنندهٔ مستقل مرجوعی').lastInsertRowid);
  initializeChart(db,owner);if(!db.prepare("SELECT id FROM accounting_periods WHERE status='open' AND ? BETWEEN start_date AND end_date").get(date))createPeriod(db,owner,{name:'سال آزمون مرجوعی',start_date:date.slice(0,4)+'-01-01',end_date:date.slice(0,4)+'-12-31'});
  const opening=proposeOpening(db,owner,{branch_id:branch,mode:'new_business',cutover_date:date,memo:'شروع مستقل با صفر واقعی و تأییدشده',lines:[],controls:openingControlCodes.map(account_code=>({account_code,balance:0,reference:'صورت مستقلِ صفرِ محیط آزمون'})),evidence:['صورت شروع مستقل شعبهٔ آزمون']});decideOpening(db,approver,opening.id,'approved');await rehearseOpening(db,owner,opening.id);applyOpening(db,owner,opening.id);
  for(const kind of ['cash_receivable_v1','cash_payable_v1','customer_return_credit_v1','supplier_return_credit_v1','return_restock_cost_v1','return_damage_cost_v1','supplier_return_stock_v1','return_cash_refund_v1','supplier_return_cash_v1',...(process.env.V6_RETURN_BROWSER==='1'?['return_restock_cost_v2','return_damage_cost_v2','supplier_return_stock_v2'] as const:[])] as const){const p=proposeRecognitionPolicy(db,owner,{branch_id:branch,kind,effective_date:date,reason:'تصویب مصنوعیِ مستقل، فقط برای سناریوی پذیرش در دیتابیس جدا'});changeRecognitionPolicy(db,approver,p.id,'approve');}
  const capital=createJournal(db,owner,{branch_id:branch,posting_date:date,memo:'آوردهٔ نقدیِ مستندِ سناریوی آزمون',event_key:`return-capital-${nonce}`,source_type:'manual',source_id:nonce,lines:[{account_code:'1000',debit:1000},{account_code:'3000',credit:1000}]});postJournal(db,owner,capital.id);
  for(const [key,value] of Object.entries({vat_enabled:'0',tax_rate:'0',duty_rate:'0',round_to:'0'}))db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);
  const location=Number(db.prepare('INSERT INTO inventory_locations(name,branch_id,is_default) VALUES(?,?,1)').run('انبار آزمون مرجوعی',branch).lastInsertRowid);
  const part=Number(db.prepare('INSERT INTO parts(name,sku,price,purchase_price,avg_cost) VALUES(?,?,300,100,100)').run('قطعهٔ قابل پیگیری',`RET-PART-${nonce}`).lastInsertRowid);
  moveStock({part_id:part,location_id:location,qty:6,type:'purchase',unit_cost:100,branch_id:branch,user_id:owner.user.id});
  const received=Number(db.prepare("SELECT id FROM accounting_events WHERE branch_id=? AND source_type='stock' ORDER BY id DESC LIMIT 1").get(branch)!.id);reviewFinancialEvent(db,owner,received,{posting_date:date,reason:'رسید واقعیِ کالای فاکتورنشده در سناریوی مستقل',lines:[{account_code:'1110',debit:600,part_id:part},{account_code:'2100',credit:600}]});
  const book=(id:number,purchase:boolean)=>{
   const original=db.prepare('SELECT total FROM invoices WHERE id=?').get(id)!;
   const events=db.prepare("SELECT e.id,e.source_type,e.source_id FROM accounting_events e LEFT JOIN accounting_event_reviews r ON r.event_id=e.id WHERE r.event_id IS NULL AND ((e.source_type='invoice' AND e.source_id=?) OR (e.source_type='stock' AND e.source_id IN (SELECT CAST(id AS TEXT) FROM inventory_movements WHERE ref_type='invoice' AND ref_id=?))) ORDER BY e.id").all(String(id),id);
   for(const event of events){if(event.source_type==='stock'){const m=db.prepare('SELECT unit_cost,qty FROM inventory_movements WHERE id=?').get(Number(event.source_id))!,amount=Number(m.unit_cost)*Math.abs(Number(m.qty));reviewFinancialEvent(db,owner,Number(event.id),{posting_date:date,reason:'ثبت مستند بهای موجودی/فروش سناریوی مرجوعی',lines:purchase?[{account_code:'1110',debit:amount,part_id:part},{account_code:'2100',credit:amount}]:[{account_code:'5000',debit:amount},{account_code:'1110',credit:amount,part_id:part}]});}
    else reviewFinancialEvent(db,owner,Number(event.id),{posting_date:date,reason:'شناسایی مستقلِ تعهد اصلی در سناریوی آزمون',lines:purchase?[{account_code:'2100',debit:Number(original.total)},{account_code:'2000',credit:Number(original.total),supplier_id:supplier}]:[{account_code:'1100',debit:Number(original.total),customer_id:customer},{account_code:'4000',credit:Number(original.total)}]});}
  };
  const makeSale=(qty:number,paid:boolean)=>{const inv=createInvoice(owner,{type:'sale',customer_id:customer,confirm:true,date,items:[{kind:'part',ref_id:part,qty,unit_price:300,cost:100}]},String(branch));book(inv.id,false);const payment=paid?createCustomerReceipt(db,owner,{invoice_id:inv.id,amount:qty*300,method:'cash'},branch):null;return {id:inv.id,line:Number(db.prepare('SELECT id FROM invoice_items WHERE invoice_id=?').get(inv.id)!.id),payment:payment?.id};};
  const full=makeSale(1,true),partial=makeSale(2,false),damaged=makeSale(1,false);
  const purchase=createInvoice(owner,{type:'purchase',supplier_id:supplier,confirm:true,date,items:[{kind:'part',ref_id:part,qty:3,unit_price:100,cost:100}]},String(branch));book(purchase.id,true);const supplierPayment=addPaymentInTx(db,owner,{id:purchase.id},{amount:300,method:'cash'},branch);
  const foreignBranch=Number(db.prepare('INSERT INTO branches(name,code) VALUES(?,?)').run('شعبهٔ خارج از محدودهٔ آزمون',`OTHER-${nonce}`).lastInsertRowid);
  const foreignInvoice=createInvoice(owner,{type:'sale',customer_id:customer,confirm:true,date,items:[{kind:'labor',name:'خدمت خارج از شعبهٔ انتخابی',qty:1,unit_price:777}]},String(foreignBranch));
  const foreignNumber=String(db.prepare('SELECT number FROM invoices WHERE id=?').get(foreignInvoice.id)!.number);
  fs.writeFileSync('.freebuff/returns-browser-fixture.json',JSON.stringify({filename,branch,customer,supplier,approver:approverId,email,location,part,full,partial,damaged,foreignInvoice:foreignInvoice.id,foreignNumber,purchase:{id:purchase.id,line:Number(db.prepare('SELECT id FROM invoice_items WHERE invoice_id=?').get(purchase.id)!.id),payment:supplierPayment.id},nonce},null,2));
  console.log('Isolated return source documents, actual journals and independent approvals prepared');
 }finally{db.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
