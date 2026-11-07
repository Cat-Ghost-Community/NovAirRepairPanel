import type {NextRequest} from 'next/server';
import {HttpError} from '../http-error';
import {readRequestJson} from '../request-json';
import {postgresFinancialRequest} from './pg-financial-http';
import {postgresFailure} from './pg-http';
import {pgId} from './pg-customer-finance';
import {DuplicatePostgresDevice,PostgresDevicesRepository,PostgresSuppliersRepository,mutatePostgresCustomer} from './pg-operational-profiles';
import {mergePostgresCustomer,postgresCustomerMergeHistory} from './pg-customer-merge';

export async function postgresOperationalHttp(req:NextRequest,kind:'devices'|'suppliers'|'customer-profile',id?:number){
 try{
  const write=req.method==='POST';
  const permission=kind==='customer-profile'?write?'customers.edit':'customers.view':kind==='suppliers'?write?'suppliers.manage':'suppliers.view':write?'devices.create':'devices.view';
  const {database,schema,token,branchId}=await postgresFinancialRequest(req,permission),q=req.nextUrl.searchParams;
  if(write){
   const body=await readRequestJson(req),key=req.headers.get('idempotency-key');
   if(kind==='customer-profile'){
    if(body.action==='merge_into'){
     if(Object.keys(body).some(field=>!['action','target_id'].includes(field)))throw new HttpError(400,'فیلد ادغام معتبر نیست.');
     return Response.json(await mergePostgresCustomer(database,schema,token,branchId,pgId(id),pgId(body.target_id),key),{headers:{'Cache-Control':'no-store'}});
    }
    return Response.json(await mutatePostgresCustomer(database,schema,token,branchId,pgId(id),body,key));
   }
   const repository=kind==='devices'?new PostgresDevicesRepository(database,schema):new PostgresSuppliersRepository(database,schema);
   return Response.json(await repository.create(token,branchId,body,key));
  }
  if(!['GET','HEAD'].includes(req.method))throw new HttpError(405,'روش درخواست معتبر نیست.');
  if(kind==='customer-profile'){
   if(q.get('view')!=='merge_history')throw new HttpError(400,'نمای سوابق معتبر نیست.');
   return Response.json(await postgresCustomerMergeHistory(database,schema,token,branchId,pgId(id),Number(q.get('page')??1)),{headers:{'Cache-Control':'no-store'}});
  }
  const query={page:Number(q.get('page')??1),perPage:Number(q.get('perPage')??(q.has('customer_id')?200:q.get('q')?20:50)),q:q.get('q')??'',type:q.get('type')??undefined,customer_id:q.has('customer_id')?pgId(q.get('customer_id')):undefined};
  const result=kind==='devices'?await new PostgresDevicesRepository(database,schema).list(token,branchId,query):await new PostgresSuppliersRepository(database,schema).list(token,branchId,query);
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(error){
  if(error instanceof DuplicatePostgresDevice)return Response.json({error:error.message,duplicate:true,duplicates:error.duplicates},{status:409});
  return postgresFailure(error);
 }
}
