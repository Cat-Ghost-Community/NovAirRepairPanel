import {readRequestJson} from "./request-json";
import {validateId} from './validate-id';
import {HttpError} from './http-error';
import {databaseContention} from './db/contention';
import { NextRequest } from "next/server";
import { getSession, canForUser, Session } from "@/lib/auth";
import { getDb } from "@/lib/db/schema";
import { fmtMoney } from "@/lib/format";
import { statusFa } from "@/lib/status-fa";
import { isSameOriginMutation } from "@/lib/request-security";
import { rial } from "@/lib/money";
import type { DatabaseSync } from "node:sqlite";
import { assertBranchPath, assertBranchReferences } from "./branch-access";
import { activeBranch, BRANCH_COOKIE, canSwitchBranch } from "./branch";
import {enforceRepairWorkflow} from './repair-workflow';
import {repairWorkflow,currentWorkflowActor} from './repair-workflow';
import {atomic} from './db/transaction';
import {durableJsonResponse} from './idempotency';

export {HttpError} from './http-error';

const requestSessions=new WeakMap<NextRequest,Session>();
const sessionRequirements=new WeakMap<Session,Set<string>>();
const requestPayloads=new WeakMap<NextRequest,Record<string,unknown>>();
const workflowRequests=new WeakMap<NextRequest,{id:number;version:number;revision:number;mode:string}>();
function checkWorkflowRequest(req:NextRequest,session:Session){
 const path=req.nextUrl.pathname.match(/^\/api\/repairs\/(\d+)(?:\/|$)/);
 const id=path?.[1]??req.nextUrl.searchParams.get('ticket_id');
 if(id){
  const mutation=!['GET','HEAD','OPTIONS'].includes(req.method),row=enforceRepairWorkflow(session,Number(id),mutation);
  const policy=repairWorkflow(getDb(),Number(row.branch_id)),version=Number(getDb().prepare('SELECT assignment_version FROM repair_tickets WHERE id=?').get(Number(id))?.assignment_version??0),previous=workflowRequests.get(req);
  if(previous&&mutation&&(previous.mode!=='legacy'||policy.mode!=='legacy')&&(previous.version!==version||previous.revision!==policy.revision))throw new HttpError(409,'ارجاع یا مسیر تعمیر حین درخواست تغییر کرد؛ صفحه را تازه کنید.');
  if(!previous)workflowRequests.set(req,{id:Number(id),version,revision:policy.revision,mode:policy.mode});
  if(mutation&&policy.mode!=='legacy'&&/\/(start|time|diagnosis|checklist|items|qc)(\/|$)/.test(req.nextUrl.pathname)&&row.technician_id==null&&row.technician2_id==null)throw new HttpError(409,'ابتدا مدیر باید تعمیرکار را مشخص کند یا دستگاه از صف آزاد انتخاب شود.');
 }
}
export function atomicRepairMutation(db:DatabaseSync,req:NextRequest,session:Session,id:number,work:()=>Response):Response{return atomic(db,()=>{
 assertRequestSession(req);currentWorkflowActor(db,session);const row=enforceRepairWorkflow(session,id,true,db),branch=Number(row.branch_id),key=req.headers.get('idempotency-key');
 if(!key&&req.nextUrl.pathname.endsWith('/time')&&repairWorkflow(db,branch).mode!=='legacy')throw new HttpError(400,'شناسهٔ ضدتکرار برای ثبت زمان الزامی است؛ صفحه را تازه کنید.');
 return key?durableJsonResponse(db,{actorId:session.user.id,branchId:branch,operation:'repair.write:'+req.nextUrl.pathname,key,payload:requestPayloads.get(req)??{}},work):work();
});}

/** Recheck after asynchronous body/file reads: employment or permissions may have changed meanwhile. */
export function assertRequestSession(req:NextRequest){
  const initial=requestSessions.get(req);
  if(!initial)return;
  const current=getSession(req);
  if(!current)throw new HttpError(401,"نشست شما منقضی شده است؛ دوباره وارد شوید.");
  if(current.user.id!==initial.user.id || current.user.role!==initial.user.role || current.user.branch_id!==initial.user.branch_id)throw new HttpError(409,"شعبه یا دسترسی حساب شما تغییر کرده است؛ صفحه را تازه‌سازی کنید.");
  if(activeBranch(current).branchId===-1)throw new HttpError(403,"شعبهٔ فعال به حساب شما اختصاص داده نشده است.");
  for(const perm of sessionRequirements.get(initial)??[])requirePerm(current,perm);
  checkWorkflowRequest(req,current);
}

