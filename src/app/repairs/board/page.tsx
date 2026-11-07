import { SearchableSelect } from "@/components/searchable-select";
import {repairReadAssignedOnly,repairWorkflow} from '@/lib/repair-workflow';
import { requirePageAccess } from "@/lib/page-access";
import { getDb } from "@/lib/db/schema";
import { cookies } from "next/headers";
import { activeBranch, branchWhere, BRANCH_COOKIE } from "@/lib/branch";
import { INVOICE_BALANCES_CTE } from "@/lib/payment-state";
import { resolvePaging, countOf } from "@/lib/pagination";
import { Pagination } from "@/components/pagination";
import Link from "next/link";
import { BoardClient } from "./board-client";
import { plainRows,faNum } from "@/lib/format";
import { canUser } from "@/lib/auth";
import { boardHref,type BoardView } from "@/lib/board-shared";

export const dynamic = "force-dynamic";

export default async function BoardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requirePageAccess("/repairs/board");
  const scope = activeBranch(session, (await cookies()).get(BRANCH_COOKIE)?.value);
  const branch = branchWhere(scope, "t");
  const sp = await searchParams;
  const db = getDb();
  const statuses = db.prepare("SELECT id, name, color, category, is_open, allowed_next FROM repair_statuses ORDER BY sort, id").all() as any[];
  const view:BoardView=['overview','board','list'].includes(sp.view??'')?sp.view as BoardView:'overview';
  const activeStatus=statuses.some(s=>String(s.id)===sp.status)?sp.status??'':'';

  const projection = `SELECT t.id, t.number, t.priority, t.problem, t.estimated_completion, t.ready_at, t.is_warranty,
    t.status_id, t.customer_id, t.technician_id,t.technician2_id,t.created_at, c.first_name, c.last_name, c.mobile,
    d.brand, d.model, d.type, s.name status_name, s.color status_color, s.category status_category, u.name tech_name, u.avatar_color, b.name branch_name,
    (SELECT COALESCE(SUM(MAX(total-settled_paid,0)),0) FROM invoice_balances i WHERE i.ticket_id=t.id AND i.type!='purchase' AND i.status NOT IN ('draft','cancelled')) balance `;
  let from = `FROM repair_tickets t
    JOIN repair_statuses s ON s.id = t.status_id
    JOIN customers c ON c.id = t.customer_id
    JOIN devices d ON d.id = t.device_id
    LEFT JOIN users u ON u.id = t.technician_id
    LEFT JOIN branches b ON b.id = t.branch_id
    WHERE (s.category != 'closed' OR s.name IN ('Ready for Pickup','آماده تحویل')) AND ${branch.sql}`;
  const params: (string | number)[] = [...branch.params];
  if (session.user.role === 'technician' && (repairWorkflow(db,Number(session.user.branch_id)).mode==='legacy'||repairReadAssignedOnly(session))) {
    from += " AND (t.technician_id=? OR t.technician2_id=?)";
    params.push(session.user.id, session.user.id);
  }
  if (sp.tech) { from += " AND t.technician_id = ?"; params.push(Number(sp.tech)); }
  if (sp.q) {
    from += " AND (t.number LIKE ? OR c.first_name || ' ' || c.last_name LIKE ? OR d.brand || ' ' || d.model LIKE ?)";
    const like = `%${sp.q}%`;
    params.push(like, like, like);
  }
  const counts=db.prepare(`SELECT t.status_id,COUNT(*) total,
    SUM(CASE WHEN t.technician_id IS NULL AND t.technician2_id IS NULL THEN 1 ELSE 0 END) unassigned,
    SUM(CASE WHEN t.estimated_completion IS NOT NULL AND t.estimated_completion<datetime('now') AND s.name NOT IN ('Ready for Pickup','Delivered') THEN 1 ELSE 0 END) overdue
    ${from} GROUP BY t.status_id`).all(...params) as Array<{status_id:number;total:number;unassigned:number;overdue:number}>;
  if(activeStatus){from+=' AND t.status_id=?';params.push(Number(activeStatus));}
  const total = countOf(db, `SELECT t.id ${from}`, params);
  const paging = resolvePaging(sp, total);
  const order="CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,t.created_at,t.id";
  const previewLimit=!activeStatus&&view!=='list'?(view==='board'?20:sp.density==='compact'?4:3):null;
  // Rank scoped IDs first. Financial balances are loaded only for the bounded visible previews.
  const tickets = (previewLimit===null
    ? db.prepare(`${INVOICE_BALANCES_CTE} ${projection}${from} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params,paging.perPage,paging.offset)
    : db.prepare(`${INVOICE_BALANCES_CTE}, board_ranking AS (SELECT t.id,ROW_NUMBER() OVER(PARTITION BY t.status_id ORDER BY ${order}) stage_rank ${from}) ${projection}${from} AND t.id IN (SELECT id FROM board_ranking WHERE stage_rank<=?) ORDER BY ${order}`).all(...params,...params,previewLimit)) as any[];

  const technicians = db.prepare("SELECT id,name FROM users WHERE role='technician' AND is_active=1 AND (? IS NULL OR branch_id=?) ORDER BY name").all(scope.branchId, scope.branchId) as any[];

  return (
    <div className="mx-auto flex min-w-0 max-w-[1800px] flex-col gap-4 p-4 sm:p-6">
      <div className="card flex min-w-0 items-center justify-between flex-wrap gap-4 p-4 sm:p-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight">تابلوی وضعیت</h1>
          <p className="page-sub leading-6">نمای کلی، تابلوی ستونی یا فهرست فشرده؛ مسیر کار را متناسب با نیازتان ببینید و مدیریت کنید.</p>
        </div>
        <div className="flex w-full min-w-0 items-center gap-2 flex-wrap">
          <form className="flex flex-1 flex-wrap gap-2 min-w-0">
            <input type="hidden" name="view" value={view} />
            {activeStatus&&<input type="hidden" name="status" value={activeStatus} />}
            {sp.density&&<input type="hidden" name="density" value={sp.density} />}
            <input name="q" defaultValue={sp.q} placeholder="شماره پذیرش، مشتری یا دستگاه…" className="input min-w-0 flex-1 basis-48" aria-label="جستجو در تابلو" />
            <SearchableSelect name="tech" defaultValue={sp.tech ?? ""} className="input w-full sm:!w-44" aria-label="فیلتر تعمیرکار">
              <option value="">همه تعمیرکاران</option>
              {technicians.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </SearchableSelect>
            <button className="btn-secondary btn-sm">فیلتر</button>
            {(sp.q || sp.tech || activeStatus) && <Link href={boardHref(sp,{q:null,tech:null,status:null})} className="btn-ghost btn-sm">پاک‌کردن فیلترها</Link>}
          </form>
          <Link href="/repairs" className="btn-ghost btn-sm">فهرست پذیرش‌ها</Link>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">{[['پذیرش در کل نتایج',counts.reduce((n,c)=>n+Number(c.total),0)],['بدون تعمیرکار',counts.reduce((n,c)=>n+Number(c.unassigned),0)],['گذشته از موعد',counts.reduce((n,c)=>n+Number(c.overdue),0)]].map(([label,count])=><div key={label} className="card min-w-0 p-3 sm:p-4"><p className="text-[11px] leading-5 text-zinc-500 sm:text-xs">{label}</p><p className="mt-2 text-xl font-bold tabular-nums">{faNum(Number(count))}</p></div>)}</div>
        <div className="min-w-0">
          <BoardClient
            key={[view,sp.density,activeStatus,sp.q,sp.tech,...tickets.map(t => `${t.id}:${t.status_id}`)].join(",")}
            view={view} compact={sp.density==='compact'} activeStatus={activeStatus} query={sp}
            workerId={session.user.role==='technician'&&repairWorkflow(db,Number(session.user.branch_id)).mode!=='legacy'?session.user.id:undefined}
            canMove={canUser(session, "repairs.status")}
            statuses={plainRows(statuses.map((s: any) => ({ id: s.id, name: s.name, color: s.color, is_open: s.is_open, total:Number(counts.find(c=>c.status_id===s.id)?.total??0),allowed_next: JSON.parse(s.allowed_next || "[]") })))}
            tickets={plainRows(tickets)}
          />
        </div>
      {total > 0 && previewLimit===null && <div className="card min-w-0 overflow-hidden"><Pagination base="/repairs/board" sp={sp} {...paging} unit="پذیرش" /></div>}
    </div>
  );
}
