import { NextRequest } from "next/server";
import { requireSession, requirePerm, ok, fail, readJson } from "@/lib/api";
import { getDb } from "@/lib/db/schema";
import { recordBranchId } from "@/lib/branch";
import { mutateBank, requireCentralBankAccess, type BankInput } from "@/lib/bank";
import { durableOperation } from "@/lib/idempotency";
import {bankRegisterTotal} from '@/lib/bank-input';
import {readSnapshot} from '@/lib/db/transaction';
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresFinancialRequest} from '@/lib/db/pg-financial-http';
import {postgresMutateBank,postgresBankPosition} from '@/lib/db/postgres-bank';
import {postgresFailure} from '@/lib/db/pg-http';
import {readRequestJson} from '@/lib/request-json';

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if(postgresIntegration()){
    try{
      const {database,schema,token}=await postgresFinancialRequest(req,'finance.view');
      const result=await postgresBankPosition(database,schema,token,{page:Number(req.nextUrl.searchParams.get('page')??1),size:Number(req.nextUrl.searchParams.get('size')??50)});
      return Response.json({...result,accounts:result.accounts.map(account=>({...account,current_balance:account.registered_balance,is_active:account.active?1:0})),txns:result.transactions},{headers:{'Cache-Control':'no-store'}});
    }catch(error){return postgresFailure(error);}
  }
  try {
    const session = requireSession(req);
    requirePerm(session, "finance.view");
    requireCentralBankAccess(session);
    const db = getDb();
    return readSnapshot(db,()=>{
    const accounts = db.prepare("SELECT * FROM bank_accounts WHERE is_active=1 ORDER BY id").all();
    const txns = db.prepare(`SELECT t.*,a.name account_name FROM bank_transactions t LEFT JOIN bank_accounts a ON a.id=t.account_id ORDER BY t.id DESC LIMIT 200`).all();
    const exact=bankRegisterTotal(accounts as Array<{current_balance:unknown}>),safe=exact!=null&&exact<=BigInt(Number.MAX_SAFE_INTEGER)&&exact>= -BigInt(Number.MAX_SAFE_INTEGER);
    return ok({ accounts, txns, total:safe?Number(exact):null,total_exact:exact?.toString()??null,total_state:exact==null?'review_required':safe?'exact':'exceeds_number_range' });
    });
  } catch (e) { return fail(e); }
}

export async function POST(req: NextRequest) {
  if(postgresIntegration()){
    try{
      const {database,schema,token}=await postgresFinancialRequest(req,'finance.manage');
      const body=await readRequestJson(req) as unknown as BankInput;
      return Response.json(await postgresMutateBank(database,schema,token,req.headers.get('idempotency-key'),body));
    }catch(error){return postgresFailure(error);}
  }
  try {
    const session = requireSession(req);
    requirePerm(session, "finance.manage");
    requireCentralBankAccess(session);
    const body = await readJson<BankInput>(req);
    const db = getDb();
    // Accounts are centralized, so changing a UI branch must not allow replay.
    const branchId = recordBranchId(session, "all");
    return ok(durableOperation(db, { actorId: session.user.id, branchId, operation: "bank_mutation",
      key: req.headers.get("idempotency-key"), payload: body, scope: "business" }, () => mutateBank(db, session, body)));
  } catch (e) { return fail(e); }
}