export function requireSession(req: NextRequest): Session {
  if (!isSameOriginMutation(req)) throw new HttpError(403, "درخواست از منبع غیرمجاز رد شد.");
  const session = getSession(req);
  if (!session) throw new HttpError(401, "نشست شما منقضی شده است. لطفاً دوباره وارد شوید.");
  if (activeBranch(session).branchId === -1) throw new HttpError(403, "شعبهٔ فعال به حساب شما اختصاص داده نشده است؛ با مدیر سیستم تماس بگیرید.");
  const cookie = req.cookies.get(BRANCH_COOKIE)?.value;
  assertBranchPath(getDb(), session, cookie, req.nextUrl.pathname,req.method);
  assertBranchReferences(getDb(), session, cookie, Object.fromEntries(req.nextUrl.searchParams));
  checkWorkflowRequest(req,session);
  if(!requestSessions.has(req)){requestSessions.set(req,session);sessionRequirements.set(session,new Set());}
  return session;
}

export function requirePerm(session: Session, perm: string) {
  sessionRequirements.get(session)?.add(perm);
  if (["settings.edit","communication.manage"].includes(perm) && !canSwitchBranch(session.user.role)) {
    throw new HttpError(403,"تغییر تنظیمات مشترک شرکت فقط برای مالک یا مدیر سیستم مجاز است.");
  }
  const userId = (session.user as any).id ?? null;
  if (!canForUser(session.user.role, perm, userId)) {
    throw new HttpError(403, "شما اجازه انجام این عملیات را ندارید.");
  }
}

const responseBodies = new WeakMap<Response, unknown>();
export function ok(data: unknown, init?: ResponseInit) {
  const response = Response.json(data, init);
  responseBodies.set(response, data);
  return response;
}

/** Synchronous JSON access for transaction-bound API response receipts. */
export function responseData(response: Response): { found: boolean; data: unknown } {
  return { found: responseBodies.has(response), data: responseBodies.get(response) };
}

const FA_RE = /[\u0600-\u06FF]/;

export function fail(err: unknown) {
  if(databaseContention(err))return Response.json({error:'پایگاه داده مشغول پردازش درخواست دیگری است. کمی بعد دوباره تلاش کنید؛ برای عملیات مالی همان شناسهٔ درخواست را نگه دارید.',code:'DATABASE_BUSY'},{status:503,headers:{'Retry-After':'1','Cache-Control':'no-store'}});
  if (err instanceof HttpError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  // خطای عمدی با پیام فارسی (اعتبارسنجی و…) → 400 با همان پیام تا کاربر ببیند
  if (err instanceof Error && err.message && FA_RE.test(err.message) && !(err instanceof TypeError)) {
    return Response.json({ error: err.message }, { status: 400 });
  }
  // خطاهای دامنه با پیام انگلیسی → ترجمه فارسی برای کاربر
  if (err instanceof Error && err.message) {
    const m = err.message;
    const st = m.match(/A ticket in "(.+?)" cannot move to "(.+?)"\./);
    if (st) {
      return Response.json(
        { error: `انتقال از وضعیت «${statusFa(st[1])}» به «${statusFa(st[2])}» مجاز نیست — ابتدا وضعیت‌های میانی مجاز را طی کنید.` },
        { status: 400 }
      );
    }
    const un = m.match(/Unknown status "(.+?)"\./);
    if (un) return Response.json({ error: `وضعیت «${un[1]}» تعریف نشده است.` }, { status: 400 });
    if (m === "Repair ticket not found.") return Response.json({ error: "پذیرش یافت نشد." }, { status: 404 });
    const inv = m.match(/Not enough stock( at this location)?\./);
    if (inv) {
      return Response.json(
        { error: "موجودی کافی نیست — ابتدا از بخش خرید، کالا را به انبار اضافه کنید." },
        { status: 400 }
      );
    }
    if (m === "No inventory location configured.")
      return Response.json({ error: "هیچ انبار پیش‌فرضی تعریف نشده است — از تنظیمات انبار اضافه کنید." }, { status: 400 });
  }
  console.error(JSON.stringify({ event: "api_error", type: err instanceof Error ? err.name : "UnknownError" }));
  return Response.json(
    { error: "خطایی رخ داد. اطلاعات شما امن است — لطفاً دوباره تلاش کنید." },
    { status: 500 }
  );
}

export async function readJson<T = any>(req: NextRequest): Promise<T> {
  const body = await readRequestJson(req);
  try {
    requestPayloads.set(req,body);
    const session = getSession(req);
    assertRequestSession(req);
    if (session) assertBranchReferences(getDb(), session, req.cookies.get(BRANCH_COOKIE)?.value, body);
    if(session&&body.ticket_id&&req.nextUrl.pathname!=='/api/repairs/claim')enforceRepairWorkflow(session,Number(body.ticket_id),true);
    return body as T;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "درخواست قابل خواندن نیست. لطفاً صفحه را تازه‌سازی و دوباره تلاش کنید.");
  }
}

