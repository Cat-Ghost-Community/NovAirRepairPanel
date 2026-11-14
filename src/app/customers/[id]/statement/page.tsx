import { partyStatement } from '@/lib/party-statements';
import { activeBranch,BRANCH_COOKIE } from '@/lib/branch';
import { requirePageAccess } from "@/lib/page-access";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db/schema";
import { getSessionByToken, canUser } from "@/lib/auth";
import { fmtDate, fmtMoney, toFaDigits, toGregorian, todayISO, todayJalaali } from "@/lib/format";
import { Breadcrumb } from "@/components/breadcrumb";
import { PrintButton } from "./print-button";
import {DocumentBrand,DocumentFooter} from '@/components/document-print';
import {readPrintSettings} from '@/lib/print-settings-server';

export const dynamic = "force-dynamic";




/** شروع ماه جلالی جاری با n ماه عقب‌تر (برای بازه‌های آماده) */
function jalaliMonthStartIso(nMonthsBack: number): string {
  const t = todayJalaali();
  let jy = t.jy;
  let jm = t.jm - nMonthsBack;
  while (jm < 1) {
    jm += 12;
    jy -= 1;
  }
  const g = toGregorian(jy, jm, 1);
  return `${g.gy}-${String(g.gm).padStart(2, "0")}-${String(g.gd).padStart(2, "0")}`;
}

