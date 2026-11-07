import { panelReport } from "@/lib/panel-report";
import { activeBranch, BRANCH_COOKIE } from "@/lib/branch";
import { requirePageAccess } from "@/lib/page-access";
import { toFaDigits, fmtMoney } from "@/lib/format";
import Link from "next/link";
import { getDb } from "@/lib/db/schema";
import { statusFa } from "@/lib/status-fa";
import { getSessionByToken, canUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageAccess("/reports");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "reports.view")) redirect("/");
  const sp = await searchParams;
  const db = getDb();
  const {days,repairsByStatus,byBrand,byTech,topParts,revenue,expenses,repairCount,avgTat,estimates,newCustomers,warrantyClaims,unclaimed} = panelReport(db,activeBranch(session,cookieStore.get(BRANCH_COOKIE)?.value),sp.days);

  const maxStatus = Math.max(...repairsByStatus.map((r: any) => r.c), 1);
  const maxBrand = Math.max(...byBrand.map((r: any) => r.c), 1);
  const maxPart = Math.max(...topParts.map((r: any) => r.used), 1);

  const ranges = [7, 30, 90, 365];

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">گزارش‌ها</h1>
          <p className="text-sm text-zinc-500 mt-0.5">نمای کلی عملکرد کسب‌وکار. همه اعداد مطابق بازه انتخابی محاسبه می‌شوند.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Link href="/reports/vat" className="btn-secondary btn-sm">گزارش ارزش افزوده</Link>
          {ranges.map((r) => (
            <Link key={r} href={`/reports?days=${r}`} className={`rounded-full px-3 py-1.5 text-xs font-medium ${days === r ? "bg-brand-600 text-white" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>
              {r === 365 ? "۱ سال" : `${toFaDigits(r)} روز`}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-4 gap-3 [&_.kpi]:min-w-0 [&_.kpi-value]:break-words">
        <div className="kpi"><div className="kpi-label">دریافتی‌های ثبت‌شده</div><div className="kpi-value">{fmtMoney(revenue)}</div></div>
        <div className="kpi"><div className="kpi-label">هزینه‌ها</div><div className="kpi-value">{fmtMoney(expenses)}</div></div>
        <div className="kpi"><div className="kpi-label">پذیرش‌های جدید</div><div className="kpi-value">{toFaDigits(repairCount)}</div></div>
        <div className="kpi"><div className="kpi-label">میانگین زمان تعمیر</div><div className="kpi-value">{avgTat ? `${toFaDigits(avgTat.toFixed(1))} روز` : "—"}</div></div>
        <div className="kpi"><div className="kpi-label">نرخ پذیرش برآورد</div><div className="kpi-value">{toFaDigits(estimates.total ? Math.round(((estimates.approved ?? 0) / estimates.total) * 100) : 0)}٪</div></div>
        <div className="kpi"><div className="kpi-label">نرخ رد برآورد</div><div className="kpi-value">{toFaDigits(estimates.total ? Math.round(((estimates.rejected ?? 0) / estimates.total) * 100) : 0)}٪</div></div>
        <div className="kpi"><div className="kpi-label">مشتریان جدید</div><div className="kpi-value">{toFaDigits(newCustomers)}</div></div>
        <div className="kpi"><div className="kpi-label">گارانتی / دستگاه‌های تحویل‌نگرفته</div><div className="kpi-value">{toFaDigits(warrantyClaims)} / {toFaDigits(unclaimed)}</div></div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <section className="card card-pad">
          <h2 className="section-title mb-3">پذیرش‌ها به تفکیک وضعیت</h2>
          {repairsByStatus.length === 0 ? <p className="text-sm text-zinc-400">در این بازه پذیرشی ثبت نشده است.</p> : (
            <div className="space-y-2">
              {repairsByStatus.map((r: any) => (
                <div key={r.name} className="flex items-center gap-2 text-sm">
                  <span className="w-44 truncate">{statusFa(r.name)}</span>
                  <div className="flex-1 h-2.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(r.c / maxStatus) * 100}%`, backgroundColor: r.color }} />
                  </div>
                  <span className="w-8 text-right font-medium">{r.c}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card card-pad">
          <h2 className="section-title mb-3">پرتکرارترین برندها</h2>
          {byBrand.length === 0 ? <p className="text-sm text-zinc-400">هنوز داده‌ای نیست.</p> : (
            <div className="space-y-2">
              {byBrand.map((r: any) => (
                <div key={r.brand} className="flex items-center gap-2 text-sm">
                  <span className="w-32 truncate">{r.brand}</span>
                  <div className="flex-1 h-2.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${(r.c / maxBrand) * 100}%` }} />
                  </div>
                  <span className="w-8 text-right font-medium">{r.c}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card overflow-x-auto">
          <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800"><h2 className="section-title">عملکرد تعمیرکاران</h2></div>
          {byTech.length === 0 ? <p className="px-5 py-6 text-sm text-zinc-400">پذیرشی به شما ارجاع نشده است.</p> : (
            <table className="w-full">
              <thead className="border-b border-zinc-200 dark:border-zinc-800"><tr><th className="th">تعمیرکار</th><th className="th text-right">رسیدگی‌شده</th><th className="th text-right">تحویل‌شده</th><th className="th text-right">میانگین روز</th></tr></thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {byTech.map((t: any) => (
                  <tr key={t.name}>
                    <td className="td"><span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.avatar_color }} />{t.name}</span></td>
                    <td className="td text-right">{t.repairs}</td>
                    <td className="td text-right">{t.delivered ?? 0}</td>
                    <td className="td text-right">{t.avg_days ? t.avg_days.toFixed(1) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card card-pad">
          <h2 className="section-title mb-3">پرکاربردترین قطعات</h2>
          {topParts.length === 0 ? <p className="text-sm text-zinc-400">هنوز قطعه‌ای مصرف نشده است.</p> : (
            <div className="space-y-2">
              {topParts.map((r: any) => (
                <div key={r.name} className="flex items-center gap-2 text-sm">
                  <span className="w-44 truncate">{r.name}</span>
                  <div className="flex-1 h-2.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                    <div className="h-full rounded-full bg-purple-500" style={{ width: `${(r.used / maxPart) * 100}%` }} />
                  </div>
                  <span className="w-8 text-right font-medium">{r.used}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
