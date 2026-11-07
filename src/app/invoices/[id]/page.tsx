import { requirePageAccess } from "@/lib/page-access";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/schema";
import { fmtMoney, fmtDate, fmtDateTime, toFaDigits } from "@/lib/format";
import { InvStatusBadge } from "@/app/repairs/[id]/workspace-client";
import { PrintButton } from "./print-button";
import { InstallmentsPanel } from "./installments-panel";
import { DueDateEditor } from "./due-date-editor";
import { Breadcrumb } from "@/components/breadcrumb";
import { getSessionByToken, canUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { RefundButton } from "./refund-button";
import { AutoPrint, InvoiceActions } from "./invoice-actions";
import { activeBranch, BRANCH_COOKIE } from "@/lib/branch";
import { invoiceObligation } from '@/lib/invoice-obligation';
import { netInvoicePaid } from '@/lib/payment-state';

export const dynamic = "force-dynamic";

const METHOD_FA: Record<string, string> = { cash: "نقد", card: "کارتخوان", transfer: "حواله", cheque: "چک", check: "چک", credit: "نسیه", online: "آنلاین" };
const TYPE_FA: Record<string, string> = { purchase: "فاکتور خرید", sale: "فاکتور فروش", repair: "فاکتور تعمیر دستگاه" };
const KIND_FA: Record<string, string> = { part: "کالا", service: "خدمت", labor: "اجرت", fee: "هزینه", product: "محصول", device: "دستگاه", other: "سایر" };

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageAccess("/invoices/[id]");
  const { id } = await params;
  const session = getSessionByToken((await cookies()).get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "invoices.view")) redirect("/");
  const canRefund = canUser(session, "payments.refund");
  const canEdit = canUser(session, "invoices.edit");
  const canPay = canUser(session, "payments.create");
  const db = getDb();
  const invId = Number(id);
  const inv = db
    .prepare(
      `SELECT i.*, c.first_name, c.last_name, c.company, c.mobile, c.address, c.city,
              sup.name supplier_name, sup.phone supplier_phone, sup.address supplier_address,
              t.number ticket_number, t.delivered_at, d.brand device_brand, d.model device_model,
              e.name employee_name, b.name branch_name
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id AND COALESCE(i.type,'repair') != 'purchase'
       LEFT JOIN suppliers sup ON sup.id = i.supplier_id
       LEFT JOIN repair_tickets t ON t.id = i.ticket_id
       LEFT JOIN devices d ON d.id = t.device_id
       LEFT JOIN users e ON e.id = i.employee_id
       LEFT JOIN branches b ON b.id = i.branch_id
       WHERE i.id = ?`
    )
    .get(invId) as any;
  if (!inv) notFound();
  const branchScope = activeBranch(session, (await cookies()).get(BRANCH_COOKIE)?.value);
  if (!branchScope.all && inv.branch_id !== branchScope.branchId) notFound();
  const type = (inv.type ?? "repair") as string;
  const isPurchase = type === "purchase";
  const items = db.prepare("SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort, id").all(invId) as any[];
  const payments = db.prepare("SELECT * FROM payments WHERE invoice_id = ? ORDER BY created_at").all(invId) as any[];
  const checks = db.prepare("SELECT * FROM checks WHERE invoice_id = ? ORDER BY id").all(invId) as any[];
  const refunds = db
    .prepare(`SELECT r.* FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE p.invoice_id = ? ORDER BY r.created_at DESC`)
    .all(invId) as any[];
  const installments = db.prepare("SELECT * FROM effective_installments WHERE invoice_id = ? ORDER BY seq").all(invId) as any[];
  const refundedByPayment = new Map<number, number>();
  for (const r of refunds) refundedByPayment.set(Number(r.payment_id), (refundedByPayment.get(Number(r.payment_id)) ?? 0) + Number(r.amount ?? 0));
  const shop = (db.prepare("SELECT value FROM settings WHERE key = 'business_name'").get() as any)?.value ?? "RePaird";
  const inPayments = payments.filter((p) => p.direction !== "out");
  const outPayments = payments.filter((p) => p.direction === "out");
  const obligation=invoiceObligation(db,invId);inv.paid=netInvoicePaid(db,invId,isPurchase?'out':'in');
  const balance = obligation.effective_total - inv.paid;
  const lineDiscTotal = items.reduce((s: number, i: any) => s + Number(i.line_discount ?? 0), 0);
  const endDisc = Math.max(0, Number(inv.discount ?? 0) - lineDiscTotal);
  const partyName = isPurchase ? inv.supplier_name ?? "—" : inv.company ?? `${inv.first_name ?? ""} ${inv.last_name ?? ""}`.trim();

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <AutoPrint />
      <div className="no-print">
        <Breadcrumb items={[{ label: "فاکتورها", href: "/invoices" }, { label: inv.number }]} />
      </div>
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <Link href="/invoices" className="btn-ghost btn-sm">← فاکتورها</Link>
        {canEdit&&inv.status!=='draft'&&inv.status!=='cancelled'&&<Link href={`/returns?invoice_id=${inv.id}`} className="btn-secondary btn-sm">مرجوعی و اعتبارنامه</Link>}
        {canEdit&&inv.type!=='purchase'&&inv.status!=='draft'&&inv.status!=='cancelled'&&<Link href={`/returns/services?invoice_id=${inv.id}`} className="btn-secondary btn-sm">اصلاح مالی خدمات</Link>}
        <span className={`badge ${isPurchase ? "badge-amber" : type === "sale" ? "badge-blue" : "badge-purple"}`}>{TYPE_FA[type] ?? type}</span>
        <span className="flex-1" />
        <InvoiceActions
          invoiceId={inv.id}
          status={inv.status}
          type={type}
          balance={balance}
          canPay={canPay}
          canEdit={canEdit}
          canConfirm={isPurchase ? canUser(session, "purchasing.manage") : canUser(session, "invoices.create")}
        />
        <PrintButton />
      </div>

      <div className="card card-pad print-area">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 font-bold text-white">R</span>
              <span className="text-lg font-bold">{shop}</span>
            </div>
            {inv.branch_name && <div className="mt-2 text-xs text-zinc-500">{inv.branch_name}</div>}
          </div>
          <div className="text-left">
            <div className="text-xs font-semibold text-zinc-500">{TYPE_FA[type] ?? type}</div>
            <h1 className="font-mono text-xl font-bold" dir="ltr">{inv.number}</h1>
            <div className="mt-1"><InvStatusBadge status={inv.status} /></div>
            {inv.status === "cancelled" && inv.cancel_reason && <div className="mt-1 text-xs text-red-500">دلیل لغو: {inv.cancel_reason}</div>}
            <div className="mt-2 text-xs text-zinc-500">
              <div>تاریخ: {fmtDate(inv.date)}</div>
              {!isPurchase && <div>موعد تسویه: {fmtDate(inv.due_date)} <DueDateEditor invoiceId={inv.id} current={inv.due_date} /></div>}
              {inv.ticket_number && (
                <div>
                  پذیرش <span className="font-mono">{inv.ticket_number}</span>
                  {inv.device_brand ? <span> — {inv.device_brand} {inv.device_model}</span> : null}
                </div>
              )}
              {isPurchase && inv.external_number && <div>شماره فاکتور تأمین‌کننده: <span className="ltr-num" dir="ltr">{inv.external_number}</span></div>}
              {inv.sale_number && (
                <div>
                  مرجع: فروش صندوق <Link className="font-mono underline" href="/pos">{inv.sale_number}</Link>
                </div>
              )}
              {inv.po_number && (
                <div>
                  مرجع: سفارش خرید <Link className="font-mono underline" href={`/purchase-orders/${inv.purchase_order_id}`}>{inv.po_number}</Link>
                </div>
              )}
              {inv.employee_name && <div>{isPurchase ? "مسئول خرید" : "مسئول"}: {inv.employee_name}</div>}
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-4 border-t border-zinc-200 pt-4 sm:grid-cols-2 dark:border-zinc-800">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{isPurchase ? "تأمین‌کننده" : "صورتحساب برای"}</div>
            <div className="mt-1 text-sm font-medium">{partyName}</div>
            {isPurchase
              ? inv.supplier_address && <div className="text-xs text-zinc-500">{inv.supplier_address}</div>
              : inv.address && <div className="text-xs text-zinc-500">{inv.address}، {inv.city}</div>}
            {!isPurchase && inv.mobile && <div className="text-xs text-zinc-500 ltr-num" dir="ltr">{inv.mobile}</div>}
          </div>
          <div className="sm:text-left">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{isPurchase ? "مانده پرداخت" : "مانده حساب"}</div>
            <div className={`text-2xl font-bold ${balance > 0 ? "text-amber-600" : "text-emerald-600"}`}>{fmtMoney(Math.max(0, balance))}</div>
          </div>
        </div>

        <table className="mt-5 w-full border-t border-zinc-200 dark:border-zinc-800">
          <thead className="print-repeat">
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th className="th text-right">شرح</th>
              <th className="th">نوع</th>
              <th className="th">تعداد</th>
              <th className="th">قیمت واحد</th>
              {lineDiscTotal > 0 && <th className="th">تخفیف</th>}
              <th className="th">جمع</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-b border-zinc-100 dark:border-zinc-800/60">
                <td className="td">
                  {i.name}
                  {i.sku && <span className="mr-1 text-[10px] text-zinc-400 ltr-num" dir="ltr">{i.sku}</span>}
                </td>
                <td className="td text-xs text-zinc-500">{KIND_FA[i.kind] ?? i.kind}</td>
                <td className="td">{toFaDigits(i.qty)}</td>
                <td className="td">{fmtMoney(i.unit_price)}</td>
                {lineDiscTotal > 0 && <td className="td">{Number(i.line_discount ?? 0) > 0 ? `−${fmtMoney(i.line_discount)}` : "—"}</td>}
                <td className="td font-medium">{fmtMoney((i.total ?? 0) > 0 ? i.total : Math.round(i.qty * i.unit_price) - Number(i.line_discount ?? 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="print-avoid-break mt-4 mr-auto max-w-56 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-zinc-500">جمع اقلام</span><span>{fmtMoney(inv.subtotal)}</span></div>
          {lineDiscTotal > 0 && <div className="flex justify-between"><span className="text-zinc-500">تخفیف اقلام</span><span>−{fmtMoney(lineDiscTotal)}</span></div>}
          {endDisc > 0 && <div className="flex justify-between"><span className="text-zinc-500">تخفیف فاکتور</span><span>−{fmtMoney(endDisc)}</span></div>}
          <div className="flex justify-between"><span className="text-zinc-500">مالیات و عوارض</span><span>{fmtMoney(inv.tax)}</span></div>
          <div className="flex justify-between border-t border-zinc-200 pt-1 font-bold dark:border-zinc-800"><span>{obligation.credit_total?'اصل مبلغ فاکتور':'مبلغ قابل پرداخت'}</span><span>{fmtMoney(inv.total)}</span></div>
          {obligation.credit_total>0&&<><div className="flex justify-between gap-2"><span>اعتبارنامه‌های قطعی</span><span>{fmtMoney(obligation.credit_total)}</span></div><div className="flex justify-between gap-2 font-bold"><span>تعهد خالص پس از اعتبارنامه</span><span>{fmtMoney(obligation.effective_total)}</span></div></>}
          <div className="flex justify-between text-emerald-600"><span>{isPurchase ? "پرداخت‌شده" : "دریافت‌شده"}</span><span>{fmtMoney(inv.paid)}</span></div>
        </div>

        {payments.length > 0 && (
          <div className="print-avoid-break mt-5 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              {isPurchase ? "سابقهٔ پرداخت" : "سابقهٔ دریافت"}
            </div>
            {inPayments.map((p) => {
              const refundable = Number(p.amount) - (refundedByPayment.get(Number(p.id)) ?? 0);
              return (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-0.5 text-sm">
                  <span className="text-zinc-500">
                    {fmtDateTime(p.created_at)} · {METHOD_FA[p.method] ?? p.method}
                    {p.reference ? ` · ${p.reference}` : ""}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{fmtMoney(p.amount)}</span>
                    {canRefund && <RefundButton paymentId={Number(p.id)} refundable={refundable} method={String(p.method ?? "cash")} />}
                  </span>
                </div>
              );
            })}
            {refunds.map((r) => (
              <div key={r.id} className="flex justify-between text-sm text-red-600">
                <span className="text-zinc-500">بازگشت وجه · {r.reason ?? ""}</span>
                <span className="font-medium">−{fmtMoney(r.amount)}</span>
              </div>
            ))}
          </div>
        )}

        {isPurchase && outPayments.length > 0 && (
          <div className="print-avoid-break mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">پرداخت‌های انجام‌شده</div>
            {outPayments.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-0.5 text-sm">
                <span className="text-zinc-500">
                  {fmtDateTime(p.created_at)} · {METHOD_FA[p.method] ?? p.method}
                  {p.reference ? ` · ${p.reference}` : ""}
                </span>
                <span className="font-medium">{fmtMoney(p.amount)}</span>
              </div>
            ))}
          </div>
        )}

        {checks.length > 0 && (
          <div className="print-avoid-break mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">چک‌های مرتبط</div>
            {checks.map((ch) => (
              <div key={ch.id} className="flex flex-wrap items-center justify-between gap-2 py-0.5 text-sm">
                <span className="text-zinc-500">
                  {ch.kind === "issued" ? "چک پرداختی" : "چک دریافتی"} · {ch.bank_name ?? "—"} · سرسید {fmtDate(ch.due_date)}
                </span>
                <span className="font-medium">{fmtMoney(ch.amount)}</span>
              </div>
            ))}
          </div>
        )}

        {inv.notes && <p className="mt-4 text-xs text-zinc-500">یادداشت: {inv.notes}</p>}

        {(type === "repair" || type === "sale") && (
          <div className="print-signatures mt-10 grid grid-cols-2 gap-8 text-xs text-zinc-400">
            <div className="border-t border-dashed border-zinc-300 pt-2 dark:border-zinc-700">امضای مشتری / تحویل‌گیرنده</div>
            <div className="border-t border-dashed border-zinc-300 pt-2 dark:border-zinc-700">مهر و امضای فروشنده</div>
          </div>
        )}
        {isPurchase && (
          <div className="print-signatures mt-10 grid grid-cols-2 gap-8 text-xs text-zinc-400">
            <div className="border-t border-dashed border-zinc-300 pt-2 dark:border-zinc-700">تحویل‌گیرندهٔ انبار</div>
            <div className="border-t border-dashed border-zinc-300 pt-2 dark:border-zinc-700">مهر و امضای تأمین‌کننده</div>
          </div>
        )}

        <p className="mt-6 border-t border-zinc-200 pt-3 text-xs text-zinc-400 dark:border-zinc-800">
          {type === "repair"
            ? `با تشکر از انتخاب ${shop}. تعمیرات مشمول گارانتی درج‌شده در سند پذیرش است. این فاکتور را برای پیگیری گارانتی نگه دارید.`
            : type === "sale"
              ? `با تشکر از خرید شما از ${shop}. کالاهای دارای گارانتی با ارائهٔ همین فاکتور پیگیری می‌شوند.`
              : `سند خرید از تأمین‌کننده — مبنای تسویهٔ مالی و ورود کالا به انبار ${shop}.`}
        </p>
      </div>

      {!isPurchase && (
        <div className="no-print mt-5">
          <InstallmentsPanel
            invoiceId={inv.id}
            balance={balance}
            canManage={canUser(session,"finance.manage")} canReceive={canUser(session,"payments.create")} canViewHistory={canUser(session,"finance.view")}
            installments={installments.map((i: any) => ({ id: i.id, seq: i.seq, amount: i.amount, paid_amount: i.paid_amount, due_date: i.due_date, status: i.status,legacy_review:i.legacy_review }))}
          />
        </div>
      )}
    </div>
  );
}
