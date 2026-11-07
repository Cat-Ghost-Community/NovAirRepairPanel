import {normalizeJournal,ledgerText as text,type JournalInput,type JournalLine} from './journal-input';
import {accountingDate} from './accounting-date';
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Session } from "@/lib/auth";
import { auditRecord, HttpError, requirePerm, validate } from "@/lib/api";
import { activeBranch } from "@/lib/branch";
import { atomic, readSnapshot } from "@/lib/db/transaction";
import { sumRial } from "@/lib/money";
import { automaticPlan } from "@/lib/accounting-policy-plan";
import { validateReturnPosting,finalizeReturnEvent } from '@/lib/return-state';
import { refreshInvoiceFinancialState } from '@/lib/payment-state';
import { requireCreditSchedule,applyCreditSchedule } from '@/lib/installments';
import {journalDigest as digest,streamingJournalDigest} from '@/lib/ledger-proof';

import {DEFAULT_ACCOUNTING_CHART as chart,type AccountClass} from './accounting-chart';
export type {AccountClass} from './accounting-chart';
type LedgerAccount={code:string;name:string;classification:AccountClass;normal_side:"debit"|"credit";active:number};
export type {JournalLine,JournalInput} from './journal-input';

type Header = { id: number; branch_id: number; period_id: number; posting_date: string; source_type: string; source_id: string;
  event_key: string; memo: string; state: string; request_hash: string; created_by: number; posted_by: number | null;
  posted_at: string | null; posted_sequence: number | null; previous_hash: string | null; digest: string | null; reversal_of: number | null };
type Line = Required<JournalLine> & { position: number };
const dimensions = ["customer_id", "supplier_id", "employee_id", "part_id", "bank_account_id"] as const;
const classes: AccountClass[] = ["asset", "liability", "equity", "revenue", "expense", "cogs"];


export {accountingDate} from './accounting-date';


