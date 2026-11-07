import {operationHash,operationKey} from '../operation-identity';
import {HttpError} from '../http-error';
import {authorizePostgresScope,postgresRelation} from './postgres-auth';
import {safePostgresInteger,type PostgresDatabase} from './postgres';

/** Read imported immutable operation evidence before new command dispatch.
 * Historical handlers stored both plain values and {status,body} envelopes.
 * Never invent a missing request hash, relink a source or repeat its mutation. */
export async function postgresLegacyFinancialReplay(db:PostgresDatabase,schema:string,token:string,options:{permission:string;branchId:number;operation:string;scope?:'branch'|'business';key:unknown;payload:unknown}){
 const key=operationKey(options.key),hash=operationHash(options.payload),kind=options.scope??'branch';
 return db.transaction(async()=>{
  const actor=await authorizePostgresScope(db,schema,token,options.permission,options.branchId,true);
  const prior=(await db.query(`SELECT branch_id,request_hash,result_json FROM ${postgresRelation(schema,'operation_receipts')} WHERE actor_id=$1 AND operation=$2 AND operation_key=$3 AND scope=$4${kind==='branch'?' AND branch_id=$5':''}`,[actor.session.user.id,options.operation,key,kind,...(kind==='branch'?[options.branchId]:[])])).rows[0];
  if(!prior)return null;
  if(safePostgresInteger(prior.branch_id)!==options.branchId&&!['owner','admin'].includes(actor.session.user.role))throw new HttpError(409,'سابقهٔ درخواست متعلق به شعبهٔ مجاز فعلی نیست.');
  if(prior.request_hash!==hash)throw new HttpError(409,'این شناسه قبلاً برای محتوای دیگری ثبت شده است.');
  const result=JSON.parse(String(prior.result_json));
  if(result&&typeof result==='object'&&!Array.isArray(result)&&typeof result.status==='number'&&Object.keys(result).length===2&&Object.hasOwn(result,'body')){
   if(!Number.isInteger(result.status)||result.status<200||result.status>=300)throw new HttpError(409,'نتیجهٔ تاریخی درخواست به بررسی نیاز دارد.');
   return Response.json(result.body,{status:result.status,headers:{'Cache-Control':'no-store'}});
  }
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 });
}
