import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresRepairWorkflowHttp} from '@/lib/db/pg-repair-workflow-http';
import {NextRequest} from 'next/server';
import {requireSession,ok,fail} from '@/lib/api';
import {recordBranchId,BRANCH_COOKIE} from '@/lib/branch';
import {getDb} from '@/lib/db/schema';
import {repairWorkflow,canAssignRepair} from '@/lib/repair-workflow';
export function GET(req:NextRequest){if(postgresIntegration())return postgresRepairWorkflowHttp(req,'workflow');try{const session=requireSession(req),branch=recordBranchId(session,req.cookies.get(BRANCH_COOKIE)?.value);return ok({branch_id:branch,...repairWorkflow(getDb(),branch),can_assign:canAssignRepair(session,branch)});}catch(error){return fail(error);}}
