import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import type { Session } from '@/lib/auth';
import { auditRecord,HttpError,validate } from '@/lib/api';
import { accountingAdmin,accountingDate,createJournal,ledgerScope,normalizeJournal,postJournal,signedSafe,validateLedgerLines,verifyLedger,type JournalLine } from '@/lib/accounting';
import { reconcileSubledgers } from '@/lib/accounting-reports';
import { atomic } from '@/lib/db/transaction';
import { verifiedSnapshot } from '@/lib/backup';
import { DB_PATH } from '@/lib/db/schema';
import { PAYROLL_SOURCE_JOINS,PAYROLL_BRANCH_SQL } from '@/lib/payroll-scope';
import { multiplyRial } from '@/lib/money';

const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export const openingControlCodes=['1000','1020','1100','1110','2000','2010','2030'] as const;
type Control={account_code:string;balance:number;reference:string};
type Opening={id:number;branch_id:number;mode:'legacy'|'new_business';cutover_date:string;memo:string;lines_json:string;controls_json:string;evidence_json:string;source_hash:string;document_hash:string;proposed_by:number;approved_by:number|null;status:string;backup_path:string|null;backup_hash:string|null;journal_id:number|null};
function opening(db:DatabaseSync,session:Session,id:number,cookie?:string|null){
 const row=db.prepare('SELECT * FROM accounting_opening_documents WHERE id=?').get(validate.id(id)) as Opening|undefined;
 if(!row)throw new HttpError(404,'سند افتتاحیه یافت نشد.');ledgerScope(session,row.branch_id,cookie,'finance.manage');return row;
}
/** Stream actual source rows, not their unreliable caches; never persist personal source contents. */
function fingerprint(db:DatabaseSync,branch:number){
 const digest=createHash('sha256');let records=0;
 for(const table of ['invoices','payments','refunds','sales','expenses','inventory_movements','checks','commission_payments'] as const){
  digest.update(table);for(const row of db.prepare(`SELECT * FROM ${table} WHERE branch_id=? ORDER BY id`).iterate(branch)){digest.update(JSON.stringify(row));records++;}
 }
 for(const [name,sql] of [
  ['invoice_items','SELECT x.* FROM invoice_items x JOIN invoices i ON i.id=x.invoice_id WHERE i.branch_id=? ORDER BY x.id'],
  ['sale_items','SELECT x.* FROM sale_items x JOIN sales s ON s.id=x.sale_id WHERE s.branch_id=? ORDER BY x.id'],
  ['stock','SELECT s.*,p.avg_cost FROM inventory_stock s JOIN inventory_locations l ON l.id=s.location_id JOIN parts p ON p.id=s.part_id WHERE l.branch_id=? ORDER BY s.part_id,s.location_id'],
  ['commission',`SELECT r.* FROM payroll_runs r ${PAYROLL_SOURCE_JOINS} WHERE ${PAYROLL_BRANCH_SQL}=? ORDER BY r.id`],
  ['events','SELECT id,payload_hash FROM accounting_events WHERE branch_id=? ORDER BY id'],
 ] as const){digest.update(name);for(const row of db.prepare(sql).iterate(branch)){digest.update(JSON.stringify(row));records++;}}
 // Bank registers have no safe branch ownership. Freeze their evidence globally
 // rather than pretending an employee's branch owns a central account.
 for(const table of ['bank_accounts','bank_transactions'] as const){digest.update(table);for(const row of db.prepare(`SELECT * FROM ${table} ORDER BY id`).iterate())digest.update(JSON.stringify(row));}
 return {hash:digest.digest('hex'),records};
}
function safeState(db:DatabaseSync,row:Opening){
 if(row.document_hash&&hash(JSON.stringify({branch_id:row.branch_id,mode:row.mode,cutover_date:row.cutover_date,memo:row.memo,lines:JSON.parse(row.lines_json),controls:JSON.parse(row.controls_json),evidence:JSON.parse(row.evidence_json),source_hash:row.source_hash}))!==row.document_hash)throw new HttpError(409,'اثر انگشت سند افتتاحیه معتبر نیست.');
 if(db.prepare('SELECT id FROM accounting_journals WHERE branch_id=? LIMIT 1').get(row.branch_id))throw new HttpError(409,'افتتاحیه فقط پیش از نخستین سند دفترکل شعبه مجاز است.');
 if(fingerprint(db,row.branch_id).hash!==row.source_hash)throw new HttpError(409,'منابع مالی پس از آماده‌سازی تغییر کرده‌اند؛ سند تازه و تأیید مستقل لازم است.');
 for(const table of ['invoices','payments','refunds','sales','expenses','inventory_movements','checks'] as const){
  if(db.prepare(`SELECT id FROM ${table} WHERE branch_id=? AND substr(created_at,1,10)>? LIMIT 1`).get(row.branch_id,row.cutover_date))throw new HttpError(409,'منبعی بعد از تاریخ افتتاحیه وجود دارد؛ تاریخ برش و مدارک را بازبینی کنید.');
 }
 if(!db.prepare("SELECT id FROM accounting_periods WHERE status='open' AND ? BETWEEN start_date AND end_date").get(row.cutover_date))throw new HttpError(409,'تاریخ افتتاحیه در دورهٔ باز نیست.');
}
function compareControls(db:DatabaseSync,session:Session,row:Opening,lines:JournalLine[],controls:Control[],cookie?:string|null){
 for(const code of openingControlCodes){
  const control=controls.find(c=>c.account_code===code);if(!control||typeof control.reference!=='string'||control.reference.trim().length<5||control.reference.length>1000||!Number.isSafeInteger(control.balance))throw new HttpError(400,'برای تمام حساب‌های کنترل، ماندهٔ صحیح و مرجع بررسی لازم است؛ صفر نیز باید صریح تأیید شود.');
  const balance=signedSafe(lines.filter(l=>l.account_code===code).reduce((n,l)=>n+BigInt(l.debit??0)-BigInt(l.credit??0),BigInt(0)));
  if(balance!==control.balance)throw new HttpError(409,`ماندهٔ افتتاحیه با مدرک کنترل ${code} برابر نیست.`);
 }
 if(controls.length!==openingControlCodes.length||new Set(controls.map(c=>c.account_code)).size!==controls.length)throw new HttpError(400,'فهرست کنترل‌ها باید کامل و بدون تکرار باشد.');
 const balances=(codes:string[],dimension:'customer_id'|'supplier_id')=>{const map=new Map<number,bigint>();for(const l of lines.filter(l=>codes.includes(l.account_code))){if(!l[dimension])throw new HttpError(400,'تفصیلی افتتاحیهٔ دریافتنی و پرداختنی الزامی است.');const id=l[dimension]!;map.set(id,(map.get(id)??BigInt(0))+BigInt(l.debit??0)-BigInt(l.credit??0));}return map;};
 const customer=balances(['1100','2010'],'customer_id'),supplier=balances(['2000'],'supplier_id');let ca:number|null=0,sa:number|null=0,inventory=0;
 do {const report=reconcileSubledgers(db,session,row.branch_id,cookie,ca??Number.MAX_SAFE_INTEGER,sa??Number.MAX_SAFE_INTEGER);inventory=report.inventory.operational;
  for(const [rows,map,sign] of [[report.customers,customer,1],[report.suppliers,supplier,-1]] as const){for(const party of rows){if((map.get(party.id)??BigInt(0))!==BigInt(party.operational)*BigInt(sign))throw new HttpError(409,'افتتاحیه با ماندهٔ مستقل مشتری یا تأمین‌کننده سازگار نیست.');map.delete(party.id);}}
  ca=report.nextCustomer;sa=report.nextSupplier;
 }while(ca!=null||sa!=null);
 if([...customer.values(),...supplier.values()].some(n=>n!==BigInt(0)))throw new HttpError(409,'افتتاحیه دارای ماندهٔ طرف حساب بدون منبع است.');
 if(controls.find(c=>c.account_code==='1110')!.balance!==inventory)throw new HttpError(409,'ارزش افتتاحیه با موجودی عملیاتی برابر نیست.');
 const stockValues=new Map<number,bigint>();
 for(const stock of db.prepare(`SELECT s.part_id,s.qty,s.carrying_value,p.avg_cost FROM inventory_stock s JOIN inventory_locations l ON l.id=s.location_id JOIN parts p ON p.id=s.part_id WHERE l.branch_id=?`).iterate(row.branch_id)){
  if(Number(stock.qty)<0)throw new HttpError(409,'موجودی منفی پیش از افتتاحیه نیازمند اصلاح مصوب است.');
  const id=Number(stock.part_id);stockValues.set(id,(stockValues.get(id)??BigInt(0))+BigInt(stock.carrying_value==null?multiplyRial(Number(stock.avg_cost),Number(stock.qty)):Number(stock.carrying_value)));
 }
 for(const line of lines.filter(l=>l.account_code==='1110')){if(!line.part_id)throw new HttpError(400,'تفصیلی کالا در افتتاحیه الزامی است.');stockValues.set(line.part_id,(stockValues.get(line.part_id)??BigInt(0))-BigInt(line.debit??0)+BigInt(line.credit??0));}
 if([...stockValues.values()].some(value=>value!==BigInt(0)))throw new HttpError(409,'ارزش افتتاحیهٔ هر کالا با منبع موجودی همان کالا برابر نیست.');
 for(const line of lines){if(line.account_code==='1110'&&!line.part_id||line.account_code==='2030'&&!line.employee_id||line.account_code==='1020'&&!line.bank_account_id)throw new HttpError(400,'تفصیلی موجودی، پورسانت و بانک الزامی است.');}
}
export function proposeOpening(db:DatabaseSync,session:Session,input:{branch_id:number;mode:'legacy'|'new_business';cutover_date:string;memo:string;lines:JournalLine[];controls:Control[];evidence:string[]},cookie?:string|null){
 accountingAdmin(session);ledgerScope(session,input.branch_id,cookie,'finance.manage');
 if(!['legacy','new_business'].includes(input.mode)||typeof input.memo!=='string'||input.memo.trim().length<10||input.memo.length>500)throw new HttpError(400,'نوع و شرح مستند افتتاحیه معتبر نیست.');
 if(!Array.isArray(input.evidence)||!input.evidence.length||input.evidence.length>30||input.evidence.some(e=>typeof e!=='string'||e.trim().length<5||e.length>1000))throw new HttpError(400,'مرجع مدارک افتتاحیه الزامی است.');
 if(!Array.isArray(input.lines)||!Array.isArray(input.controls))throw new HttpError(400,'سطرها و کنترل‌های افتتاحیه معتبر نیست.');
 if(input.controls.some(c=>!c||typeof c!=='object'||Array.isArray(c)||typeof c.account_code!=='string'||typeof c.balance!=='number'||typeof c.reference!=='string'))throw new HttpError(400,'ساختار حساب‌های کنترل معتبر نیست.');
 return atomic(db,()=>{
  const date=accountingDate(input.cutover_date),source=fingerprint(db,input.branch_id);
  if(date!==new Date().toISOString().slice(0,10))throw new HttpError(409,'این مسیر فقط برشِ امروز با منابع فعلی را می‌پذیرد؛ افتتاحیهٔ تاریخ دیگر نیازمند صورت‌های همان تاریخ و فرایند انتقال جداگانه است.');
  if(input.mode==='new_business'&&source.records!==0)throw new HttpError(409,'شعبه دارای منبع مالی است؛ افتتاحیهٔ کسب‌وکار جدید مجاز نیست.');
  const lines=input.mode==='new_business'&&input.lines.length===0?[]:normalizeJournal({branch_id:input.branch_id,posting_date:date,memo:input.memo,lines:input.lines,event_key:'opening-validation',source_type:'opening',source_id:'validation'}).lines;
  if(lines.length){validateLedgerLines(db,lines);const codes=[...new Set(lines.map(l=>l.account_code))];
   if(db.prepare(`SELECT code FROM accounting_accounts WHERE code IN (${codes.map(()=>'?').join(',')}) AND classification IN ('revenue','expense','cogs')`).get(...codes))throw new HttpError(400,'افتتاحیه فقط حساب‌های ترازنامه را می‌پذیرد؛ سود انباشته نیازمند مدرک مستقل است.');}
  const data={branch_id:input.branch_id,mode:input.mode,cutover_date:date,memo:input.memo.trim(),lines,controls:input.controls,evidence:input.evidence,source_hash:source.hash};
  const prospective={...data,id:0,lines_json:JSON.stringify(lines)} as unknown as Opening;safeState(db,prospective);compareControls(db,session,prospective,lines,input.controls,cookie);
  const documentHash=hash(JSON.stringify(data));const prior=db.prepare("SELECT id,document_hash,status FROM accounting_opening_documents WHERE branch_id=? AND status!='rejected'").get(input.branch_id);
  if(prior){if(prior.document_hash!==documentHash)throw new HttpError(409,'افتتاحیهٔ متفاوتی برای این شعبه وجود دارد.');return {id:Number(prior.id),status:String(prior.status)};}
  const id=Number(db.prepare(`INSERT INTO accounting_opening_documents(branch_id,mode,cutover_date,memo,lines_json,controls_json,evidence_json,source_hash,document_hash,proposed_by) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(input.branch_id,input.mode,date,data.memo,JSON.stringify(lines),JSON.stringify(input.controls),JSON.stringify(input.evidence),source.hash,documentHash,session.user.id).lastInsertRowid);
  auditRecord(db,session,'propose','accounting_opening',id,null,{branch_id:input.branch_id,document_hash:documentHash,mode:input.mode});return {id,status:'proposed'};
 });
}
export function decideOpening(db:DatabaseSync,session:Session,id:number,decision:'approved'|'rejected',cookie?:string|null){
 accountingAdmin(session);return atomic(db,()=>{const row=opening(db,session,id,cookie);
 if(row.status!=='proposed'||!['approved','rejected'].includes(decision))throw new HttpError(409,'سند در مرحلهٔ بررسی اولیه نیست.');
 if(row.proposed_by===session.user.id)throw new HttpError(403,'پیشنهاددهنده نمی‌تواند افتتاحیهٔ خودش را تأیید کند.');
 if(decision==='approved'){safeState(db,row);compareControls(db,session,row,JSON.parse(row.lines_json),JSON.parse(row.controls_json),cookie);}
 db.prepare('UPDATE accounting_opening_documents SET status=?,approved_by=? WHERE id=?').run(decision,session.user.id,id);
 auditRecord(db,session,decision,'accounting_opening',id,null,{branch_id:row.branch_id});return {id,status:decision};});
}
function writeOpening(db:DatabaseSync,session:Session,row:Opening,cookie?:string|null){
 const lines=JSON.parse(row.lines_json) as JournalLine[];let journalId:number|null=null;
 if(lines.length){const journal=createJournal(db,session,{branch_id:row.branch_id,posting_date:row.cutover_date,memo:row.memo,lines,source_type:'opening',source_id:String(row.id),event_key:`opening:${row.branch_id}`},cookie);postJournal(db,session,journal.id,cookie);journalId=journal.id;}
 db.prepare("UPDATE accounting_opening_documents SET status='posted',journal_id=? WHERE id=?").run(journalId,row.id);
 db.prepare('INSERT INTO accounting_opening_event_links(event_id,opening_id) SELECT id,? FROM accounting_events WHERE branch_id=?').run(row.id,row.branch_id);
 auditRecord(db,session,'post','accounting_opening',row.id,null,{branch_id:row.branch_id,journal_id:journalId,document_hash:row.document_hash,source_hash:row.source_hash});return {id:row.id,status:'posted',journal_id:journalId,duplicate:false};
}
export async function rehearseOpening(db:DatabaseSync,session:Session,id:number,cookie?:string|null){
 accountingAdmin(session);if(db.isTransaction)throw new Error('Opening backup must run outside the writer transaction');
 const row=opening(db,session,id,cookie);if(row.status==='rehearsed'){safeState(db,row);return {id,status:'rehearsed',backup_hash:row.backup_hash};}
 if(row.status!=='approved')throw new HttpError(409,'تأیید مستقل افتتاحیه لازم است.');safeState(db,row);
 const bytes=await verifiedSnapshot(db),backupHash=hash(bytes),temp=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-opening-'));let restored:DatabaseSync|undefined;
 try {const restoredPath=path.join(temp,'restored.db');fs.writeFileSync(restoredPath,bytes,{mode:0o600});restored=new DatabaseSync(restoredPath);restored.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');safeState(restored,row);
  // Rehearse the very same writer; its audit explicitly targets this copy.
  const result=atomic(restored,()=>{restored!.prepare("UPDATE accounting_opening_documents SET status='rehearsed',backup_path=?,backup_hash=?,rehearsal_json=? WHERE id=?").run('rehearsal-copy',backupHash,'{}',id);return writeOpening(restored!,session,{...row,status:'rehearsed'},cookie);});
  const integrity=restored.prepare('PRAGMA integrity_check').get()!.integrity_check,foreignKeys=restored.prepare('PRAGMA foreign_key_check').all().length;
  if(integrity!=='ok'||foreignKeys||!verifyLedger(restored).valid)throw new HttpError(409,'بازآزمایی افتتاحیه در نسخهٔ بازیابی‌شده موفق نبود.');
  const backupDirectory=path.join(path.dirname(DB_PATH),'accounting-opening-backups');fs.mkdirSync(backupDirectory,{recursive:true,mode:0o700});const filename=path.join(backupDirectory,`${id}-${backupHash}.db`);
  if(!fs.existsSync(filename))fs.writeFileSync(filename,bytes,{flag:'wx',mode:0o600});if(hash(fs.readFileSync(filename))!==backupHash)throw new HttpError(409,'نسخهٔ پشتیبان افتتاحیه معتبر نیست.');
  return atomic(db,()=>{const current=opening(db,session,id,cookie);safeState(db,current);if(current.status!=='approved'||current.approved_by!==row.approved_by)throw new HttpError(409,'وضعیت تأیید تغییر کرده است.');
   db.prepare("UPDATE accounting_opening_documents SET status='rehearsed',backup_path=?,backup_hash=?,rehearsal_json=? WHERE id=?").run(filename,backupHash,JSON.stringify({restored:true,integrity,foreignKeys,result}),id);
   auditRecord(db,session,'rehearse','accounting_opening',id,null,{branch_id:row.branch_id,backup_hash:backupHash});return {id,status:'rehearsed',backup_hash:backupHash};});
 }finally{restored?.close();fs.rmSync(temp,{recursive:true,force:true});}
}
export function applyOpening(db:DatabaseSync,session:Session,id:number,cookie?:string|null){
 accountingAdmin(session);return atomic(db,()=>{const row=opening(db,session,id,cookie);if(row.status==='posted')return {id,status:'posted',journal_id:row.journal_id,duplicate:true};
 if(row.status!=='rehearsed'||!row.approved_by||row.approved_by===row.proposed_by||!row.backup_path||!row.backup_hash||!fs.existsSync(row.backup_path)||hash(fs.readFileSync(row.backup_path))!==row.backup_hash)throw new HttpError(409,'تأیید مستقل، پشتیبان معتبر و بازآزمایی لازم است.');
 safeState(db,row);compareControls(db,session,row,JSON.parse(row.lines_json),JSON.parse(row.controls_json),cookie);return writeOpening(db,session,row,cookie);});
}
