import { requirePageAccess } from "@/lib/page-access";
import { getDb } from "@/lib/db/schema";
import { getSessionByToken, canUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { BRANCH_COOKIE, activeBranch, branchWhere } from "@/lib/branch";
import { redirect } from "next/navigation";
import { fmtMoney, fmtDate, faNum } from "@/lib/format";
import { ChecksClient } from "./checks-client";
import { FilterForm, FilterField, NativeSelect } from "@/components/select";
import { Pagination } from "@/components/pagination";
import { countOf, resolvePaging } from "@/lib/pagination";

export const dynamic = "force-dynamic";

const STATUS_FA: Record<string, string> = {
  in_hand: "در دست",
  passed: "وصول‌شده",
  bounced: "برگشتی",
  transferred_spend: "خرج‌شده",
  deposited: "خوابانده به بانک",
  returned_to_bank: "برگشت به بانک",
};

export default async function ChecksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageAccess("/checks");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "finance.view")) redirect("/");
  const sp = await searchParams;
  const db = getDb();

  // فیلترها: نوع سند، وضعیت، حساب بانکی، بازهٔ سررسید و جستجو
  let sql = `SELECT c.*, cu.first_name || ' ' || cu.last_name customer_name, ba.name bank_account_name
     FROM checks c LEFT JOIN customers cu ON cu.id = c.customer_id LEFT JOIN bank_accounts ba ON ba.id = c.bank_account_id
     WHERE 1=1`;
  const params: any[] = [];
  const bScope = branchWhere(activeBranch(session, cookieStore.get(BRANCH_COOKIE)?.value), "c");
  if (bScope.sql !== "1=1") { sql += ` AND ${bScope.sql}`; params.push(...bScope.params); }
  if (sp.kind) { sql += " AND c.kind = ?"; params.push(sp.kind); }
  if (sp.status) { sql += " AND c.status = ?"; params.push(sp.status); }
  if (sp.account) { sql += " AND c.bank_account_id = ?"; params.push(Number(sp.account)); }
  if (sp.from) { sql += " AND c.due_date >= ?"; params.push(sp.from); }
  if (sp.to) { sql += " AND c.due_date <= ?"; params.push(sp.to); }
  if (sp.q) {
    sql += " AND (c.number LIKE ? OR c.sayad_id LIKE ? OR (cu.first_name || ' ' || cu.last_name) LIKE ?)";
    const like = `%${sp.q}%`;
    params.push(like, like, like);
  }
  const total = countOf(db, sql, params);
  const { page, perPage, offset, totalPages } = resolvePaging(sp, total);
  const checks = db.prepare(`${sql} ORDER BY c.due_date ASC LIMIT ${perPage} OFFSET ${offset}`).all(...params);
  const accounts = db.prepare("SELECT id, name, bank_name FROM bank_accounts WHERE is_active = 1").all();
  const summary = db.prepare(`SELECT c.kind, c.status, COUNT(*) count, SUM(c.amount) total FROM checks c WHERE ${bScope.sql} GROUP BY c.kind, c.status`).all(...bScope.params);
  const filterParams = { kind: sp.kind ?? "", status: sp.status ?? "", account: sp.account ?? "", from: sp.from ?? "", to: sp.to ?? "", q: sp.q ?? "" };

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">مدیریت چک‌ها</h1>
          <p className="text-sm text-zinc-500 mt-0.5">چک‌های دریافتی و پرداختی، وصول، برگشت، خرج و خواباندن به بانک</p>
        </div>
      </div>

      <FilterForm action="/checks">
        <FilterField label="نوع سند">
          <NativeSelect
            size="sm"
            name="kind"
            ariaLabel="نوع سند"
            placeholder="همه"
            defaultValue={filterParams.kind}
            options={[{ value: "received", label: "دریافتی" }, { value: "issued", label: "پرداختی" }]}
          />
        </FilterField>
        <FilterField label="وضعیت">
          <NativeSelect
            size="sm"
            name="status"
            ariaLabel="وضعیت چک"
            placeholder="همه"
            defaultValue={filterParams.status}
            options={Object.entries(STATUS_FA).map(([value, label]) => ({ value, label }))}
          />
        </FilterField>
        <FilterField label="حساب بانکی">
          <NativeSelect
            size="sm"
            name="account"
            ariaLabel="حساب بانکی"
            placeholder="همه حساب‌ها"
            defaultValue={filterParams.account}
            options={(accounts as any[]).map((a) => ({ value: String(a.id), label: a.bank_name ? `${a.name} — ${a.bank_name}` : String(a.name) }))}
          />
        </FilterField>
        <FilterField label="سررسید از">
          <input className="input num !py-1.5 !text-[13px]" type="date" dir="ltr" name="from" defaultValue={filterParams.from} />
        </FilterField>
        <FilterField label="سررسید تا">
          <input className="input num !py-1.5 !text-[13px]" type="date" dir="ltr" name="to" defaultValue={filterParams.to} />
        </FilterField>
        <FilterField label="جستجو">
          <input className="input !py-1.5 !text-[13px]" name="q" defaultValue={filterParams.q} placeholder="شماره چک یا مشتری" />
        </FilterField>
      </FilterForm>

      <ChecksClient
        checks={JSON.parse(JSON.stringify(checks))}
        accounts={JSON.parse(JSON.stringify(accounts))}
        summary={JSON.parse(JSON.stringify(summary))}
        statusFa={STATUS_FA}
      />

      <div className="mt-3">
        <Pagination base="/checks" sp={sp} page={page} totalPages={totalPages} total={total} perPage={perPage} unit="چک" />
      </div>
    </div>
  );
}