export function ledgerScope(session: Session, branchId: number, cookie?: string | null, permission = "finance.view") {
  requirePerm(session, permission);
  const scope = activeBranch(session, cookie);
  if (!scope.all && scope.branchId !== branchId) throw new HttpError(404, "سند حسابداری یافت نشد.");
  if(!Number.isSafeInteger(branchId)||branchId<=0)throw new HttpError(409,"شعبهٔ این سند مالی مشخص نیست؛ انتساب تاریخی نیازمند بررسی و تأیید است.");
}
export function accountingAdmin(session: Session) {
  requirePerm(session, "finance.manage");
  if (!["owner", "admin"].includes(session.user.role)) throw new HttpError(403, "تغییر ساختار و دوره‌های حسابداری فقط برای مدیر مجاز است.");
}
export function initializeChart(db: DatabaseSync, session: Session) {
  accountingAdmin(session);
  return atomic(db, () => {
    const insert = db.prepare("INSERT INTO accounting_accounts(code,name,classification,normal_side) VALUES(?,?,?,?) ON CONFLICT(code) DO NOTHING");
    for (const row of chart) insert.run(...row);
    auditRecord(db,session, "initialize_chart", "accounting", null, null, { codes: chart.map(row => row[0]) });
    return { accounts: chart.length };
  });
}
export function createAccount(db: DatabaseSync, session: Session, input: {code: string; name: string; classification: AccountClass; normal_side: string}) {
  accountingAdmin(session);
  if(!input||typeof input!=="object")throw new HttpError(400,"مشخصات سرفصل الزامی است.");
  if (!/^[A-Za-z0-9_-]{2,20}$/.test(input.code) || !classes.includes(input.classification) || !["debit", "credit"].includes(input.normal_side)) throw new HttpError(400, "مشخصات سرفصل معتبر نیست.");
  return atomic(db, () => {
    if (db.prepare("SELECT code FROM accounting_accounts WHERE code=?").get(input.code)) throw new HttpError(409, "کد سرفصل قبلاً ثبت شده است.");
    db.prepare("INSERT INTO accounting_accounts(code,name,classification,normal_side) VALUES(?,?,?,?)").run(input.code, text(input.name,"نام سرفصل",150),input.classification,input.normal_side);
    auditRecord(db,session,"create","accounting_account",null,null,input);
    return { code: input.code };
  });
}
export function createPeriod(db: DatabaseSync, session: Session, input: {name: string; start_date: string; end_date: string}) {
  accountingAdmin(session);
  if(!input||typeof input!=="object")throw new HttpError(400,"مشخصات دوره الزامی است.");
  const start = accountingDate(input.start_date), end = accountingDate(input.end_date);
  if (start > end) throw new HttpError(400, "پایان دوره باید پس از آغاز دوره باشد.");
  return atomic(db, () => {
    if (db.prepare("SELECT id FROM accounting_periods WHERE start_date<=? AND end_date>=?").get(end,start)) throw new HttpError(409,"دورهٔ حسابداری هم‌پوشان است.");
    const id = Number(db.prepare("INSERT INTO accounting_periods(name,start_date,end_date,created_by) VALUES(?,?,?,?)").run(text(input.name,"نام دوره",150),start,end,session.user.id).lastInsertRowid);
    auditRecord(db,session,"create","accounting_period",id,null,{start,end});
    return { id };
  });
}
export function setPeriodState(db: DatabaseSync, session: Session, id: number, status: "open" | "closed", reason: string) {
  accountingAdmin(session); reason = text(reason,"دلیل تغییر دوره");
  if (!["open","closed"].includes(status)) throw new HttpError(400,"وضعیت دوره معتبر نیست.");
  return atomic(db, () => {
    const period = db.prepare("SELECT * FROM accounting_periods WHERE id=?").get(validate.id(id));
    if (!period) throw new HttpError(404,"دوره یافت نشد.");
    if (status === "closed") {
      const drafts = db.prepare("SELECT COUNT(*) n FROM accounting_journals j WHERE period_id=? AND state='draft' AND NOT EXISTS(SELECT 1 FROM accounting_journal_voids v WHERE v.journal_id=j.id)").get(id)!.n;
      const pending = db.prepare(`SELECT COUNT(*) n FROM accounting_events e LEFT JOIN accounting_event_reviews r ON r.event_id=e.id
        LEFT JOIN accounting_journals j ON j.id=r.journal_id WHERE substr(e.created_at,1,10) BETWEEN ? AND ?
        AND NOT EXISTS(SELECT 1 FROM accounting_opening_event_links ol WHERE ol.event_id=e.id) AND json_extract(e.payload_json,'$.control_amount')>0 AND (j.id IS NULL OR j.state NOT IN ('posted','reversed'))`).get(period.start_date,period.end_date)!.n;
      if (drafts || pending) throw new HttpError(409,"سند پیش‌نویس یا رویداد بررسی‌نشده در این دوره وجود دارد.");
    }
    db.prepare("UPDATE accounting_periods SET status=? WHERE id=?").run(status,id);
    auditRecord(db,session,"change_state","accounting_period",id,{status:period.status},{status,reason});
    return { id,status };
  });
}
export {normalizeJournal} from './journal-input';

