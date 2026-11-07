import { requirePageAccess } from "@/lib/page-access";
import Link from "next/link";
import { getDb } from "@/lib/db/schema";
import { fmtMoney, toFaDigits } from "@/lib/format";
import { FinanceCharts } from "./finance-charts";
import { getSessionByToken, canUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { activeBranch, BRANCH_COOKIE } from "@/lib/branch";
import { operationalFinance } from "@/lib/financial-report";

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  await requirePageAccess("/finance");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "finance.view")) redirect("/");
  const db = getDb();

  const scope = activeBranch(session, cookieStore.get(BRANCH_COOKIE)?.value);
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString().slice(0, 10);
  const flowFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29)).toISOString().slice(0, 10);
  const report = operationalFinance(db, scope.branchId, monthStart, until, flowFrom);
  const { cashIn: revenue, cashOut, expenses, netFlow: netProfit, receivables, payables, inventoryValue, flow, aging } = report;
  const grossProfit = revenue - cashOut;
  const period = { branch: scope.branchId, from: monthStart, until };

  // profit by technician (repairs this month): revenue from invoices of their tickets minus part cost
  const byTech = db.prepare(
    `SELECT u.name, u.avatar_color,
      COALESCE(SUM(ii.total),0) revenue,
      COALESCE(SUM(ii.cost * ii.qty),0) cost
     FROM invoices i
     JOIN repair_tickets t ON t.id = i.ticket_id
     JOIN users u ON u.id = t.technician_id
     JOIN invoice_items ii ON ii.invoice_id = i.id
     WHERE i.created_at >= @from AND i.created_at < @until AND i.status NOT IN ('draft','cancelled') AND i.type='repair' AND (@branch IS NULL OR i.branch_id=@branch)
     GROUP BY u.id ORDER BY revenue DESC`
  ).all(period) as any[];

  // revenue by service category
  const byService = db.prepare(
    `SELECT s.category, COALESCE(SUM(ii.total),0) revenue, COALESCE(SUM(ii.cost*ii.qty),0) cost
     FROM invoice_items ii JOIN services s ON s.id = ii.ref_id AND ii.kind = 'service'
     JOIN invoices i ON i.id = ii.invoice_id
     WHERE i.created_at >= @from AND i.created_at < @until AND i.status NOT IN ('draft','cancelled') AND i.type!='purchase' AND (@branch IS NULL OR i.branch_id=@branch)
     GROUP BY s.category ORDER BY revenue DESC LIMIT 8`
  ).all(period) as any[];

  const cards = [
    { label: "دریافت وصول‌شده (ماه)", value: fmtMoney(revenue), tone: "" },
    { label: "پرداخت و استرداد وجه", value: fmtMoney(cashOut), tone: "" },
    { label: "خالص دریافت و پرداخت", value: fmtMoney(grossProfit), tone: revenue > 0 ? (grossProfit / revenue >= 0.5 ? "text-emerald-600" : "text-amber-600") : "" },
    { label: "هزینه‌های عملیاتی", value: fmtMoney(expenses), tone: "" },
    { label: "خالص پس از هزینه‌های ثبت‌شده", value: fmtMoney(netProfit), tone: netProfit >= 0 ? "text-emerald-600" : "text-red-600" },
    { label: "مطالبات", value: fmtMoney(receivables), tone: "text-amber-600" },
    { label: "مانده فاکتورهای خرید", value: fmtMoney(payables), tone: "" },
    { label: "ارزش موجودی انبار", value: fmtMoney(inventoryValue), tone: "" },
  ];

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">خلاصه مالی</h1>
        <p className="text-sm text-zinc-500 mt-0.5">گردش اسناد از ابتدای ماه میلادی جاری (UTC). دریافت شامل پیش‌پرداخت است؛ این گزارش صورت سود و زیان حسابداری نیست.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Link href="/reports/vat" className="btn-secondary btn-sm">گزارش ارزش افزوده</Link>
          <Link href="/reports" className="btn-secondary btn-sm">گزارش‌های مدیریتی</Link>
            <Link href="/finance/accounting" className="btn-secondary btn-sm">دفتر حسابداری</Link>
          <Link href="/payroll" className="btn-secondary btn-sm">حقوق و دستمزد</Link>
        </div>
      </div>

      <div className="grid grid-cols-1 min-[375px]:grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="kpi">
            <div className="kpi-label">{c.label}</div>
            <div className={`kpi-value !text-base sm:!text-xl xl:!text-2xl ${c.tone}`}>
              <bdi dir="ltr" className="block text-right whitespace-nowrap">{c.value.split(" ")[0]}</bdi>
              <span className="block text-sm">{c.value.split(" ").slice(1).join(" ")}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="card card-pad">
        <h2 className="section-title mb-4">جریان نقدی — ۳۰ روز اخیر</h2>
        <FinanceCharts flow={flow} />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="card">
          <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800"><h2 className="section-title">اقلام فاکتور به تفکیک تعمیرکار (ماه)</h2></div>
          {byTech.length === 0 ? (
            <p className="px-5 py-6 text-sm text-zinc-400">این ماه هنوز فاکتوری صادر نشده است.</p>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {byTech.map((t) => {
                const profit = t.revenue - t.cost;
                const margin = t.revenue > 0 ? Math.round((profit / t.revenue) * 100) : 0;
                return (
                  <div key={t.name} className="flex items-center justify-between px-5 py-3 text-sm">
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.avatar_color }} />
                      {t.name}
                    </span>
                    <span className="text-right">
                      <span className="font-medium">{fmtMoney(t.revenue)}</span>
                      <span className={`ml-2 text-xs ${margin >= 50 ? "text-emerald-600" : "text-amber-600"}`}>حاشیه اقلام {toFaDigits(margin)}٪</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card">
          <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800"><h2 className="section-title">سنی مطالبات فاکتورها</h2></div>
          <div className="px-5 py-3 space-y-2.5">
            {[
              { label: "فاقد تاریخ معتبر", v: aging.undated, tone: "" },
              { label: "جاری (سرنرسیده)", v: aging.current, tone: "" },
              { label: "۱ تا ۳۰ روز", v: aging.d30, tone: "bg-amber-100 dark:bg-amber-500/10" },
              { label: "۳۱ تا ۶۰ روز", v: aging.d60, tone: "bg-orange-100 dark:bg-orange-500/10" },
              { label: "۶۱ تا ۹۰ روز", v: aging.d90, tone: "bg-red-100 dark:bg-red-500/10" },
              { label: "بیش از ۹۰ روز", v: aging.d90p, tone: "bg-red-200 dark:bg-red-500/20" },
            ].map((a) => (
              <div key={a.label} className={`flex justify-between rounded-lg px-3 py-2 text-sm ${a.tone}`}>
                <span>{a.label}</span>
                <span className="font-medium">{fmtMoney(a.v)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {byService.length > 0 && (
        <div className="card">
          <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800"><h2 className="section-title">مبلغ اقلام خدمات (ماه)</h2></div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {byService.map((s) => (
              <div key={s.category} className="flex justify-between px-5 py-3 text-sm">
                <span>{s.category ?? "دسته‌بندی‌نشده"}</span>
                <span className="font-medium">{fmtMoney(s.revenue)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
