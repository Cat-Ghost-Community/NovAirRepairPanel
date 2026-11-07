import { SignatureView } from "@/components/signature-pad";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/schema";
import { fmtMoney, fmtDate, fmtDateTime } from "@/lib/format";
import { TrackActions } from "../../[token]/track-actions";

export const dynamic = "force-dynamic";

export default async function TrackEstimatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = getDb();
  const e = db
    .prepare(
      `SELECT e.*, c.first_name, c.last_name, d.brand, d.model, t.number ticket_number
       FROM estimates e
       JOIN customers c ON c.id = e.customer_id
       LEFT JOIN devices d ON d.id = e.device_id
       LEFT JOIN repair_tickets t ON t.id = e.ticket_id
       WHERE e.public_token = ?`
    )
    .get(token) as any;
  if (!e) notFound();
  const items = db.prepare("SELECT * FROM estimate_items WHERE estimate_id = ? ORDER BY id").all(e.id) as any[];
  const shop = (db.prepare("SELECT value FROM settings WHERE key = 'business_name'").get() as any)?.value ?? "تعمیرگاه الکترونیک ریپرد";

  if (e.status !== "sent" && e.status !== "viewed") {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-zinc-100 dark:bg-zinc-950 p-4">
        <div className="card card-pad text-center max-w-sm">
          <h1 className="font-semibold">برآورد {e.number} قبلاً {e.status === "approved" ? "تأیید" : e.status === "rejected" ? "رد" : "بررسی"} شده است</h1>
          {e.status === "approved" && e.signature_data && (
            <div className="mt-3 space-y-2">
              <SignatureView dataUrl={e.signature_data} alt="امضای تأیید" className="w-full sm:max-w-md" />
              <p className="text-sm">امضاکننده: <strong>{e.signed_name}</strong></p>
              <p className="text-xs text-zinc-400">تاریخ امضا: {fmtDateTime(e.signed_at)}</p>
            </div>
          )}
          <p className="text-sm text-zinc-500 mt-1">برای هر سوال با تعمیرگاه تماس بگیرید.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-zinc-100 dark:bg-zinc-950 py-8 px-4">
      <div className="max-w-lg mx-auto card card-pad">
        <div className="text-center mb-4">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white text-xl font-bold">R</span>
          <div className="mt-2 text-lg font-bold">{shop}</div>
          <div className="text-sm text-zinc-500">برآورد برای پذیرش <span className="font-mono">{e.ticket_number ?? e.number}</span></div>
        </div>
        <h1 className="font-semibold">{e.first_name} عزیز، برآورد هزینه شما آماده است</h1>
        {e.brand && <p className="text-sm text-zinc-500">{e.brand} {e.model}</p>}
        <div className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {items.map((i) => (
            <div key={i.id} className="flex justify-between py-2 text-sm">
              <span>{i.name}</span>
              <span>{fmtMoney(i.total)}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-between pt-2 mt-1 border-t border-zinc-200 dark:border-zinc-800 font-bold">
          <span>جمع با احتساب مالیات</span><span>{fmtMoney(e.total)}</span>
        </div>
        <p className="mt-3 text-xs text-zinc-400">{e.notes} {e.terms} اعتبار تا {e.valid_until ? fmtDate(String(e.valid_until)) : "—"}.</p>
        <TrackActions estimateToken={e.public_token} customerName={`${e.first_name} ${e.last_name ?? ""}`.trim()} total={e.total} validUntil={e.valid_until} />
      </div>
    </div>
  );
}
