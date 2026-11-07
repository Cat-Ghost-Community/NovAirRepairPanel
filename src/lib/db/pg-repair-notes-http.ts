import type {NextRequest} from 'next/server';
import {HttpError} from '../http-error';
import {readRequestJson} from '../request-json';
import {postgresFinancialRequest} from './pg-financial-http';
import {postgresFailure} from './pg-http';
import {PostgresRepairNotes} from './pg-repair-notes';
import {pgId} from './pg-customer-finance';
export async function postgresRepairNotesHttp(req:NextRequest,ticketId:number){try{const mutation=req.method==='POST',{database,schema,token,branchId}=await postgresFinancialRequest(req,mutation?'repairs.notes':'repairs.view'),service=new PostgresRepairNotes(database,schema),id=pgId(ticketId);if(mutation)return Response.json(await service.create(token,branchId,id,await readRequestJson(req),req.headers.get('idempotency-key')));if(req.method==='GET'||req.method==='HEAD'){const p=req.nextUrl.searchParams;return Response.json(await service.list(token,branchId,id,{q:p.has('q')?p.get('q')??'':undefined,page:Number(p.get('page')??1),perPage:Number(p.get('perPage')??20),similar:p.has('q')}),{headers:{'Cache-Control':'no-store'}});}throw new HttpError(405,'روش درخواست پشتیبانی نمی‌شود.');}catch(error){return postgresFailure(error);}}
