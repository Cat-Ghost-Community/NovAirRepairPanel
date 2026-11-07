import {repairReadAssignedOnly} from '@/lib/repair-workflow';
import { requirePageAccess } from "@/lib/page-access";
import { activeBranch,BRANCH_COOKIE,canSwitchBranch } from '@/lib/branch';
import { customerBalance } from '@/lib/finance';
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db/schema";
import { getSessionByToken, canUser } from "@/lib/auth";
import { fmtMoney, fmtDate, fmtDateTime, timeAgo, toFaDigits } from "@/lib/format";
import { StatusBadge } from "@/components/ui";
import { customerTypeFa, customerTypeBadge } from "@/lib/customer-type";
import { InvStatusBadge } from "@/app/repairs/[id]/workspace-client";
import { CustomerActions } from "./customer-actions";
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {PostgresCustomerProfile} from '@/components/pg-customer-profile';

const TYPE_FA: Record<string, string> = {
  mobile: "موبایل", laptop: "لپ‌تاپ", desktop: "دسکتاپ", tablet: "تبلت",
  console: "کنسول بازی", smartwatch: "ساعت هوشمند", printer: "پرینتر",
  network: "تجهیزات شبکه", other: "سایر",
};
const METHOD_FA: Record<string, string> = {
  cash: "نقدی", card: "کارتخوان", transfer: "کارت به کارت", credit: "نسیان",
  online: "درگاه آنلاین", cheque: "چک",
};

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({ params,searchParams }: { params: Promise<{ id: string }>;searchParams:Promise<Record<string,string|undefined>> }) {
  if(postgresIntegration())return <PostgresCustomerProfile id={Number((await params).id)} historyPage={Number((await searchParams).historyPage??1)}/>;
  await requirePageAccess("/customers/[id]");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if(!session)redirect('/login');
  const { id } = await params;
  const db = getDb();
  const customerId = Number(id);
  const c = db.prepare("SELECT * FROM customers WHERE id = ?").get(customerId) as any;
  if (!c) notFound();
  const scope=activeBranch(session,(await cookies()).get(BRANCH_COOKIE)?.value);
  if(!scope.all&&!db.prepare("SELECT 1 FROM customer_branch_access WHERE customer_id=? AND branch_id=?").get(customerId,scope.branchId))notFound();

  const devices = db.prepare("SELECT * FROM devices WHERE customer_id = ? AND is_archived = 0 AND (? IS NULL OR id IN (SELECT device_id FROM device_branch_access WHERE branch_id=?)) ORDER BY created_at DESC LIMIT 200").all(customerId,scope.branchId,scope.branchId) as any[];
  const repairs = db
    .prepare(
      `SELECT t.*, s.name status_name, s.color status_color, d.brand, d.model
       FROM repair_tickets t JOIN repair_statuses s ON s.id = t.status_id JOIN devices d ON d.id = t.device_id
       WHERE t.customer_id = :customer AND (:branch IS NULL OR t.branch_id=:branch) AND (:assignedOnly=0 OR t.technician_id=:actor OR t.technician2_id=:actor) ORDER BY t.created_at DESC LIMIT 25`
    )
    .all({customer:customerId,branch:scope.branchId,assignedOnly:repairReadAssignedOnly(session)?1:0,actor:session.user.id}) as any[];
  const invoices = db.prepare("SELECT * FROM effective_invoices WHERE customer_id = :customer AND (:branch IS NULL OR branch_id=:branch) ORDER BY created_at DESC LIMIT 15").all({customer:customerId,branch:scope.branchId}) as any[];
  const payments = db.prepare("SELECT * FROM payments WHERE customer_id = :customer AND (:branch IS NULL OR branch_id=:branch) ORDER BY created_at DESC LIMIT 15").all({customer:customerId,branch:scope.branchId}) as any[];
  const balance=customerBalance(customerId,scope.branchId??undefined);
  const events = db
    .prepare(
      `SELECT e.*, u.name user_name FROM customer_events e LEFT JOIN users u ON u.id = e.user_id
       WHERE e.customer_id=:customer AND (:branch IS NULL OR e.branch_id=:branch
        OR (e.ticket_id IS NOT NULL AND EXISTS(SELECT 1 FROM repair_tickets t WHERE t.id=e.ticket_id AND t.branch_id=:branch))
        OR (e.ticket_id IS NULL AND e.branch_id IS NULL AND e.type NOT IN ('invoice','payment','refund') AND (SELECT COUNT(*) FROM customer_branch_access a WHERE a.customer_id=e.customer_id)=1))
       ORDER BY e.created_at DESC, e.id DESC LIMIT 50`
    )
    .all({customer:customerId,branch:scope.branchId}) as any[];

  const totalSpend = (db.prepare(
    `SELECT COALESCE(SUM(total),0) v FROM effective_invoices WHERE customer_id=:customer AND status IN ('paid','partially_paid') AND (:branch IS NULL OR branch_id=:branch)`
  ).get({customer:customerId,branch:scope.branchId}) as any).v
    + (db.prepare(`SELECT COALESCE(SUM(s.total),0) v FROM sales s WHERE s.customer_id=:customer AND s.status='completed' AND (:branch IS NULL OR s.branch_id=:branch) AND NOT EXISTS(SELECT 1 FROM invoices i WHERE i.sale_id=s.id AND i.status NOT IN ('draft','cancelled'))`).get({customer:customerId,branch:scope.branchId}) as any).v;

  const sharedLegacy=c.branch_id==null && Number(db.prepare("SELECT COUNT(*) n FROM customer_branch_access WHERE customer_id=?").get(customerId)?.n)>1;
  const editableIdentity=!sharedLegacy || (session && canSwitchBranch(session.user.role));
  const canEdit = !!editableIdentity && canUser(session, "customers.edit");
  const canMerge = !!editableIdentity && canUser(session, "customers.*");

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 space-y-4">
      <div className="card card-pad">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-bold">{c.company ? c.company : `${c.first_name} ${c.last_name}`}</h1>
              <span className="badge-gray">{c.code}</span>
              {c.is_vip ? <span className="badge-amber">VIP</span> : null}
              <span className={customerTypeBadge(c.customer_type)}>{customerTypeFa(c.customer_type)}</span>
              {sharedLegacy && !editableIdentity && <span className="badge-gray">نمایهٔ مشترک · ویرایش با مدیر شرکت</span>}
              {c.is_blacklisted ? <span className="badge-red">لیست سیاه{c.blacklist_reason ? `: ${c.blacklist_reason}` : ""}</span> : null}
              {c.is_blacklisted ? <span className="badge-red">لیست سیاه{c.blacklist_reason ? `: ${c.blacklist_reason}` : ""}</span> : null}
            </div>
            <div className="mt-1 text-sm text-zinc-500 space-x-3">
              {c.nickname && <span className="font-medium text-zinc-700 dark:text-zinc-300">«{c.nickname}»</span>}
              {c.mobile && <span>{c.mobile}</span>}
              {c.phone && <span>{c.phone}</span>}
              {c.email && <span>{c.email}</span>}
              {c.city && <span>{c.city}</span>}
              {c.postal_code && <span>کد پستی: <span dir="ltr" className="num">{toFaDigits(c.postal_code)}</span></span>}
            </div>
            <div className="mt-1 text-xs text-zinc-400 space-x-3">
              {c.national_id && <span>کد ملی: <span dir="ltr" className="num">{toFaDigits(c.national_id)}</span></span>}
              {c.customer_type === "organization" && c.organization_name && <span>سازمان: {c.organization_name}</span>}
              {c.job && <span>شغل: {c.job}</span>}
              {c.referral_source && <span>آشنایی: {c.referral_source}</span>}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {JSON.parse(c.tags ?? "[]").map((t: string) => <span key={t} className="chip">{t}</span>)}
            </div>
          </div>
          <div className="text-right space-y-1">
            <div>
              <span className="text-xs text-zinc-400">مانده حساب </span>
              <span className={`font-semibold ${balance > 0 ? "text-amber-600" : ""}`}>{fmtMoney(balance)}</span>
            </div>
            <div>
              <span className="text-xs text-zinc-400">مجموع خرید </span>
              <span className="font-semibold">{fmtMoney(totalSpend)}</span>
            </div>
            <div className="flex gap-1.5 justify-end pt-1">
              <Link href={`/repairs/new`} className="btn-primary btn-sm">+ پذیرش</Link>
              <Link href={`/customers/${c.id}/statement`} className="btn-secondary btn-sm">صورت‌حساب</Link>
              {balance > 0 && <Link href={`/payments/new?customer_id=${c.id}`} className="btn-secondary btn-sm">دریافت وجه</Link>}
              <CustomerActions customerId={Number(c.id)} canEdit={canEdit} canMerge={canMerge} blacklist={!!c.is_blacklisted} />
            </div>
          </div>
        </div>
        {c.notes && <p className="mt-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/60 px-3 py-2 text-sm text-zinc-600 dark:text-zinc-300">{c.notes}</p>}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Devices */}
        <section className="card">
          <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <h2 className="section-title">Devices ({devices.length})</h2>
            <Link href={`/devices/new?customer_id=${c.id}`} className="text-xs text-brand-600 hover:underline">+ افزودن دستگاه</Link>
          </div>
          {devices.length === 0 ? (
            <p className="px-5 py-6 text-sm text-zinc-400">هنوز دستگاهی ثبت نشده است.</p>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {devices.map((d) => (
                <Link key={d.id} href={`/devices/${d.id}`} className="block px-5 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{d.brand} {d.model}</span>
                    <span className="text-xs text-zinc-400">{TYPE_FA[d.type] ?? d.type}</span>
                  </div>
                  <div className="text-xs text-zinc-400">{d.imei ? `IMEI ${d.imei}` : d.serial ? `SN ${d.serial}` : ""}</div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Repairs */}
        <section className="card">
          <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800">
            <h2 className="section-title">سابقه تعمیر</h2>
          </div>
          {repairs.length === 0 ? (
            <p className="px-5 py-6 text-sm text-zinc-400">هنوز پذیرشی ثبت نشده است.</p>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60 max-h-96 overflow-y-auto">
              {repairs.map((t) => (
                <Link key={t.id} href={`/repairs/${t.id}`} className="block px-5 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[13px] font-semibold text-brand-600">{t.number}</span>
                    <StatusBadge name={t.status_name} color={t.status_color} />
                  </div>
                  <div className="text-xs text-zinc-500">{t.brand} {t.model} · {t.problem?.slice(0, 60)}</div>
                  <div className="text-xs text-zinc-400">{timeAgo(t.created_at)}</div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Invoices */}
        <section className="card">
          <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800">
            <h2 className="section-title">فاکتورها</h2>
          </div>
          {invoices.length === 0 ? (
            <p className="px-5 py-6 text-sm text-zinc-400">هنوز فاکتوری نیست.</p>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {invoices.map((i) => (
                <Link key={i.id} href={`/invoices/${i.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  <span>
                    <span className="font-mono text-[13px] font-medium">{i.number}</span>
                    <span className="text-xs text-zinc-400"> · {fmtDate(i.date)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium">{fmtMoney(i.total)}</span>
                    <InvStatusBadge status={i.status} />
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Payments */}
        <section className="card">
          <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800">
            <h2 className="section-title">پرداخت‌ها</h2>
          </div>
          {payments.length === 0 ? (
            <p className="px-5 py-6 text-sm text-zinc-400">هنوز پرداختی ثبت نشده است.</p>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60 max-h-72 overflow-y-auto">
              {payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between px-5 py-3">
                  <span className="text-sm">
                    <span className="font-medium">{fmtMoney(p.amount)}</span>
                    <span className="text-xs text-zinc-400"> · {METHOD_FA[p.method] ?? p.method} · {timeAgo(p.created_at)}</span>
                  </span>
                  <span className="badge-green">دریافت شد</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Timeline */}
      <section className="card card-pad">
        <h2 className="section-title mb-4">خط زمانی مشتری</h2>
        {events.length === 0 ? (
          <p className="text-sm text-zinc-400">هنوز فعالیتی ثبت نشده است.</p>
        ) : (
          <ol className="relative ml-2 border-l border-zinc-200 dark:border-zinc-800 space-y-4 max-h-96 overflow-y-auto">
            {events.map((e: any) => (
              <li key={e.id} className="ml-4">
                <span className="absolute -left-[7px] mt-1.5 h-3.5 w-3.5 rounded-full border-2 border-white dark:border-zinc-900 bg-brand-500" />
                <div className="text-sm font-medium">{e.title}{e.user_name && <span className="text-zinc-400 font-normal"> · {e.user_name}</span>}</div>
                {e.detail && <div className="text-xs text-zinc-500">{e.detail}</div>}
                <div className="text-xs text-zinc-400">{fmtDateTime(e.created_at)}</div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
