import type {NextRequest} from 'next/server';
import {requireSession,requirePerm,readJson,ok,fail} from '@/lib/api';
import {getDb} from '@/lib/db/schema';
import {readDeviceCatalog,saveDeviceCatalog} from '@/lib/device-catalog-store';
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresFinancialRequest} from '@/lib/db/pg-financial-http';
import {readPostgresDeviceCatalog,savePostgresDeviceCatalog} from '@/lib/db/pg-device-catalog';
import {isSameOriginMutation} from '@/lib/request-security';
import {HttpError} from '@/lib/http-error';
import {readRequestJson} from '@/lib/request-json';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){try{
 if(postgresIntegration()){const ctx=await postgresFinancialRequest(req,undefined);return Response.json(await readPostgresDeviceCatalog(ctx.database,ctx.schema),{headers:{'Cache-Control':'no-store'}});}
 requireSession(req);return Response.json(readDeviceCatalog(getDb()),{headers:{'Cache-Control':'no-store'}});
}catch(error){return fail(error);}}
export async function PUT(req:NextRequest){try{
 if(!isSameOriginMutation(req))throw new HttpError(403,'منبع درخواست مجاز نیست.');
 if(postgresIntegration()){const ctx=await postgresFinancialRequest(req,'settings.edit');return ok(await savePostgresDeviceCatalog(ctx.database,ctx.schema,ctx.token,await readRequestJson(req)));}
 const session=requireSession(req);requirePerm(session,'settings.edit');return ok(saveDeviceCatalog(getDb(),session,await readJson(req)));
}catch(error){return fail(error);}}
