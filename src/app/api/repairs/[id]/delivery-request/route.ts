import type {NextRequest} from 'next/server';
import {requireSession,assertRequestSession,fail,ok,validate} from '@/lib/api';
import {getDb} from '@/lib/db/schema';
import {requestDeliverySignature} from '@/lib/delivery-signature';
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {issueTrackingToken} from '@/lib/tracking';
import {getSetting} from '@/lib/repair';

export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{
  if(postgresIntegration())return Response.json({error:'تحویل نهایی از این مسیر هنوز برای PostgreSQL فعال نیست.'},{status:409});
  const session=requireSession(req),id=validate.id((await params).id);assertRequestSession(req);
  const result=requestDeliverySignature(getDb(),session,id,req.cookies.get('repaid_branch')?.value);
  const requestOrigin=new URL(req.nextUrl.origin),host=req.headers.get('host');
  if(host)requestOrigin.host=host;
  const token=issueTrackingToken(id),link=new URL('/track/'+token,getSetting('public_base_url')||process.env.APP_ORIGIN||requestOrigin.origin);
  return ok({...result,tracking_url:link.toString()});
 }catch(error){return fail(error);}
}
