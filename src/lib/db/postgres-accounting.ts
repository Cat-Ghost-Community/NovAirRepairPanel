import {DEFAULT_ACCOUNTING_CHART,type AccountClass} from '../accounting-chart';
import {accountingDate} from '../accounting-date';
import {ledgerText} from '../journal-input';
import {HttpError} from '../http-error';
import {validateId} from '../validate-id';
import {recognitionTemplates,type RecognitionKind} from '../recognition-templates';
import {authorizePostgresScope,postgresRelation,type Scope} from './postgres-auth';
import {safePostgresInteger,type PostgresDatabase} from './postgres';

async function administrator(db:PostgresDatabase,schema:string,token:string,branch?:number){
 const scope=await authorizePostgresScope(db,schema,token,'finance.manage',branch??null,true);
 if(!['owner','admin'].includes(scope.session.user.role))throw new HttpError(403,'تغییر ساختار و دورهٔ حسابداری فقط برای مدیر مجاز است.');
 await db.query('SELECT pg_advisory_xact_lock(hashtext($1),19204301)',[schema]);return scope;
}
async function audit(db:PostgresDatabase,schema:string,scope:Scope,action:string,entity:string,id:number|null,before:unknown,after:unknown){await db.query(`INSERT INTO ${postgresRelation(schema,'audit_logs')}(user_id,action,entity,entity_id,branch_id,"before","after") VALUES($1,$2,$3,$4,$5,$6,$7)`,[scope.session.user.id,action,entity,id,scope.branchId??scope.session.user.branch_id,before==null?null:JSON.stringify(before),after==null?null:JSON.stringify(after)]);}
export async function postgresInitializeChart(db:PostgresDatabase,schema:string,token:string){
 return db.transaction(async()=>{const scope=await administrator(db,schema,token),q=postgresRelation(schema,'accounting_accounts');for(const row of DEFAULT_ACCOUNTING_CHART)await db.query(`INSERT INTO ${q}(code,name,classification,normal_side) VALUES($1,$2,$3,$4) ON CONFLICT(code) DO NOTHING`,row);await audit(db,schema,scope,'initialize_chart','accounting',null,null,{codes:DEFAULT_ACCOUNTING_CHART.map(r=>r[0])});return {accounts:DEFAULT_ACCOUNTING_CHART.length};});
}
export async function postgresCreateAccount(db:PostgresDatabase,schema:string,token:string,input:{code:string;name:string;classification:AccountClass;normal_side:string}){
 if(!input||!/^[A-Za-z0-9_-]{2,20}$/.test(input.code)||!['asset','liability','equity','revenue','expense','cogs'].includes(input.classification)||!['debit','credit'].includes(input.normal_side))throw new HttpError(400,'مشخصات سرفصل معتبر نیست.');
 return db.transaction(async()=>{const scope=await administrator(db,schema,token),q=postgresRelation(schema,'accounting_accounts');if((await db.query(`SELECT code FROM ${q} WHERE code=$1`,[input.code])).rowCount)throw new HttpError(409,'کد سرفصل قبلاً ثبت شده است.');await db.query(`INSERT INTO ${q}(code,name,classification,normal_side) VALUES($1,$2,$3,$4)`,[input.code,ledgerText(input.name,'نام سرفصل',150),input.classification,input.normal_side]);await audit(db,schema,scope,'create','accounting_account',null,null,input);return {code:input.code};});
}
export async function postgresCreatePeriod(db:PostgresDatabase,schema:string,token:string,input:{name:string;start_date:string;end_date:string}){
 if(!input)throw new HttpError(400,'مشخصات دوره الزامی است.');const start=accountingDate(input.start_date),end=accountingDate(input.end_date);if(start>end)throw new HttpError(400,'پایان دوره باید پس از آغاز باشد.');
 return db.transaction(async()=>{const scope=await administrator(db,schema,token),q=postgresRelation(schema,'accounting_periods');if((await db.query(`SELECT id FROM ${q} WHERE start_date<=$1 AND end_date>=$2`,[end,start])).rowCount)throw new HttpError(409,'دورهٔ حسابداری هم‌پوشان است.');const row=(await db.query(`INSERT INTO ${q}(name,start_date,end_date,created_by) VALUES($1,$2,$3,$4) RETURNING id`,[ledgerText(input.name,'نام دوره',150),start,end,scope.session.user.id])).rows[0],id=safePostgresInteger(row.id);await audit(db,schema,scope,'create','accounting_period',id,null,{start,end});return {id};});
}
export async function postgresSetPeriodState(db:PostgresDatabase,schema:string,token:string,id:number,status:'open'|'closed',reason:string){
 id=validateId(id);reason=ledgerText(reason,'دلیل تغییر دوره');if(!['open','closed'].includes(status))throw new HttpError(400,'وضعیت دوره معتبر نیست.');
 return db.transaction(async()=>{const scope=await administrator(db,schema,token),q=postgresRelation(schema,'accounting_periods'),row=(await db.query(`SELECT * FROM ${q} WHERE id=$1 FOR UPDATE`,[id])).rows[0];if(!row)throw new HttpError(404,'دوره یافت نشد.');await db.query(`UPDATE ${q} SET status=$1 WHERE id=$2`,[status,id]);await audit(db,schema,scope,'change_state','accounting_period',id,{status:row.status},{status,reason});return {id,status};});
}
export async function postgresProposeRecognitionPolicy(db:PostgresDatabase,schema:string,token:string,input:{branch_id:number;kind:RecognitionKind;effective_date:string;reason:string}){
 if(!input||!Object.hasOwn(recognitionTemplates,input.kind)||typeof input.reason!=='string'||input.reason.trim().length<10||input.reason.length>1000)throw new HttpError(400,'سیاست یا مبنای مستند معتبر نیست.');const branch=validateId(input.branch_id),date=accountingDate(input.effective_date);
 return db.transaction(async()=>{const scope=await administrator(db,schema,token,branch),row=(await db.query(`INSERT INTO ${postgresRelation(schema,'accounting_recognition_policies')}(branch_id,kind,effective_date,reason,proposed_by) VALUES($1,$2,$3,$4,$5) RETURNING id`,[branch,input.kind,date,input.reason.trim(),scope.session.user.id])).rows[0],id=safePostgresInteger(row.id);await audit(db,schema,scope,'propose','accounting_policy',id,null,{branch_id:branch,kind:input.kind,effective_date:date});return {id,status:'proposed'};});
}
export async function postgresChangeRecognitionPolicy(db:PostgresDatabase,schema:string,token:string,id:number,action:'approve'|'disable'){
 return db.transaction(async()=>{const q=(name:string)=>postgresRelation(schema,name),scope=await administrator(db,schema,token),row=(await db.query(`SELECT * FROM ${q('accounting_recognition_policies')} WHERE id=$1 FOR UPDATE`,[validateId(id)])).rows[0];if(!row)throw new HttpError(404,'سیاست یافت نشد.');
  if(action==='approve'){
   if(row.status!=='proposed')throw new HttpError(409,'سیاست در مرحلهٔ تأیید نیست.');if(safePostgresInteger(row.proposed_by)===scope.session.user.id)throw new HttpError(403,'تأیید مستقل سیاست الزامی است.');
   if(!(await db.query(`SELECT id FROM ${q('accounting_opening_documents')} WHERE branch_id=$1 AND status='posted'`,[row.branch_id])).rowCount)throw new HttpError(409,'ابتدا افتتاحیه و نقطهٔ شروع شعبه را تأیید و اجرا کنید.');
   if((await db.query(`SELECT id FROM ${q('accounting_recognition_policies')} WHERE branch_id=$1 AND kind=$2 AND status='approved'`,[row.branch_id,row.kind])).rowCount)throw new HttpError(409,'سیاست فعال قبلی را ابتدا غیرفعال کنید.');
   await db.query(`UPDATE ${q('accounting_recognition_policies')} SET status='approved',approved_by=$1,approved_at=$2,min_event_id=(SELECT COALESCE(MAX(id),0) FROM ${q('accounting_events')}) WHERE id=$3`,[scope.session.user.id,new Date().toISOString(),id]);
  }else{if(action!=='disable'||row.status!=='approved')throw new HttpError(409,'فقط سیاست فعال قابل غیرفعال‌کردن است.');await db.query(`UPDATE ${q('accounting_recognition_policies')} SET status='disabled' WHERE id=$1`,[id]);}
  await audit(db,schema,{...scope,branchId:safePostgresInteger(row.branch_id)},action,'accounting_policy',id,{status:row.status},{status:action==='approve'?'approved':'disabled'});return {id,status:action==='approve'?'approved':'disabled'};
 });
}
