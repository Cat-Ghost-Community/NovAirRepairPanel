import type {NextRequest} from 'next/server';
import {readRequestJson} from '../request-json';
import {postgresFinancialRequest} from './pg-financial-http';
import {postgresFailure} from './pg-http';
import {listPostgresNotifications,markPostgresNotifications} from './pg-notifications';
export async function postgresNotificationsHttp(req:NextRequest){
 try{
  if(!['GET','HEAD','POST'].includes(req.method))return Response.json({error:'روش درخواست مجاز نیست.'},{status:405,headers:{Allow:'GET, HEAD, POST'}});
  const {database,schema,token,branchId}=await postgresFinancialRequest(req,undefined),query=req.nextUrl.searchParams;
  const body=req.method==='POST'?await readRequestJson(req):null;
  const value=body?await markPostgresNotifications(database,schema,token,branchId,req.headers.get('idempotency-key'),body as {action:unknown;id?:unknown}):await listPostgresNotifications(database,schema,token,branchId,query.get('page')??1,query.get('limit')??30);
  return Response.json(value,{headers:{'Cache-Control':'no-store'}});
 }catch(error){return postgresFailure(error);}
}
