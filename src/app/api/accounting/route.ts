import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession,requirePerm,readJson,ok,fail,validate,HttpError } from "@/lib/api";
import { activeBranch,recordBranchId } from "@/lib/branch";
import { canUser } from "@/lib/auth";
import { durableJsonResponse } from "@/lib/idempotency";
import { accountingAdmin,ledgerScope,createAccount,createJournal,createPeriod,financialStatements,generalLedger,initializeChart,postJournal,reverseJournal,setPeriodState,trialBalance } from "@/lib/accounting";
import { reviewFinancialEvent } from "@/lib/accounting-events";
import { financialCases } from "@/lib/financial-cases";
import { reconcileSubledgers } from "@/lib/accounting-reports";
import { readSnapshot } from "@/lib/db/transaction";
import { editJournalDraft,voidJournalDraft } from "@/lib/accounting-drafts";
import { recognitionTemplates } from "@/lib/accounting-policy-plan";
import { proposeRecognitionPolicy,changeRecognitionPolicy } from "@/lib/accounting-policy";
import { openingControlCodes,proposeOpening,decideOpening,rehearseOpening,applyOpening } from "@/lib/accounting-opening";
import { proposeCacheCorrection,approveCacheCorrection,rehearseCacheCorrection,applyCacheCorrection } from "@/lib/financial-corrections";
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresAccountingHttp} from '@/lib/db/pg-accounting-http';

export const dynamic="force-dynamic";

