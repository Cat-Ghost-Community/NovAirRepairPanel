import { requirePageAccess } from "@/lib/page-access";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db/schema";
import { getSessionByToken, canUser } from "@/lib/auth";
import { BRANCH_COOKIE, activeBranch, branchWhere } from "@/lib/branch";
import { fmtDate, fmtMoney, toFaDigits, toGregorian, todayJalaali } from "@/lib/format";
import { Breadcrumb } from "@/components/breadcrumb";
import { PrintButton } from "@/app/customers/[id]/statement/print-button";

export const dynamic = "force-dynamic";

const JALALI_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

/** بازهٔ میلادی یک ماه جلالی (اول ماه تا اول ماه بعد) */
function jalaliMonthRange(jy: number, jm: number): { from: string; to: string; nextJm: number; nextJy: number } {
  const start = toGregorian(jy, jm, 1);
  const nextJm = jm === 12 ? 1 : jm + 1;
  const nextJy = jm === 12 ? jy + 1 : jy;
  const end = toGregorian(nextJy, nextJm, 1);
  const iso = (g: { gy: number; gm: number; gd: number }) => `${g.gy}-${String(g.gm).padStart(2, "0")}-${String(g.gd).padStart(2, "0")}`;
  return { from: iso(start), to: iso(end), nextJm, nextJy };
}

/**
 * گزارش ارزش افزودهٔ ماهانه — پایهٔ مالیات از فاکتورهای صادرشده محاسبه می‌شود
 * (مقدار مالیات در لحظهٔ صدور فاکتور ذخیره شده است).
 */
