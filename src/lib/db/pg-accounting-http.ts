import type {NextRequest} from 'next/server';
import type {JournalInput} from '../journal-input';
import {HttpError} from '../http-error';
import {validateId} from '../validate-id';
import {readRequestJson} from '../request-json';
import {recognitionTemplates} from '../recognition-templates';
import {hasPerm} from '../perms-shared';
import {postgresFinancialRequest} from './pg-financial-http';
import {postgresFailure} from './pg-http';
import {postgresRelation} from './postgres-auth';
import {postgresDurableOperation} from './postgres-operations';
import {safePostgresInteger} from './postgres';
import {postgresInitializeChart,postgresCreateAccount,postgresCreatePeriod,postgresSetPeriodState,postgresProposeRecognitionPolicy,postgresChangeRecognitionPolicy} from './postgres-accounting';
import {postgresCreateManualJournal,postgresPostManualJournal,postgresReverseManualJournal,postgresEditManualJournal,postgresVoidManualJournal} from './postgres-journals';
import {postgresTrialBalance,postgresGeneralLedger,postgresFinancialStatements} from './postgres-ledger-reports';
import {reviewPostgresFinancialEvent} from './postgres-financial-events';

const numeric=new Set(['id','branch_id','period_id','created_by','posted_by','posted_sequence','reversal_of','entity_id','actor_id','proposed_by','approved_by','journal_id','event_id','position','debit','credit','customer_id','supplier_id','employee_id','part_id','bank_account_id','amount','voided','enabled_after_event_id']);
function publicRows(rows:Record<string,unknown>[]){return rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value==null?null:numeric.has(key)&&typeof value!=='boolean'?safePostgresInteger(value as string|number|bigint):value])));}
function object(value:unknown){if(!value||typeof value!=='object'||Array.isArray(value))throw new HttpError(400,'ساختار سند معتبر نیست.');return value as Record<string,unknown>;}
const reply=(value:unknown)=>Response.json(value,{headers:{'Cache-Control':'no-store'}});
export async function postgresAccountingHttp(req:NextRequest){
 try{
  const write=req.method==='POST',context=await postgresFinancialRequest(req,write?'finance.manage':'finance.view'),{database:db,schema,token,branchId,scope}=context,q=req.nextUrl.searchParams,t=(name:string)=>postgresRelation(schema,name);
  if(write){
   const b=await readRequestJson(req),action=String(b.action??''),key=req.headers.get('idempotency-key');
   const supported=['initialize_chart','create_account','create_period','period_state','draft','post','reverse','edit_draft','void_draft','review_event','propose_policy','approve_policy','disable_policy'];
   if(!supported.includes(action))throw new HttpError(503,'این گردش حسابداری هنوز برای PostgreSQL فعال نشده است؛ هیچ تغییری انجام نشد.');
   const targetTable=['post','reverse','edit_draft','void_draft'].includes(action)?'accounting_journals':action==='review_event'?'accounting_events':['approve_policy','disable_policy'].includes(action)?'accounting_recognition_policies':null;
   let branch=branchId??scope.session.user.branch_id;
   if(targetTable){const row=(await db.query(`SELECT branch_id FROM ${t(targetTable)} WHERE id=$1 AND ($2::bigint IS NULL OR branch_id=$2)`,[validateId(b.id),branchId])).rows[0];if(!row)throw new HttpError(404,'رکورد مالی یافت نشد.');branch=safePostgresInteger(row.branch_id);}
   if(['draft','propose_policy'].includes(action)&&b.branch_id!=null){const requested=validateId(b.branch_id);if(branchId!=null&&requested!==branchId)throw new HttpError(403,'شعبهٔ سند مجاز نیست.');branch=requested;}
   if(branch==null)throw new HttpError(409,'شعبهٔ سند را انتخاب کنید.');
   return reply(await postgresDurableOperation(db,schema,token,{permission:'finance.manage',branchId:branch,operation:'accounting',scope:'business',key,payload:b,legacyJsonResponse:true},async()=>{
    switch(action){
     case 'initialize_chart':return postgresInitializeChart(db,schema,token);
     case 'create_account':return postgresCreateAccount(db,schema,token,object(b.account) as Parameters<typeof postgresCreateAccount>[3]);
     case 'create_period':return postgresCreatePeriod(db,schema,token,object(b.period) as Parameters<typeof postgresCreatePeriod>[3]);
     case 'period_state':return postgresSetPeriodState(db,schema,token,validateId(b.id),b.status as 'open'|'closed',String(b.reason??''));
     case 'draft':return postgresCreateManualJournal(db,schema,token,{branch_id:branch!,posting_date:b.posting_date,memo:b.memo,lines:b.lines,event_key:'manual:'+scope.session.user.id+':'+key,source_type:'manual',source_id:String(scope.session.user.id)} as JournalInput);
     case 'post':if(typeof b.expected_hash!=='string'||!/^[a-f0-9]{64}$/.test(b.expected_hash))throw new HttpError(400,'نسخهٔ مورد تأیید پیش‌نویس لازم است.');return postgresPostManualJournal(db,schema,token,validateId(b.id),{branch_id:branch,expectedHash:b.expected_hash});
     case 'edit_draft':return postgresEditManualJournal(db,schema,token,validateId(b.id),b as Parameters<typeof postgresEditManualJournal>[4]);
     case 'void_draft':return postgresVoidManualJournal(db,schema,token,validateId(b.id),String(b.reason??''));
     case 'reverse':return postgresReverseManualJournal(db,schema,token,validateId(b.id),String(b.posting_date??''),String(b.reason??''));
     case 'review_event':return reviewPostgresFinancialEvent(db,schema,token,validateId(b.id),b as Parameters<typeof reviewPostgresFinancialEvent>[4]);
     case 'propose_policy':return postgresProposeRecognitionPolicy(db,schema,token,{...b,branch_id:branch} as Parameters<typeof postgresProposeRecognitionPolicy>[3]);
     case 'approve_policy':return postgresChangeRecognitionPolicy(db,schema,token,validateId(b.id),'approve');
     case 'disable_policy':return postgresChangeRecognitionPolicy(db,schema,token,validateId(b.id),'disable');
    }
    throw new HttpError(400,'عملیات حسابداری معتبر نیست.');
   }));
  }
  if(!['GET','HEAD'].includes(req.method))throw new HttpError(405,'روش درخواست مجاز نیست.');
  const to=q.get('to')??new Date().toISOString().slice(0,10),from=q.get('from')??to.slice(0,4)+'-01-01',view=q.get('view');
  if(view==='cases'||view==='reconciliation')throw new HttpError(503,'این گزارش هنوز به منابع کامل PostgreSQL متصل نشده است؛ نتیجهٔ ناقص نمایش داده نمی‌شود.');
  return await db.transaction(async()=>{
   if(view==='setup'){
    if(!['owner','admin'].includes(scope.session.user.role))throw new HttpError(403,'تنظیم حسابداری فقط برای مدیر مجاز است.');
    const branch=branchId??scope.session.user.branch_id;if(branch==null)throw new HttpError(409,'شعبه را انتخاب کنید.');
    return reply({branch_id:branch,actor_id:scope.session.user.id,templates:recognitionTemplates,control_codes:['1000','1020','1100','1110','2000','2010','2030'],policies:publicRows((await db.query(`SELECT * FROM ${t('accounting_recognition_policies')} WHERE branch_id=$1 ORDER BY id DESC LIMIT 100`,[branch])).rows),openings:publicRows((await db.query(`SELECT * FROM ${t('accounting_opening_documents')} WHERE branch_id=$1 ORDER BY id DESC LIMIT 50`,[branch])).rows),opening_state:'postgres_restore_workflow_incomplete'});
   }
   if(view==='ledger')return reply(await postgresGeneralLedger(db,schema,token,{account_code:q.get('account')??'',from,to,branch_id:branchId,after:Number(q.get('after')??0),limit:100}));
   if(view==='journal'){
    const id=validateId(q.get('journal_id')),header=(await db.query(`SELECT * FROM ${t('accounting_journals')} WHERE id=$1 AND ($2::bigint IS NULL OR branch_id=$2)`,[id,branchId])).rows[0];if(!header)throw new HttpError(404,'سند یافت نشد.');
    const lines=(await db.query(`SELECT * FROM ${t('accounting_lines')} WHERE journal_id=$1 ORDER BY position LIMIT 500`,[id])).rows,cancellation=(await db.query(`SELECT * FROM ${t('accounting_journal_voids')} WHERE journal_id=$1`,[id])).rows[0],source=header.source_type==='financial_event'?(await db.query(`SELECT payload_json FROM ${t('accounting_events')} WHERE id=$1 AND branch_id=$2`,[header.source_id,header.branch_id])).rows[0]:null;
    return reply({header:{...publicRows([header])[0],voided:!!cancellation},cancellation:cancellation?publicRows([cancellation])[0]:null,lines:publicRows(lines),source:source?JSON.parse(String(source.payload_json)):null});
   }
   const before=Number(q.get('before')??0),after=Number(q.get('events_after')??0),source=q.get('event_source')??'',sourceId=q.has('event_source_id')?String(validateId(q.get('event_source_id'))):null;
   if(!Number.isSafeInteger(before)||before<0||!Number.isSafeInteger(after)||after<0||source.length>30||source.includes('\0'))throw new HttpError(400,'فیلتر یا صفحه‌بندی معتبر نیست.');
   const journals=(await db.query(`SELECT j.*,EXISTS(SELECT 1 FROM ${t('accounting_journal_voids')} v WHERE v.journal_id=j.id) voided,(SELECT SUM(debit) FROM ${t('accounting_lines')} WHERE journal_id=j.id) amount FROM ${t('accounting_journals')} j WHERE ($1::bigint=0 OR j.id<$1) AND ($2::bigint IS NULL OR j.branch_id=$2) ORDER BY j.id DESC LIMIT 51`,[before,branchId])).rows;
   const events=(await db.query(`SELECT e.*,r.journal_id FROM ${t('accounting_events')} e LEFT JOIN ${t('accounting_event_reviews')} r ON r.event_id=e.id WHERE r.event_id IS NULL AND e.id>$1 AND ($2::bigint IS NULL OR e.branch_id=$2) AND ($3::text='' OR e.source_type=$3) AND ($4::text IS NULL OR e.source_id=$4) AND (e.payload_json::jsonb->>'control_amount')::numeric>0 AND NOT EXISTS(SELECT 1 FROM ${t('accounting_opening_event_links')} ol WHERE ol.event_id=e.id) ORDER BY e.id LIMIT 51`,[after,branchId,source,sourceId])).rows;
   return reply({trial:await postgresTrialBalance(db,schema,token,{branch_id:branchId,from,to}),statements:await postgresFinancialStatements(db,schema,token,{branch_id:branchId,from,to}),journals:publicRows(journals.slice(0,50)),next:journals.length>50?safePostgresInteger(journals[49].id):null,events:publicRows(events.slice(0,50)),nextEvent:events.length>50?safePostgresInteger(events[49].id):null,corrections:publicRows((await db.query(`SELECT id,invoice_id,branch_id,expected_paid,status,proposed_by,approved_by,backup_sha256,created_at,applied_at,reason FROM ${t('financial_corrections')} WHERE ($1::bigint IS NULL OR branch_id=$1) ORDER BY id DESC LIMIT 50`,[branchId])).rows),lines:[],periods:publicRows((await db.query(`SELECT * FROM ${t('accounting_periods')} ORDER BY start_date DESC LIMIT 100`)).rows),mode:'review_required',canManage:hasPerm(context.permissions,'finance.manage'),canAdmin:hasPerm(context.permissions,'finance.manage')&&['owner','admin'].includes(scope.session.user.role),recordBranch:branchId??scope.session.user.branch_id,actorId:scope.session.user.id});
  },{isolation:'repeatable read',readOnly:true});
 }catch(error){return postgresFailure(error);}
}
