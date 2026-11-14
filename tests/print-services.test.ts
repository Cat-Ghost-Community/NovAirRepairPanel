import {before,after,it} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {chargeKindLabel,isRepairService} from '../src/lib/charge-category';
import {parsePrintSettings,printSettingError,documentPrintCss,printPaper} from '../src/lib/print-settings';
import {fmtMoneyNumber,currencyUnitLabel} from '../src/lib/format';

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'print-services-'));
process.env.REPAID_DATA_DIR=directory;process.env.REPAID_DEMO_MODE='0';
let db:ReturnType<typeof import('../src/lib/db/schema').getDb>;
const tokens:Record<number,string>={};
function request(user:number,url:string,body?:unknown){return new NextRequest('http://app.test'+url,{method:body===undefined?'GET':'POST',headers:{cookie:'repaid_session='+tokens[user]+'; repaid_branch=all',origin:'http://app.test','Content-Type':'application/json','Idempotency-Key':randomUUID()},...(body===undefined?{}:{body:JSON.stringify(body)})});}
before(async()=>{
 const {getDb}=await import('../src/lib/db/schema'),{createSession}=await import('../src/lib/auth');db=getDb();
 db.exec(`INSERT INTO branches(id,name,code) VALUES(1,'One','ONE'),(2,'Two','TWO');
 INSERT INTO users(id,name,email,password_hash,role,branch_id) VALUES(1,'Owner','owner@print.test','unused','owner',1),(2,'Tech','tech@print.test','unused','technician',1),(3,'Other','other@print.test','unused','manager',2);
 INSERT INTO customers(id,last_name,salutation,branch_id) VALUES(1,'رضایی','ms',1);
 INSERT INTO devices(id,customer_id,branch_id,type,model) VALUES(1,1,1,'mobile','Model');
 INSERT INTO repair_statuses(id,name,color,allowed_next,customer_visible) VALUES(1,'Ready','#00aa00','["Delivered"]',1),(2,'Delivered','#0000aa','[]',1);
 INSERT INTO repair_tickets(id,number,branch_id,customer_id,device_id,status_id,technician_id) VALUES(1,'RP-001',1,1,1,1,2);
 INSERT INTO services(id,name,price,cost,warranty_days) VALUES(1,'Catalog service',1000,200,90);
 INSERT INTO repair_tariffs(id,device_type,title,labor_price,warranty_days) VALUES(1,'mobile','Reference tariff',3000,45);`);
 for(const id of [1,2,3])tokens[id]=createSession(id);
});
after(()=>{db?.close();fs.rmSync(directory,{recursive:true,force:true});});

