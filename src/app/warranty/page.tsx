import { requirePageAccess } from "@/lib/page-access";
import Link from "next/link";
import { getDb } from "@/lib/db/schema";
import { fmtDate, fmtMoney, toFaDigits } from "@/lib/format";
import { EmptyState } from "@/components/ui";
import { NewWarrantyButton, ClaimButton, ClaimActions } from "./warranty-actions";
import { Pagination } from "@/components/pagination";
import { countOf, resolvePaging } from "@/lib/pagination";
import { getSessionByToken, canUser } from "@/lib/auth";
import { activeBranch } from "@/lib/branch";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const KIND_FA: Record<string, string> = { repair: "گارانتی تعمیر", part: "گارانتی قطعه", sale: "گارانتی فروش" };
const CLAIM_STATUS: Record<string, { label: string; badge: string }> = {
  open: { label: "باز", badge: "badge-amber" },
  investigating: { label: "در حال بررسی", badge: "badge-blue" },
  resolved: { label: "تأیید و انجام شد", badge: "badge-green" },
  rejected: { label: "رد شد", badge: "badge-red" },
};

export default async function WarrantyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageAccess("/warranty");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "warranty.view")) redirect("/");
  const sp = await searchParams;
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const scope = activeBranch(session, cookieStore.get("repaid_branch")?.value);
  // قفل شعبه: گارانتی از طریق پذیرش متصلش نسبت داده میشود (گارانتی بدون پذیرش متعلق به همهٔ شعب)
  const branchClause = scope.all || scope.branchId == null ? "" : " AND COALESCE(w.branch_id,(SELECT branch_id FROM repair_tickets WHERE id=w.ticket_id),(SELECT branch_id FROM invoices WHERE id=w.invoice_id),(SELECT branch_id FROM sales WHERE id=w.sale_id),(SELECT branch_id FROM customers WHERE id=w.customer_id),(SELECT MIN(a.branch_id) FROM customer_branch_access a WHERE a.customer_id=w.customer_id HAVING COUNT(*)=1)) = ?";
  const branchParams = scope.all || scope.branchId == null ? [] : [scope.branchId];

  let sql = `SELECT w.*, c.first_name, c.last_name, t.number ticket_number,
        (SELECT COUNT(*) FROM warranty_claims wc WHERE wc.warranty_id = w.id) claim_count
       FROM warranties w
       LEFT JOIN customers c ON c.id = w.customer_id
       LEFT JOIN repair_tickets t ON t.id = w.ticket_id
       WHERE 1=1${branchClause}`;
  const params: any[] = [...branchParams];
  if (sp.status === "active") sql += " AND w.status = 'active' AND w.end_date >= ?", params.push(today);
  if (sp.status === "expired") sql += " AND w.end_date < ?", params.push(today);
  if (sp.q) {
    sql += " AND (COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'') LIKE ? OR t.number LIKE ?)";
    const like = `%${sp.q}%`;
    params.push(like, like);
  }
  const total = countOf(db, sql, params);
  const { page, perPage, offset, totalPages } = resolvePaging(sp, total);
  sql += ` ORDER BY w.created_at DESC LIMIT ${perPage} OFFSET ${offset}`;
  const warranties = JSON.parse(JSON.stringify(db.prepare(sql).all(...params) as any[])) as any[];
  const claims = JSON.parse(JSON.stringify(db
    .prepare(
      `SELECT wc.*, w.kind, t.number ticket_number, c.first_name, c.last_name
       FROM warranty_claims wc JOIN warranties w ON w.id = wc.warranty_id
       LEFT JOIN repair_tickets t ON t.id = wc.ticket_id
       LEFT JOIN customers c ON c.id = (SELECT customer_id FROM repair_tickets WHERE id = wc.ticket_id)
       WHERE 1=1${branchClause}
       ORDER BY wc.created_at DESC LIMIT 50`
    )
    .all(...branchParams) as any[])) as any[];

  const active = Number((db.prepare(
    `SELECT COUNT(*) c FROM warranties w LEFT JOIN repair_tickets t ON t.id = w.ticket_id
     WHERE w.status = 'active' AND w.end_date >= ?${branchClause}`
  ).get(today, ...branchParams) as any).c);
  const openClaims = Number((db.prepare(
    `SELECT COUNT(*) c FROM warranty_claims wc JOIN warranties w ON w.id = wc.warranty_id LEFT JOIN repair_tickets t ON t.id = w.ticket_id
     WHERE wc.status IN ('open','investigating')${branchClause}`
  ).get(...branchParams) as any).c);

  const customers = (db.prepare("SELECT id, first_name, last_name FROM customers WHERE (? IS NULL OR id IN (SELECT customer_id FROM customer_branch_access WHERE branch_id=?)) ORDER BY first_name LIMIT 500").all(scope.branchId,scope.branchId) as any[]).map((c) => ({ id: c.id, first_name: c.first_name, last_name: c.last_name }));
  const tickets = (db.prepare(`SELECT id, number, customer_id FROM repair_tickets WHERE 1=1${scope.all || scope.branchId == null ? "" : " AND branch_id = ?"} ORDER BY id DESC LIMIT 300`).all(...branchParams) as any[]).map((t) => ({ id: t.id, number: t.number, customer_id: t.customer_id }));
  const activeWarranties = (db
    .prepare(
      `SELECT w.id, w.kind, w.end_date, t.number ticket_number, c.first_name, c.last_name
       FROM warranties w LEFT JOIN repair_tickets t ON t.id = w.ticket_id
       LEFT JOIN customers c ON c.id = w.customer_id
       WHERE w.status = 'active' AND w.end_date >= ?${branchClause} ORDER BY w.end_date`
    )
    .all(today, ...branchParams) as any[])
    .map((w) => ({
      id: w.id, kind: w.kind, end_date: w.end_date,
      ticket_number: w.ticket_number ?? null,
      customer: w.first_name ? `${w.first_name} ${w.last_name}` : "—",
    }));

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 space-y-4">
      <div className="page-head page-head-flush">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="page-title">گارانتی</h1>
            <p className="page-sub">
              {toFaDigits(active)} گارانتی فعال · {toFaDigits(openClaims)} درخواست در انتظار رسیدگی
            </p>
          </div>
          <div className="flex items-center gap-2">
            <NewWarrantyButton customers={customers} tickets={tickets} />
            <ClaimButton warranties={activeWarranties} />
          </div>
        </div>
      </div>

      {warranties.length === 0 ? (
        <div className="card"><EmptyState icon="shield" title="گارانتی‌ای ثبت نشده" body="هر تعمیر تحویل‌شده خودکار بر اساس دوره گارانتی خدمات، رکورد گارانتی می‌گیرد. همچنین می‌توانید از دکمه بالا به‌صورت دستی گارانتی صادر کنید." /></div>
      ) : (
        <section className="card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="th">تعمیر</th><th className="th">مشتری</th><th className="th">شرایط</th>
                <th className="th">معتبر تا</th><th className="th">درخواست‌ها</th><th className="th">وضعیت</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {warranties.map((w) => {
                const expired = w.end_date < today;
                return (
                  <tr key={w.id} className="row-hover">
                    <td className="td">{w.ticket_number ? <Link href={`/repairs/${w.ticket_id}`} className="font-mono text-[13px] text-brand-600 hover:underline">{w.ticket_number}</Link> : "—"}</td>
                    <td className="td">{w.first_name ? <Link href={`/customers/${w.customer_id}`} className="hover:underline">{w.first_name} {w.last_name}</Link> : "—"}</td>
                    <td className="td text-zinc-500">{w.terms}</td>
                    <td className="td whitespace-nowrap">{fmtDate(w.end_date)}</td>
                    <td className="td">{w.claim_count > 0 ? <span className="badge-amber">{toFaDigits(String(w.claim_count))}</span> : "۰"}</td>
                    <td className="td">{expired ? <span className="badge-gray">منقضی</span> : <span className="badge-green">فعال</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          <Pagination base="/warranty" sp={sp} page={page} totalPages={totalPages} total={total} perPage={perPage} unit="گارانتی" />
        </section>
      )}

      {claims.length > 0 && (
        <section className="card">
          <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800"><h2 className="section-title">درخواست‌های گارانتی</h2></div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {claims.map((c) => {
              const st = CLAIM_STATUS[c.status] ?? { label: c.status, badge: "badge-gray" };
              return (
                <div key={c.id} className="px-5 py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{c.reason}</div>
                    <div className="text-xs text-zinc-400">
                      {c.ticket_number ?? ""}{c.first_name ? ` · ${c.first_name} ${c.last_name}` : ""} · {fmtDate(c.created_at)}
                    </div>
                    {c.resolution && <div className="text-[13px] text-emerald-700 dark:text-emerald-400 mt-1">نتیجه: {c.resolution}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    {c.cost > 0 && <span className="text-xs text-red-500">{fmtMoney(c.cost)}</span>}
                    <span className={st.badge}>{st.label}</span>
                    <ClaimActions claimId={Number(c.id)} status={c.status} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
