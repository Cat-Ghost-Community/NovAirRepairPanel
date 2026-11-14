import {customerDisplayName} from '@/lib/customer-identity';
import { SignatureView } from "@/components/signature-pad";
import { requirePageAccess } from "@/lib/page-access";
import { requireRepairAccess } from "@/lib/repair-access";
import { cookies,headers } from "next/headers";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/schema";
import { getSetting, decryptSecret } from "@/lib/repair";
import { PatternLockView } from "@/components/pattern-lock";
import { fmtMoney, fmtDate, fmtDateTime, toFaDigits } from "@/lib/format";
import PrintControls from "./print-controls";
import {repairReceiptPositions} from '@/lib/repair-receipt-position';
import {HttpError} from '@/lib/api';
import {DocumentBrand,DocumentFooter,DocumentPrintStyles} from '@/components/document-print';
import {readPrintSettings} from '@/lib/print-settings-server';
import {printPaper} from '@/lib/print-settings';
import {currentDeviceCatalog} from '@/lib/current-device-catalog';
import {deviceTypeLabel} from '@/lib/device-catalog';

export const dynamic = "force-dynamic";


export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requirePageAccess("/repairs/[id]/receipt");
  const { id } = await params;
  try{requireRepairAccess(session, Number(id), (await cookies()).get("repaid_branch")?.value);}catch(error){if(error instanceof HttpError&&[403,404].includes(error.status))notFound();throw error;}
  const sp = await searchParams;
  const db = getDb(),documentSettings=readPrintSettings(db),catalog=await currentDeviceCatalog();
  const trackingBase=(getSetting('public_base_url')||process.env.APP_ORIGIN||'http://'+((await headers()).get('host')??'localhost')).replace(/\/$/,'');
  const paper = printPaper(sp.paper,documentSettings.print_receipt_paper);
  const showPrice = sp.price !== "0";
  const t = db
    .prepare(
      `SELECT t.*, s.name status_name, c.first_name, c.last_name, c.salutation, c.mobile, c.phone, c.address,
              d.brand, d.model, d.type, d.serial, d.imei, d.color, u.name tech_name, b.name branch_name, b.phone branch_phone, b.address branch_address
       FROM repair_tickets t
       JOIN customers c ON c.id = t.customer_id
       JOIN devices d ON d.id = t.device_id
       JOIN repair_statuses s ON s.id = t.status_id
       LEFT JOIN users u ON u.id = t.technician_id
       LEFT JOIN branches b ON b.id = t.branch_id
       WHERE t.id = ?`
    )
    .get(Number(id)) as any;
  if (!t) notFound();

  const shop = getSetting("business_name", "تعمیرگاه");
  const position=repairReceiptPositions(db,[t.id],t.branch_id).get(t.id)!;
  const deposit = position.review?null:position.net;

  const rows: Array<[string, string]> = [
    ["نوع دستگاه", deviceTypeLabel(catalog,t.type)],
    ["برند و مدل", `${t.brand ?? "—"} ${t.model ?? ""}`.trim()],
    ...(t.imei ? [["IMEI", t.imei] as [string, string]] : []),
    ...(t.serial ? [["سریال", t.serial] as [string, string]] : []),
    ...(t.color ? [["رنگ", t.color] as [string, string]] : []),
    ["ایراد اعلامی", t.problem ?? "—"],
    ...(t.condition_notes ? [["وضعیت ظاهری", t.condition_notes] as [string, string]] : []),
    ...(t.accessories ? [["لوازم همراه", t.accessories] as [string, string]] : []),
    ...(t.repair_type ? [["نوع تعمیر", t.repair_type] as [string, string]] : []),
    ...(t.estimated_completion ? [["تحویل تخمینی", fmtDate(t.estimated_completion)] as [string, string]] : []),
    ...(t.diagnostic_fee > 0 && showPrice ? [["هزینه عیب‌یابی", fmtMoney(t.diagnostic_fee)] as [string, string]] : []),
    ...(t.security_type ? [["اطلاعات امنیتی", "ثبت شده (تحویل با رسید)"] as [string, string]] : []),
  ];

  return (
    <div className="overflow-x-auto print:overflow-visible">
    <DocumentPrintStyles settings={documentSettings} paper={paper}/>
    <div className={`receipt mx-auto w-full p-4 ${paper === "roll" ? "max-w-[8cm]" : "max-w-[21cm]"} bg-white text-black`}>
      <PrintControls paper={paper} priceHidden={!showPrice} />

      <div className="receipt-sheet document-sheet" data-document="receipt">
        <header className="text-center border-b-2 border-black pb-2">
          <DocumentBrand name={shop} settings={documentSettings}/>
          {t.branch_name && <p className="text-xs">{t.branch_name}{t.branch_phone ? ` — ${t.branch_phone}` : ""}</p>}
          <p className="text-sm font-bold mt-1">رسید پذیرش دستگاه</p>
        </header>

        <div className="flex items-start justify-between gap-3 mt-3 text-sm">
          <div className="space-y-0.5">
            <p><b>شماره پذیرش:</b> <span className="font-mono text-base">{t.number}</span></p>
            <p><b>تاریخ:</b> {fmtDate(t.created_at)}</p>
            <p><b>مشتری:</b> {customerDisplayName(t)}</p>
            <p dir="ltr" className="text-right"><b>تلفن:</b> {toFaDigits(t.mobile ?? t.phone ?? "—")}</p>
            {t.address && <p className="text-xs"><b>نشانی:</b> {t.address}</p>}
          </div>
          <div className="text-center shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/qr?text=${encodeURIComponent(trackingBase+'/track?ticket='+encodeURIComponent(t.number))}`} alt="QR پیگیری" className="h-20 w-20" />
            <p className="text-[11px] mt-0.5">اسکن برای پیگیری</p>
          </div>
        </div>

        <table className="w-full mt-3 border-collapse text-sm">
          <tbody>
            {rows.map(([k, v], i) => (
              <tr key={i} className="align-top">
                <td className="border border-black px-1.5 py-1 w-32 font-medium text-xs">{k}</td>
                <td className="border border-black px-1.5 py-1">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {showPrice&&deposit==null&&<p className="mt-2 text-sm">ماندهٔ دریافت نیازمند بررسی مالی است.</p>}
        {deposit!=null&&deposit > 0 && showPrice && (
          <p className="mt-2 text-sm"><b>خالص دریافت قطعی پس از استرداد:</b> {fmtMoney(deposit)}</p>
        )}
        {showPrice&&position.pending>0&&<p className="mt-2 text-xs text-zinc-600">اسناد در انتظار وصول: {fmtMoney(position.pending)}؛ این مبلغ دریافت قطعی نیست.</p>}

        {/* الگوی قفل ثبت‌شده — فقط برای نوع pattern و با حضور مشتری چاپ می‌شود */}
        {t.security_type === "pattern" && t.security_value_enc && (
          <div className="mt-3 border border-black p-2 flex items-center justify-between gap-3">
            <div className="text-xs">
              <p className="font-bold">الگوی قفل دستگاه</p>
              <p className="mt-1 leading-4">همراه دستگاه تحویل داده شد؛ پس از امضا، این برگه نزد مشتری می‌ماند.</p>
              <p className="mt-1 leading-4">راهنما: شمارهٔ کنار هر دایره موقعیت نقطه (۱ تا ۹) و عدد داخل دایره‌های سیاه، ترتیب کشیدن الگو از ۱ به بعد است.</p>
            </div>
            <PatternLockView value={decryptSecret(t.security_value_enc)} size={120} mono />
          </div>
        )}

        <div className="mt-4 text-xs leading-5 border border-black p-2">
          <p className="font-bold">شرایط تحویل:</p>
          <p>۱. دستگاه پس از اتمام تعمیر حداکثر تا ۳۰ روز نگهداری می‌شود؛ پس از آن هزینه نگهداری تعلق می‌گیرد.</p>
          <p>۲. مسئولیت اطلاعات ذخیره‌شده دستگاه بر عهده مشتری است؛ قبل از تحویل نسخه پشتیبان تهیه کنید.</p>
          <p>۳. این رسید هنگام تحویل دستگاه همراه داشته باشید.</p>
        </div>

        {/* رسید تحویل حضوری با امضا — فقط وقتی تحویل با امضا ثبت شده باشد چاپ می‌شود */}
        {t.delivery_signature && (
          <div className="document-signed-evidence print-avoid-break mt-3 border-2 border-black p-2">
            <p className="font-bold text-sm">رسید تحویل دستگاه — امضای تحویل‌گیرنده</p>
            <div className="flex flex-col items-start gap-3 mt-2 sm:flex-row print:flex-row">
              <SignatureView dataUrl={t.delivery_signature} alt="امضای تحویل‌گیرنده" className="w-full sm:max-w-md" compact />
              <div className="text-xs leading-5">
                <p><b>تحویل‌گیرنده:</b> {t.delivery_signed_name ?? "—"}</p>
                <p><b>تاریخ و ساعت تحویل:</b> {fmtDateTime(t.delivery_signed_at)}</p>
                <p><b>شماره پذیرش:</b> <span className="font-mono">{t.number}</span></p>
              </div>
            </div>
            <p className="text-[11px] leading-4 mt-2 border-t border-black pt-1">
              تحویل‌گیرنده با امضای خود تأیید می‌کند دستگاه تعمیرشده به‌همراه لوازم همراه ذکرشده در این رسید، سالم و کامل تحویل گرفته شد و از انجام کار و هزینه نهایی مطابق فاکتور اطلاع دارد.
            </p>
          </div>
        )}

        <div className="document-signature-lines flex justify-between mt-6 text-sm">
          {t.delivery_signature ? (
            <div className="text-xs">امضای مشتری در کادر بالا ثبت شده است.</div>
          ) : (
            <div>
              <p className="border-t border-black pt-1 px-6">امضای مشتری</p>
            </div>
          )}
          <div>
            <p className="border-t border-black pt-1 px-6">مهر و امضای تعمیرگاه</p>
          </div>
        </div>
        <DocumentFooter settings={documentSettings}/>
      </div>
    </div>
    </div>
  );
}
