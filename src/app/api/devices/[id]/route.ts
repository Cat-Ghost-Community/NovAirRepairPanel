import type {NextRequest} from 'next/server';
import {getDb} from '@/lib/db/schema';
import {requireSession,requirePerm,readJson,ok,fail,validate,audit,HttpError} from '@/lib/api';
import {assertBranchResource,assertBranchProfileWrite} from '@/lib/branch-access';
import {BRANCH_COOKIE} from '@/lib/branch';
import {atomic} from '@/lib/db/transaction';
import {readDeviceCatalog} from '@/lib/device-catalog-store';
import {deviceProfileChanges} from '@/lib/device-profile';
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresFinancialRequest} from '@/lib/db/pg-financial-http';
import {postgresFailure} from '@/lib/db/pg-http';
import {PostgresDevicesRepository} from '@/lib/db/pg-operational-profiles';
import {updatePostgresDevice} from '@/lib/db/pg-device-profile';
import {readRequestJson} from '@/lib/request-json';

export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{
  const id=validate.id((await params).id);
  if(postgresIntegration()){
   const {database,schema,token,branchId}=await postgresFinancialRequest(req,'devices.view');
   const result=await new PostgresDevicesRepository(database,schema).detail(token,branchId,id);
   return Response.json({device:result.device,catalog:result.catalog},{headers:{'Cache-Control':'no-store'}});
  }
  const session=requireSession(req);requirePerm(session,'devices.view');const db=getDb();assertBranchResource(db,session,req.cookies.get(BRANCH_COOKIE)?.value,'device',id);
  const device=db.prepare('SELECT * FROM devices WHERE id=? AND is_archived=0').get(id);if(!device)throw new HttpError(404,'دستگاه یافت نشد.');
  return ok({device,catalog:readDeviceCatalog(db)});
 }catch(error){return postgresIntegration()?postgresFailure(error):fail(error);}
}
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{
  const id=validate.id((await params).id);
  if(postgresIntegration()){
   const {database,schema,token,branchId}=await postgresFinancialRequest(req,'devices.edit');
   return Response.json(await updatePostgresDevice(database,schema,token,branchId,id,await readRequestJson(req),req.headers.get('idempotency-key')));
  }
  const session=requireSession(req);requirePerm(session,'devices.edit');const body=await readJson(req),db=getDb();
  return atomic(db,()=>{
   assertBranchProfileWrite(db,session,req.cookies.get(BRANCH_COOKIE)?.value,'device',id);
   const before=db.prepare('SELECT * FROM devices WHERE id=? AND is_archived=0').get(id);if(!before)throw new HttpError(404,'دستگاه یافت نشد.');
   if(Object.hasOwn(body,'expected_updated_at')&&body.expected_updated_at!==(before.updated_at??null))throw new HttpError(409,'مشخصات دستگاه تغییر کرده است؛ دوباره باز کنید.');
   const changes=deviceProfileChanges(readDeviceCatalog(db),before,body);changes.updated_at=new Date().toISOString();
   const fields=Object.keys(changes);db.prepare(`UPDATE devices SET ${fields.map(field=>'"'+field+'"=?').join(',')} WHERE id=?`).run(...Object.values(changes),id);
   audit(session,'update','device',id,before,changes);return ok({ok:true,id});
  });
 }catch(error){return postgresIntegration()?postgresFailure(error):fail(error);}
}
