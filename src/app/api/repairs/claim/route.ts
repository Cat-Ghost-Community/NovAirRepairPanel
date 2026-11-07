import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresRepairWorkflowHttp} from '@/lib/db/pg-repair-workflow-http';
import {atomic} from '@/lib/db/transaction';
import {assertRequestSession as recheckSession} from '@/lib/api';
import {NextRequest} from 'next/server';
import {requireSession,requirePerm,readJson,ok,fail,validate} from '@/lib/api';
import {getDb} from '@/lib/db/schema';
import {activeBranch} from '@/lib/branch';
import {durableOperation} from '@/lib/idempotency';
import {changeRepairAssignment,currentWorkflowActor} from '@/lib/repair-workflow';
export async function POST(req:NextRequest){if(postgresIntegration())return postgresRepairWorkflowHttp(req,'claim');try{
 const session=requireSession(req);requirePerm(session,'repairs.view');const body=await readJson(req),db=getDb();currentWorkflowActor(db,session);
 const id=validate.id(body.ticket_id),branch=Number(activeBranch(session).branchId);
 return atomic(db,()=>{recheckSession(req);currentWorkflowActor(db,session);
 const result=durableOperation(db,{actorId:session.user.id,branchId:branch,operation:'repair.claim',key:req.headers.get('idempotency-key'),payload:body},()=>changeRepairAssignment(db,session,{ticketId:id,targetId:session.user.id,expect:null,version:body.version,workflowRevision:body.workflow_revision,claim:true}));
 return ok(result);
 });
}catch(error){return fail(error);}}
