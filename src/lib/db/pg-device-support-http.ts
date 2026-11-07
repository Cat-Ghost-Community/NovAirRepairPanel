import type {NextRequest} from 'next/server';
import {HttpError} from '../http-error';
import {readRequestJson} from '../request-json';
import {postgresFinancialRequest} from './pg-financial-http';
import {postgresFailure} from './pg-http';
import {pgId} from './pg-customer-finance';
import {postgresDeviceCheck,postgresDeviceBlacklist,postgresAddDeviceBlacklist,postgresRevokeDeviceBlacklist,postgresServiceReminders,postgresSetServiceReminder} from './pg-device-support';
export async function postgresDeviceSupportHttp(req:NextRequest,kind:'check'|'blacklist'|'service-reminders'){
 try{
 const write=!['GET','HEAD'].includes(req.method),permission=write?'devices.edit':kind==='check'?'repairs.view':'devices.view';
 const {database,schema,token,branchId}=await postgresFinancialRequest(req,permission),q=req.nextUrl.searchParams,key=req.headers.get('idempotency-key');
 let result:unknown;
 if(!write){
 if(kind==='check')result=await postgresDeviceCheck(database,schema,token,branchId,{serial:q.get('serial')??'',imei:q.get('imei')??''});
 else if(kind==='blacklist')result=await postgresDeviceBlacklist(database,schema,token,branchId,Number(q.get('page')??1),Number(q.get('perPage')??50));
 else result=await postgresServiceReminders(database,schema,token,branchId,Number(q.get('page')??1),Number(q.get('perPage')??50));
 }else if(kind==='blacklist'&&req.method==='DELETE')result=await postgresRevokeDeviceBlacklist(database,schema,token,branchId,pgId(q.get('id')),key);
 else if(req.method==='POST'&&kind==='check')result=await postgresAddDeviceBlacklist(database,schema,token,branchId,await readRequestJson(req),key);
 else if(req.method==='POST'&&kind==='service-reminders')result=await postgresSetServiceReminder(database,schema,token,branchId,await readRequestJson(req),key);
 else throw new HttpError(405,'روش درخواست معتبر نیست.');
 return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(error){return postgresFailure(error);}
}
