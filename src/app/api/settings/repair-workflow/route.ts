import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresRepairWorkflowHttp} from '@/lib/db/pg-repair-workflow-http';
import {atomic} from '@/lib/db/transaction';
import {assertRequestSession} from '@/lib/api';
import {NextRequest} from 'next/server';
import {requireSession,requirePerm,readJson,ok,fail,validate} from '@/lib/api';
import {getDb} from '@/lib/db/schema';
import {workflowSettings,saveWorkflow} from '@/lib/repair-workflow';
export const dynamic='force-dynamic';
export function GET(req:NextRequest){if(postgresIntegration())return postgresRepairWorkflowHttp(req,'settings');try{const session=requireSession(req);requirePerm(session,'settings.view');return ok(workflowSettings(getDb(),session,validate.id(req.nextUrl.searchParams.get('branch_id'),'شعبه'),req.nextUrl.searchParams.get('employee_q')??'',Number(req.nextUrl.searchParams.get('employee_page')??1)));}catch(error){return fail(error);}}
export async function POST(req:NextRequest){if(postgresIntegration())return postgresRepairWorkflowHttp(req,'settings');try{const session=requireSession(req);requirePerm(session,'settings.edit');const body=await readJson(req);return atomic(getDb(),()=>{assertRequestSession(req);return ok(saveWorkflow(getDb(),session,{branch_id:validate.id(body.branch_id,'شعبه'),mode:body.mode,revision:body.revision,supervisors:body.supervisors,key:req.headers.get('idempotency-key')}));});}catch(error){return fail(error);}}