export async function GET(req:NextRequest) {
  if(postgresIntegration())return postgresAccountingHttp(req);
  try {
    const session=requireSession(req);requirePerm(session,"finance.view");
    const cookie=req.cookies.get("repaid_branch")?.value, scope=activeBranch(session,cookie), db=getDb(),q=req.nextUrl.searchParams;
    const branch=q.has("branch_id")?validate.id(q.get("branch_id")):scope.branchId;
    if(!scope.all && branch!==scope.branchId) throw new HttpError(403,"دسترسی به شعبهٔ دیگر مجاز نیست.");
    const to=q.get("to")??new Date().toISOString().slice(0,10),from=q.get("from")??`${to.slice(0,4)}-01-01`;
    const response=readSnapshot(db,()=>{
    if(q.get('view')==='setup'){
      accountingAdmin(session);const setupBranch=branch??recordBranchId(session,cookie);ledgerScope(session,setupBranch,cookie,'finance.manage');
      return ok({branch_id:setupBranch,actor_id:session.user.id,templates:recognitionTemplates,control_codes:openingControlCodes,
        policies:db.prepare('SELECT * FROM accounting_recognition_policies WHERE branch_id=? ORDER BY id DESC LIMIT 100').all(setupBranch),
        openings:db.prepare('SELECT id,branch_id,mode,cutover_date,memo,lines_json,controls_json,evidence_json,document_hash,source_hash,proposed_by,approved_by,status,backup_hash,rehearsal_json,journal_id FROM accounting_opening_documents WHERE branch_id=? ORDER BY id DESC LIMIT 50').all(setupBranch)});
    }
    if(q.get("view")==="journal"){
      const header=db.prepare("SELECT * FROM accounting_journals WHERE id=?").get(validate.id(q.get("journal_id")));
      if(!header)throw new HttpError(404,"سند حسابداری یافت نشد.");ledgerScope(session,Number(header.branch_id),cookie);
      const lines=db.prepare("SELECT * FROM accounting_lines WHERE journal_id=? ORDER BY position LIMIT 500").all(header.id);
      const cancellation=db.prepare("SELECT * FROM accounting_journal_voids WHERE journal_id=?").get(header.id);
      const source=header.source_type==="financial_event"?db.prepare("SELECT payload_json FROM accounting_events WHERE id=? AND branch_id=?").get(header.source_id,header.branch_id):null;
      return ok({header:{...header,voided:Boolean(cancellation)},cancellation:cancellation??null,lines,source:source?JSON.parse(String(source.payload_json)):null});
    }
    if(q.get("view")==="ledger") return ok(generalLedger(db,session,{account_code:q.get("account")??"",from,to,branch_id:branch,after:Number(q.get("after")??0),limit:100},cookie));
    if(q.get("view")==="cases") return ok(financialCases(db,branch));
    if(q.get("view")==="reconciliation")return ok(reconcileSubledgers(db,session,branch,cookie,Number(q.get("customer_after")??0),Number(q.get("supplier_after")??0),Number(q.get("employee_after")??0)));
    const trial=trialBalance(db,session,{branch_id:branch,from,to},cookie);
    const where=branch==null?"":"AND j.branch_id=?",params=branch==null?[]:[branch];
    const requested=Number(q.get("before")??0);
    if(!Number.isSafeInteger(requested)||requested<0) throw new HttpError(400,"صفحه‌بندی معتبر نیست.");
    const journals=db.prepare(`SELECT j.*,EXISTS(SELECT 1 FROM accounting_journal_voids v WHERE v.journal_id=j.id) voided,(SELECT SUM(l.debit) FROM accounting_lines l WHERE l.journal_id=j.id) amount
      FROM accounting_journals j WHERE (?=0 OR j.id<?) ${where} ORDER BY j.id DESC LIMIT 51`).all(requested,requested,...params);
    const eventAfter=Number(q.get("events_after")??0),eventSource=q.get("event_source")??"",eventSourceId=q.has("event_source_id")?validate.id(q.get("event_source_id")):null;
    if(!Number.isSafeInteger(eventAfter)||eventAfter<0||eventSource.length>30)throw new HttpError(400,"فیلتر یا صفحهٔ رویداد معتبر نیست.");
    const events=db.prepare(`SELECT e.*,r.journal_id FROM accounting_events e LEFT JOIN accounting_event_reviews r ON r.event_id=e.id
      WHERE r.event_id IS NULL AND NOT EXISTS(SELECT 1 FROM accounting_opening_event_links ol WHERE ol.event_id=e.id) AND e.id>? AND json_extract(e.payload_json,'$.control_amount')>0 ${branch==null?"":"AND e.branch_id=?"}
      ${eventSource?"AND e.source_type=?":""} ${eventSourceId==null?"":"AND e.source_id=?"} ORDER BY e.id LIMIT 51`)
      .all(eventAfter,...params,...(eventSource?[eventSource]:[]),...(eventSourceId==null?[]:[String(eventSourceId)]));
    const corrections=db.prepare(`SELECT id,invoice_id,branch_id,expected_paid,status,proposed_by,approved_by,backup_sha256,created_at,applied_at,reason
      FROM financial_corrections WHERE 1=1 ${branch==null?"":"AND branch_id=?"} ORDER BY id DESC LIMIT 50`).all(...params);
    let lines:unknown[]=[];
    if(q.has("journal_id")) {
      const id=validate.id(q.get("journal_id"));
      const exists=db.prepare(`SELECT j.id FROM accounting_journals j WHERE j.id=? ${where}`).get(id,...params);
      if(!exists) throw new HttpError(404,"سند حسابداری یافت نشد.");
      lines=db.prepare("SELECT * FROM accounting_lines WHERE journal_id=? ORDER BY position LIMIT 500").all(id);
    }
    return ok({trial,statements:financialStatements(db,session,{branch_id:branch,from,to},cookie),journals:journals.slice(0,50),
      next:journals.length>50?journals[49].id:null,events:events.slice(0,50),nextEvent:events.length>50?events[49].id:null,corrections,lines,periods:db.prepare("SELECT * FROM accounting_periods ORDER BY start_date DESC LIMIT 100").all(),
      mode:"review_required",canManage:canUser(session,"finance.manage"),
      canAdmin:canUser(session,"finance.manage")&&["owner","admin"].includes(session.user.role),recordBranch:recordBranchId(session,cookie),actorId:session.user.id});
    });
    response.headers.set("cache-control","no-store");return response;
  } catch(error){return fail(error);}
}