/** اعتبارسنجی سرور — موبایل ایرانی، مبلغ نامنفی، متن با طول مناسب */
export const validate = {
  id:validateId,
  mobile(v: unknown): string | null {
    // تبدیل ارقام فارسی/عربی به انگلیسی، حذف غیرعددی، نرمال‌سازی به ۰۹xxxxxxxxx
    const faDigits = "۰۱۲۳۴۵۶۷۸۹";
    const arDigits = "٠١٢٣٤٥٦٧٨٩";
    const s = String(v ?? "").replace(/[۰-۹٠-٩]/g, (d) => {
      const i = faDigits.indexOf(d);
      return String(i >= 0 ? i : arDigits.indexOf(d));
    }).replace(/\D/g, "");
    if (!s) return null;
    const norm = s.startsWith("98") ? "0" + s.slice(2) : s.startsWith("9") && s.length === 10 ? "0" + s : s;
    if (!/^09\d{9}$/.test(norm)) throw new HttpError(400, "شماره موبایل معتبر نیست (نمونه: ۰۹۱۲۳۴۵۶۷۸۹).");
    return norm;
  },
  amount(v: unknown, label = "مبلغ"): number {
    try { return rial(v, label); }
    catch (error) { throw new HttpError(400, (error as Error).message); }
  },
  required(v: unknown, label: string): string {
    const s = String(v ?? "").trim();
    if (!s) throw new HttpError(400, `${label} الزامی است.`);
    return s;
  },
  maxLength(v: unknown, max: number, label: string): string {
    const s = String(v ?? "");
    if (s.length > max) throw new HttpError(400, `${label} نمی‌تواند بیشتر از ${max} نویسه باشد.`);
    return s;
  },
};

export function audit(
  session: Session | null,
  action: string,
  entity: string,
  entityId: number | null,
  before?: unknown,
  after?: unknown,
  branchId?: number | null
) {
  return auditRecord(getDb(),session,action,entity,entityId,before,after,branchId);
}

/** Explicit connection is essential for restored-copy rehearsal and atomic audit. */
export function auditRecord(db:DatabaseSync,session:Session|null,action:string,entity:string,entityId:number|null,before?:unknown,after?:unknown,branchId?:number|null){
  const hasBranch=!!after && typeof after === "object" && "branch_id" in after;
  const explicitBranch = hasBranch ? (after as { branch_id?: unknown }).branch_id : undefined;
  const auditBranch = branchId!==undefined?branchId:(explicitBranch===null?null:typeof explicitBranch==="number"?explicitBranch:session?.user.branch_id??null);
  db.prepare(
    "INSERT INTO audit_logs(user_id, action, entity, entity_id, before, after, branch_id) VALUES(?,?,?,?,?,?,?)"
  ).run(
    session?.user.id ?? null,
    action,
    entity,
    entityId,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    auditBranch
  );
}

export function money(cents: number | null | undefined): string {
  return fmtMoney(cents);
}