function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function linesOf(db: DatabaseSync,id: number): Line[] {
  return db.prepare(`SELECT position,account_code,debit,credit,memo,customer_id,supplier_id,employee_id,part_id,bank_account_id
    FROM accounting_lines WHERE journal_id=? ORDER BY position`).all(id) as Line[];
}
export function validateLedgerLines(db:DatabaseSync,lines:Line[]) {
  const codes=[...new Set(lines.map(line=>line.account_code))];
  const active=new Set(db.prepare(`SELECT code FROM accounting_accounts WHERE active=1 AND code IN (${codes.map(()=>"?").join(",")})`).all(...codes).map(row=>String(row.code)));
  for(const code of codes)if(!active.has(code))throw new HttpError(400,`سرفصل فعال ${code} یافت نشد.`);
  for(const [key,table] of [["customer_id","customers"],["supplier_id","suppliers"],["employee_id","users"],["part_id","parts"],["bank_account_id","bank_accounts"]] as const){
    const ids=[...new Set(lines.map(line=>line[key]).filter((id):id is number=>id!=null))];
    if(ids.length&&db.prepare(`SELECT id FROM ${table} WHERE id IN (${ids.map(()=>"?").join(",")})`).all(...ids).length!==ids.length)throw new HttpError(400,"تفصیلی سطر سند یافت نشد.");
  }
}
export function createJournal(db: DatabaseSync, session: Session, raw: JournalInput, cookie?: string | null) {
  const input = normalizeJournal(raw);
  ledgerScope(session,input.branch_id,cookie,"finance.manage");
  return writeJournalDraft(db,session,input);
}
/** Private writer: callers above enforce manual authority; automatic entry below
 * is constrained by an independently approved, future-only policy plan. */
