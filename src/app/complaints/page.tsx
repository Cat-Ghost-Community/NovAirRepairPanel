import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresShellState} from '@/lib/db/pg-shell';
import {readyApplicationPostgres} from '@/lib/db/pg-application';
import {PostgresComplaints} from '@/lib/db/pg-complaints';
import {hasPerm} from '@/lib/perms-shared';
import { requirePageAccess } from "@/lib/page-access";
import Link from "next/link";
import { getDb } from "@/lib/db/schema";
import { fmtDate, timeAgo, toFaDigits } from "@/lib/format";
import { EmptyState } from "@/components/ui";
import { NewComplaintButton } from "./new-complaint";
import { ComplaintActions } from "./complaint-actions";
import { Pagination } from "@/components/pagination";
import { countOf, resolvePaging } from "@/lib/pagination";
import { canUser } from "@/lib/auth";
import { activeBranch } from "@/lib/branch";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, string> = {
  open: "badge-amber", investigating: "badge-blue", waiting_customer: "badge-purple", resolved: "badge-green", closed: "badge-gray",
};
const STATUS_LABEL: Record<string, string> = { open: "باز", investigating: "در حال بررسی", waiting_customer: "در انتظار مشتری", resolved: "حل‌شده", closed: "بسته" };
const PRIORITY_LABEL: Record<string, string> = { low: "کم", normal: "معمولی", high: "زیاد", urgent: "فوری" };
const PRIORITY_BADGE: Record<string, string> = { low: "badge-gray", normal: "badge-gray", high: "badge-amber", urgent: "badge-red" };

