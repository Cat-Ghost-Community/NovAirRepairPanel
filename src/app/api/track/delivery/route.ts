import type {NextRequest} from 'next/server';
import {isIP} from 'node:net';
import {fail,ok,readJson,HttpError} from '@/lib/api';
import {getDb} from '@/lib/db/schema';
import {resolveTrackingToken,trackingRateLimit} from '@/lib/tracking';
import {signTrackedDelivery} from '@/lib/delivery-signature';
import {isSameOriginMutation} from '@/lib/request-security';

export async function POST(req:NextRequest){
 try{
  if(!isSameOriginMutation(req))throw new HttpError(403,'درخواست از منبع غیرمجاز رد شد.');
  const body=await readJson(req),ticket=resolveTrackingToken(body.token);
  if(!ticket)throw new HttpError(403,'پیوند پیگیری معتبر نیست یا منقضی شده است.');
  trackingRateLimit('delivery:'+ticket,20);
  const ip=(req.headers.get('x-forwarded-for')??'').split(',')[0].trim();
  return ok(signTrackedDelivery(getDb(),ticket,body,isIP(ip)?ip:null));
 }catch(error){return fail(error);}
}
