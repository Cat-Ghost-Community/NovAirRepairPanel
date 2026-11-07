"use client";

import { SearchableSelect } from "@/components/searchable-select";


import { useCallback, useEffect, useState } from "react";
import { useToast, EmptyState } from "@/components/ui";
import { fmtDateTime, toFaDigits } from "@/lib/format";

type Msg = { id: number; body: string; channel: string; status: string; customer_name: string | null; mobile: string | null; user_name: string | null; created_at: string };

const STATUS_FA: Record<string, { label: string; cls: string }> = {
  queued: { label: "در صف", cls: "badge-amber" },
  sent: { label: "ارسال‌شده", cls: "badge-green" },
  failed: { label: "ناموفق", cls: "badge-red" },
  sending: { label: "در حال ارسال", cls: "badge-amber" },
  unknown: { label: "نیازمند بررسی درگاه", cls: "badge-amber" },
  cancelled: { label: "لغوشده", cls: "badge-gray" },
};

const PROVIDERS = [
  { key: "none", label: "بدون درگاه (فقط صف)", hint: "" },
  { key: "kavenegar", label: "کاوه‌نگار", hint: "کلید API از پنل کاوه‌نگار" },
  { key: "melipayamak", label: "ملی‌پیامک", hint: "username|password" },
  { key: "ghasedak", label: "قاصدک", hint: "کلید API از پنل قاصدک" },
  { key: "custom", label: "درگاه سفارشی (وب‌هوک)", hint: "POST {to, from, text}" },
];

