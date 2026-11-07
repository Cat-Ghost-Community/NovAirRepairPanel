import { requirePageAccess } from "@/lib/page-access";
import { getDb } from "@/lib/db/schema";
import { getSessionByToken, canUser } from "@/lib/auth";
import { activeBranch } from "@/lib/branch";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { fmtMoney, fmtDate } from "@/lib/format";
import { InstallmentsClient } from "./installments-client";
import { FilterForm, FilterField, NativeSelect } from "@/components/select";
import { Pagination } from "@/components/pagination";
import { countOf, resolvePaging } from "@/lib/pagination";
import { installmentCollected } from '@/lib/installments';

export const dynamic = "force-dynamic";

export default async function InstallmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageAccess("/installments");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "finance.view")) redirect("/");
  const sp = await searchParams;
  const db = getDb();
  const scope = activeBranch(session, cookieStore.get("repaid_branch")?.value);
  // قفل شعبه: قسط از طریق فاکتور متصلش نسبت داده میشود (قسط بدون فاکتور متعلق به همهٔ شعب)
  const branchClause = scope.all || scope.branchId == null ? "" : " AND i.branch_id = ?";
  const branchParams = scope.all || scope.branchId == null ? [] : [scope.branchId];

  // فیلترها: وضعیت، بازهٔ سررسید، مشتری/فاکتور
  let sql = `SELECT i.*, cu.first_name || ' ' || cu.last_name customer_name, inv.number invoice_number
     FROM effective_installments i LEFT JOIN customers cu ON cu.id = i.customer_id LEFT JOIN invoices inv ON inv.id = i.invoice_id
     WHERE 1=1${branchClause}`;
  const params: any[] = [...branchParams];
  if (sp.status) { sql += " AND i.status = ?"; params.push(sp.status); }
  if (sp.from) { sql += " AND i.due_date >= ?"; params.push(sp.from); }
  if (sp.to) { sql += " AND i.due_date <= ?"; params.push(sp.to); }
  if (sp.overdue === "1") { sql += " AND i.status != 'paid' AND i.due_date < date('now')"; }
  if (sp.q) {
    sql += " AND ((cu.first_name || ' ' || cu.last_name) LIKE ? OR inv.number LIKE ?)";
    const like = `%${sp.q}%`;
    params.push(like, like);
  }
  const total = countOf(db, sql, params);
  const { page, perPage, offset, totalPages } = resolvePaging(sp, total);
  const installments = db.prepare(`${sql} ORDER BY i.due_date ASC LIMIT ${perPage} OFFSET ${offset}`).all(...params);
  const fp = { status: sp.status ?? "", from: sp.from ?? "", to: sp.to ?? "", q: sp.q ?? "", overdue: sp.overdue ?? "" };
  const totals = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN i.legacy_review=0 AND i.status IN ('pending','partially_paid','overdue') THEN i.amount - i.paid_amount END),0) remaining,
            COALESCE(SUM(CASE WHEN i.legacy_review=0 THEN i.paid_amount ELSE 0 END),0) collected
     FROM effective_installments i LEFT JOIN invoices inv ON inv.id = i.invoice_id WHERE 1=1${branchClause}`
  ).get(...branchParams) as any;
  totals.collected=installmentCollected(db,scope.branchId);
  const unpaidInvoices = db.prepare(
    `SELECT id, number, total - paid remaining FROM effective_invoices WHERE type!='purchase' AND status NOT IN ('draft','cancelled') AND total - paid > 0${scope.all || scope.branchId == null ? "" : " AND branch_id = ?"} ORDER BY id DESC LIMIT 50`
  ).all(...branchParams);

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">مدیریت اقساط</h1>
          <p className="text-sm text-zinc-500 mt-0.5">قسط‌بندی خودکار و دستی، یادآور سررسید، پرداخت قسط</p>
        </div>
        <div className="flex gap-3">
          <div className="kpi min-w-40">
            <div className="kpi-label">مانده اقساط</div>
            <div className="kpi-value">{fmtMoney(totals.remaining)}</div>
          </div>
          <div className="kpi min-w-40">
            <div className="kpi-label">وصول‌شده</div>
            <div className="kpi-value text-emerald-600">{fmtMoney(totals.collected)}</div>
          </div>
        </div>
      </div>

      <FilterForm action="/installments">
        <FilterField label="وضعیت">
          <NativeSelect
            size="sm"
            name="status"
            ariaLabel="وضعیت قسط"
            placeholder="همه"
            defaultValue={fp.status}
            options={[
              { value: "pending", label: "در انتظار" },
              { value: "partially_paid", label: "نیمه‌پرداخت" },
              { value: "paid", label: "پرداخت‌شده" },
            ]}
          />
        </FilterField>
        <FilterField label="سررسید از">
          <input className="input num !py-1.5 !text-[13px]" type="date" dir="ltr" name="from" defaultValue={fp.from} />
        </FilterField>
        <FilterField label="سررسید تا">
          <input className="input num !py-1.5 !text-[13px]" type="date" dir="ltr" name="to" defaultValue={fp.to} />
        </FilterField>
        <FilterField label="جستجو">
          <input className="input !py-1.5 !text-[13px]" name="q" defaultValue={fp.q} placeholder="نام مشتری یا شماره فاکتور" />
        </FilterField>
        <label className="flex items-center gap-2 pb-1.5 text-[13px]">
          <input type="checkbox" name="overdue" value="1" defaultChecked={fp.overdue === "1"} className="h-4 w-4" />
          فقط سررسید گذشته
        </label>
      </FilterForm>

      <InstallmentsClient
        installments={JSON.parse(JSON.stringify(installments))}
        invoices={JSON.parse(JSON.stringify(unpaidInvoices))}
        canManage={canUser(session,"finance.manage")} canReceive={canUser(session,"payments.create")}
      />

      <div className="mt-3">
        <Pagination base="/installments" sp={sp} page={page} totalPages={totalPages} total={total} perPage={perPage} unit="قسط" />
      </div>
    </div>
  );
}
