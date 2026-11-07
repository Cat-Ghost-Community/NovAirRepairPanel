import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresRepairWorkflowHttp} from '@/lib/db/pg-repair-workflow-http';
import {NextRequest} from 'next/server';
import {requireSession,ok,fail} from '@/lib/api';
import {availableRepairs} from '@/lib/repair-assign';
export function GET(req:NextRequest){if(postgresIntegration())return postgresRepairWorkflowHttp(req,'available');try{const session=requireSession(req);return ok(availableRepairs(session,{q:req.nextUrl.searchParams.get('q')??'',page:req.nextUrl.searchParams.get('page')??undefined}));}catch(error){return fail(error);}}
