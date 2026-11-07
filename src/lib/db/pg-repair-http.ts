import type {NextRequest} from 'next/server';
import {HttpError} from '../http-error';
import {readRequestJson} from '../request-json';
import {postgresFinancialRequest} from './pg-financial-http';
import {postgresFailure} from './pg-http';
import {createPostgresRepairIntake} from './pg-repair-intake';
import {listPostgresRepairs} from './pg-repair-read';

export async function postgresRepairsHttp(req:NextRequest){
 try{
  const write=req.method==='POST',{database,schema,token,branchId}=await postgresFinancialRequest(req,write?'repairs.create':'repairs.view');
  if(write)return Response.json(await createPostgresRepairIntake(database,schema,token,branchId,await readRequestJson(req),req.headers.get('idempotency-key')),{headers:{'Cache-Control':'no-store'}});
  if(!['GET','HEAD'].includes(req.method))throw new HttpError(405,'روش درخواست پشتیبانی نمی‌شود.');
  const q=req.nextUrl.searchParams;
  return Response.json(await listPostgresRepairs(database,schema,token,branchId,{page:Number(q.get('page')??1),perPage:Number(q.get('perPage')??q.get('limit')??100),q:q.get('q')??'',status:q.get('status')??'',mine:q.get('mine')==='1',delayed:q.get('delayed')==='1'}),{headers:{'Cache-Control':'no-store'}});
 }catch(error){return postgresFailure(error);}
}
