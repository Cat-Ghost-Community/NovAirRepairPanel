import { SignatureView } from "@/components/signature-pad";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/lib/db/schema";
import { getStatuses, statusFa } from "@/lib/repair";
import {deviceTypeLabel} from '@/lib/device-catalog';
import {readDeviceCatalog} from '@/lib/device-catalog-store';
import {customerDisplayName} from '@/lib/customer-identity';
import { fmtMoney, fmtDate, fmtDateTime } from "@/lib/format";
import {DeliveryAcceptance} from './delivery-acceptance';
import { TrackActions } from "./track-actions";
import { fetchPostalEvents } from "@/lib/postal";
import { resolveTrackingToken } from "@/lib/tracking";

export const dynamic = "force-dynamic";

export default async function TrackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = getDb();

  // resolve token to ticket (scoped hash)
  const ticketId = resolveTrackingToken(token);
  if (!ticketId) notFound();

  const t = db
    .prepare(
      `SELECT t.*, s.name status_name, s.color status_color, s.customer_visible, s.description status_desc,
              c.first_name, c.last_name, c.salutation, d.brand, d.model, d.type device_type
       FROM repair_tickets t
       JOIN repair_statuses s ON s.id = t.status_id
       JOIN customers c ON c.id = t.customer_id
       JOIN devices d ON d.id = t.device_id
       WHERE t.id = ?`
    )
    .get(ticketId) as any;
  if (!t || !t.customer_visible) {
    return (
      <Centered>
        <h1 className="text-lg font-bold">این پذیرش در حال پردازش است</h1>
        <p className="text-sm text-zinc-500 mt-1">ردیابی تفصیلی برای این وضعیت در دسترس نیست. لطفاً با تعمیرگاه تماس بگیرید.</p>
      </Centered>
    );
  }

  const deliveryRequest=db.prepare('SELECT * FROM repair_delivery_requests WHERE ticket_id=? AND fulfilled_at IS NULL AND expires_at>?').get(ticketId,Date.now());
  const statuses = getStatuses().filter((s) => s.customer_visible);
  const history = db
    .prepare(
      `SELECT h.*, s.name status_name, s.color color, s.customer_visible
       FROM repair_status_history h JOIN repair_statuses s ON s.id = h.to_status
       WHERE h.ticket_id = ? AND s.customer_visible = 1
       ORDER BY h.created_at ASC, h.id ASC`
    )
    .all(ticketId) as any[];

  const estimate = t.estimate_id ? db.prepare("SELECT * FROM estimates WHERE id = ? AND status IN ('sent','viewed','approved','rejected')").get(t.estimate_id) as any : null;
  const estimateItems = estimate ? db.prepare("SELECT * FROM estimate_items WHERE estimate_id = ? ORDER BY id").all(estimate.id) as any[] : [];

  const invoice = db.prepare("SELECT number, total, paid, status FROM invoices WHERE ticket_id = ? AND status != 'draft' ORDER BY id DESC LIMIT 1").get(ticketId) as any;

  const warranty = db.prepare("SELECT end_date, terms FROM warranties WHERE ticket_id = ? AND status = 'active'").get(ticketId) as any;

  // شرح کارهای عمومی (قابل نمایش به مشتری) — شرح داخلی و خصوصی هرگز نمایش داده نمی‌شود
  const publicNotes = db
    .prepare(
      `SELECT n.body, n.created_at, u.name user_name FROM repair_notes n
       LEFT JOIN users u ON u.id = n.user_id
       WHERE n.ticket_id = ? AND n.kind = 'public'
       ORDER BY n.created_at DESC LIMIT 10`
    )
    .all(ticketId) as any[];

  const shop = (db.prepare("SELECT value FROM settings WHERE key = 'business_name'").get() as any)?.value ?? "تعمیرگاه الکترونیک ریپرد";

  // تاریخچه وضعیت مرسوله پستی (در صورت ثبت کد رهگیری) — با کش و timeout امن
  const postalEvents = t.postal_tracking ? await fetchPostalEvents(t.postal_tracking).catch(() => []) : [];

  const currentIndex = statuses.findIndex((s) => s.name === t.status_name);
  const progress = currentIndex >= 0 ? Math.round(((currentIndex + 1) / statuses.length) * 100) : 0;

  return (
    <div className="min-h-dvh bg-zinc-100 dark:bg-zinc-950 py-8 px-4">
      <div className="max-w-lg mx-auto space-y-4">
        <div className="text-center">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white text-xl font-bold">R</span>
          <div className="mt-2 text-lg font-bold">{shop}</div>
        </div>

        <div className="card card-pad">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono font-bold text-lg">{t.number}</div>
              <div className="text-sm text-zinc-500">{[t.brand,t.model].filter(Boolean).join(' ')||deviceTypeLabel(readDeviceCatalog(db),t.device_type)} <span className="text-zinc-400">· {deviceTypeLabel(readDeviceCatalog(db),t.device_type)}</span></div>
            </div>
            <span className="badge" style={{ backgroundColor: t.status_color + "22", color: t.status_color }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: t.status_color }} />
              {statusFa(t.status_name)}
            </span>
          </div>

          <div className="mt-4">
            <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, backgroundColor: t.status_color }} />
            </div>
            <div className="mt-1.5 flex justify-between text-xs text-zinc-400">
              <span>دریافت‌شده</span><span>در جریان</span><span>آماده</span>
            </div>
          </div>

          {t.status_desc && <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">{t.status_desc}</p>}
          {t.estimated_completion && ["تحویل‌شده", "لغوشده"].indexOf(t.status_name) === -1 && (
            <p className="mt-1 text-sm text-zinc-500">تحویل تخمینی: <strong>{fmtDate(t.estimated_completion)}</strong></p>
          )}
        </div>

        {deliveryRequest&&!t.delivery_signature&&<DeliveryAcceptance token={token} customerName={customerDisplayName(t)}/>}
        {/* Estimate approve/reject */}
        {estimate && estimate.status === "sent" && (
          <div className="card card-pad border-amber-300 dark:border-amber-500/40">
            <h2 className="font-semibold">برآورد شما آماده است — {fmtMoney(estimate.total)}</h2>
            <div className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {estimateItems.map((i) => (
                <div key={i.id} className="flex justify-between py-1.5 text-sm">
                  <span>{i.name}</span>
                  <span>{fmtMoney(i.total)}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between pt-2 mt-1 border-t border-zinc-200 dark:border-zinc-800 font-semibold">
              <span>جمع با احتساب مالیات</span><span>{fmtMoney(estimate.total)}</span>
            </div>
            <TrackActions estimateToken={estimate.public_token} customerName={customerDisplayName(t)} total={estimate.total} validUntil={estimate.valid_until} />
          </div>
        )}

        {/* تأیید امضاشده برآورد — سند حقوقی مشتری */}
        {estimate && estimate.status === "approved" && estimate.signature_data && (
          <div className="card card-pad border-emerald-200 dark:border-emerald-500/30">
            <h2 className="font-semibold text-emerald-700 dark:text-emerald-400">✓ برآورد با امضای شما تأیید شد</h2>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <SignatureView dataUrl={estimate.signature_data} alt="امضای شما" className="w-full sm:max-w-md" />
              <div className="text-sm space-y-0.5">
                <div>امضاکننده: <strong>{estimate.signed_name}</strong></div>
                <div className="text-xs text-zinc-400">تاریخ و ساعت امضا: {fmtDateTime(estimate.signed_at)}</div>
              </div>
            </div>
            <p className="mt-2 text-xs text-zinc-400">این سند با نام، زمان و نشانی IP در سوابق تعمیرگاه نگهداری می‌شود.</p>
          </div>
        )}

        {/* ارسال پستی — کد رهگیری + تاریخچه */}
        {t.postal_tracking && (
          <div className="card card-pad border-blue-200 dark:border-blue-500/30">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <h2 className="font-semibold text-blue-700 dark:text-blue-400">📦 دستگاه شما با پست ارسال شد</h2>
                <div className="mt-1 text-sm">کد رهگیری: <strong dir="ltr" className="font-mono">{t.postal_tracking}</strong></div>
                {t.postal_sent_at && <div className="text-xs text-zinc-400">تاریخ ارسال: {fmtDate(t.postal_sent_at)}</div>}
              </div>
              <a href={`https://tracking.post.ir/?id=${encodeURIComponent(t.postal_tracking)}`} target="_blank" rel="noopener noreferrer" className="btn-primary btn-sm">
                رهگیری مرسوله ↗
              </a>
            </div>
            {postalEvents.length > 0 && (
              <div className="mt-4 border-t border-zinc-100 dark:border-zinc-800/60 pt-3">
                <h3 className="text-sm font-medium mb-2">وضعیت مرسوله</h3>
                <ol className="relative mr-2 border-r border-blue-200 dark:border-blue-500/30 space-y-3">
                  {[...postalEvents].reverse().map((ev, i) => (
                    <li key={i} className="mr-4">
                      <span className="absolute -right-[6px] mt-1.5 h-3 w-3 rounded-full border-2 border-white dark:border-zinc-900 bg-blue-500" />
                      <div className="text-sm font-medium">{ev.title}</div>
                      <div className="text-xs text-zinc-400">{ev.date}{ev.location ? ` · ${ev.location}` : ""}</div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}

        {/* تحویل حضوری با امضا — سند تحویل سالم */}
        {t.delivery_signature && (
          <div className="card card-pad border-emerald-200 dark:border-emerald-500/30">
            <h2 className="font-semibold text-emerald-700 dark:text-emerald-400">✓ دستگاه تحویل داده شد</h2>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <SignatureView dataUrl={t.delivery_signature} alt="امضای تحویل" className="w-full sm:max-w-md" />
              <div className="text-sm space-y-0.5">
                <div>تحویل‌گیرنده: <strong>{t.delivery_signed_name}</strong></div>
                <div className="text-xs text-zinc-400">تاریخ و ساعت تحویل: {fmtDateTime(t.delivery_signed_at)}</div>
              </div>
            </div>
            <p className="mt-2 text-xs text-zinc-400">این امضا تأییدیه دریافت دستگاه سالم و کامل همراه با لوازم ذکرشده در پذیرش است.</p>
          </div>
        )}

        {/* Invoice / amount due */}
        {invoice && invoice.total - invoice.paid > 0 && (
          <div className="card card-pad">
            <div className="flex justify-between items-center">
              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-400">مبلغ قابل پرداخت</div>
                <div className="text-xl font-bold">{fmtMoney(invoice.total - invoice.paid)}</div>
                <div className="text-xs text-zinc-400">فاکتور {invoice.number}</div>
              </div>
              <span className="badge-amber">پرداخت هنگام تحویل</span>
            </div>
          </div>
        )}

        {/* Warranty */}
        {warranty && (
          <div className="card card-pad border-emerald-200 dark:border-emerald-500/30">
            <h2 className="font-semibold text-emerald-700 dark:text-emerald-400">گارانتی فعال</h2>
            <p className="text-sm text-zinc-500 mt-1">{warranty.terms} — تا {fmtDate(warranty.end_date)}</p>
          </div>
        )}

        {/* Progress timeline (customer-visible only) */}
        <div className="card card-pad">
          <h2 className="font-semibold mb-3">پیشرفت</h2>
          <ol className="relative mr-2 border-r border-zinc-200 dark:border-zinc-800 space-y-4">
            {history.map((h: any) => (
              <li key={h.id} className="mr-4">
                <span className="absolute -right-[7px] mt-1.5 h-3.5 w-3.5 rounded-full border-2 border-white dark:border-zinc-900" style={{ backgroundColor: h.color }} />
                <div className="text-sm font-medium">{statusFa(h.status_name)}</div>
                <div className="text-xs text-zinc-400">{fmtDateTime(h.created_at)}</div>
              </li>
            ))}
          </ol>
        </div>

        {/* شرح کار عمومی */}
        {publicNotes.length > 0 && (
          <div className="card card-pad">
            <h2 className="font-semibold mb-2">گزارش پیشرفت کار</h2>
            <div className="space-y-2">
              {publicNotes.map((n: any) => (
                <div key={n.created_at} className="rounded-lg bg-brand-50/60 dark:bg-brand-500/10 px-3 py-2">
                  <p className="text-sm">{n.body}</p>
                  <p className="text-xs text-zinc-400 mt-1">{n.user_name ?? "تیم تعمیرگاه"} · {fmtDateTime(n.created_at)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-center text-xs text-zinc-400">
          برای پرسش دربارهٔ پذیرش با تعمیرگاه تماس بگیرید. شرح کارهای داخلی نمایش داده نمی‌شود.
        </p>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-zinc-100 dark:bg-zinc-950 p-4">
      <div className="card card-pad text-center max-w-sm">{children}</div>
    </div>
  );
}
