import type {NextRequest} from 'next/server';
import {HttpError} from '../http-error';
import {readRequestJson} from '../request-json';
import {postgresFinancialRequest} from './pg-financial-http';
import {postgresFailure} from './pg-http';
import {requirePostgresIdentity} from './pg-app-auth';
import {postgresRelation} from './postgres-auth';
import {postgresDurableOperation} from './postgres-operations';
import {pgId,pgRecord,pgText,postgresFinancialAudit,scopeFor} from './pg-customer-finance';
import {safePostgresInteger,type PostgresDatabase} from './postgres';

export async function listPostgresBranches(db:PostgresDatabase,schema:string,token:string|undefined,branch:number|null,page=1){
 if(!Number.isSafeInteger(page)||page<1||page>100000)throw new HttpError(400,'صفحه معتبر نیست.');
 return db.transaction(async()=>{
  const scope=await requirePostgresIdentity(db,schema,token,undefined,branch),t=(name:string)=>postgresRelation(schema,name);
  const total=safePostgresInteger((await db.query(`SELECT COUNT(*) n FROM ${t('branches')} WHERE ($1::bigint IS NULL OR id=$1)`,[scope.branchId])).rows[0].n);
  const rows=(await db.query(`SELECT b.*,COALESCE(staff.staff_count,0) staff_count,COALESCE(repairs.open_repairs,0) open_repairs FROM ${t('branches')} b LEFT JOIN (SELECT branch_id,COUNT(*) staff_count FROM ${t('users')} WHERE is_active=1 GROUP BY branch_id) staff ON staff.branch_id=b.id LEFT JOIN (SELECT t.branch_id,COUNT(*) open_repairs FROM ${t('repair_tickets')} t JOIN ${t('repair_statuses')} s ON s.id=t.status_id WHERE s.is_open=1 GROUP BY t.branch_id) repairs ON repairs.branch_id=b.id WHERE ($1::bigint IS NULL OR b.id=$1) ORDER BY b.id LIMIT 100 OFFSET $2`,[scope.branchId,(page-1)*100])).rows;
  return {branches:rows.map(row=>({...row,id:safePostgresInteger(row.id),name:String(row.name),is_active:row.is_active==null?null:safePostgresInteger(row.is_active),staff_count:safePostgresInteger(row.staff_count),open_repairs:safePostgresInteger(row.open_repairs)})),page,total,totalPages:Math.max(1,Math.ceil(total/100)),hasMore:page*100<total};
 },{isolation:'repeatable read'});
}
export async function mutatePostgresBranch(db:PostgresDatabase,schema:string,token:string|undefined,branch:number|null,method:'POST'|'PATCH',payload:unknown,key:string|null){
 const body=pgRecord(payload),actor=await requirePostgresIdentity(db,schema,token,'settings.edit',branch);
 if(!['owner','admin'].includes(actor.session.user.role))throw new HttpError(403,'مدیریت شعبه‌ها فقط برای مدیر شرکت مجاز است.');
 const allowed=['name','code','address','city','phone',...(method==='PATCH'?['id']:[])];if(Object.keys(body).some(key=>!allowed.includes(key)))throw new HttpError(400,'فیلد شعبه معتبر نیست.');
 const fields:Record<string,unknown>={};for(const name of ['name','code','address','city','phone'])if(Object.hasOwn(body,name))fields[name]=pgText(body[name],name==='address'?1000:name==='code'?40:160);
 if(method==='POST'&&!fields.name||Object.hasOwn(fields,'name')&&!fields.name||Object.hasOwn(fields,'code')&&!fields.code)throw new HttpError(400,'نام و کد شعبه نباید خالی باشند.');
 if(method==='POST'&&!fields.code)fields.code=String(fields.name).slice(0,3).toUpperCase();
 const target=method==='PATCH'?pgId(body.id):await scopeFor(db,schema,token,'settings.edit',branch),t=(name:string)=>postgresRelation(schema,name);
 return postgresDurableOperation(db,schema,token??'',{permission:'settings.edit',branchId:target,operation:'branch.'+(method==='POST'?'create':'update'),key,payload},async scope=>{
  if(!['owner','admin'].includes(scope.session.user.role))throw new HttpError(403,'مدیریت شعبه‌ها فقط برای مدیر شرکت مجاز است.');
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1),169013)',[schema]);
  if(method==='PATCH'&&!(await db.query(`SELECT id FROM ${t('branches')} WHERE id=$1 FOR UPDATE`,[target])).rowCount)throw new HttpError(404,'شعبه یافت نشد.');
  const keys=Object.keys(fields);if(!keys.length)throw new HttpError(400,'تغییری برای ثبت وجود ندارد.');
  const result=method==='POST'?await db.query(`INSERT INTO ${t('branches')}(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING id`,Object.values(fields)):await db.query(`UPDATE ${t('branches')} SET ${keys.map((key,i)=>'"'+key+'"=$'+(i+1)).join(',')} WHERE id=$${keys.length+1} RETURNING id`,[...Object.values(fields),target]);
  const id=safePostgresInteger(result.rows[0].id);await postgresFinancialAudit(db,schema,{...scope,branchId:id},method==='POST'?'create':'edit','branch',id,{fields:keys});return method==='POST'?{id}:{done:true};
 });
}
export async function postgresBranchesHttp(req:NextRequest){
 try{
  const write=['POST','PATCH'].includes(req.method),{database,schema,token,branchId}=await postgresFinancialRequest(req,write?'settings.edit':undefined);
  const result=write?await mutatePostgresBranch(database,schema,token,branchId,req.method as 'POST'|'PATCH',await readRequestJson(req),req.headers.get('idempotency-key')):await listPostgresBranches(database,schema,token,branchId,Number(req.nextUrl.searchParams.get('page')??1));
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(error){return postgresFailure(error);}
}
