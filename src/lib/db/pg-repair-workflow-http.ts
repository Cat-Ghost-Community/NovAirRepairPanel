import type {NextRequest} from 'next/server';
import {HttpError} from '../http-error';
import {readRequestJson} from '../request-json';
import {postgresFinancialRequest} from './pg-financial-http';
import {postgresFailure} from './pg-http';
import {pgId,pgRecord} from './pg-customer-finance';
import {postgresRepairWorkflow,postgresWorkflowSettings,savePostgresWorkflow,postgresAssignmentAuthority} from './pg-repair-workflow';
import {postgresRepairQueues,postgresAssignmentTechnicians,assignPostgresRepairs,claimPostgresRepair} from './pg-repair-assignment';
import type {RepairWorkflowMode} from '../repair-workflow-shared';
export async function postgresRepairWorkflowHttp(req:NextRequest,kind:'settings'|'workflow'|'assignment'|'assign'|'queue'|'available'|'claim'|'technicians'){
 try{
 const write=!['GET','HEAD'].includes(req.method),permission=kind==='settings'?write?'settings.edit':'settings.view':['assign','assignment','technicians'].includes(kind)?'repairs.assign':'repairs.view';
 const ctx=await postgresFinancialRequest(req,permission),{database:db,schema,token,branchId,scope}=ctx,q=req.nextUrl.searchParams,key=req.headers.get('idempotency-key');let result:unknown;
 if(write){if(req.method!=='POST')throw new HttpError(405,'روش درخواست معتبر نیست.');const b=pgRecord(await readRequestJson(req));if(kind==='settings'){await savePostgresWorkflow(db,schema,token,{branch_id:pgId(b.branch_id),mode:b.mode as RepairWorkflowMode,revision:b.revision as number,supervisors:b.supervisors as number[]},key);result=await postgresWorkflowSettings(db,schema,token,pgId(b.branch_id));}else if(kind==='assign')result=await assignPostgresRepairs(db,schema,token,branchId,b,typeof b.operation_key==='string'?b.operation_key:key);else if(kind==='claim')result=await claimPostgresRepair(db,schema,token,branchId,b,key);else throw new HttpError(405,'روش درخواست معتبر نیست.');}
 else if(kind==='settings')result=await postgresWorkflowSettings(db,schema,token,pgId(q.get('branch_id')),q.get('employee_q')??'',Number(q.get('employee_page')??1));
 else if(kind==='workflow'){const target=branchId??scope.session.user.branch_id;if(target==null)throw new HttpError(409,'ابتدا شعبه را انتخاب کنید.');const policy=await postgresRepairWorkflow(db,schema,target);let canAssign=false;try{await postgresAssignmentAuthority(db,schema,scope,target);canAssign=ctx.permissions.includes('repairs.assign')||ctx.permissions.includes('repairs.*')||ctx.permissions.includes('*');}catch(error){if(!(error instanceof HttpError))throw error;}result={branch_id:target,...policy,can_assign:canAssign};}
 else if(kind==='technicians')result=await postgresAssignmentTechnicians(db,schema,token,branchId,{q:q.get('q')??'',page:Number(q.get('page')??1),perPage:Number(q.get('perPage')??50)});
 else if(['assignment','queue','available'].includes(kind))result=await postgresRepairQueues(db,schema,token,branchId,kind==='queue'?'mine':kind==='assignment'?'assignment':'available',{q:q.get('q')??'',page:Number(q.get('page')??1),perPage:q.has('perPage')?Number(q.get('perPage')):undefined,phase:q.get('phase')??undefined,dateFrom:q.get('date_from'),dateTo:q.get('date_to')});
 else throw new HttpError(405,'روش درخواست معتبر نیست.');return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(error){return postgresFailure(error);}
}
