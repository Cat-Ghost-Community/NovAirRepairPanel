import {createHash} from 'node:crypto';
import {HttpError} from '../http-error';import {validateId} from '../validate-id';
import {normalizeJournal,ledgerText,type JournalInput,type Line,journalDimensions} from '../journal-input';
import {journalDigest,type LedgerProofHeader} from '../ledger-proof';
import {safePostgresInteger,type PostgresDatabase} from './postgres';
import {authorizePostgresScope,postgresRelation,type Scope} from './postgres-auth';
type Draft=ReturnType<typeof normalizeJournal>;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function locked<T>(db:PostgresDatabase,schema:string,work:()=>Promise<T>){postgresRelation(schema,'accounting_journals');return db.transaction(async()=>{await db.query('SELECT pg_advisory_xact_lock(hashtext($1),19204301)',[schema]);return work();});}
async function audit(db:PostgresDatabase,schema:string,scope:Scope,action:string,id:number,branch:number,before:unknown,after:unknown){
 await db.query(`INSERT INTO ${postgresRelation(schema,'audit_logs')}(user_id,action,entity,entity_id,"before","after",branch_id,created_at) VALUES($1,$2,'accounting_journal',$3,$4,$5,$6,$7)`,[scope.session.user.id,action,id,before==null?null:JSON.stringify(before),after==null?null:JSON.stringify(after),branch,new Date().toISOString()]);
}
async function validateLines(db:PostgresDatabase,schema:string,scope:Scope,input:Draft){
 const codes=[...new Set(input.lines.map(line=>line.account_code))],active=await db.query(`SELECT code FROM ${postgresRelation(schema,'accounting_accounts')} WHERE code=ANY($1::text[]) AND active=1`,[codes]);if(active.rowCount!==codes.length)throw new HttpError(400,'سرفصل فعال برای تمام سطرها یافت نشد.');
 for(const [dimension,table] of [['customer_id','customers'],['supplier_id','suppliers'],['employee_id','users'],['part_id','parts'],['bank_account_id','bank_accounts']] as const){
  const ids=[...new Set(input.lines.map(line=>line[dimension]).filter((id):id is number=>id!=null))];if(!ids.length)continue;
  const scoped=!['owner','admin'].includes(scope.session.user.role)&&['customers','users'].includes(table);
  const restriction=table==='customers'?` AND EXISTS(SELECT 1 FROM ${postgresRelation(schema,'customer_branch_access')} a WHERE a.customer_id=${postgresRelation(schema,table)}.id AND a.branch_id=$2)`:' AND (branch_id=$2 OR branch_id IS NULL)';
  const rows=await db.query(`SELECT id FROM ${postgresRelation(schema,table)} WHERE id=ANY($1::bigint[])${scoped?restriction:''}`,scoped?[ids,input.branch_id]:[ids]);if(rows.rowCount!==ids.length)throw new HttpError(400,'تفصیلی مجاز تمام سطرها یافت نشد.');
 }
}
async function writeDraft(db:PostgresDatabase,schema:string,scope:Scope,input:Draft){
 const table=(name:string)=>postgresRelation(schema,name),requestHash=hash(input),existing=(await db.query(`SELECT id,state,request_hash,branch_id FROM ${table('accounting_journals')} WHERE event_key=$1`,[input.event_key])).rows[0];
 if(existing){if(existing.request_hash!==requestHash||safePostgresInteger(existing.branch_id)!==input.branch_id)throw new HttpError(409,'این شناسه با محتوای دیگری ثبت شده است.');return {id:safePostgresInteger(existing.id),state:String(existing.state),request_hash:requestHash,duplicate:true};}
 if(!(await db.query(`SELECT id FROM ${table('branches')} WHERE id=$1 AND is_active=1`,[input.branch_id])).rowCount)throw new HttpError(400,'شعبهٔ فعال یافت نشد.');
 const period=(await db.query(`SELECT id FROM ${table('accounting_periods')} WHERE status='open' AND $1 BETWEEN start_date AND end_date`,[input.posting_date])).rows[0];if(!period)throw new HttpError(409,'دورهٔ باز برای تاریخ سند وجود ندارد.');await validateLines(db,schema,scope,input);
 const result=await db.query(`INSERT INTO ${table('accounting_journals')}(branch_id,period_id,posting_date,source_type,source_id,event_key,memo,request_hash,created_by,reversal_of,state,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11) RETURNING id`,[input.branch_id,period.id,input.posting_date,input.source_type,input.source_id,input.event_key,input.memo,requestHash,scope.session.user.id,input.reversal_of,new Date().toISOString()]);const id=safePostgresInteger(result.rows[0].id),values:unknown[]=[],groups=input.lines.map(line=>'('+[id,line.position,line.account_code,line.debit,line.credit,line.memo,...journalDimensions.map(key=>line[key])].map(value=>{values.push(value);return '$'+values.length;}).join(',')+')');
 await db.query(`INSERT INTO ${table('accounting_lines')}(journal_id,position,account_code,debit,credit,memo,customer_id,supplier_id,employee_id,part_id,bank_account_id) VALUES ${groups.join(',')}`,values);await audit(db,schema,scope,'draft',id,input.branch_id,null,{event_key:input.event_key,branch_id:input.branch_id});return {id,state:'draft',request_hash:requestHash,duplicate:false};
}
function headerOf(raw:Record<string,unknown>){const header={...raw} as unknown as LedgerProofHeader;for(const key of ['id','branch_id','period_id','created_by','posted_by','posted_sequence','reversal_of'] as const)(header as unknown as Record<string,unknown>)[key]=raw[key]==null?null:safePostgresInteger(raw[key] as string);return header;}
async function linesOf(db:PostgresDatabase,schema:string,id:number):Promise<Line[]>{
 const result=await db.query(`SELECT position,account_code,debit,credit,memo,customer_id,supplier_id,employee_id,part_id,bank_account_id FROM ${postgresRelation(schema,'accounting_lines')} WHERE journal_id=$1 ORDER BY position LIMIT 501`,[id]);if(result.rows.length>500)throw new HttpError(409,'سند قدیمی بزرگ نیازمند بررسی مستقل است.');
 return result.rows.map(raw=>{const line={position:safePostgresInteger(raw.position),account_code:String(raw.account_code),debit:safePostgresInteger(raw.debit),credit:safePostgresInteger(raw.credit),memo:String(raw.memo)} as Line;for(const key of journalDimensions)line[key]=raw[key]==null?null:safePostgresInteger(raw[key]);return line;});
}
async function postRecord(db:PostgresDatabase,schema:string,scope:Scope,id:number,expectedHash?:string,allowReversal=false,sourceEventId?:number){
 const table=(name:string)=>postgresRelation(schema,name),raw=(await db.query(`SELECT * FROM ${table('accounting_journals')} WHERE id=$1 AND ($2::bigint IS NULL OR branch_id=$2)`,[id,scope.branchId])).rows[0];if(!raw)throw new HttpError(404,'سند یافت نشد.');
 if(expectedHash!=null&&expectedHash!==raw.request_hash)throw new HttpError(409,'نسخهٔ پیش‌نویس تغییر کرده است.');if(raw.state!=='draft')return {id,state:String(raw.state),duplicate:true};
 // Operational documents need their own policy/source transition port; a manual endpoint must never bypass it.
 if(raw.source_type!=='manual'&&!(allowReversal&&raw.source_type==='journal_reversal')){
  if(sourceEventId==null||!(await db.query(`SELECT e.id FROM ${table('accounting_event_reviews')} r JOIN ${table('accounting_events')} e ON e.id=r.event_id WHERE r.event_id=$1 AND r.journal_id=$2 AND e.branch_id=$3 AND ((e.source_type=$4 AND e.source_id=$5) OR ($4='financial_event' AND e.id::text=$5))`,[sourceEventId,id,raw.branch_id,raw.source_type,raw.source_id])).rowCount)throw new HttpError(409,'ثبت سند عملیاتی فقط از مسیر مصوب مرجع آن مجاز است.');
 }
 if((await db.query(`SELECT journal_id FROM ${table('accounting_journal_voids')} WHERE journal_id=$1`,[id])).rowCount)throw new HttpError(409,'پیش‌نویس باطل شده است.');
 const header=headerOf(raw),lines=await linesOf(db,schema,id),previous=(await db.query(`SELECT posted_sequence,digest FROM ${table('accounting_journals')} WHERE posted_sequence IS NOT NULL ORDER BY posted_sequence DESC LIMIT 1`)).rows[0];
 // Reuse exact normalization and existing proof format; SQL guards independently validate the final mutation.
 const normalized=normalizeJournal({...header,lines});await validateLines(db,schema,scope,normalized);header.posted_by=scope.session.user.id;header.posted_at=new Date().toISOString();header.posted_sequence=safePostgresInteger(BigInt(previous?.posted_sequence??'0')+BigInt(1));header.previous_hash=String(previous?.digest??'');
 const proof=journalDigest(header,lines);await db.query(`UPDATE ${table('accounting_journals')} SET state='posted',posted_by=$1,posted_at=$2,posted_sequence=$3,previous_hash=$4,digest=$5 WHERE id=$6 AND state='draft'`,[header.posted_by,header.posted_at,header.posted_sequence,header.previous_hash,proof,id]);await audit(db,schema,scope,'post',id,header.branch_id,{state:'draft'},{state:'posted',digest:proof,branch_id:header.branch_id});return {id,state:'posted',duplicate:false};
}
/** Trusted domain boundary; callers hold a validated current Scope and perform
 * their source-specific independent approval before invoking these helpers. */