it('groups historical service, labor and fee kinds without changing identifiers or arithmetic',async()=>{
 const {sanitizeLines}=await import('../src/lib/invoice'),{totals}=await import('../src/lib/finance');
 const raw=[{kind:'service',ref_id:1,qty:1},{kind:'labor',name:'Manual',qty:2,unit_price:2000},{kind:'fee',name:'Diagnostic',qty:1,unit_price:500}];
 const lines=sanitizeLines(db,raw,'repair',{allowPriceOverride:false});
 assert.deepEqual(lines.map(row=>row.kind),['service','labor','fee']);
 assert.equal(totals(lines.map(row=>({...row,kind:row.kind as 'service'|'labor'|'fee'}))).total,5500);
 assert(lines.every(row=>chargeKindLabel(row.kind)==='خدمات تعمیر'));assert(!isRepairService('part'));
 assert.equal(chargeKindLabel('fee','purchase'),'هزینه جانبی');assert.equal(chargeKindLabel('service','sale'),'خدمات');
 assert.equal(fmtMoneyNumber(11,'toman'),'۱.۱');assert.equal(fmtMoneyNumber(BigInt(100001),'rial'),'۱۰۰,۰۰۱');assert.equal(currencyUnitLabel('rial'),'ریال');
 assert.throws(()=>sanitizeLines(db,[{kind:'service',ref_id:1,qty:1,unit_price:1}],'repair',{allowPriceOverride:false}),{status:403});
});
it('reports all customer service sources together without counting procurement fees as revenue',async()=>{
 db.exec(`INSERT INTO suppliers(id,name) VALUES(1,'Supplier');
 INSERT INTO invoices(id,number,customer_id,branch_id,type,status,subtotal,total) VALUES(1,'INV-SERVICE',1,1,'repair','issued',5500,5500);
 INSERT INTO invoices(id,number,customer_id,supplier_id,branch_id,type,status,subtotal,total) VALUES(2,'INV-PURCHASE',0,1,1,'purchase','issued',999,999);
 INSERT INTO invoice_items(invoice_id,kind,name,qty,unit_price,total) VALUES(1,'service','Catalog',1,1000,1000),(1,'labor','Work',1,4000,4000),(1,'fee','Diagnostic',1,500,500),(2,'fee','Procurement',1,999,999);`);
 const {GET}=await import('../src/app/api/reports/iran/route');
 const response=await GET(request(1,'/api/reports/iran?type=pl&days=30'));assert.equal(response.status,200,await response.clone().text());
 const result=await response.json();assert.equal(result.services.revenue,5500);assert.deepEqual(result.services,result.labor);
});
it('resolves tariff prices and warranty on the server, rejects unauthorized overrides and inactive sources',async()=>{
 const {POST}=await import('../src/app/api/repairs/[id]/items/route'),context={params:Promise.resolve({id:'1'})};
 const response=await POST(request(2,'/api/repairs/1/items',{kind:'labor',tariff_id:1,name:'Untrusted label',warranty_days:999}),context);
 assert.equal(response.status,200,await response.clone().text());
 const item=db.prepare('SELECT name,unit_price,warranty_days,kind,ref_id FROM ticket_items WHERE ticket_id=1').get()!;
 assert.equal(item.name,'Reference tariff');assert.equal(item.unit_price,3000);assert.equal(item.warranty_days,45);assert.equal(item.kind,'labor');
 assert.equal(item.ref_id,1);
 const count=db.prepare('SELECT COUNT(*) n FROM ticket_items').get()!.n;
 assert.equal((await POST(request(2,'/api/repairs/1/items',{kind:'labor',tariff_id:1,unit_price:1}),context)).status,403);
 db.exec('UPDATE repair_tariffs SET is_active=0 WHERE id=1');
 assert.equal((await POST(request(2,'/api/repairs/1/items',{kind:'labor',tariff_id:1}),context)).status,404);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM ticket_items').get()!.n,count);
});
it('accrues one commission across all repair service sources, excluding parts and preserving existing awards',async()=>{
 const {computeTechnicianCommission}=await import('../src/lib/payroll');
 db.exec(`INSERT INTO payroll_profiles(user_id,salary_type,percent_repair,percent_parts,percent_only_labor,is_active) VALUES(2,'percent',10,20,1,1);
 INSERT INTO repair_tickets(id,number,branch_id,customer_id,device_id,status_id,technician_id,delivered_at) VALUES(2,'RP-002',1,1,1,2,2,'2026-11-14');
 INSERT INTO ticket_items(ticket_id,kind,name,qty,unit_price,consumed) VALUES(2,'labor','Manual',2,1000,1),(2,'service','Catalog',1,1000,1),(2,'fee','Diagnostic',1,500,1),(2,'part','Part',1,5000,1),(2,'service','Not performed',1,9000,0);`);
 computeTechnicianCommission(2,1);
 const run=db.prepare('SELECT id,earned_commission FROM payroll_runs WHERE source_ticket_id=2').get()!;assert.equal(run.earned_commission,350);
 db.exec('UPDATE payroll_profiles SET percent_repair=20 WHERE user_id=2');computeTechnicianCommission(2,1);
 assert.equal(db.prepare('SELECT earned_commission FROM payroll_runs WHERE id=?').get(run.id)!.earned_commission,350);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM payroll_runs WHERE source_ticket_id=2').get()!.n,1);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM accounting_events WHERE source_type='commission' AND source_id=?").get(String(run.id))!.n,1);
});
it('validates print settings atomically with permission checks and rejects CSS injection',async()=>{
 const {POST}=await import('../src/app/api/settings/route');
 assert.equal((await POST(request(2,'/api/settings',{values:{print_font_size:'12'}}))).status,403);
 assert.equal((await POST(request(1,'/api/settings',{values:{print_font_size:'12',print_accent:'red;display:none'}}))).status,400);
 assert.equal(db.prepare("SELECT value FROM settings WHERE key='print_font_size'").get(),undefined);
 const values={print_font_size:'12',print_margin:'8',print_paper:'a5',print_footer:'Thank you <script>unsafe()</script>',business_address:'Line one\nLine two',print_show_signature:'0'};
 assert.equal((await POST(request(1,'/api/settings',{values}))).status,200);
 assert.equal(printSettingError('print_margin','-1')!==null,true);
 assert.equal(printSettingError('print_font_size','14.5')!==null,true);
 const settings=parsePrintSettings({...values,print_accent:'</style><script>alert(1)</script>'}),css=documentPrintCss(settings);
 assert(!css.includes('<script>'));assert(css.includes('size:A5'));assert(css.includes('margin:8mm'));assert.equal(settings.print_accent,'#222222');
 assert.equal(printPaper('roll','a4'),'roll');assert.equal(printPaper('malicious','a5'),'a5');
});
it('produces escaped customer-ready estimates with shared layout and preserves signed evidence',async()=>{
 db.exec(`INSERT INTO estimates(id,number,customer_id,ticket_id,status,subtotal,total,public_token) VALUES(1,'EST-001',1,1,'draft',1000,1000,'synthetic-print-token');
 INSERT INTO estimate_items(estimate_id,kind,name,qty,unit_price,total) VALUES(1,'service','<img src=x onerror=alert(1)>',1,1000,1000);`);
 const signature=await (await import('qrcode')).default.toDataURL('Synthetic signed evidence');
 db.prepare('UPDATE estimates SET signature_data=?,signed_name=? WHERE id=1').run(signature,'Customer');
 const {GET}=await import('../src/app/api/estimates/[id]/document/route'),context={params:Promise.resolve({id:'1'})};
 assert.equal((await GET(request(3,'/api/estimates/1/document'),context)).status,404);
 const response=await GET(request(1,'/api/estimates/1/document'),context);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
 const html=await response.text();assert(html.includes('خانم رضایی'));assert(html.includes('&lt;img src=x onerror=alert(1)&gt;'));assert(!html.includes('<script>unsafe()'));
 assert(html.includes('&lt;script&gt;unsafe()&lt;/script&gt;'));assert(html.includes('document.fonts.ready'));assert(html.includes('size:A5'));assert(!html.includes('null رضایی'));
 assert(html.includes(signature));assert.equal(db.prepare('SELECT signature_data FROM estimates WHERE id=1').get()!.signature_data,signature);
});
