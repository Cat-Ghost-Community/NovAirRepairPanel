import { requirePageAccess } from "@/lib/page-access";
import { getDb } from "@/lib/db/schema";
import { getSessionByToken, canUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { fmtMoney, fmtDate, faNum } from "@/lib/format";
import { BankClient } from "./bank-client";
import { FilterForm, FilterField, NativeSelect } from "@/components/select";
import { Pagination } from "@/components/pagination";
import { countOf, resolvePaging } from "@/lib/pagination";
import { canSwitchBranch } from "@/lib/branch";
import {bankRegisterTotal} from '@/lib/bank-input';

export const dynamic = "force-dynamic";

export default async function BankPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageAccess("/bank");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "finance.view")) redirect("/");
  if (!canSwitchBranch(session.user.role)) redirect("/finance");
  const sp = await searchParams;
  const db = getDb();

  const accounts = db.prepare("SELECT * FROM bank_accounts WHERE is_active = 1 ORDER BY id").all();
  // فیلترها: حساب، نوع تراکنش و بازهٔ تاریخ
  let sql = `SELECT t.*, a.name account_name FROM bank_transactions t LEFT JOIN bank_accounts a ON a.id = t.account_id WHERE 1=1`;
  const params: any[] = [];
  if (sp.account) { sql += " AND t.account_id = ?"; params.push(Number(sp.account)); }
  if (sp.type) { sql += " AND t.type = ?"; params.push(sp.type); }
  if (sp.from) { sql += " AND COALESCE(t.date, substr(t.created_at,1,10)) >= ?"; params.push(sp.from); }
  if (sp.to) { sql += " AND COALESCE(t.date, substr(t.created_at,1,10)) <= ?"; params.push(sp.to); }
  if (sp.q) { sql += " AND (t.ref LIKE ? OR t.description LIKE ?)"; const like = `%${sp.q}%`; params.push(like, like); }
  const txnCount = countOf(db, sql, params);
  const { page, perPage, offset, totalPages } = resolvePaging(sp, txnCount);
  const txns = db.prepare(`${sql} ORDER BY t.id DESC LIMIT ${perPage} OFFSET ${offset}`).all(...params);
  const fp = { account: sp.account ?? "", type: sp.type ?? "", from: sp.from ?? "", to: sp.to ?? "", q: sp.q ?? "" };
  // Each register amount is a safe integer; a company aggregate need not fit
  // that per-document range. Never let SQL/Number rounding lose the last rial.
  const total=bankRegisterTotal(accounts as Array<{current_balance:unknown}>);

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">حساب‌های بانکی</h1>
          <p className="text-sm text-zinc-500 mt-0.5">موجودی، واریز، برداشت، انتقال و تسویه کارتخوان</p>
        </div>
        <div className="kpi min-w-0 max-w-full w-full sm:w-auto sm:min-w-44">
          <div className="kpi-label">موجودی کل</div>
          <div className={`kpi-value [overflow-wrap:anywhere] ${total!=null&&(total>BigInt(1e12)||total< -BigInt(1e12))?'!text-[clamp(1rem,5vw,1.5rem)]':''}`}>{total==null?'نیازمند بررسی مانده':fmtMoney(total)}</div>
        </div>
      </div>

      <FilterForm action="/bank">
        <FilterField label="حساب">
          <NativeSelect
            size="sm"
            name="account"
            ariaLabel="حساب بانکی"
            placeholder="همه حساب‌ها"
            defaultValue={fp.account}
            options={(accounts as any[]).map((a) => ({ value: String(a.id), label: String(a.name) }))}
          />
        </FilterField>
        <FilterField label="نوع تراکنش">
          <NativeSelect
            size="sm"
            name="type"
            ariaLabel="نوع تراکنش"
            placeholder="همه"
            defaultValue={fp.type}
            options={[
              { value: "deposit", label: "واریز" },
              { value: "withdraw", label: "برداشت" },
              { value: "transfer_in", label: "انتقال ورودی" },
              { value: "transfer_out", label: "انتقال خروجی" },
              { value: "pos_settlement", label: "تسویه کارتخوان" },
            ]}
          />
        </FilterField>
        <FilterField label="تاریخ از">
          <input className="input num !py-1.5 !text-[13px]" type="date" dir="ltr" name="from" defaultValue={fp.from} />
        </FilterField>
        <FilterField label="تاریخ تا">
          <input className="input num !py-1.5 !text-[13px]" type="date" dir="ltr" name="to" defaultValue={fp.to} />
        </FilterField>
        <FilterField label="جستجو">
          <input className="input !py-1.5 !text-[13px]" name="q" defaultValue={fp.q} placeholder="شرح یا شماره پیگیری" />
        </FilterField>
      </FilterForm>

      <BankClient
        canManage={canUser(session,'finance.manage')}
        accounts={JSON.parse(JSON.stringify(accounts))}
        txns={JSON.parse(JSON.stringify(txns))}
      />

      <div className="mt-3">
        <Pagination base="/bank" sp={sp} page={page} totalPages={totalPages} total={txnCount} perPage={perPage} unit="تراکنش" />
      </div>
    </div>
  );
}