function writeJournalDraft(db:DatabaseSync,session:Session,input:ReturnType<typeof normalizeJournal>){
  return atomic(db, () => {
    const requestHash = hash(input);
    const existing = db.prepare("SELECT id,state,request_hash FROM accounting_journals WHERE event_key=?").get(input.event_key);
    if (existing) {
      if (existing.request_hash!==requestHash) throw new HttpError(409,"رویداد حسابداری با محتوای متفاوت قبلاً ثبت شده است.");
      return {id:Number(existing.id),state:String(existing.state),duplicate:true};
    }
    if (!db.prepare("SELECT id FROM branches WHERE id=? AND is_active=1").get(input.branch_id)) throw new HttpError(400,"شعبهٔ معتبر انتخاب کنید.");
    const period = db.prepare("SELECT id FROM accounting_periods WHERE status='open' AND ? BETWEEN start_date AND end_date").get(input.posting_date);
    if (!period) throw new HttpError(409,"دورهٔ باز برای تاریخ سند وجود ندارد.");
    validateLedgerLines(db,input.lines);
    if (input.reversal_of) {
      const original = db.prepare("SELECT state,branch_id FROM accounting_journals WHERE id=?").get(input.reversal_of);
      if (!original || original.state!=="posted" || original.branch_id!==input.branch_id) throw new HttpError(409,"مرجع برگشت سند معتبر نیست.");
    }
    const id = Number(db.prepare(`INSERT INTO accounting_journals(branch_id,period_id,posting_date,source_type,source_id,event_key,memo,request_hash,created_by,reversal_of)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(input.branch_id,period.id,input.posting_date,input.source_type,input.source_id,input.event_key,input.memo,requestHash,session.user.id,input.reversal_of??null).lastInsertRowid);
    const insert = db.prepare(`INSERT INTO accounting_lines(journal_id,position,account_code,debit,credit,memo,customer_id,supplier_id,employee_id,part_id,bank_account_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
    for (const line of input.lines) insert.run(id,line.position,line.account_code,line.debit,line.credit,line.memo,...dimensions.map(key=>line[key]));
    auditRecord(db,session,"draft","accounting_journal",id,null,{event_key:input.event_key,branch_id:input.branch_id,debit:sumRial(input.lines.map(l=>l.debit))});
    return {id,state:"draft",duplicate:false};
  });
}
export function postJournal(db: DatabaseSync, session: Session, id: number, cookie?: string | null,expectedHash?:string) {
  return atomic(db, () => {
    const header = db.prepare("SELECT * FROM accounting_journals WHERE id=?").get(validate.id(id)) as Header | undefined;
    if (!header) throw new HttpError(404,"سند حسابداری یافت نشد.");
    ledgerScope(session,header.branch_id,cookie,"finance.manage");
    return postJournalRecord(db,session,header,expectedHash);
  });
}
function postJournalRecord(db:DatabaseSync,session:Session,header:Header,expectedHash?:string){
    const id=header.id;
    if(expectedHash!=null&&expectedHash!==header.request_hash)throw new HttpError(409,"نسخهٔ پیش‌نویس تغییر کرده است؛ سند را دوباره بررسی کنید.");
    if(db.prepare("SELECT journal_id FROM accounting_journal_voids WHERE journal_id=?").get(id))throw new HttpError(409,"پیش‌نویس باطل شده و قابل ثبت مالی نیست.");
    if (header.state!=="draft") return {id,state:header.state,duplicate:true};
    const period = db.prepare("SELECT status FROM accounting_periods WHERE id=?").get(header.period_id);
    if (period?.status!=="open") throw new HttpError(409,"دورهٔ حسابداری بسته است.");
    const lines = linesOf(db,id);
    if (sumRial(lines.map(l=>l.debit))!==sumRial(lines.map(l=>l.credit)) || lines.length<2) throw new HttpError(409,"سند تراز نیست.");
    const previous = db.prepare("SELECT posted_sequence,digest FROM accounting_journals WHERE posted_sequence IS NOT NULL ORDER BY posted_sequence DESC LIMIT 1").get();
    header.posted_sequence=Number(previous?.posted_sequence??0)+1; header.previous_hash=String(previous?.digest??"");
    header.posted_by=session.user.id; header.posted_at=new Date().toISOString();
    const contentHash = digest(header,lines);
    db.prepare("UPDATE accounting_journals SET state='posted',posted_by=?,posted_at=?,posted_sequence=?,previous_hash=?,digest=? WHERE id=? AND state='draft'")
      .run(header.posted_by,header.posted_at,header.posted_sequence,header.previous_hash,contentHash,id);
    auditRecord(db,session,"post","accounting_journal",id,{state:"draft"},{state:"posted",digest:contentHash,branch_id:header.branch_id});
    return {id,state:"posted",duplicate:false};
}
/** Called only inside the authenticated source operation's transaction. The
 * actual source actor remains the actor; nobody impersonates the policy approver. */
export function postAutomaticFinancialEvent(db:DatabaseSync,eventId:number){
  if(!db.isTransaction)throw new Error('Automatic accounting requires the source transaction');
  if(db.prepare("SELECT event_id FROM accounting_automatic_postings WHERE event_id=?").get(eventId))return;
  const plan=automaticPlan(db,eventId);if(!plan)return;
  const user=db.prepare("SELECT id,name,email,role,branch_id,avatar_color FROM users WHERE id=? AND is_active=1").get(plan.event.actor_id);
  if(!user)throw new HttpError(409,"عامل رویداد برای ثبت خودکار معتبر نیست.");
  const session={user} as Session;
  validateReturnPosting(db,plan.event,plan.input.lines);
  const draft=writeJournalDraft(db,session,normalizeJournal(plan.input));
  const header=db.prepare("SELECT * FROM accounting_journals WHERE id=?").get(draft.id) as Header;
  postJournalRecord(db,session,header);
  db.prepare("INSERT INTO accounting_event_reviews(event_id,journal_id,reason,approved_by) VALUES(?,?,?,?)").run(eventId,draft.id,`اجرای خودکار سیاست مصوب ${plan.policy.id}`,plan.policy.approved_by);
  db.prepare("INSERT INTO accounting_automatic_postings(event_id,policy_id,journal_id,executed_by) VALUES(?,?,?,?)").run(eventId,plan.policy.id,draft.id,user.id);
  auditRecord(db,session,'automatic_post','accounting_event',eventId,null,{policy_id:plan.policy.id,journal_id:draft.id,policy_approved_by:plan.policy.approved_by,branch_id:plan.event.branch_id});
  finalizeReturnEvent(db,eventId,postAutomaticFinancialEvent);
}
export function reverseJournal(db: DatabaseSync, session: Session, id: number, date: string, reason: string, cookie?: string | null) {
  return atomic(db, () => {
    const original = db.prepare("SELECT * FROM accounting_journals WHERE id=?").get(validate.id(id)) as Header | undefined;
    if (!original) throw new HttpError(404,"سند حسابداری یافت نشد.");
    ledgerScope(session,original.branch_id,cookie,"finance.manage");
    if(db.prepare("SELECT id FROM customer_credit_operations WHERE journal_id=? AND state='posted'").get(id))throw new HttpError(409,'برگشت سند تخصیص اعتبار باید از گردش برگشت مستقل همان تخصیص انجام شود.');
    if(db.prepare("SELECT id FROM commission_corrections WHERE journal_id=? AND state='posted'").get(id))throw new HttpError(409,'برگشت اصلاح پورسانت نیازمند سند اعاده یا بازیافت مستقل همان گردش است.');
    const credit=db.prepare("SELECT * FROM credit_notes WHERE journal_id=?").get(id);
    if(credit){
      if(!['owner','admin'].includes(session.user.role)||credit.approved_by===session.user.id)throw new HttpError(403,'برگشت اعتبارنامه نیازمند مدیر مستقل از تأییدکنندهٔ اولیه است.');
      if(db.prepare('SELECT id FROM return_settlements WHERE return_id=? LIMIT 1').get(credit.return_id))throw new HttpError(409,'اعتبارنامه تسویه شده است؛ ابتدا سند اصلاحی/بازیافت مصوب لازم است.');
    }
    const existing = db.prepare("SELECT id,posting_date,memo FROM accounting_journals WHERE reversal_of=?").get(id);
    if (existing) {
      if (existing.posting_date!==accountingDate(date) || existing.memo!==text(reason,"دلیل برگشت")) throw new HttpError(409,"این سند با مشخصات دیگری برگشت خورده است.");
      return {id:Number(existing.id),state:"posted",duplicate:true};
    }
    if (original.state!=="posted" || original.reversal_of) throw new HttpError(409,"فقط سند نهاییِ اصلی قابل برگشت است؛ اصلاح بعدی سند تعدیلی مستقل می‌خواهد.");
    const lines = linesOf(db,id).map(line=>({...line,debit:line.credit,credit:line.debit}));
    const correction = createJournal(db,session,{branch_id:original.branch_id,posting_date:date,memo:reason,event_key:`reversal:${id}`,
      source_type:"journal_reversal",source_id:String(id),reversal_of:id,lines},cookie);
    postJournal(db,session,correction.id,cookie);
    db.prepare("UPDATE accounting_journals SET state='reversed' WHERE id=?").run(id);
    if(credit){requireCreditSchedule(db,Number(credit.id),'credit_reversal');db.prepare("UPDATE credit_notes SET status='reversed',reversal_id=? WHERE id=?").run(correction.id,credit.id);
      applyCreditSchedule(db,Number(credit.id),'credit_reversal',session.user.id);
      db.prepare("UPDATE business_returns SET state='credit_pending' WHERE id=? AND state='completed'").run(credit.return_id);
      refreshInvoiceFinancialState(db,Number(credit.invoice_id));}
    if(original.source_type==='financial_event')finalizeReturnEvent(db,Number(original.source_id));
    auditRecord(db,session,"reverse","accounting_journal",id,{state:"posted"},{state:"reversed",reversal_id:correction.id,reason,branch_id:original.branch_id});
    return {id:correction.id,state:"posted",duplicate:false};
  });
}
export function verifyLedger(db: DatabaseSync) {
  return readSnapshot(db, () => {
    let previous = "", sequence = 0, count = 0;
    const errors: Array<{id:number;reason:string}> = [];
    let errorCount=0;
    const problem=(id:number,reason:string)=>{errorCount++;if(errors.length<1000)errors.push({id,reason});};
    const stream=db.prepare(`SELECT j.posted_sequence,l.position,l.account_code,l.debit,l.credit,l.memo,l.customer_id,l.supplier_id,l.employee_id,l.part_id,l.bank_account_id
      FROM accounting_lines l JOIN accounting_journals j ON j.id=l.journal_id WHERE j.state IN ('posted','reversed') ORDER BY j.posted_sequence,l.position`).iterate();
    let next=stream.next();
    for (const raw of db.prepare(`SELECT j.*,CASE WHEN state='reversed' AND NOT EXISTS(SELECT 1 FROM accounting_journals r WHERE r.reversal_of=j.id AND r.state='posted') THEN 1 ELSE 0 END invalid_reversal
      FROM accounting_journals j WHERE state IN ('posted','reversed') ORDER BY posted_sequence`).iterate()) {
      const header = raw as Header, proof=streamingJournalDigest(header);
      let lineCount=0,debit=BigInt(0),credit=BigInt(0),invalidAmount=false;
      while(!next.done && next.value.posted_sequence===header.posted_sequence){
        const row=next.value;proof.line({position:Number(row.position),account_code:String(row.account_code),debit:Number(row.debit),credit:Number(row.credit),memo:String(row.memo),
          customer_id:row.customer_id==null?null:Number(row.customer_id),supplier_id:row.supplier_id==null?null:Number(row.supplier_id),
          employee_id:row.employee_id==null?null:Number(row.employee_id),part_id:row.part_id==null?null:Number(row.part_id),bank_account_id:row.bank_account_id==null?null:Number(row.bank_account_id)});
        lineCount++;
        if(!Number.isSafeInteger(row.debit)||!Number.isSafeInteger(row.credit)||Number(row.debit)<0||Number(row.credit)<0)invalidAmount=true;
        else{debit+=BigInt(Number(row.debit));credit+=BigInt(Number(row.credit));}
        next=stream.next();
      }
      if (header.posted_sequence!==++sequence || header.previous_hash!==previous || proof.finish()!==header.digest) problem(header.id,"digest_or_sequence");
      if (invalidAmount||lineCount<2||debit!==credit||debit>BigInt(Number.MAX_SAFE_INTEGER)) problem(header.id,"unbalanced");
      if (raw.invalid_reversal) problem(header.id,"missing_reversal");
      previous=header.digest??""; count++;
    }
    for(const event of db.prepare("SELECT id,event_key,source_type,source_id,branch_id,event_type,payload_json,payload_hash FROM accounting_events").iterate()){
      const actual=createHash("sha256").update(String(event.payload_json)).digest("hex");
      if(actual!==event.payload_hash||event.event_key!==`${event.source_type}:${event.source_id}:${event.event_type}`)problem(Number(event.id),"source_event_digest");
      try{const payload=JSON.parse(String(event.payload_json));if(String(payload.document.id)!==event.source_id
        ||(payload.document.branch_id!=null&&payload.document.branch_id!==event.branch_id))problem(Number(event.id),"source_event_reference");}
      catch{problem(Number(event.id),"source_event_payload");}
    }
    return {count,valid:errorCount===0,error_count:errorCount,errors,errors_truncated:errorCount>errors.length};
  });
}
export function signedSafe(value: bigint): number {
  if (value>BigInt(Number.MAX_SAFE_INTEGER) || value<-BigInt(Number.MAX_SAFE_INTEGER)) throw new HttpError(409,"جمع گزارش از محدودهٔ عدد صحیح امن بیشتر است؛ بازه را محدود کنید.");
  return Number(value);
}
export function trialBalance(db: DatabaseSync, session: Session, filters: {branch_id?: number | null; from?: string; to: string}, cookie?: string | null) {
  requirePerm(session,"finance.view");
  const scope=activeBranch(session,cookie), branch=scope.all ? filters.branch_id??null : scope.branchId;
  if (!scope.all && filters.branch_id!=null && filters.branch_id!==branch) throw new HttpError(403,"گزارش شعبهٔ دیگر مجاز نیست.");
  const to=accountingDate(filters.to), from=filters.from?accountingDate(filters.from):null;
  if (from && from>to) throw new HttpError(400,"بازهٔ گزارش معتبر نیست.");
  return readSnapshot(db, () => {
    const accounts=db.prepare("SELECT * FROM accounting_accounts ORDER BY code LIMIT 2001").all() as LedgerAccount[];
    if(accounts.length>2000) throw new HttpError(409,"تعداد سرفصل‌ها نیازمند گزارش دسته‌ای است.");
    const balances=new Map<string,{opening:bigint;debit:bigint;credit:bigint}>();
    for(const a of accounts) balances.set(String(a.code),{opening:BigInt(0),debit:BigInt(0),credit:BigInt(0)});
    for(const row of db.prepare(`SELECT l.account_code,l.debit,l.credit,j.posting_date FROM accounting_lines l JOIN accounting_journals j ON j.id=l.journal_id
      WHERE j.state IN ('posted','reversed') AND j.posting_date<=? ${branch==null?"":"AND j.branch_id=?"}`).iterate(to,...(branch==null?[]:[branch]))) {
      const balance=balances.get(String(row.account_code))!;
      const debit=BigInt(Number(row.debit)),credit=BigInt(Number(row.credit));
      if(from && String(row.posting_date)<from) balance.opening+=debit-credit;
      else {balance.debit+=debit;balance.credit+=credit;}
    }
    let debit=BigInt(0),credit=BigInt(0),opening=BigInt(0);
    const rows=accounts.map(a=>{const b=balances.get(String(a.code))!;debit+=b.debit;credit+=b.credit;opening+=b.opening;
      return {...a,opening:signedSafe(b.opening),debit:signedSafe(b.debit),credit:signedSafe(b.credit),balance:signedSafe(b.opening+b.debit-b.credit)};});
    return {currency:"IRR",branch_id:branch,from,to,rows,debit:signedSafe(debit),credit:signedSafe(credit),opening:signedSafe(opening),balanced:debit===credit && opening===BigInt(0),
      pendingEvents:Number(db.prepare(`SELECT COUNT(*) n FROM accounting_events e LEFT JOIN accounting_event_reviews r ON r.event_id=e.id
        LEFT JOIN accounting_journals j ON j.id=r.journal_id WHERE json_extract(e.payload_json,'$.control_amount')>0
        AND NOT EXISTS(SELECT 1 FROM accounting_opening_event_links ol WHERE ol.event_id=e.id)
        AND (j.id IS NULL OR j.state NOT IN ('posted','reversed')) ${branch==null?"":"AND e.branch_id=?"}`).get(...(branch==null?[]:[branch]))!.n)};
  });
}

export function generalLedger(db: DatabaseSync, session: Session, filters: {account_code:string;from:string;to:string;branch_id?:number|null;after?:number;limit?:number}, cookie?:string|null) {
  requirePerm(session,"finance.view");
  const scope=activeBranch(session,cookie), branch=scope.all?filters.branch_id??null:scope.branchId;
  if(!scope.all && filters.branch_id!=null && filters.branch_id!==branch) throw new HttpError(403,"گزارش شعبهٔ دیگر مجاز نیست.");
  const from=accountingDate(filters.from),to=accountingDate(filters.to);
  if(from>to) throw new HttpError(400,"بازهٔ گزارش معتبر نیست.");
  const after=filters.after??0,limit=filters.limit??100;
  if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>200) throw new HttpError(400,"صفحه‌بندی معتبر نیست.");
  return readSnapshot(db,()=>{
    const account=db.prepare("SELECT * FROM accounting_accounts WHERE code=?").get(filters.account_code);
    if(!account) throw new HttpError(404,"سرفصل یافت نشد.");
    const params=[filters.account_code,to,...(branch==null?[]:[branch])];
    const base=`FROM accounting_lines l JOIN accounting_journals j ON j.id=l.journal_id WHERE l.account_code=?
      AND j.posting_date<=? AND j.state IN ('posted','reversed') ${branch==null?"":"AND j.branch_id=?"}`;
    let opening=BigInt(0),running=BigInt(0);
    // Ledger pagination follows immutable posting sequence, including backdated entries.
    for(const row of db.prepare(`SELECT l.debit,l.credit,j.posting_date,j.posted_sequence ${base}`).iterate(...params)) {
      const delta=BigInt(Number(row.debit))-BigInt(Number(row.credit));
      if(String(row.posting_date)<from) opening+=delta;
      else if(Number(row.posted_sequence)<=after) running+=delta;
    }
    running+=opening;
    const rows=db.prepare(`SELECT l.*,j.posting_date,j.posted_sequence,j.source_type,j.source_id,j.memo journal_memo,j.state
      ${base} AND j.posting_date>=? AND j.posted_sequence>? ORDER BY j.posted_sequence,l.position LIMIT ?`).all(...params,from,after,limit+1);
    // Do not split one journal's same-account lines across a sequence cursor.
    let page=rows.slice(0,limit);
    if(rows.length>limit){const boundary=page[page.length-1].posted_sequence;
      if(rows[limit].posted_sequence===boundary){page=page.filter(r=>r.posted_sequence!==boundary);
        if(!page.length) page=db.prepare(`SELECT l.*,j.posting_date,j.posted_sequence,j.source_type,j.source_id,j.memo journal_memo,j.state ${base}
          AND j.posted_sequence=? ORDER BY l.position LIMIT 500`).all(...params,boundary);
      }
    }
    const result=page.map(row=>{running+=BigInt(Number(row.debit))-BigInt(Number(row.credit));return {...row,balance:signedSafe(running)};});
    const last=page.length?Number(page[page.length-1].posted_sequence):null;
    const next=last!=null&&db.prepare(`SELECT 1 ${base} AND j.posting_date>=? AND j.posted_sequence>? LIMIT 1`).get(...params,from,last)?last:null;
    return {currency:"IRR",account,branch_id:branch,from,to,opening:signedSafe(opening),rows:result,next};
  });
}

export function financialStatements(db: DatabaseSync, session: Session, filters: {branch_id?:number|null;from:string;to:string}, cookie?:string|null) {
  return readSnapshot(db,()=>{
    const activity=trialBalance(db,session,filters,cookie),asOf=trialBalance(db,session,{branch_id:filters.branch_id,to:filters.to},cookie);
    const total=(rows:typeof activity.rows,kind:AccountClass)=>rows.filter(r=>r.classification===kind)
      .reduce((s,r)=>s+BigInt(r.balance),BigInt(0));
    const movement=(kind:AccountClass)=>activity.rows.filter(r=>r.classification===kind).reduce((s,r)=>s+BigInt(r.debit)-BigInt(r.credit),BigInt(0));
    const revenue=-movement("revenue"),cogs=movement("cogs"),expenses=movement("expense");
    const assets=total(asOf.rows,"asset"),liabilities=-total(asOf.rows,"liability"),equity=-total(asOf.rows,"equity");
    const earnings=-total(asOf.rows,"revenue")-total(asOf.rows,"cogs")-total(asOf.rows,"expense");
    return {currency:"IRR",basis:"posted_journals_only",branch_id:activity.branch_id,from:filters.from,to:filters.to,
      revenue:signedSafe(revenue),cogs:signedSafe(cogs),expenses:signedSafe(expenses),profit:signedSafe(revenue-cogs-expenses),
      assets:signedSafe(assets),liabilities:signedSafe(liabilities),equity:signedSafe(equity),retainedCurrentEarnings:signedSafe(earnings),
      balanceSheetBalanced:assets===liabilities+equity+earnings,pendingEvents:activity.pendingEvents,
      acceptance:"review_required_no_verified_opening_balances"};
  });
}
