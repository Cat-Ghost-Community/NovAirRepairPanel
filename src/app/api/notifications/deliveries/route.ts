import type {NextRequest} from 'next/server';
import {requireSession,fail,ok} from '@/lib/api';
import {getDb} from '@/lib/db/schema';
import {activeBranch,BRANCH_COOKIE} from '@/lib/branch';
import {claimNotificationDeliveries} from '@/lib/notification-delivery';
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresFinancialRequest} from '@/lib/db/pg-financial-http';
import {postgresFailure} from '@/lib/db/pg-http';
import {claimPostgresNotifications} from '@/lib/db/pg-notification-delivery';

export async function POST(req:NextRequest){
 try{
  if(postgresIntegration()){
   const {database,schema,token,branchId}=await postgresFinancialRequest(req,undefined);
   return Response.json({notifications:await claimPostgresNotifications(database,schema,token,branchId)},{headers:{'Cache-Control':'no-store'}});
  }
  const session=requireSession(req),branch=activeBranch(session,req.cookies.get(BRANCH_COOKIE)?.value).branchId;
  return ok({notifications:claimNotificationDeliveries(getDb(),session,branch)});
 }catch(error){return postgresIntegration()?postgresFailure(error):fail(error);}
}