export default async function ComplaintsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session=await requirePageAccess("/complaints");
  const cookieStore = await cookies();
  const sp = await searchParams;
  const {complaints,customers,tickets,open,page,perPage,totalPages,total,canManage}=await(async()=>{
   if(postgresIntegration()){
    const token=cookieStore.get('repaid_session')?.value,state=await postgresShellState(token,cookieStore.get('repaid_branch')?.value),{database,schema}=await readyApplicationPostgres(),service=new PostgresComplaints(database,schema),canManage=hasPerm(state.permissions,'complaints.manage'),data=await service.list(token,state.scope?.branchId??null,{page:Number(sp.page??1),perPage:Number(sp.perPage??50),q:sp.q,status:sp.status,priority:sp.priority});
    const customerData=canManage?await service.selectors(token,state.scope?.branchId??null,'customers'):null,ticketData=canManage?await service.selectors(token,state.scope?.branchId??null,'tickets'):null;
    return {...data,canManage,customers:customerData&&'customers'in customerData?(customerData.customers??[]):[],tickets:ticketData&&'tickets'in ticketData?(ticketData.tickets??[]):[]};
   }
  const db = getDb();
  const scope = activeBranch(session, cookieStore.get("repaid_branch")?.value);
  // قفل شعبه: شکایت از طریق پذیرش متصلش نسبت داده میشود (شکایت بدون پذیرش متعلق به همهٔ شعب)
  const branchClause = scope.all || scope.branchId == null ? "" : " AND COALESCE(co.branch_id,t.branch_id,(SELECT branch_id FROM customers WHERE id=co.customer_id),(SELECT MIN(a.branch_id) FROM customer_branch_access a WHERE a.customer_id=co.customer_id HAVING COUNT(*)=1)) = ?";
  const branchParams = scope.all || scope.branchId == null ? [] : [scope.branchId];
  let sql = `SELECT co.*, c.first_name, c.last_name, t.number ticket_number, u.name assigned_name
       FROM complaints co
       LEFT JOIN customers c ON c.id = co.customer_id
       LEFT JOIN repair_tickets t ON t.id = co.ticket_id
       LEFT JOIN users u ON u.id = co.assigned_to
       WHERE 1=1${branchClause}`;
  const params: any[] = [...branchParams];
  if (sp.status) { sql += " AND co.status = ?"; params.push(sp.status); }
  if (sp.priority) { sql += " AND co.priority = ?"; params.push(sp.priority); }
  if (sp.q) {
    sql += " AND (co.description LIKE ? OR co.category LIKE ? OR (c.first_name || ' ' || c.last_name) LIKE ?)";
    const like = `%${sp.q}%`;
    params.push(like, like, like);
  }
  const total = countOf(db, sql, params);
  const { page, perPage, offset, totalPages } = resolvePaging(sp, total);
  sql += ` ORDER BY co.created_at DESC LIMIT ${perPage} OFFSET ${offset}`;
  const complaints = JSON.parse(JSON.stringify(db.prepare(sql).all(...params) as any[])) as any[];

  const customers = (db.prepare("SELECT id, first_name, last_name, mobile FROM customers WHERE (? IS NULL OR id IN (SELECT customer_id FROM customer_branch_access WHERE branch_id=?)) ORDER BY first_name LIMIT 500").all(scope.branchId,scope.branchId) as any[]).map((c) => ({ id: c.id, first_name: c.first_name, last_name: c.last_name, mobile: c.mobile }));
  const tickets = (db.prepare(`SELECT id, number, customer_id FROM repair_tickets WHERE 1=1${scope.all || scope.branchId == null ? "" : " AND branch_id = ?"} ORDER BY id DESC LIMIT 300`).all(...branchParams) as any[]).map((t) => ({ id: t.id, number: t.number, customer_id: t.customer_id }));

  const open = Number((db.prepare(
    `SELECT COUNT(*) c FROM complaints co LEFT JOIN repair_tickets t ON t.id = co.ticket_id
     WHERE co.status IN ('open','investigating','waiting_customer')${branchClause}`
  ).get(...branchParams) as any).c);

  return {complaints,customers,tickets,open,page,perPage,totalPages,total,canManage:canUser(session,"complaints.manage")};
  })();

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="page-head">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="page-title">شکایات</h1>
            <p className="page-sub">{toFaDigits(open)} شکایت باز — هر شکایت به مشتری و سابقه تعمیر متصل می‌ماند تا چیزی فراموش نشود.</p>
          </div>
          {canManage&&<NewComplaintButton customers={customers} tickets={tickets} remote={!!postgresIntegration()} />}
        </div>
      </div>
      {complaints.length === 0 ? (
        <div className="card"><EmptyState icon="book" title="شکایتی نیست" body="وقتی مشتری ناراضی است، اینجا ثبت کنید تا الگوها دیده شود و چیزی فراموش نشود." /></div>
      ) : (
        <div className="space-y-2">
          {complaints.map((c) => (
            <div key={c.id} className="card card-pad">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                    {c.category} — {c.first_name ? <Link href={`/customers/${c.customer_id}`} className="text-brand-600 hover:underline">{c.first_name} {c.last_name}</Link> : "—"}
                    <span className={PRIORITY_BADGE[c.priority] ?? "badge-gray"}>اولویت {PRIORITY_LABEL[c.priority] ?? c.priority}</span>
                  </div>
                  <div className="text-[13px] text-zinc-500 mt-0.5">{c.description}</div>
                  <div className="text-xs text-zinc-400 mt-1">
                    {timeAgo(c.created_at)}
                    {c.ticket_number && <> · پذیرش <Link href={`/repairs/${c.ticket_id}`} className="font-mono text-brand-600 hover:underline">{c.ticket_number}</Link></>}
                    {c.assigned_name && <> · مسئول رسیدگی: {c.assigned_name}</>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={STATUS_BADGE[c.status] ?? "badge-gray"}>{STATUS_LABEL[c.status] ?? c.status}</span>
                  {canManage&&<ComplaintActions id={Number(c.id)} status={c.status} resolution={c.resolution} />}
                </div>
              </div>
              {c.resolution && <p className="mt-2 text-[13px] text-emerald-700 dark:text-emerald-400">نتیجه رسیدگی: {c.resolution}</p>}
              <p className="mt-1 text-xs text-zinc-300 dark:text-zinc-600">ثبت: {fmtDate(c.created_at)}</p>
            </div>
          ))}
          <div className="card overflow-hidden">
            <Pagination base="/complaints" sp={sp} page={page} totalPages={totalPages} total={total} perPage={perPage} unit="شکایت" />
          </div>
        </div>
      )}
    </div>
  );
}
