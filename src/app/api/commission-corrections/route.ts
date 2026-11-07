import {NextRequest} from 'next/server';import {getDb} from '@/lib/db/schema';
import {requireSession,requirePerm,readJson,ok,fail,validate,HttpError} from '@/lib/api';
import {ledgerScope} from '@/lib/accounting';import {durableJsonResponse} from '@/lib/idempotency';import {readSnapshot} from '@/lib/db/transaction';
import {commissionEvidence} from '@/lib/commission-settlement';import {commissionPosition} from '@/lib/commission-position';
import {proposeCommissionCorrection,decideCommissionCorrection,postCommissionCorrection} from '@/lib/commission-corrections';
export async function GET(req:NextRequest){try{
 const session=requireSession(req);requirePerm(session,'finance.view');requirePerm(session,'team.view');const db=getDb(),q=req.nextUrl.searchParams,cookie=req.cookies.get('repaid_branch')?.value;
 const run=validate.id(q.get('run_id')),evidence=commissionEvidence(db,run);ledgerScope(session,Number(evidence.run.branch_id),cookie,'finance.view');
 const page=Number(q.get('page')??1);if(!Number.isSafeInteger(page)||page<1||page>100000)throw new HttpError(400,'صفحهٔ اصلاحات معتبر نیست.');
 return readSnapshot(db,()=>{const rows=db.prepare(`SELECT id,kind,reverses_id,amount,liability_amount,recovery_amount,posting_date,reason,evidence_reference,proposed_by,approved_by,state,settlement_reference,journal_id,
 amount-COALESCE((SELECT SUM(amount) FROM commission_corrections r WHERE r.reverses_id=c.id AND r.state='posted'),0) reversible FROM commission_corrections c WHERE run_id=? ORDER BY id DESC LIMIT 21 OFFSET ?`).all(run,(page-1)*20);
 return ok({run:evidence.run,position:commissionPosition(db,run),operations:rows.slice(0,20),hasMore:rows.length>20,page,actor_id:session.user.id});});
}catch(e){return fail(e);}}
export async function POST(req:NextRequest){try{
 const session=requireSession(req);requirePerm(session,'finance.manage');requirePerm(session,'team.manage');const body=await readJson(req),db=getDb(),cookie=req.cookies.get('repaid_branch')?.value;
 const run=body.action==='propose'?validate.id(body.run_id):Number(db.prepare('SELECT run_id FROM commission_corrections WHERE id=?').get(validate.id(body.id))?.run_id);if(!Number.isSafeInteger(run)||run<=0)throw new HttpError(404,'سند یافت نشد.');
 const evidence=commissionEvidence(db,run);ledgerScope(session,Number(evidence.run.branch_id),cookie,'finance.manage');
 return durableJsonResponse(db,{actorId:session.user.id,branchId:Number(evidence.run.branch_id),operation:'commission_correction',key:req.headers.get('idempotency-key'),payload:body},()=>{
  if(body.action==='propose')return ok(proposeCommissionCorrection(db,session,body,cookie));
  if(body.action==='approve'||body.action==='reject')return ok(decideCommissionCorrection(db,session,validate.id(body.id),body.action==='approve',cookie));
  if(body.action==='post')return ok(postCommissionCorrection(db,session,validate.id(body.id),body,cookie));
  throw new HttpError(400,'عملیات اصلاح پورسانت معتبر نیست.');
 });
}catch(e){return fail(e);}}
