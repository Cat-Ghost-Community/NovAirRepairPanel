import { SignatureView } from "@/components/signature-pad";
import { requirePageAccess } from "@/lib/page-access";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/schema";
import { fmtMoney, fmtDate, toFaDigits } from "@/lib/format";
import { EstStatusBadge } from "@/app/repairs/[id]/workspace-client";
import { EstimateActions } from "./estimate-actions";

export const dynamic = "force-dynamic";

export default async function EstimateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageAccess("/estimates/[id]");
  const { id } = await params;
  const db = getDb();
  const estId = Number(id);
  const e = db
    .prepare(
      `SELECT e.*, c.first_name, c.last_name, c.company, c.mobile, c.email, d.brand, d.model, t.number ticket_number
       FROM estimates e
       JOIN customers c ON c.id = e.customer_id
       LEFT JOIN devices d ON d.id = e.device_id
       LEFT JOIN repair_tickets t ON t.id = e.ticket_id
       WHERE e.id = ?`
    )
    .get(estId) as any;
  if (!e) notFound();
  const items = db.prepare("SELECT * FROM estimate_items WHERE estimate_id = ? ORDER BY sort, id").all(estId) as any[];

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <div className="no-print flex items-center justify-between mb-4">
        <Link href="/estimates" className="btn-ghost btn-sm">← همه برآوردها</Link>
        <div className="flex gap-2">
          <EstimateActions estimateId={e.id} status={e.status} token={e.public_token} />
          <a href={`/api/estimates/${e.id}/document`} target="_blank" className="btn-secondary btn-sm">چاپ</a>
        </div>
      </div>

      <div className="card card-pad">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-mono text-xl font-bold">{e.number} <span className="text-sm text-zinc-400 font-sans">نسخهٔ {toFaDigits(e.version)}</span></h1>
            <div className="mt-1"><EstStatusBadge status={e.status} /></div>
            {e.ticket_number && (
              <div className="mt-2 text-sm text-zinc-500">پذیرش <Link href={`/repairs`} className="font-mono text-brand-600 hover:underline">{e.ticket_number}</Link></div>
            )}
          </div>
          <div className="text-right text-sm">
            <div className="font-medium">{e.company ?? `${e.first_name} ${e.last_name}`}</div>
            <div className="text-zinc-500">{e.mobile}</div>
            {e.brand && <div className="text-zinc-400 mt-1">{e.brand} {e.model}</div>}
          </div>
        </div>

        <table className="mt-5 w-full border-t border-zinc-200 dark:border-zinc-800">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th className="th">قلم</th><th className="th">نوع</th><th className="th text-right">تعداد</th><th className="th text-right">قیمت فروش</th><th className="th text-right">جمع کل</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-b border-zinc-100 dark:border-zinc-800/60">
                <td className="td">{i.name}</td>
                <td className="td"><span className="badge-gray">{i.kind === "service" ? "خدمت" : i.kind === "part" ? "قطعه" : i.kind === "labor" ? "اجرت" : i.kind === "fee" ? "هزینه" : i.kind}</span></td>
                <td className="td text-right">{i.qty}</td>
                <td className="td text-right">{fmtMoney(i.unit_price)}</td>
                <td className="td text-right font-medium">{fmtMoney(i.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 ml-auto max-w-56 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-zinc-500">جمع کل</span><span>{fmtMoney(e.subtotal)}</span></div>
          <div className="flex justify-between"><span className="text-zinc-500">مالیات</span><span>{fmtMoney(e.tax)}</span></div>
          <div className="flex justify-between font-bold border-t border-zinc-200 dark:border-zinc-800 pt-1 text-base"><span>جمع کل</span><span>{fmtMoney(e.total)}</span></div>
          {e.deposit > 0 && <div className="flex justify-between text-brand-600"><span>بیعانه درخواستی</span><span>{fmtMoney(e.deposit)}</span></div>}
        </div>

        {e.signature_data && (
          <div className="mt-4 rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/10 p-3">
            <h3 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">امضای تأیید مشتری</h3>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <SignatureView dataUrl={e.signature_data} alt="امضای مشتری" className="w-full sm:max-w-md" />
              <div className="text-sm space-y-0.5">
                <div>امضاکننده: <strong>{e.signed_name}</strong></div>
                <div className="text-xs text-zinc-500">تاریخ و ساعت: {fmtDate(e.signed_at)} — IP: <span dir="ltr" className="font-mono">{e.signed_ip}</span></div>
                <div className="text-xs text-zinc-400">تصویر اصلی امضا همراه نام و زمان تأیید در سوابق نگهداری می‌شود.</div>
              </div>
            </div>
          </div>
        )}
        {e.approved_at && <p className="mt-4 text-sm text-emerald-600"> تأیید توسط مشتری در {fmtDate(e.approved_at)}{e.signature_data ? " — با امضای دیجیتال" : ""}</p>}
        {e.rejected_at && <p className="mt-4 text-sm text-red-600"> رد توسط مشتری در {fmtDate(e.rejected_at)}{e.rejection_reason ? ` — “${e.rejection_reason}”` : ""}</p>}

        <div className="mt-6 border-t border-zinc-200 dark:border-zinc-800 pt-3 text-xs text-zinc-400">
          <p>{e.notes}</p>
          <p className="mt-1">{e.terms}</p>
          <p className="mt-1">اعتبار تا {fmtDate(e.valid_until)} — پس از تأیید، هر تغییر نسخه جدید می‌سازد.</p>
        </div>
      </div>
    </div>
  );
}
