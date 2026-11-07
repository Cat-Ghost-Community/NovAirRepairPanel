import { requirePageAccess } from "@/lib/page-access";
import { requireRepairRowsAccess } from "@/lib/repair-access";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db/schema";
import { fmtMoney, fmtDate, toFaDigits } from "@/lib/format";
import { DEVICE_TYPE_FA } from "@/lib/status-fa";
import PrintControls from "@/app/repairs/[id]/receipt/print-controls";
import {repairReceiptPositions,groupReceiptPosition} from '@/lib/repair-receipt-position';
import Link from 'next/link';
import {canUser} from '@/lib/auth';
import {HttpError} from '@/lib/api';
import {EmptyState} from '@/components/ui';

export const dynamic = "force-dynamic";

/** قبض پذیرش گروهی — همه دستگاه‌های یک پذیرش گروهی از یک مشتری روی یک برگه */
export default async function GroupReceiptPage({ params,searchParams }: { params: Promise<{ gid: string }>;searchParams:Promise<Record<string,string|undefined>> }) {
  const session = await requirePageAccess("/repairs/group-receipt/[gid]");
  const { gid } = await params;
  const db = getDb();
  const tickets = db
    .prepare(
      `SELECT t.*, s.name status_name, s.color status_color, c.first_name, c.last_name, c.mobile, c.phone,
        d.type, d.brand, d.model, d.serial, d.imei
       FROM repair_tickets t
       JOIN repair_statuses s ON s.id = t.status_id
       JOIN customers c ON c.id = t.customer_id
       JOIN devices d ON d.id = t.device_id
       WHERE t.group_receipt_id = ? ORDER BY t.id LIMIT 101`
    )
    .all(gid) as any[];
  if (tickets.length === 0) notFound();
  const branchCookie = (await cookies()).get("repaid_branch")?.value;
  try{requireRepairRowsAccess(session, tickets, branchCookie);}catch(error){if(error instanceof HttpError&&[403,404].includes(error.status))notFound();throw error;}
  if(tickets.length>100)notFound();

  const c = tickets[0];
  if(tickets.some(t=>t.customer_id!==c.customer_id||t.branch_id!==c.branch_id))return <div className="mx-auto max-w-3xl p-4 sm:p-6"><div className="card card-pad" role="alert"><EmptyState title="قبض گروهی نیازمند بررسی اسناد است" body="این شناسه به بیش از یک مشتری یا شعبه تعلق دارد؛ برای حفظ محرمانگی، چاپ متوقف شد. مدیر باید اسناد اصلی را بررسی کند." action={<Link className="btn-secondary" href="/repairs">بازگشت به پذیرش‌ها</Link>}/></div></div>;
  const shop = (db.prepare("SELECT value FROM settings WHERE key = 'business_name'").get() as any)?.value ?? "RePaird";
  const shopPhone = (db.prepare("SELECT value FROM settings WHERE key = 'business_phone'").get() as any)?.value ?? "";
  const shopAddr = (db.prepare("SELECT value FROM settings WHERE key = 'business_address'").get() as any)?.value ?? "";
  const amounts=repairReceiptPositions(db,tickets.map(t=>t.id),c.branch_id);
  const depositTotal=[...amounts.values()].reduce((sum,p)=>sum+p.net,BigInt(0));
  const receiptReview=[...amounts.values()].some(p=>p.review);
  const groupCash=groupReceiptPosition(db,gid,c.customer_id,c.branch_id);

  const query=await searchParams,paper=query.paper==='roll'?'roll':'a5';
  const showPrices = query.price==null?!(await cookies()).get("repaid_receipt_hide_prices"):query.price!=='0';

  return (
    <div className="min-h-dvh bg-zinc-100 dark:bg-zinc-950 print:bg-white" dir="rtl">
      <style>{`@media print{@page{size:${paper==='roll'?'80mm 297mm':'A5'};margin:0;}}`}</style>
      <PrintControls paper={paper} priceHidden={!showPrices} />
      <div id="print-area" className={`mx-auto w-full bg-white p-4 text-zinc-900 shadow-lg print:shadow-none ${paper==='roll'?'max-w-[80mm] print:w-[80mm] print:p-3':'max-w-[148mm] sm:p-[10mm] print:w-[148mm] print:p-[10mm]'}`}>
        {/* سربرگ */}
        <div className="flex items-start justify-between border-b-2 border-zinc-800 pb-3">
          <div>
            <h1 className="text-lg font-extrabold">{shop}</h1>
            {(shopAddr || shopPhone) && <p className="text-[11px] text-zinc-500 mt-0.5">{shopAddr} {shopPhone && `· ${shopPhone}`}</p>}
          </div>
          <div className="text-left">
            <div className="text-[13px] font-bold">قبض پذیرش گروهی</div>
            <div className="text-[11px] text-zinc-500">شماره گروه: <span dir="ltr" className="font-mono break-all">{gid}</span></div>
            <div className="text-[11px] text-zinc-500">{fmtDate(new Date())}</div>
          </div>
        </div>

        {/* مشتری */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs py-3 border-b border-zinc-300">
          <div><span className="text-zinc-500">مشتری: </span><span className="font-semibold">{c.first_name} {c.last_name}</span></div>
          <div><span className="text-zinc-500">تماس: </span><span className="font-mono">{c.mobile || c.phone || "—"}</span></div>
        </div>

        {/* جدول دستگاه‌ها */}
        {paper==='roll'?<div className="mt-2 space-y-2">{tickets.map((t,i)=><article key={t.id} className="border-b border-zinc-300 pb-2 text-[11px] break-words print-avoid-break">
          <div className="font-semibold">{toFaDigits(i+1)}. {DEVICE_TYPE_FA[t.type]??t.type} {t.brand} {t.model}</div>
          <p>شمارهٔ پذیرش: <span dir="ltr" className="font-mono">{t.number}</span></p>
          <p>سریال / IMEI: <span dir="ltr" className="font-mono break-all">{t.serial||t.imei||'—'}</span></p>
          <p>ایراد اعلامی: {t.problem}</p>
          {showPrices&&<p>خالص دریافت قطعی: {amounts.get(t.id)?.review?'نیازمند بررسی':fmtMoney(amounts.get(t.id)?.net??BigInt(0))}</p>}
          {showPrices&&(amounts.get(t.id)?.pending??BigInt(0))>0&&<p>در انتظار وصول: {fmtMoney(amounts.get(t.id)!.pending)}</p>}
        </article>)}</div>:<div className="overflow-x-auto print:overflow-visible"><table className="w-full text-[11px] mt-2">
          <thead>
            <tr className="border-b border-zinc-400 text-zinc-600">
              <th className="py-1 text-right font-semibold">#</th>
              <th className="py-1 text-right font-semibold">دستگاه</th>
              <th className="py-1 text-right font-semibold">سریال/IMEI</th>
              <th className="py-1 text-right font-semibold">ایراد اعلامی</th>
              <th className="py-1 text-right font-semibold">شماره پذیرش</th>
              {showPrices && <th className="py-1 text-right font-semibold">خالص دریافت قطعی</th>}
            </tr>
          </thead>
          <tbody>
            {tickets.map((t, i) => (
              <tr key={t.id} className="border-b border-zinc-200 align-top">
                <td className="py-1.5">{toFaDigits(i + 1)}</td>
                <td className="py-1.5 font-medium">{DEVICE_TYPE_FA[t.type] ?? t.type} {t.brand} {t.model}</td>
                <td className="py-1.5 font-mono text-[10px]" dir="ltr">{t.serial || t.imei || "—"}</td>
                <td className="py-1.5">{t.problem}</td>
                <td className="py-1.5 font-mono">{t.number}</td>
                {showPrices && <td className="py-1.5 num">{amounts.get(t.id)?.review?'نیازمند بررسی':fmtMoney(amounts.get(t.id)?.net??BigInt(0))}{(amounts.get(t.id)?.pending??BigInt(0))>0&&<span className="block text-[10px] text-zinc-600">در انتظار وصول: {fmtMoney(amounts.get(t.id)!.pending)}</span>}</td>}
              </tr>
            ))}
          </tbody>
        </table></div>}

        {/* جمع بیعانه */}
        {showPrices&&receiptReview&&<p className="mt-2 text-xs font-semibold">جمع دریافت‌های پذیرش نیازمند بررسی مالی است.</p>}
        {showPrices && !receiptReview && depositTotal > 0 && (
          <div className="text-xs font-bold mt-2">جمع خالص دریافت قطعی بابت دستگاه‌ها: {fmtMoney(depositTotal)}</div>
        )}
        {showPrices&&groupCash&&<section aria-label="دریافت نقدی گروه" className="mt-3 space-y-1 rounded-lg border border-zinc-300 p-3 text-xs break-words">
          <div className="font-semibold">رسید پیش‌دریافت گروه: <span dir="ltr">{String(groupCash.number)}</span></div>
          <p>مبلغ اولیه: {fmtMoney(Number(groupCash.amount))} · استرداد: {fmtMoney(Number(groupCash.refunded))}</p>
          <p>اعتبار آزاد مشتری: {groupCash.available==null?'نیازمند بررسی':fmtMoney(groupCash.available)}</p>
          <p>این وجه بین دستگاه‌ها تقسیم نشده است؛ تخصیص به فاکتورها از گردش تأیید اعتبار مشتری انجام می‌شود.</p>
          <p>وضعیت دفترکل: {groupCash.accounting_state==='posted'?'ثبت‌شده':'در انتظار بررسی مالی'}</p>
          <p>مرجع دریافت: {String(groupCash.evidence_reference)}</p>
          {canUser(session,'finance.manage')&&<Link className="btn-secondary btn-sm print:hidden" href={`/payments/credit?customer_id=${c.customer_id}`}>مدیریت اعتبار مشتری</Link>}
        </section>}

        {/* شرایط */}
        <div className="text-[8.5px] leading-relaxed text-zinc-600 mt-3 border-t border-zinc-300 pt-2">
          <p className="font-semibold mb-0.5">شرایط تحویل:</p>
          <p>۱. پس از اطلاع آمادگی، حداکثر ظرف {toFaDigits(7)} روز دستگاه را تحویل بگیرید.</p>
          <p>۲. مسئولیت اطلاعات ذخیره‌شده با مشتری است — قبل از تحویل بکاپ مطمئن انجام دهید.</p>
          <p>۳. دستگاه‌های تحویل‌نشده پس از {toFaDigits(90)} روز، طبق قانون به حساب امانی منتقل می‌شود.</p>
          <p>۴. هر دستگاه دارای قبض جداگانه برای پیگیری آنلاین است.</p>
        </div>

        {/* امضا */}
        <div className="flex justify-between mt-5 text-[11px]">
          <div>امضای مشتری: .....................</div>
          <div>مهر و امضای فروشگاه: .....................</div>
        </div>
      </div>
    </div>
  );
}