export function OutboxClient({ initialSettings,canConfigure }: { initialSettings: Record<string, string>;canConfigure:boolean }) {
  const toast = useToast();
  const [rows, setRows] = useState<Msg[]>([]);
  const [counts, setCounts] = useState<Array<{ status: string; c: number }>>([]);
  const [filter, setFilter] = useState("");
  const [provider, setProvider] = useState(initialSettings.sms_provider ?? "none");
  const [apiKey, setApiKey] = useState("");
  const [sender, setSender] = useState(initialSettings.sms_sender ?? "");
  const [webhook, setWebhook] = useState(initialSettings.sms_webhook_url ?? "");
  const [savingSms, setSavingSms] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [acting, setActing] = useState(false);

  const load = useCallback((signal?: AbortSignal) => {
    const q = filter ? `?status=${filter}` : "";
    setLoading(true);
    setLoadError("");
    fetch(`/api/messages/dispatch${q}`, { signal }).then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "بارگذاری پیام‌ها ناموفق بود.");
      return data;
    }).then((d) => {
      setRows(d.messages ?? []);
      setCounts(d.counts ?? []);
      if (d.provider) setProvider(d.provider);
    }).catch((error) => {
      if (!signal?.aborted) setLoadError(error instanceof Error && /[\u0600-\u06FF]/.test(error.message) ? error.message : "دریافت پیام‌ها ناموفق بود. اتصال شبکه را بررسی و دوباره تلاش کنید.");
    }).finally(() => { if (!signal?.aborted) setLoading(false); });
  }, [filter]);
  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort(); }, [load]);

  const count = (s: string) => counts.find((c) => c.status === s)?.c ?? 0;

  const act = async (body: any, msg: string) => {
    if (acting) return;
    setActing(true);
    try {
    const res = await fetch("/api/messages/dispatch", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const d = await res.json();
    if (!res.ok || d.error) { toast(d.error ?? "خطا", "error"); return d; }
    toast(msg);
    load();
    return d;
    } catch { toast("ارتباط با سرور برقرار نشد. دوباره تلاش کنید.", "error"); }
    finally { setActing(false); }
  };

  const saveSmsSettings = async () => {
    if (savingSms) return;
    setSavingSms(true);
    try {
    const res = await fetch("/api/settings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: { sms_provider: provider, sms_api_key: apiKey, sms_sender: sender, sms_webhook_url: webhook } }),
    });
    if (res.ok) { setApiKey(""); toast("تنظیمات درگاه ذخیره شد"); }
    else { const data = await res.json(); toast(data.error ?? "خطا در ذخیره تنظیمات", "error"); }
    } catch { toast("ارتباط با سرور برقرار نشد. دوباره تلاش کنید.", "error"); }
    finally { setSavingSms(false); }
  };

  const saveEnabled = provider === "none" || !["", "custom"].includes(provider) || (provider === "custom" && !!webhook);

  return (
    <div className="space-y-5">
      {/* پیکربندی درگاه */}
      {canConfigure && <section className="card card-pad">
        <h2 className="section-title mb-3">درگاه پیامک</h2>
        <div className="grid sm:grid-cols-4 gap-2 items-end">
          <div>
            <label className="label" htmlFor="sms-prov">ارائه‌دهنده</label>
            <SearchableSelect id="sms-prov" className="input" value={provider} onChange={(e) => setProvider(e.target.value)}>
              {PROVIDERS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </SearchableSelect>
          </div>
          {provider === "custom" ? (
            <div className="sm:col-span-2">
              <label className="label" htmlFor="sms-hook">آدرس وب‌هوک</label>
              <input id="sms-hook" className="input" dir="ltr" value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://…" />
            </div>
          ) : (
            <div>
              <label className="label" htmlFor="sms-key">کلید API {provider !== "none" && PROVIDERS.find((p) => p.key === provider)?.hint ? `(${PROVIDERS.find((p) => p.key === provider)?.hint})` : ""}</label>
              <input id="sms-key" className="input" dir="ltr" type="password" autoComplete="new-password" placeholder={initialSettings.has_sms_api_key === "1" ? "کلید ذخیره شده؛ برای تغییر وارد کنید" : "کلید API"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} disabled={provider === "none"} />
            </div>
          )}
          <div>
            <label className="label" htmlFor="sms-sender">شماره فرستنده</label>
            <input id="sms-sender" className="input" dir="ltr" value={sender} onChange={(e) => setSender(e.target.value)} placeholder="+98…" disabled={provider === "none"} />
          </div>
        </div>
        <div className="flex justify-end mt-3">
          <button className="btn-primary btn-sm" onClick={saveSmsSettings} disabled={savingSms}>ذخیره تنظیمات درگاه</button>
        </div>
        {provider === "none" && <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">درگاه تنظیم نشده — پیام‌ها در صف می‌مانند و ارسال نمی‌شوند.</p>}
      </section>}

      {/* فیلتر و اقدامات */}
      <div className="flex flex-wrap gap-2 items-center">
        <button onClick={() => setFilter("")} className={`badge-gray min-h-8 focus-visible:outline-2 focus-visible:outline-brand-500 cursor-pointer ${!filter ? "ring-2 ring-brand-400" : ""}`}>همه</button>
        {Object.entries(STATUS_FA).map(([k, v]) => (
          <button key={k} onClick={() => setFilter(filter === k ? "" : k)} className={`${v.cls} min-h-8 focus-visible:outline-2 focus-visible:outline-brand-500 cursor-pointer ${filter === k ? "ring-2 ring-brand-400" : ""}`}>
            {v.label}: {toFaDigits(count(k))}
          </button>
        ))}
        {count("failed") > 0 && (
          <button disabled={acting} className="btn-secondary btn-sm mr-auto" onClick={() => act({ action: "retry_all_failed" }, "تلاش مجدد انجام شد؛ وضعیت هر پیام را بررسی کنید.")}>
            تلاش مجدد همه ناموفق‌ها ({toFaDigits(count("failed"))})
          </button>
        )}
      </div>

      {/* جدول پیام‌ها */}
      <div className="card overflow-x-auto">
        {loading && <p className="p-4 text-sm text-zinc-500" role="status">در حال دریافت پیام‌ها…</p>}
        {loadError && <div className="p-4" role="alert"><p className="text-sm text-red-600">{loadError}</p><button type="button" className="btn-secondary mt-2" onClick={() => load()}>تلاش مجدد</button></div>}
        {!loading && !loadError && rows.length === 0 && <EmptyState title="پیامی نیست" body="با تغییر فیلتر یا ثبت پیام برای مشتری، این فهرست به‌روز می‌شود." />}
        {!loading && !loadError && rows.length > 0 &&
        <table className="w-full">
          <thead className="border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="th">مشتری</th><th className="th">متن پیام</th><th className="th">وضعیت</th>
              <th className="th hidden md:table-cell">تاریخ</th><th className="th">اقدام</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {rows.map((m) => {
              const st = STATUS_FA[m.status] ?? { label: m.status, cls: "badge-gray" };
              return (
                <tr key={m.id} className="row-hover align-top">
                  <td className="td">
                    {m.customer_name ?? "—"}
                    {m.mobile && <span className="block text-xs text-zinc-400 font-mono" dir="ltr">{m.mobile}</span>}
                  </td>
                  <td className="td max-w-md"><span className="text-[13px] line-clamp-2">{m.body}</span></td>
                  <td className="td"><span className={st.cls}>{st.label}</span></td>
                  <td className="td hidden md:table-cell text-zinc-400 text-xs whitespace-nowrap">{fmtDateTime(m.created_at)}</td>
                  <td className="td">
                    <span className="flex gap-2 text-xs">
                      {(m.status === "queued" || m.status === "failed") && (
                        <button disabled={acting} className="min-h-8 focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-50 text-brand-600 hover:underline" onClick={() => act({ action: "send_now", id: m.id }, "درگاه پیام را پذیرفت")}>ارسال</button>
                      )}
                      {m.status === "queued" && (
                        <button disabled={acting} className="min-h-8 focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-50 text-zinc-500 hover:underline" onClick={() => act({ action: "cancel", id: m.id }, "پیام لغو شد")}>لغو</button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={5} className="td text-center text-zinc-400 py-8">پیامی نیست</td></tr>}
          </tbody>
        </table>}
      </div>
    </div>
  );
}
