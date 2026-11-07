import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail } from "@/lib/api";
import { getSetting as rawGetSetting } from "@/lib/repair";
import { escapeHtml } from "@/lib/html";
import { requireRepairAccess } from "@/lib/repair-access";
import { fmtMoney, fmtDate, fmtDateTime, toFaDigits } from "@/lib/format";
import {PRINT_FONT_ROOT} from '@/lib/network-policy';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = requireSession(req);
    requirePerm(session, "estimates.view");
    const { id } = await params;
    const db = getDb();
    const e = db
      .prepare(
        `SELECT e.*, c.first_name, c.last_name, c.company, c.mobile, d.brand, d.model, t.number ticket_number
         FROM estimates e JOIN customers c ON c.id = e.customer_id
         LEFT JOIN devices d ON d.id = e.device_id LEFT JOIN repair_tickets t ON t.id = e.ticket_id
         WHERE e.id = ?`
      )
      .get(Number(id)) as any;
    if (!e) return new Response("یافت نشد", { status: 404 });
    if (e.ticket_id) requireRepairAccess(session, Number(e.ticket_id), req.cookies.get("repaid_branch")?.value);
    for (const key of Object.keys(e)) if (typeof e[key] === "string") e[key] = escapeHtml(e[key]);
    if (e.signature_data && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(e.signature_data)) e.signature_data = null;
    const items = db.prepare("SELECT * FROM estimate_items WHERE estimate_id = ? ORDER BY id").all(Number(id)) as any[];
    const shop = escapeHtml(rawGetSetting("business_name", "تعمیرگاه"));
    const origin = escapeHtml(new URL(process.env.APP_ORIGIN??req.nextUrl.origin).origin);

    const rows = items
      .map(
        (i) => `<tr><td>${escapeHtml(i.name)}</td><td class="num">${toFaDigits(String(i.qty))}</td><td class="num">${fmtMoney(i.unit_price)}</td><td class="num">${fmtMoney(i.total)}</td></tr>`
      )
      .join("");

    const statusFa: Record<string, string> = {
      draft: "پیش‌نویس", sent: "ارسال‌شده", approved: "تأیید مشتری", rejected: "رد شده", expired: "منقضی",
    };

    const html = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>برآورد ${e.number}</title>