export async function postgresCreateScopedJournal(db:PostgresDatabase,schema:string,scope:Scope,raw:JournalInput){
 if(!db.isTransaction())throw Error('Source journal requires its authoritative transaction');
 const input=normalizeJournal(raw);if(scope.branchId!=null&&scope.branchId!==input.branch_id)throw new HttpError(403,'سند شعبهٔ دیگر مجاز نیست.');
 return locked(db,schema,()=>writeDraft(db,schema,scope,input));
}
export async function postgresPostScopedJournal(db:PostgresDatabase,schema:string,scope:Scope,id:number,expectedHash?:string,sourceEventId?:number){
 if(!db.isTransaction())throw Error('Source posting requires its authoritative transaction');
 return locked(db,schema,async()=>{
  const table=(name:string)=>postgresRelation(schema,name);
  if(sourceEventId!=null){
   const event=(await db.query(`SELECT * FROM ${table('accounting_events')} WHERE id=$1`,[validateId(sourceEventId)])).rows[0],journal=(await db.query(`SELECT branch_id,source_type,source_id,memo FROM ${table('accounting_journals')} WHERE id=$1`,[validateId(id)])).rows[0];
   if(!event||!journal||safePostgresInteger(event.branch_id)!==safePostgresInteger(journal.branch_id)||(scope.branchId!=null&&safePostgresInteger(event.branch_id)!==scope.branchId))throw new HttpError(409,'مرجع رویداد و سند حسابداری تطبیق ندارد.');
   if(!((journal.source_type===event.source_type&&journal.source_id===event.source_id)||(journal.source_type==='financial_event'&&journal.source_id===String(event.id))))throw new HttpError(409,'هویت منبع سند با رویداد مالی تطبیق ندارد.');
   if(createHash('sha256').update(String(event.payload_json)).digest('hex')!==String(event.payload_hash))throw new HttpError(409,'اثر انگشت رویداد مالی معتبر نیست.');
   const control=safePostgresInteger(JSON.parse(String(event.payload_json)).control_amount),totals=(await db.query(`SELECT COALESCE(SUM(debit),0)::text debit,COALESCE(SUM(credit),0)::text credit FROM ${table('accounting_lines')} WHERE journal_id=$1`,[id])).rows[0];
   if(control<=0||BigInt(totals.debit)!==BigInt(control)||BigInt(totals.credit)!==BigInt(control))throw new HttpError(409,'مبلغ سند با کنترل مرجع مالی تطبیق ندارد.');
   const prior=(await db.query(`SELECT journal_id FROM ${table('accounting_event_reviews')} WHERE event_id=$1`,[sourceEventId])).rows[0];
   if(prior&&safePostgresInteger(prior.journal_id)!==id)throw new HttpError(409,'رویداد قبلاً به سند دیگری متصل شده است.');
   if(!prior)await db.query(`INSERT INTO ${table('accounting_event_reviews')}(event_id,journal_id,reason,approved_by) VALUES($1,$2,$3,$4)`,[sourceEventId,id,String(journal.memo).trim().length>=5?journal.memo:'اجرای سند مصوب مرجع مالی',scope.session.user.id]);
  }
  return postRecord(db,schema,scope,id,expectedHash,false,sourceEventId);
 });
}
export async function postgresCreateManualJournal(db:PostgresDatabase,schema:string,token:string,raw:JournalInput){
 const input=normalizeJournal(raw);if(input.source_type!=='manual'||input.reversal_of!=null)throw new HttpError(409,'این مسیر فقط برای پیش‌نویس دستی مستقل است.');
 return db.transaction(async()=>{const scope=await authorizePostgresScope(db,schema,token,'finance.manage',input.branch_id,true);return locked(db,schema,()=>writeDraft(db,schema,scope,input));});
}
export async function postgresPostManualJournal(db:PostgresDatabase,schema:string,token:string,id:number,options:{branch_id?:number|null;expectedHash?:string}={}){
 id=validateId(id);return db.transaction(async()=>{const scope=await authorizePostgresScope(db,schema,token,'finance.manage',options.branch_id,true);return locked(db,schema,()=>postRecord(db,schema,scope,id,options.expectedHash));});
}
export async function postgresReverseManualJournal(db:PostgresDatabase,schema:string,token:string,id:number,date:string,reason:string){
 id=validateId(id);ledgerText(reason,'دلیل برگشت');return db.transaction(async()=>{
  const scope=await authorizePostgresScope(db,schema,token,'finance.manage',null,true);return locked(db,schema,async()=>{const table=(name:string)=>postgresRelation(schema,name),raw=(await db.query(`SELECT * FROM ${table('accounting_journals')} WHERE id=$1 AND ($2::bigint IS NULL OR branch_id=$2)`,[id,scope.branchId])).rows[0];if(!raw)throw new HttpError(404,'سند یافت نشد.');
  if(raw.source_type!=='manual'||raw.reversal_of!=null)throw new HttpError(409,'اصلاح سند عملیاتی نیازمند مسیر مرجع مصوب است.');
  const original=headerOf(raw),input=normalizeJournal({branch_id:original.branch_id,posting_date:date,memo:reason,event_key:'reversal:'+id,source_type:'journal_reversal',source_id:String(id),reversal_of:id,lines:(await linesOf(db,schema,id)).map(line=>({...line,debit:line.credit,credit:line.debit}))});
  const existing=(await db.query(`SELECT id,posting_date,memo,state FROM ${table('accounting_journals')} WHERE reversal_of=$1`,[id])).rows[0];if(existing){if(existing.posting_date!==input.posting_date||existing.memo!==input.memo||existing.state!=='posted'||raw.state!=='reversed')throw new HttpError(409,'برگشت قبلی متفاوت یا ناقص است و نیازمند بررسی مستقل است.');return {id:safePostgresInteger(existing.id),state:'posted',duplicate:true};}
  if(raw.state!=='posted')throw new HttpError(409,'فقط سند نهایی اصلی قابل برگشت است.');const reversal=await writeDraft(db,schema,scope,input);await postRecord(db,schema,scope,reversal.id,undefined,true);await db.query(`UPDATE ${table('accounting_journals')} SET state='reversed' WHERE id=$1`,[id]);await audit(db,schema,scope,'reverse',id,original.branch_id,{state:'posted'},{state:'reversed',reversal_id:reversal.id,reason:input.memo,branch_id:original.branch_id});return {id:reversal.id,state:'posted',duplicate:false};
 });});
}
export async function postgresEditManualJournal(db:PostgresDatabase,schema:string,token:string,id:number,input:{posting_date:string;memo:string;lines:JournalInput['lines'];expected_hash:string}){
 return db.transaction(async()=>{const scope=await authorizePostgresScope(db,schema,token,'finance.manage',null,true);return locked(db,schema,async()=>{
  const q=(name:string)=>postgresRelation(schema,name),row=(await db.query(`SELECT * FROM ${q('accounting_journals')} WHERE id=$1 AND ($2::bigint IS NULL OR branch_id=$2)`,[validateId(id),scope.branchId])).rows[0];
  if(!row)throw new HttpError(404,'سند حسابداری یافت نشد.');if(row.state!=='draft'||row.source_type!=='manual'||(await db.query(`SELECT journal_id FROM ${q('accounting_journal_voids')} WHERE journal_id=$1`,[id])).rowCount)throw new HttpError(409,'فقط پیش‌نویس دستیِ باطل‌نشده قابل اصلاح است.');
  if(typeof input.expected_hash!=='string'||input.expected_hash!==row.request_hash)throw new HttpError(409,'نسخهٔ پیش‌نویس تغییر کرده است؛ دوباره دریافت کنید.');
  const normalized=normalizeJournal({branch_id:safePostgresInteger(row.branch_id),posting_date:input.posting_date,memo:input.memo,lines:input.lines,event_key:String(row.event_key),source_type:'manual',source_id:String(row.source_id)}),period=(await db.query(`SELECT id FROM ${q('accounting_periods')} WHERE status='open' AND $1 BETWEEN start_date AND end_date`,[normalized.posting_date])).rows[0];if(!period)throw new HttpError(409,'دورهٔ باز برای تاریخ پیش‌نویس وجود ندارد.');await validateLines(db,schema,scope,normalized);
  const before={memo:row.memo,posting_date:row.posting_date,request_hash:row.request_hash,lines:await linesOf(db,schema,id)},nextHash=hash(normalized);
  await db.query(`UPDATE ${q('accounting_journals')} SET period_id=$1,posting_date=$2,memo=$3,request_hash=$4 WHERE id=$5 AND state='draft'`,[period.id,normalized.posting_date,normalized.memo,nextHash,id]);await db.query(`DELETE FROM ${q('accounting_lines')} WHERE journal_id=$1`,[id]);
  const values:unknown[]=[],groups=normalized.lines.map(line=>'('+[id,line.position,line.account_code,line.debit,line.credit,line.memo,...journalDimensions.map(key=>line[key])].map(value=>{values.push(value);return '$'+values.length;}).join(',')+')');await db.query(`INSERT INTO ${q('accounting_lines')}(journal_id,position,account_code,debit,credit,memo,customer_id,supplier_id,employee_id,part_id,bank_account_id) VALUES ${groups.join(',')}`,values);
  await audit(db,schema,scope,'edit_draft',id,normalized.branch_id,before,{posting_date:normalized.posting_date,memo:normalized.memo,request_hash:nextHash,lines:normalized.lines});return {id,state:'draft',request_hash:nextHash};
 });});
}
export async function postgresVoidManualJournal(db:PostgresDatabase,schema:string,token:string,id:number,reason:string){
 reason=ledgerText(reason,'دلیل ابطال',500);if(reason.length<5)throw new HttpError(400,'دلیل ابطال حداقل پنج نویسه لازم دارد.');
 return db.transaction(async()=>{const scope=await authorizePostgresScope(db,schema,token,'finance.manage',null,true);return locked(db,schema,async()=>{
  const q=(name:string)=>postgresRelation(schema,name),row=(await db.query(`SELECT * FROM ${q('accounting_journals')} WHERE id=$1 AND ($2::bigint IS NULL OR branch_id=$2)`,[validateId(id),scope.branchId])).rows[0];if(!row)throw new HttpError(404,'سند یافت نشد.');if(row.state!=='draft'||row.source_type!=='manual')throw new HttpError(409,'فقط پیش‌نویس دستی قابل ابطال است.');
  const prior=(await db.query(`SELECT reason FROM ${q('accounting_journal_voids')} WHERE journal_id=$1`,[id])).rows[0];if(prior){if(prior.reason!==reason)throw new HttpError(409,'پیش‌نویس با دلیل دیگری باطل شده است.');return {id,state:'voided',duplicate:true};}
  await db.query(`INSERT INTO ${q('accounting_journal_voids')}(journal_id,reason,actor_id) VALUES($1,$2,$3)`,[id,reason,scope.session.user.id]);await audit(db,schema,scope,'void_draft',id,safePostgresInteger(row.branch_id),{state:'draft'},{state:'voided',reason});return {id,state:'voided',duplicate:false};
 });});
}
