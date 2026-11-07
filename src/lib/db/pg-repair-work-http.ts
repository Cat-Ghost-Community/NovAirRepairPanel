import type {NextRequest} from 'next/server';
import {HttpError} from '../http-error';
import {readRequestJson} from '../request-json';
import {postgresFinancialRequest} from './pg-financial-http';
import {postgresFailure} from './pg-http';
import {pgId,pgRecord} from './pg-customer-finance';
import {mutatePostgresRepairWork,readPostgresRepairTime,type RepairWorkKind} from './pg-repair-work';

export async function postgresRepairWorkHttp(req:NextRequest,ticketId:number,action:'diagnosis'|'checklist'|'status'|'qc'|'start'|'time'){
 try{
  const read=action==='time'&&['GET','HEAD'].includes(req.method),permission=read?'repairs.view':action==='diagnosis'||action==='checklist'?'repairs.edit':action==='time'?'repairs.notes':'repairs.status';
  if(!read&&req.method!=='POST')throw new HttpError(405,'روش درخواست پشتیبانی نمی‌شود.');
  const {database,schema,token,branchId}=await postgresFinancialRequest(req,permission),id=pgId(ticketId);
  if(read)return Response.json(await readPostgresRepairTime(database,schema,token,branchId,id,Number(req.nextUrl.searchParams.get('page')??1)),{headers:{'Cache-Control':'no-store'}});
  const body=pgRecord(await readRequestJson(req));let kind:RepairWorkKind;
  if(action==='time'){
   const timeAction=body.action;if(typeof timeAction!=='string'||!['start','stop','finish','manual'].includes(timeAction))throw new HttpError(400,'عملیات زمان‌سنج معتبر نیست.');
   kind=('time.'+timeAction) as RepairWorkKind;delete body.action;
  }else kind=action;
  return Response.json(await mutatePostgresRepairWork(database,schema,token,branchId,id,kind,body,req.headers.get('idempotency-key')),{headers:{'Cache-Control':'no-store'}});
 }catch(error){return postgresFailure(error);}
}
