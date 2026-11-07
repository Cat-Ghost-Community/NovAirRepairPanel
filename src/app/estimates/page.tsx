import { requirePageAccess } from "@/lib/page-access";
import { toFaDigits, fmtMoney, fmtDate } from "@/lib/format";
import Link from "next/link";
import { getDb } from "@/lib/db/schema";
import { EmptyState } from "@/components/ui";
import { EstStatusBadge } from "@/app/repairs/[id]/workspace-client";
import { Pagination } from "@/components/pagination";
import { countOf, resolvePaging } from "@/lib/pagination";
import { Icon } from "@/components/icon";
import { getSessionByToken, canUser } from "@/lib/auth";
import { activeBranch } from "@/lib/branch";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function EstimatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageAccess("/estimates");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "estimates.view")) redirect("/");
  const sp = await searchParams;
  const db = getDb();
  const scope = activeBranch(session, cookieStore.get("repaid_branch")?.value);
  // قفل شعبه: برآورد از طریق پذیرش متصلش به شعبه نسبت داده میشود (برآورد بدون پذیرش متعلق به همهٔ شعب)
  const branchClause = scope.all || scope.branchId == null ? "" : " AND (t.branch_id = ? OR t.branch_id IS NULL)";
  let sql = `SELECT e.*, c.first_name, c.last_name, c.company, t.number ticket_number
       FROM estimates e
       JOIN customers c ON c.id = e.customer_id
       LEFT JOIN repair_tickets t ON t.id = e.ticket_id
       WHERE 1=1${branchClause}`;
  const params: any[] = scope.all || scope.branchId == null ? [] : [scope.branchId];
  if (sp.status) { sql += " AND e.status = ?"; params.push(sp.status); }
  if (sp.q) {
    sql += " AND (e.number LIKE ? OR (c.first_name || ' ' || c.last_name) LIKE ? OR c.company LIKE ?)";
    const like = `%${sp.q}%`;
    params.push(like, like, like);
  }
  const total = countOf(db, sql, params);
  const { page, perPage, offset, totalPages } = resolvePaging(sp, total);
  sql += ` ORDER BY e.created_at DESC LIMIT ${perPage} OFFSET ${offset}`;
  const estimates = JSON.parse(JSON.stringify(db.prepare(sql).all(...params) as any[])) as any[];

  const pending = Number((db.prepare(
    `SELECT COUNT(*) c FROM estimates e LEFT JOIN repair_tickets t ON t.id = e.ticket_id
     WHERE e.status IN ('sent','viewed')${branchClause}`
  ).get(...(scope.all || scope.branchId == null ? [] : [scope.branchId])) as any).c);

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="page-head">
        <h1 className="page-title">برآوردها</h1>
        <p className="page-sub">
          {toFaDigits(pending)} در انتظار پاسخ مشتری · {toFaDigits(total)} برآورد
        </p>
      </div>
      {estimates.length === 0 ? (
        <div className="card"><EmptyState icon="clipboard" title="هنوز برآوردی نیست" body="برآورد را از تب قطعات و اجرت پذیرش بسازید — مشتری از لینک پیگیری تأیید می‌کند." /></div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="th">برآورد</th><th className="th">مشتری</th><th className="th hidden md:table-cell">تعمیر</th>
                <th className="th">جمع کل</th><th className="th">وضعیت</th><th className="th hidden sm:table-cell">معتبر تا</th><th className="th">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {estimates.map((e) => (
                <tr key={e.id} className="row-hover">
                  <td className="td"><Link href={`/estimates/${e.id}`} className="font-mono text-[13px] font-semibold text-brand-600 hover:underline">{e.number}</Link><span className="text-xs text-zinc-400"> نسخهٔ {toFaDigits(e.version)}</span></td>
                  <td className="td">{e.company ?? `${e.first_name} ${e.last_name}`}</td>
                  <td className="td hidden md:table-cell font-mono text-xs">{e.ticket_number ?? "—"}</td>
                  <td className="td font-medium">{fmtMoney(e.total)}</td>
                  <td className="td"><EstStatusBadge status={e.status} /></td>
                  <td className="td hidden sm:table-cell text-zinc-500">{fmtDate(e.valid_until)}</td>
                  <td className="td">
                    <div className="flex gap-1">
                      <Link href={`/estimates/${e.id}`} className="btn-ghost btn-sm">مشاهده</Link>
                      <a href={`/api/estimates/${e.id}/document`} target="_blank" rel="noreferrer" className="btn-ghost btn-sm" title="نسخهٔ چاپی برآورد">
                        <Icon name="printer" size={14} /> چاپ
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <Pagination base="/estimates" sp={sp} page={page} totalPages={totalPages} total={total} perPage={perPage} unit="برآورد" />
        </div>
      )}
    </div>
  );
}
