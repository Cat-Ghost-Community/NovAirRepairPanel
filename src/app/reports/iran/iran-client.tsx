"use client";

import { useEffect, useState } from "react";
import { fmtMoney,toFaDigits,fmtDate } from "@/lib/format";

type Tab = "pl" | "ar_ap" | "journal" | "stock_value";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "pl", label: "سود و زیان تفکیکی" },
  { id: "ar_ap", label: "بدهکاران و بستانکاران" },
  { id: "journal", label: "دفتر روزنامه" },
  { id: "stock_value", label: "موجودی ریالی انبار" },
];

const RANGES = [
  { days: 7, label: "۷ روز" },
  { days: 30, label: "۳۰ روز" },
  { days: 90, label: "۳ ماه" },
  { days: 365, label: "۱ سال" },
];

export default function IranReportsClient() {
  const [tab, setTab] = useState<Tab>("pl");
  const [days, setDays] = useState(30);
  const [data, setData] = useState<any>(null);
  const [loadedKey,setLoadedKey]=useState(''),[error,setError]=useState(''),[reload,setReload]=useState(0),[stockAfter,setStockAfter]=useState(0);
  const requestKey=`${tab}:${days}:${stockAfter}:${reload}`,loading=loadedKey!==requestKey;

  useEffect(() => {
    const controller=new AbortController();void(async()=>{try{const response=await fetch(`/api/reports/iran?type=${tab}&days=${days}&after=${stockAfter}`,{signal:controller.signal,cache:'no-store'}),result=await response.json();if(!response.ok)throw new Error(result.error);if(!controller.signal.aborted){setData(result);setError('');}}catch(e){if(!controller.signal.aborted){setData(null);setError(e instanceof Error?e.message:'گزارش دریافت نشد؛ دوباره تلاش کنید.');}}finally{if(!controller.signal.aborted)setLoadedKey(requestKey);}})();return()=>controller.abort();
  }, [tab, days,stockAfter,reload,requestKey]);

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold tracking-tight"> گزارش‌های مالی</h1>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button key={r.days} onClick={() => setDays(r.days)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${days === r.days ? "bg-brand-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>
              {r.label}
            </button>
          ))}
          <button className="btn-secondary btn-sm mr-2" onClick={() => window.print()}> چاپ</button>
        </div>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${tab === t.id ? "bg-brand-600 text-white" : "card hover:border-brand-300"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card card-pad text-sm text-zinc-400">در حال بارگذاری…</div>
      ) : !data ? (
        <div className="card card-pad space-y-2" role="alert"><p className="text-sm text-red-500">{error||'خطا در دریافت گزارش'}</p><button className="btn-secondary" onClick={()=>setReload(n=>n+1)}>دریافت دوباره</button></div>
      ) : tab === "pl" ? (
        <PLReport d={data} />
      ) : tab === "ar_ap" ? (
        <ArApReport d={data} />
      ) : tab === "journal" ? (
        <JournalReport d={data} />
      ) : (
        <StockReport d={data} />
      )}
      {tab==='stock_value'&&!loading&&data&&<div className="flex flex-wrap gap-2"><button className="btn-secondary" disabled={!stockAfter} onClick={()=>setStockAfter(0)}>ابتدای موجودی</button><button className="btn-secondary" disabled={!data.next} onClick={()=>setStockAfter(data.next)}>کالاهای بعدی</button></div>}
    </div>
  );
}