export default async function CustomerStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string; from?: string; to?: string; page?:string }>;
}) {
  await requirePageAccess("/customers/[id]/statement");
  const session = getSessionByToken((await cookies()).get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "customers.view")) redirect("/");

  const { id } = await params;
  const sp = await searchParams;
  const customerId = Number(id);
  const db = getDb();
  const documentSettings=readPrintSettings(db),businessName=String(db.prepare("SELECT value FROM settings WHERE key='business_name'").get()?.value??'تعمیرگاه');

  const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(customerId) as any;
  if (!customer) notFound();

  const range = sp.range ?? "month";
  const today = todayISO();
  let from = sp.from ?? "";
  let to = sp.to ?? "";
  if (!sp.from && !sp.to) {
    if (range === "month") from = jalaliMonthStartIso(0);
    else if (range === "3m") from = jalaliMonthStartIso(2);
    else if (range === "12m") from = jalaliMonthStartIso(11);
    else from = "";
    to = today;
  }

  const scope=activeBranch(session,(await cookies()).get(BRANCH_COOKIE)?.value);
  if(!scope.all&&customer.branch_id!==scope.branchId)notFound();
  const statement=partyStatement(db,'customer',customerId,scope.branchId,from,to||'9999-12-31',Math.max(1,Number(sp.page)||1));
  const visible=statement.rows,opening=statement.opening,closing=statement.closing,totals=statement.totals;
  const pageHref=(page:number)=>{const q=new URLSearchParams();for(const [key,value] of Object.entries(sp))if(value!=null)q.set(key,value);q.set('page',String(page));return `/customers/${customerId}/statement?${q}`;};
  const installments = db
    .prepare("SELECT * FROM effective_installments WHERE customer_id=? AND legacy_review=0 AND status!='paid' AND (? IS NULL OR branch_id=?) ORDER BY due_date LIMIT 200")
    .all(customerId,scope.branchId,scope.branchId) as any[];
  const installmentStats=db.prepare("SELECT COUNT(*) n,COALESCE(SUM(amount-paid_amount),0) remaining,COALESCE(SUM(CASE WHEN due_date<? THEN 1 ELSE 0 END),0) overdue FROM effective_installments WHERE customer_id=? AND legacy_review=0 AND status!='paid' AND (? IS NULL OR branch_id=?)").get(today,customerId,scope.branchId,scope.branchId)!;
  const installmentDue=Number(installmentStats.remaining);


  const name = customer.company || `${customer.first_name ?? ""} ${customer.last_name ?? ""}`.trim() || "مشتری";
  const RANGES = [
    { key: "month", label: "ماه جاری" },
    { key: "3m", label: "۳ ماه اخیر" },
    { key: "12m", label: "یک سال اخیر" },
    { key: "all", label: "همه" },
  ];

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6 space-y-4">
      <div className="no-print">
        <Breadcrumb items={[{ label: "مشتریان", href: "/customers" }, { label: name, href: `/customers/${customerId}` }, { label: "صورت‌حساب" }]} />
      </div>

      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">صورت‌حساب مشتری</h1>
        <div className="flex items-center gap-1.5">
          {RANGES.map((r) => (
            <Link
              key={r.key}
              href={`/customers/${customerId}/statement?range=${r.key}`}
              className={`filter-chip ${range === r.key && !sp.from && !sp.to ? "filter-chip-active" : "filter-chip-idle"}`}
            >
              {r.label}
            </Link>
          ))}
          <PrintButton />
        </div>
      </div>

      <div className="card card-pad print-area document-sheet" data-document="statement">
        <DocumentBrand name={businessName} settings={documentSettings}/>
        <h2 className="my-3 text-lg font-bold">صورت‌حساب مشتری</h2>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 pb-3 dark:border-zinc-800">
          <div>
            <div className="text-base font-bold">{name}</div>
            <div className="mt-0.5 text-xs text-zinc-500">
              {customer.mobile ? `موبایل: ${toFaDigits(customer.mobile)}` : "—"}
              {customer.code ? ` · کد: ${toFaDigits(customer.code)}` : ""}
            </div>
          </div>
          <div className="text-left text-xs text-zinc-500">
            <div>از {from ? fmtDate(from) : "ابتدای حساب"} تا {to ? fmtDate(to) : "امروز"}</div>
            <div className="mt-0.5">تاریخ چاپ: {fmtDate(today)}</div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <div className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
            <div className="text-xs text-zinc-500">ماندهٔ ابتدای دوره</div>
            <div className="mt-1 text-[15px] font-semibold">{fmtMoney(opening)}</div>
          </div>
          <div className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
            <div className="text-xs text-zinc-500">جمع بدهکار</div>
            <div className="mt-1 text-[15px] font-semibold">{fmtMoney(totals.debit)}</div>
          </div>
          <div className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
            <div className="text-xs text-zinc-500">جمع بستانکار</div>
            <div className="mt-1 text-[15px] font-semibold text-emerald-600 dark:text-emerald-400">{fmtMoney(totals.credit)}</div>
          </div>
          <div className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
            <div className="text-xs text-zinc-500">ماندهٔ پایان دوره</div>
            <div className={`mt-1 text-[15px] font-semibold ${closing > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
              {fmtMoney(closing)}
            </div>
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-400">در این بازه گردشی ثبت نشده است.</p>
        ) : (
          <div className="mt-4 table-wrap">
            <table className="w-full">
              <thead className="border-b border-zinc-200 dark:border-zinc-800">
                <tr>
                  <th className="th">تاریخ</th>
                  <th className="th">شرح</th>
                  <th className="th">بدهکار</th>
                  <th className="th">بستانکار</th>
                  <th className="th">مانده</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {visible.map((r) => (
                  <tr key={r.key} className="row-hover">
                    <td className="td whitespace-nowrap">{fmtDate(r.day)}</td>
                    <td className="td">
                      {r.href ? (
                        <Link href={r.href} className="font-medium text-brand-600 hover:underline">{r.title}</Link>
                      ) : (
                        <span className="font-medium">{r.title}</span>
                      )}
                      <span className="block text-xs text-zinc-400">{r.detail}</span>
                    </td>
                    <td className="td tabular-nums">{r.debit ? fmtMoney(r.debit) : "—"}</td>
                    <td className="td tabular-nums text-emerald-600 dark:text-emerald-400">{r.credit ? fmtMoney(r.credit) : "—"}</td>
                    <td className="td tabular-nums font-medium">{fmtMoney(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(installments.length > 0 || installmentDue > 0) && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-500/30 dark:bg-amber-500/5">
            <div className="text-[13px] font-semibold">اقساط باز</div>
            <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
              {toFaDigits(Number(installmentStats.n))} قسط پرداخت‌نشده · مانده {fmtMoney(installmentDue)}
              {Number(installmentStats.overdue) > 0 && <span className="text-red-600 dark:text-red-400"> · {toFaDigits(Number(installmentStats.overdue))} قسط سررسید گذشته</span>}
            </div>
            <div className="mt-2 space-y-1">
              {installments.slice(0, 6).map((i) => (
                <div key={i.id} className="flex justify-between text-xs">
                  <span>قسط {toFaDigits(i.seq)} · سررسید {fmtDate(i.due_date)}</span>
                  <span className="tabular-nums">{fmtMoney(Number(i.amount ?? 0) - Number(i.paid_amount ?? 0))}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {statement.totalPages>1&&<p className="mt-4 text-xs">بخش {toFaDigits(statement.page)} از {toFaDigits(statement.totalPages)} — فقط تراکنش‌های این بخش در این نسخهٔ چاپی آمده‌اند.</p>}
        {statement.totalPages>1&&<div className="no-print mt-4 flex flex-wrap gap-2 items-center">{statement.page>1&&<Link className="btn-secondary" href={pageHref(statement.page-1)}>صفحهٔ قبل</Link>}{statement.page<statement.totalPages&&<Link className="btn-secondary" href={pageHref(statement.page+1)}>صفحهٔ بعد</Link>}</div>}
        <p className="mt-5 border-t border-zinc-200 pt-3 text-xs text-zinc-400 dark:border-zinc-800">
          این صورت‌حساب بر اساس اسناد ثبت‌شده در سیستم تهیه شده است. در صورت مشاهدهٔ اختلاف، با واحد حسابداری تماس بگیرید.
        </p>
        <DocumentFooter settings={documentSettings}/>
      </div>
    </div>
  );
}
