import type {NextRequest} from 'next/server';
import {HttpError} from '../http-error';
import {isSameOriginMutation} from '../request-security';
import {readyApplicationPostgres} from './pg-application';
import {PostgresCustomersRepository,DuplicatePostgresCustomer,requestedPostgresBranch} from './pg-customers';
import {loadPostgresIdentity} from './pg-app-auth';
import {postgresCookieBranch} from './pg-branch';
import {readRequestJson} from '../request-json';

export function postgresFailure(error:unknown){
 if(error instanceof DuplicatePostgresCustomer)return Response.json({error:error.message,duplicate:true,duplicates:error.duplicates},{status:409});
 if(error instanceof HttpError)return Response.json({error:error.message},{status:error.status,headers:error.status===429?{'Retry-After':'300'}:undefined});
 const raw=(error as {code?:unknown})?.code,code=typeof raw==='string'&&/^[A-Z0-9]{5}$/.test(raw)?raw:'UNKNOWN';
 console.error(JSON.stringify({component:'postgres-application',code}));
 if(['40001','40P01','55P03','57014','57P01','53300'].includes(code))return Response.json({error:'پایگاه داده مشغول است؛ درخواست را با همان شناسه دوباره بررسی کنید.',code:'DATABASE_BUSY'},{status:503,headers:{'Retry-After':'1'}});
 if(code==='23505')return Response.json({error:'این اطلاعات قبلاً ثبت شده است.'},{status:409});
 if(code==='23503'||code==='23514')return Response.json({error:'عملیات با قواعد داده یا وضعیت فعلی سازگار نیست.'},{status:409});
 return Response.json({error:'عملیات پایگاه داده انجام نشد؛ دوباره بررسی کنید.'},{status:500});
}
export async function postgresCustomersHttp(req:NextRequest,id?:number){
 try{
  if(!isSameOriginMutation(req))throw new HttpError(403,'درخواست از منبع غیرمجاز رد شد.');
  const {database,schema}=await readyApplicationPostgres(),repository=new PostgresCustomersRepository(database,schema),token=req.cookies.get('repaid_session')?.value;
  const identity=await loadPostgresIdentity(database,schema,token);if(!identity)throw new HttpError(401,'نشست معتبر نیست.');
  const cookie=req.cookies.get('repaid_branch')?.value;
  const explicit=req.nextUrl.searchParams.get('branch_id'),branch=explicit!=null?requestedPostgresBranch(explicit):await postgresCookieBranch(database,schema,identity.session,cookie);
  if(req.method==='GET'||req.method==='HEAD'){
   if(id!=null)return Response.json({customer:await repository.get(token,branch,id)},{headers:{'Cache-Control':'no-store'}});
   const search=req.nextUrl.searchParams,q=search.get('q')??'',perPage=search.has('perPage')?Number(search.get('perPage')):q?8:50;
   return Response.json(await repository.list(token,branch,{q,page:Number(search.get('page')??1),perPage,type:search.get('type')??undefined,vip:search.get('vip')??undefined,blacklist:search.get('blacklist')??undefined}),{headers:{'Cache-Control':'no-store'}});
  }
  if(req.method!=='POST'||id!=null)throw new HttpError(405,'این روش برای این مسیر مجاز نیست.');
  const body=await readRequestJson(req);
  return Response.json(await repository.create(token,branch,body,req.headers.get('idempotency-key')),{headers:{'Cache-Control':'no-store'}});
 }catch(error){return postgresFailure(error);}
}