function PLReport({ d }: { d: any }) {
  const rows:Array<{label:string;rev:number;cost:number;profit:number}> = d.ledger_categories??[
    { label: "اجرت‌ها و خدمات تعمیر", rev: d.labor.revenue, cost: d.labor.cost, profit: d.labor.profit },
    { label: "قطعات (فروش در تعمیرات)", rev: d.parts.revenue, cost: d.parts.cost, profit: d.parts.profit },
    { label: "فروشگاه (POS)", rev: d.sales.revenue, cost: d.sales.cost, profit: d.sales.profit },
  ];
  return (
    <div className="space-y-4">
      {d.ledger&&<div className="card card-pad text-sm text-amber-700 dark:text-amber-400" role="status">جمع سود و هزینه‌ها فقط از اسناد نهایی دفترکل است؛ اعتبارنامه و برگشت هزینه در آن لحاظ می‌شوند. رویدادهای ثبت‌نشده: {toFaDigits(d.ledger.pendingEvents)}. توازن سند، جایگزین تأیید افتتاحیه و تطبیق کامل نیست.</div>}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800 text-xs text-zinc-400">
              <th className="text-right p-3">سرفصل</th>
              <th className="text-left p-3">درآمد</th>
              <th className="text-left p-3">بهای تمام‌شده</th>
              <th className="text-left p-3">سود ناخالص</th>
              <th className="text-left p-3">حاشیه سود</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-zinc-100 dark:border-zinc-800/60">
                <td className="p-3 font-medium">{r.label}</td>
                <td className="p-3 text-left num">{fmtMoney(r.rev)}</td>
                <td className="p-3 text-left num text-zinc-400">{fmtMoney(r.cost)}</td>
                <td className={`p-3 text-left num font-medium ${r.profit >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmtMoney(r.profit)}</td>
                <td className="p-3 text-left text-xs">{r.rev > 0 ? `${Math.round((r.profit / r.rev) * 100)}٪` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card card-pad">
          <div className="text-xs text-zinc-400">جمع هزینه‌ها ({d.days} روز)</div>
          <div className="text-lg font-bold text-red-500 num">{fmtMoney(d.expenses.total)}</div>
        </div>
        <div className="card card-pad">
          <div className="text-xs text-zinc-400">سود خالص</div>
          <div className={`text-2xl font-bold num ${d.net >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmtMoney(d.net)}</div>
        </div>
        <div className="card card-pad">
          <div className="text-xs text-zinc-400 mb-1">هزینه‌ها به تفکیک</div>
          {d.expenses.rows.slice(0, 5).map((r: any) => (
            <div key={r.category} className="flex justify-between text-xs py-0.5">
              <span>{r.category}</span><span className="num">{fmtMoney(r.total)}</span>
            </div>
          ))}
          {d.expenses.rows.length === 0 && <p className="text-xs text-zinc-400">—</p>}
        </div>
      </div>
      {d.by_ticket.length > 0 && (
        <div className="card overflow-x-auto">
          <div className="p-3 text-sm font-semibold border-b border-zinc-100 dark:border-zinc-800">جزئیات اصل اسناد پذیرش؛ پیش از اعتبارنامه و تعدیلات دفترکل</div>
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-zinc-400 border-b border-zinc-100 dark:border-zinc-800">
              <th className="text-right p-2">پذیرش</th><th className="text-right p-2">دستگاه</th><th className="text-right p-2">مشتری</th>
              <th className="text-left p-2">درآمد</th><th className="text-left p-2">سود</th>
            </tr></thead>
            <tbody>
              {d.by_ticket.map((t: any) => (
                <tr key={t.number} className="border-b border-zinc-50 dark:border-zinc-800/40">
                  <td className="p-2 font-mono text-xs">{t.number}</td>
                  <td className="p-2">{t.device}</td>
                  <td className="p-2">{t.customer}</td>
                  <td className="p-2 text-left num">{fmtMoney(t.revenue)}</td>
                  <td className="p-2 text-left num text-emerald-600">{fmtMoney(t.revenue - t.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ArApReport({ d }: { d: any }) {
  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="card overflow-x-auto">
        <div className="p-3 text-sm font-semibold border-b border-zinc-100 dark:border-zinc-800 text-red-600">بدهکاران ({d.debtors.length})</div>
        <table className="w-full text-sm">
          <tbody>
            {d.debtors.map((c: any) => (
              <tr key={c.id} className="border-b border-zinc-50 dark:border-zinc-800/40">
                <td className="p-2">
                  <a href={`/customers/${c.id}`} className="hover:text-brand-600">{c.name}</a>
                  <div className="text-xs text-zinc-400">{c.mobile}</div>
                </td>
                <td className="p-2 text-left num text-red-500 font-medium">{fmtMoney(c.balance)}</td>
              </tr>
            ))}
            {d.debtors.length === 0 && <tr><td className="p-3 text-xs text-zinc-400">بدهکاری وجود ندارد </td></tr>}
          </tbody>
        </table>
      </div>
      <div className="card overflow-x-auto">
        <div className="p-3 text-sm font-semibold border-b border-zinc-100 dark:border-zinc-800 text-emerald-600">بستانکاران / پیش‌دریافت‌ها ({d.creditors.length})</div>
        <table className="w-full text-sm">
          <tbody>
            {d.creditors.map((c: any) => (
              <tr key={c.id} className="border-b border-zinc-50 dark:border-zinc-800/40">
                <td className="p-2">{c.name}<div className="text-xs text-zinc-400">{c.mobile}</div></td>
                <td className="p-2 text-left num text-emerald-600 font-medium">{fmtMoney(c.credit)}</td>
              </tr>
            ))}
            {d.creditors.length === 0 && <tr><td className="p-3 text-xs text-zinc-400">—</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="card overflow-x-auto">
        <div className="p-3 text-sm font-semibold border-b border-zinc-100 dark:border-zinc-800">بدهی به تامین‌کنندگان</div>
        <table className="w-full text-sm">
          <tbody>
            {d.supplier_debts.map((s: any) => (
              <tr key={s.id} className="border-b border-zinc-50 dark:border-zinc-800/40">
                <td className="p-2">{s.name}</td>
                <td className="p-2 text-left num">{fmtMoney(s.debt)}</td>
              </tr>
            ))}
            {d.supplier_debts.length === 0 && <tr><td className="p-3 text-xs text-zinc-400">—</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function JournalReport({ d }: { d: any }) {
  return (
    <div className="card overflow-x-auto">
      <p className="p-3 text-sm text-zinc-500">فقط اسناد نهایی دفترکل؛ چک وصول‌نشده و درخواست پرداخت، وجه قطعی نیستند. {d.truncated&&<a className="text-blue-600" href="/finance/accounting">بیش از ۵۰۰ سطر؛ ادامه در دفتر کامل حسابداری</a>}</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-800 text-xs text-zinc-400">
            <th className="text-right p-2">تاریخ</th><th className="text-right p-2">سند</th><th className="text-right p-2">نوع</th>
            <th className="text-right p-2">طرف حساب</th><th className="text-left p-2">بدهکار</th><th className="text-left p-2">بستانکار</th><th className="text-right p-2">توضیح</th>
          </tr>
        </thead>
        <tbody>
          {d.rows.map((r: any, i: number) => (
            <tr key={i} className="border-b border-zinc-50 dark:border-zinc-800/40">
              <td className="p-2 text-xs text-zinc-400">{fmtDate(r.date)}</td>
              <td className="p-2 font-mono text-xs">{r.doc}</td>
              <td className="p-2"><span className={r.kind === "دریافت" || r.kind === "فروش" || r.kind === "چک دریافتی" ? "badge-green" : "badge-amber"}>{r.kind}</span></td>
              <td className="p-2">{r.party}</td>
              <td className="p-2 text-left num text-emerald-600">{r.debit ? fmtMoney(r.debit) : "—"}</td>
              <td className="p-2 text-left num text-red-500">{r.credit ? fmtMoney(r.credit) : "—"}</td>
              <td className="p-2 text-xs text-zinc-400">{r.note}</td>
            </tr>
          ))}
          {d.rows.length === 0 && <tr><td colSpan={7} className="p-4 text-sm text-zinc-400">سندی در این بازه ثبت نشده است.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function StockReport({ d }: { d: any }) {
  return (
    <div className="space-y-3">
      <div className="card card-pad text-sm" role="status">ارزش منبع موجودی: {fmtMoney(d.totals.cost)}؛ دفترکل: {fmtMoney(d.ledger_value??0)}؛ اختلاف: {fmtMoney(d.difference??0)}. {d.requiresReview?'تطبیق و اسناد ثبت‌نشده نیازمند بررسی‌اند.':'در محدودهٔ این کنترل، ارزش موجودی با دفتر برابر است؛ افتتاحیه و صحت خارجی جداگانه تأیید شوند.'}</div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="card card-pad">
          <div className="text-xs text-zinc-400">ارزش خرید کل انبار</div>
          <div className="text-xl font-bold num">{fmtMoney(d.totals.cost)}</div>
        </div>
        <div className="card card-pad">
          <div className="text-xs text-zinc-400">ارزش فروش کل انبار</div>
          <div className="text-xl font-bold num text-brand-600">{fmtMoney(d.totals.retail)}</div>
        </div>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800 text-xs text-zinc-400">
              <th className="text-right p-2">کالا</th><th className="text-right p-2">گروه</th><th className="text-left p-2">موجودی</th>
              <th className="text-left p-2">ارزش خرید</th><th className="text-left p-2">ارزش فروش</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r: any) => (
              <tr key={r.id} className="border-b border-zinc-50 dark:border-zinc-800/40">
                <td className="p-2"><a href={`/parts/${r.id}`} className="hover:text-brand-600">{r.name}</a></td>
                <td className="p-2 text-xs">{r.category ?? "—"}</td>
                <td className="p-2 text-left num">{r.qty.toLocaleString("fa-IR")}</td>
                <td className="p-2 text-left num">{fmtMoney(r.stock_value)}</td>
                <td className="p-2 text-left num text-brand-600">{fmtMoney(r.retail_value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
