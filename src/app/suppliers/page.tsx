import { activeBranch,BRANCH_COOKIE } from '@/lib/branch';
import { requirePageAccess } from "@/lib/page-access";
import { fmtMoney, toFaDigits } from "@/lib/format";
import Link from "next/link";
import { getDb } from "@/lib/db/schema";
import { EmptyState } from "@/components/ui";
import { Pagination } from "@/components/pagination";
import { countOf, resolvePaging } from "@/lib/pagination";
import { getSessionByToken, canUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageAccess("/suppliers");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "suppliers.view")) redirect("/");
  const sp = await searchParams;
  const db = getDb();
  const financialBranch=activeBranch(session,cookieStore.get(BRANCH_COOKIE)?.value).branchId;
  let sql = `SELECT s.*,
        (SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id = s.id AND (:financialBranch IS NULL OR po.branch_id=:financialBranch)) po_count,
        (SELECT COALESCE(SUM(po.total),0) FROM purchase_orders po WHERE po.supplier_id = s.id AND po.status != 'cancelled' AND (:financialBranch IS NULL OR po.branch_id=:financialBranch)) po_total,
        (SELECT COUNT(*) FROM parts p WHERE p.preferred_supplier_id = s.id) part_count,
        (SELECT COUNT(*) FROM supplier_purchase_items i WHERE i.supplier_id = s.id AND i.status IN ('pending','ordered') AND (:financialBranch IS NULL OR i.branch_id=:financialBranch)) open_list_count
       FROM suppliers s WHERE s.is_archived = 0`;
  const params: any[] = [{financialBranch}];
  if (sp.q) {
    sql += " AND (s.name LIKE ? OR s.company LIKE ? OR s.phone LIKE ? OR s.contact_person LIKE ?)";
    const like = `%${sp.q}%`;
    params.push(like, like, like, like);
  }
  const total = countOf(db, sql, params);
  const { page, perPage, offset, totalPages } = resolvePaging(sp, total);
  sql += ` ORDER BY s.name LIMIT ${perPage} OFFSET ${offset}`;
  const suppliers = JSON.parse(JSON.stringify(db.prepare(sql).all(...params) as any[])) as any[];

  // بدهی به تأمین‌کنندگان: سفارش‌های خرید باز + سنی‌بندی بر اساس تاریخ انتظار
  const payables=db.prepare(`WITH due AS(SELECT supplier_id,COALESCE(due_date,date) due,MAX(0,total-paid) balance FROM effective_invoices WHERE type='purchase' AND status NOT IN ('draft','cancelled') AND (:financialBranch IS NULL OR branch_id=:financialBranch))
    SELECT s.id,s.name supplier_name,COUNT(*) open_pos,SUM(d.balance) due_total,
    SUM(CASE WHEN d.due>=date('now') THEN d.balance ELSE 0 END) not_due,
    SUM(CASE WHEN d.due<date('now') AND d.due>=date('now','-30 days') THEN d.balance ELSE 0 END) d30,
    SUM(CASE WHEN d.due<date('now','-30 days') AND d.due>=date('now','-60 days') THEN d.balance ELSE 0 END) d60,
    SUM(CASE WHEN d.due<date('now','-60 days') THEN d.balance ELSE 0 END) d60p
    FROM due d JOIN suppliers s ON s.id=d.supplier_id WHERE d.balance>0 GROUP BY s.id ORDER BY due_total DESC LIMIT 12`).all({financialBranch}) as any[];
  const payablesTotal = payables.reduce((sum, r) => sum + Number(r.due_total ?? 0), 0);

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="page-head">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="page-title">تأمین‌کنندگان</h1>
            <p className="page-sub">{toFaDigits(total)} تأمین‌کننده</p>
          </div>
          <Link href="/suppliers/new" className="btn-primary">+ تأمین‌کننده جدید</Link>
        </div>
      </div>
      {payables.length > 0 && (
        <div className="card card-pad mb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="section-title">بدهی به تأمین‌کنندگان</h2>
            <span className="badge-amber">جمع کل: {fmtMoney(payablesTotal)}</span>
          </div>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            بر اساس تعهد خالص فاکتورهای قطعی، اعتبارنامه‌ها و تسویه‌های واقعی در شعبهٔ انتخاب‌شده؛ سفارش خرید به‌تنهایی بدهی محسوب نمی‌شود.
          </p>
          <div className="mt-3 table-wrap">
            <table className="w-full">
              <thead className="border-b border-zinc-200 dark:border-zinc-800">
                <tr>
                  <th className="th">تأمین‌کننده</th>
                  <th className="th">فاکتور باز</th>
                  <th className="th">سرنرسیده</th>
                  <th className="th">۱ تا ۳۰ روز</th>
                  <th className="th">۳۱ تا ۶۰ روز</th>
                  <th className="th">بیش از ۶۰ روز</th>
                  <th className="th">جمع بدهی</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {payables.map((p) => (
                  <tr key={p.id} className="row-hover">
                    <td className="td"><Link href={`/suppliers/${p.id}`} className="font-medium text-brand-600 hover:underline">{p.supplier_name}</Link></td>
                    <td className="td tabular-nums">{toFaDigits(p.open_pos)}</td>
                    <td className="td tabular-nums">{p.not_due ? fmtMoney(p.not_due) : "—"}</td>
                    <td className="td tabular-nums">{p.d30 ? fmtMoney(p.d30) : "—"}</td>
                    <td className="td tabular-nums">{p.d60 ? fmtMoney(p.d60) : "—"}</td>
                    <td className="td tabular-nums text-red-600 dark:text-red-400">{p.d60p ? fmtMoney(p.d60p) : "—"}</td>
                    <td className="td tabular-nums font-medium">{fmtMoney(p.due_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {suppliers.length === 0 ? (
        <div className="card"><EmptyState icon="factory" title="هنوز تأمین‌کننده‌ای نیست" body="تأمین‌کنندگان برای سفارش خرید و تهیه قطعه استفاده می‌شوند." action={<Link href="/suppliers/new" className="btn-primary">افزودن تأمین‌کننده</Link>} /></div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {suppliers.map((s) => (
            <Link key={s.id} href={`/suppliers/${s.id}`} className="card card-pad hover:border-brand-400 transition-colors">
              <div className="font-semibold">{s.name}</div>
              {s.company && s.company !== s.name && <div className="text-xs text-zinc-400">{s.company}</div>}
              <div className="mt-2 text-[13px] text-zinc-500 space-y-0.5">
                {s.contact_person && <div>{s.contact_person}</div>}
                {s.phone && <div>{s.phone}</div>}
                {s.payment_terms && <div>{s.payment_terms}</div>}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="chip">{toFaDigits(s.po_count)} سفارش خرید</span>
                <span className="chip">{toFaDigits(s.part_count)} قطعه</span>
                {Number(s.open_list_count) > 0 && <span className="badge-amber">{toFaDigits(s.open_list_count)} قلم لیست خرید</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
      {suppliers.length > 0 && (
        <div className="card mt-3 overflow-hidden">
          <Pagination base="/suppliers" sp={sp} page={page} totalPages={totalPages} total={total} perPage={perPage} unit="تأمین‌کننده" />
        </div>
      )}
    </div>
  );
}