export default async function VatReportPage({ searchParams }: { searchParams: Promise<{ jy?: string; jm?: string }> }) {
  await requirePageAccess("/reports/vat");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "reports.view") || !canUser(session, "finance.view")) redirect("/");

  const sp = await searchParams;
  const t = todayJalaali();
  const jy = Number(sp.jy) || t.jy;
  const jm = Number(sp.jm) || t.jm;
  const { from, to, nextJm, nextJy } = jalaliMonthRange(jy, jm);
  const prevJm = jm === 1 ? 12 : jm - 1;
  const prevJy = jm === 1 ? jy - 1 : jy;

  const scope = activeBranch(session, cookieStore.get(BRANCH_COOKIE)?.value);
  const bw = branchWhere(scope, "i");
  const db = getDb();

  const totals = db
    .prepare(
      `SELECT COUNT(*) c, COALESCE(SUM(i.subtotal),0) subtotal, COALESCE(SUM(i.discount),0) discount,
              COALESCE(SUM(i.tax),0) tax, COALESCE(SUM(i.total),0) total
       FROM invoices i WHERE ${bw.sql} AND i.status != 'cancelled'
         AND COALESCE(i.date, substr(i.created_at,1,10)) >= ? AND COALESCE(i.date, substr(i.created_at,1,10)) < ?`
    )
    .get(...bw.params, from, to) as any;

  const salesTax = db
    .prepare(
      `SELECT COUNT(*) c, COALESCE(SUM(s.subtotal),0) subtotal, COALESCE(SUM(s.tax),0) tax, COALESCE(SUM(s.total),0) total
       FROM sales s WHERE ${branchWhere(scope, "s").sql} AND s.created_at >= ? AND s.created_at < ?`
    )
    .get(...branchWhere(scope, "s").params, from, to) as any;

  const byBranch = db
    .prepare(
      `SELECT COALESCE(b.name, 'بدون شعبه') branch_name, COUNT(*) c,
              COALESCE(SUM(i.subtotal),0) subtotal, COALESCE(SUM(i.tax),0) tax, COALESCE(SUM(i.total),0) total
       FROM invoices i LEFT JOIN branches b ON b.id = i.branch_id
       WHERE ${bw.sql} AND i.status != 'cancelled'
         AND COALESCE(i.date, substr(i.created_at,1,10)) >= ? AND COALESCE(i.date, substr(i.created_at,1,10)) < ?
       GROUP BY i.branch_id ORDER BY tax DESC`
    )
    .all(...bw.params, from, to) as any[];

  const invoices = db
    .prepare(
      `SELECT i.id, i.number, i.date, i.subtotal, i.discount, i.tax, i.total, i.status,
              COALESCE(c.company, COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')) customer_name
       FROM invoices i JOIN customers c ON c.id = i.customer_id
       WHERE ${bw.sql} AND i.status != 'cancelled'
         AND COALESCE(i.date, substr(i.created_at,1,10)) >= ? AND COALESCE(i.date, substr(i.created_at,1,10)) < ?
       ORDER BY i.date, i.id`
    )
    .all(...bw.params, from, to) as any[];

  const taxRate = Number((db.prepare("SELECT value FROM settings WHERE key = 'tax_rate'").get() as any)?.value ?? 0);
  const dutyRate = Number((db.prepare("SELECT value FROM settings WHERE key = 'duty_rate'").get() as any)?.value ?? 0);

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6 space-y-4">
      <div className="no-print">
        <Breadcrumb items={[{ label: "گزارش‌ها", href: "/reports" }, { label: "ارزش افزوده" }]} />
      </div>

      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="page-title">گزارش ارزش افزوده</h1>
          <p className="page-sub">
            {JALALI_MONTHS[jm - 1]} {toFaDigits(jy)} · از {fmtDate(from)} تا {fmtDate(to)}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Link href={`/reports/vat?jy=${prevJy}&jm=${prevJm}`} className="btn-secondary btn-sm">ماه قبل</Link>
          <Link href={`/reports/vat?jy=${nextJy}&jm=${nextJm}`} className="btn-secondary btn-sm">ماه بعد</Link>
          <Link href="/reports/vat" className="btn-ghost btn-sm">ماه جاری</Link>
          <PrintButton label="چاپ گزارش" />
        </div>
      </div>

      <div className="card card-pad print-area document-sheet space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-base font-bold">گزارش ارزش افزوده — {JALALI_MONTHS[jm - 1]} {toFaDigits(jy)}</div>
            <div className="mt-0.5 text-xs text-zinc-500">
              نرخ‌های ثبت‌شده: ارزش افزوده {toFaDigits(taxRate)}٪ · عوارض {toFaDigits(dutyRate)}٪
              {scope.all ? " · همه شعب" : " · یک شعبه"}
            </div>
          </div>
          <div className="text-xs text-zinc-500">تاریخ تهیه: {fmtDate(new Date())}</div>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Box label="تعداد فاکتور" value={`${toFaDigits(Number(totals.c ?? 0))} سند`} />
          <Box label="جمع فروش (بدون مالیات)" value={fmtMoney(Number(totals.subtotal ?? 0) - Number(totals.discount ?? 0))} />
          <Box label="مالیات و عوارض" value={fmtMoney(Number(totals.tax ?? 0))} tone="text-brand-600 dark:text-brand-400" />
          <Box label="جمع کل فاکتورها" value={fmtMoney(Number(totals.total ?? 0))} />
        </div>

        <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="text-[13px] font-semibold">فروش صندوق (POS)</div>
          <div className="mt-1.5 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div><div className="text-xs text-zinc-500">تعداد فاکتور</div><div className="font-medium">{toFaDigits(Number(salesTax.c ?? 0))}</div></div>
            <div><div className="text-xs text-zinc-500">جمع فروش</div><div className="font-medium">{fmtMoney(Number(salesTax.subtotal ?? 0))}</div></div>
            <div><div className="text-xs text-zinc-500">مالیات</div><div className="font-medium">{fmtMoney(Number(salesTax.tax ?? 0))}</div></div>
            <div><div className="text-xs text-zinc-500">جمع کل</div><div className="font-medium">{fmtMoney(Number(salesTax.total ?? 0))}</div></div>
          </div>
        </div>

        <div>
          <div className="mb-2 text-[13px] font-semibold">تفکیک شعبه</div>
          {byBranch.length === 0 ? (
            <p className="text-sm text-zinc-400">در این ماه فاکتوری صادر نشده است.</p>
          ) : (
            <table className="w-full">
              <thead className="border-b border-zinc-200 dark:border-zinc-800">
                <tr>
                  <th className="th">شعبه</th>
                  <th className="th">تعداد</th>
                  <th className="th">جمع فروش</th>
                  <th className="th">مالیات و عوارض</th>
                  <th className="th">جمع کل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {byBranch.map((b) => (
                  <tr key={b.branch_name}>
                    <td className="td font-medium">{b.branch_name}</td>
                    <td className="td tabular-nums">{toFaDigits(b.c)}</td>
                    <td className="td tabular-nums">{fmtMoney(b.subtotal)}</td>
                    <td className="td tabular-nums">{fmtMoney(b.tax)}</td>
                    <td className="td tabular-nums font-medium">{fmtMoney(b.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {invoices.length > 0 && (
          <div>
            <div className="mb-2 text-[13px] font-semibold">فهرست فاکتورهای ماه</div>
            <div className="table-wrap">
              <table className="w-full">
                <thead className="border-b border-zinc-200 dark:border-zinc-800">
                  <tr>
                    <th className="th">تاریخ</th>
                    <th className="th">شماره</th>
                    <th className="th">مشتری</th>
                    <th className="th">جمع اقلام</th>
                    <th className="th">تخفیف</th>
                    <th className="th">مالیات و عوارض</th>
                    <th className="th">جمع کل</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                  {invoices.map((i) => (
                    <tr key={i.id} className="row-hover">
                      <td className="td whitespace-nowrap">{fmtDate(i.date)}</td>
                      <td className="td">
                        <Link href={`/invoices/${i.id}`} className="font-mono text-[12px] font-semibold text-brand-600 hover:underline">{i.number}</Link>
                      </td>
                      <td className="td">{i.customer_name ?? "—"}</td>
                      <td className="td tabular-nums">{fmtMoney(i.subtotal)}</td>
                      <td className="td tabular-nums">{i.discount ? fmtMoney(i.discount) : "—"}</td>
                      <td className="td tabular-nums">{fmtMoney(i.tax)}</td>
                      <td className="td tabular-nums font-medium">{fmtMoney(i.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="border-t border-zinc-200 pt-3 text-xs text-zinc-400 dark:border-zinc-800">
          این گزارش برای تهیهٔ اظهارنامه و کنترل داخلی است؛ مبالغ به {""}
          {""}واحد پول فعال سیستم نمایش داده می‌شوند و در دیتابیس ریال ذخیره شده‌اند.
        </p>
      </div>
    </div>
  );
}

function Box({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`mt-1 text-[15px] font-semibold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}