<style>
  @font-face { font-family: Vazirmatn; src: url("${PRINT_FONT_ROOT}/Vazirmatn-Regular.woff2") format("woff2"); font-weight: 400; font-display: swap; }
  @font-face { font-family: Vazirmatn; src: url("${PRINT_FONT_ROOT}/Vazirmatn-Bold.woff2") format("woff2"); font-weight: 700; font-display: swap; }
  * { font-family: Vazirmatn, system-ui, sans-serif; box-sizing: border-box; }
  body{max-width:700px;margin:32px auto;color:#1c1c1c;padding:0 20px;background:#fff}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:12px}
  h1{font-size:19px;margin:0 0 4px}
  .muted{color:#777;font-size:12px}
  .badge{display:inline-block;background:#eef;padding:2px 10px;border-radius:12px;font-size:11px;margin-top:6px}
  .info{margin-top:18px;font-size:13px;line-height:2}
  table{width:100%;border-collapse:collapse;margin-top:18px;font-size:13px}
  th,td{padding:8px 8px;border-bottom:1px solid #e5e5e5;text-align:right}
  th{font-size:12px;color:#555;border-bottom:1.5px solid #999}
  .num{font-variant-numeric:tabular-nums}
  .totals{margin-top:14px;margin-right:auto;width:240px;font-size:13px}
  .totals div{display:flex;justify-content:space-between;padding:4px 0}
  .grand{font-weight:700;border-top:1.5px solid #333;padding-top:6px;font-size:14px}
  .foot{margin-top:26px;font-size:11px;color:#888;border-top:1px solid #eee;padding-top:10px;line-height:1.9}
  .qr{margin-top:14px;text-align:center}
  @media print {
    body{margin:0;padding:12mm}
    .noprint{display:none}
    @page { size: A5; margin: 10mm; }
  }
</style></head><body>
<div class="head">
  <div>
    <strong style="font-size:17px">${shop}</strong>
    <div class="muted">برآورد هزینه تعمیرات</div>
    ${e.ticket_number ? `<div class="muted">پذیرش: <span class="num">${e.ticket_number}</span></div>` : ""}
  </div>
  <div style="text-align:left">
    <h1 class="num" dir="ltr">${e.number}</h1>
    <div class="muted">تاریخ صدور: ${fmtDate(e.created_at)}</div>
    <div class="muted">اعتبار تا: ${fmtDate(e.valid_until)}</div>
    <div class="badge">وضعیت: ${statusFa[e.status] ?? e.status}</div>
  </div>
</div>
<div class="info">
  <strong>صورتحساب برای:</strong> ${e.company ?? `${e.first_name} ${e.last_name}`}<br/>
  ${e.mobile ? `تلفن: <span class="num">${toFaDigits(e.mobile)}</span><br/>` : ""}
  ${e.brand ? `دستگاه: ${e.brand} ${e.model ?? ""}<br/>` : ""}
</div>
<table><thead><tr><th>شرح</th><th style="width:60px">تعداد</th><th style="width:130px">قیمت واحد</th><th style="width:130px">جمع کل</th></tr></thead>
<tbody>${rows}</tbody></table>
<div class="totals">
  <div><span>جمع کل اقلام</span><span class="num">${fmtMoney(e.subtotal)}</span></div>
  ${e.discount > 0 ? `<div><span>تخفیف</span><span class="num">−${fmtMoney(e.discount)}</span></div>` : ""}
  <div><span>مالیات و عوارض</span><span class="num">${fmtMoney(e.tax)}</span></div>
  <div class="grand"><span>مبلغ قابل پرداخت</span><span class="num">${fmtMoney(e.total)}</span></div>
</div>
${(e.notes || e.terms) ? `<p class="muted" style="margin-top:18px;line-height:2">${e.notes ?? ""} ${e.terms ?? ""}</p>` : ""}
${e.signature_data ? `
<div style="margin-top:22px;border:1px solid #ddd;border-radius:8px;padding:14px;background:#fafafa">
  <div style="font-size:13px;font-weight:700;color:#059669;margin-bottom:8px">تأیید و امضای مشتری</div>
  <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
    <img src="${e.signature_data}" alt="امضای مشتری" style="display:block;width:100%;max-width:360px;height:120px;object-fit:contain;padding:12px;box-sizing:border-box;border:1px solid #d4d4d8;border-radius:12px;background:#fff"/>
    <div style="font-size:12px;line-height:2">
      <div>امضاکننده: <strong>${e.signed_name ?? ""}</strong></div>
      <div class="muted">تاریخ و ساعت امضا: ${fmtDateTime(e.signed_at)}</div>
      <div class="muted">نشانی IP: <span class="num" dir="ltr">${e.signed_ip ?? "—"}</span></div>
    </div>
  </div>
  <div class="muted" style="margin-top:8px;font-size:10.5px">این امضای الکترونیکی به‌منزله امضای دست‌نویس مشتری است و تأیید مبلغ و شروع تعمیر را اثبات می‌کند (مطابق قوانین تجارت الکترونیک).</div>
</div>` : `<div style="margin-top:26px;display:flex;justify-content:space-between;font-size:12px;color:#555">
  <div>امضای مشتری: ......................................</div>
  <div>مهر و امضای تعمیرگاه: ......................................</div>
</div>`}
<div class="qr">
  <p class="muted noprint">تأیید یا رد این برآورد به‌صورت آنلاین:</p>
  <img class="noprint" src="/api/qr?text=${encodeURIComponent(`/track/estimate/${e.public_token}`)}" alt="QR" width="110"/>
  <div class="muted num" dir="ltr">${origin}/track/estimate/${e.public_token}</div>
</div>
<p class="foot">این برآورد صرفاً اعلام هزینه است و تا پیش از تأیید مشتری، هیچ عملیاتی انجام نمی‌شود. پس از تأیید، موارد تأییدشده مشمول شرایط گارانتی درج‌شده در رسید پذیرش خواهد بود.</p>
<script nonce="${escapeHtml(req.headers.get('x-nonce')??'')}">if(location.search.includes("print"))window.print()</script>
</body></html>`;
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control":"private, no-store" } });
  } catch (e) {
    return fail(e);
  }
}