export async function POST(req:NextRequest) {
  if(postgresIntegration())return postgresAccountingHttp(req);
  try {
    const session=requireSession(req);requirePerm(session,"finance.manage");
    const body=await readJson(req),db=getDb(),cookie=req.cookies.get("repaid_branch")?.value;
    if(["initialize_chart","create_account","create_period","period_state","approve_correction","rehearse_correction","apply_correction","propose_policy","approve_policy","disable_policy","propose_opening","approve_opening","reject_opening","rehearse_opening","apply_opening"].includes(body.action))accountingAdmin(session);
    const targetTable=["post","reverse","edit_draft","void_draft"].includes(body.action)?"accounting_journals":body.action==="review_event"?"accounting_events"
      :["approve_correction","rehearse_correction","apply_correction"].includes(body.action)?"financial_corrections"
      :["approve_policy","disable_policy"].includes(body.action)?"accounting_recognition_policies"
      :["approve_opening","reject_opening","rehearse_opening","apply_opening"].includes(body.action)?"accounting_opening_documents":null;
    if(targetTable){const row=db.prepare(`SELECT branch_id FROM ${targetTable} WHERE id=?`).get(validate.id(body.id));if(!row)throw new HttpError(404,"رکورد مالی یافت نشد.");ledgerScope(session,Number(row.branch_id),cookie,"finance.manage");}
    // Online backup is asynchronous and cannot run under a durable writer lock.
    // Its state/evidence checks make repeated rehearsals safe without duplicating financial mutations.
    if(body.action==="rehearse_correction") return ok(await rehearseCacheCorrection(db,session,validate.id(body.id),cookie));
    if(body.action==='rehearse_opening')return ok(await rehearseOpening(db,session,validate.id(body.id),cookie));
    const branch=recordBranchId(session,cookie);
    if(body.action==="draft")ledgerScope(session,body.branch_id==null?branch:validate.id(body.branch_id),cookie,"finance.manage");
    return durableJsonResponse(db,{actorId:session.user.id,branchId:branch,operation:"accounting",scope:"business",
      key:req.headers.get("idempotency-key"),payload:body},()=>{
      switch(body.action) {
        case 'propose_policy':return ok(proposeRecognitionPolicy(db,session,{...body,branch_id:body.branch_id==null?branch:validate.id(body.branch_id)},cookie));
        case 'approve_policy':return ok(changeRecognitionPolicy(db,session,validate.id(body.id),'approve',cookie));
        case 'disable_policy':return ok(changeRecognitionPolicy(db,session,validate.id(body.id),'disable',cookie));
        case 'propose_opening':return ok(proposeOpening(db,session,{...body,branch_id:body.branch_id==null?branch:validate.id(body.branch_id)},cookie));
        case 'approve_opening':return ok(decideOpening(db,session,validate.id(body.id),'approved',cookie));
        case 'reject_opening':return ok(decideOpening(db,session,validate.id(body.id),'rejected',cookie));
        case 'apply_opening':
          if(body.confirm!==true)throw new HttpError(400,'تأیید صریح اجرای افتتاحیه لازم است.');
          return ok(applyOpening(db,session,validate.id(body.id),cookie));
        case "initialize_chart":return ok(initializeChart(db,session));
        case "create_account":return ok(createAccount(db,session,body.account));
        case "create_period":return ok(createPeriod(db,session,body.period));
        case "period_state":return ok(setPeriodState(db,session,validate.id(body.id),body.status,body.reason));
        case "draft":return ok(createJournal(db,session,{branch_id:body.branch_id==null?branch:validate.id(body.branch_id),posting_date:body.posting_date,
          memo:body.memo,lines:body.lines,event_key:`manual:${session.user.id}:${req.headers.get("idempotency-key")}`,source_type:"manual",source_id:String(session.user.id)},cookie));
        case "post":
          if(typeof body.expected_hash!=="string"||!/^[a-f0-9]{64}$/.test(body.expected_hash))throw new HttpError(400,"نسخهٔ مورد تأیید پیش‌نویس الزامی است.");
          return ok(postJournal(db,session,validate.id(body.id),cookie,body.expected_hash));
        case "edit_draft":return ok(editJournalDraft(db,session,validate.id(body.id),body,cookie));
        case "void_draft":return ok(voidJournalDraft(db,session,validate.id(body.id),body.reason,cookie));
        case "reverse":return ok(reverseJournal(db,session,validate.id(body.id),body.posting_date,body.reason,cookie));
        case "review_event":return ok(reviewFinancialEvent(db,session,validate.id(body.id),body,cookie));
        case "propose_correction":return ok(proposeCacheCorrection(db,session,validate.id(body.invoice_id),body.reason,cookie));
        case "approve_correction":return ok(approveCacheCorrection(db,session,validate.id(body.id),cookie));
        case "apply_correction":
          if(body.confirm!==true) throw new HttpError(400,"تأیید صریح اجرای اصلاح لازم است.");
          return ok(applyCacheCorrection(db,session,validate.id(body.id),cookie));
        default:throw new HttpError(400,"عملیات حسابداری معتبر نیست.");
      }
    });
  }catch(error){return fail(error);}
}
