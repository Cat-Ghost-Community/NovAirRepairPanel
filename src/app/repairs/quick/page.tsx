"use client";

import { SearchableSelect } from "@/components/searchable-select";


import { useEffect, useMemo, useState } from "react";
import { PatternLock } from "@/components/pattern-lock";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui";
import { postFinancial } from "@/lib/financial-client";
import {DeviceRegistrationFields,useDeviceCatalog} from '@/components/device-registration-fields';
import {deviceFormComplete,deviceFormPayload} from '@/lib/device-catalog';
import { parseMoneyInput } from "@/lib/format";

type Service = { id: number; name: string; price: number };

const QUICK_TYPES = [
  { id: "screen", label: "تعویض صفحه‌نمایش" },
  { id: "battery", label: "تعویض باتری" },
  { id: "software", label: "نرم‌افزاری / فلش" },
  { id: "charge", label: "سوکت شارژ" },
  { id: "diagnosis", label: "عیب‌یابی فقط" },
  { id: "other", label: "سایر" },
];

/**
 * پذیرش سریع حضوری: پذیرش + تعمیر + تحویل در یک فرم
 * برای دستگاه‌هایی که تعمیرشان سریع انجام می‌شود (مثلاً تعویض شیشه، فلش، اسکرین).
 */
export default function QuickRepairPage() {
  const router = useRouter();
  const toast = useToast();
  const {catalog,error:catalogError,retry:retryCatalog}=useDeviceCatalog();
  const [busy, setBusy] = useState(false);
  const [createdTicket, setCreatedTicket] = useState<number | null>(null);

  const [mobile, setMobile] = useState("");
  const [custName, setCustName] = useState("");
  const [custSurname,setCustSurname]=useState("");
  const [custFound, setCustFound] = useState<{ id: number; label: string } | null>(null);
  const [searching, setSearching] = useState(false);

  const [preferredType,setDevType]=useState("mobile");
  const [deviceValues,setDeviceValues]=useState<Record<string,unknown>>({brand:"",model:""});
  const devType=catalog?.types.some(t=>t.id===preferredType&&t.active)?preferredType:catalog?.types.find(t=>t.active)?.id??preferredType;

  const [repType, setRepType] = useState("");
  const [problem, setProblem] = useState("");
  const [secType, setSecType] = useState("");
  const [secValue, setSecValue] = useState("");

  const [laborName, setLaborName] = useState("");
  const [laborPrice, setLaborPrice] = useState("");
  const [partsName, setPartsName] = useState("");
  const [partsPrice, setPartsPrice] = useState("");

  const [payMethod, setPayMethod] = useState("cash");
  const [received, setReceived] = useState("");

  const total = useMemo(
    () => (Number(laborPrice) || 0) + (Number(partsPrice) || 0),
    [laborPrice, partsPrice]
  );

  const findCustomer = async () => {
    if (!mobile.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/customers?q=${encodeURIComponent(mobile)}`);
      const d = await res.json();
      const list = (d.customers ?? []) as any[];
      if (list.length > 0) {
        const c = list[0];
        setCustFound({ id: c.id, label: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || c.mobile });
      } else {
        setCustFound(null);
        toast("مشتری جدید ثبت خواهد شد", "info");
      }
    } catch {
      toast("خطا در جستجوی مشتری", "error");
    }
    setSearching(false);
  };

  const finish = async () => {
    if (busy || createdTicket) return;
    setBusy(true);
    let savedTicket: number | null = null;
    try {
      const items: Array<{kind: string; name?: string; ref_id?: number; qty: number; unit_price: number}> = [];
      if (laborName) items.push({ kind: "labor", name: laborName, qty: 1, unit_price: parseMoneyInput(laborPrice||'0','toman',true) });
      if (partsName) {
        const response = await fetch(`/api/parts?q=${encodeURIComponent(partsName)}&limit=200`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        const matches = (data.parts ?? []).filter((p: {name: string; sku: string}) => p.name === partsName.trim() || p.sku === partsName.trim());
        if (matches.length !== 1) throw new Error("نام دقیق یا کد یکتای کالای ثبت‌شده را وارد کنید؛ قطعهٔ نامشخص از انبار کسر نمی‌شود.");
        items.push({ kind: "part", ref_id: matches[0].id, qty: 1, unit_price: parseMoneyInput(partsPrice||'0','toman',true) });
      }
      const amount = parseMoneyInput(received||'0','toman',true);
      if (payMethod === "credit" && amount > 0) throw new Error("نسیه دریافت وجه نیست؛ مبلغ دریافتی را صفر کنید.");
      // ۱) مشتری
      let customerId = custFound?.id;
      if (!customerId) {
        const fn=custName.trim(),surname=custSurname.trim();
        const res = await fetch("/api/customers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ first_name: fn, last_name: surname, mobile }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error);
        customerId = d.id;
      }

      // ۲) دستگاه
      const devRes = await fetch("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({...deviceFormPayload(catalog!,devType,deviceValues),customer_id:customerId}),
      });
      const devD = await devRes.json();
      if (!devRes.ok) throw new Error(devD.error);
      const deviceId = devD.id;

      // ۳) پذیرش
      const repRes = await fetch("/api/repairs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: customerId, device_id: deviceId, repair_type: repType || "سایر",
          problem: problem || "-", source: "حضوری",
          security_type: secType || null,
          security_value: secType && secValue ? secValue : null,
          security_hint: secType ? "پذیرش سریع حضوری" : null,
        }),
      });
      const repD = await repRes.json();
      if (!repRes.ok) throw new Error(repD.error);
      const ticketId = repD.id as number;
      savedTicket = ticketId;
      setCreatedTicket(ticketId);

      // ۴) اقلام (اجرت/قطعه) اگر وارد شده‌اند
      if (items.length > 0) {
        await postFinancial(`/api/repairs/${ticketId}/items`, { items });
      }

      // ۵) پرداخت فاکتور پذیرش (در جریان تسویه تحویل)
      if (amount > 0) {
        await postFinancial(`/api/repairs/${ticketId}/settle`, { method: payMethod, amount, mark_delivered: false });
      }

      toast(`پذیرش ${repD.number} ثبت شد؛ مراحل تعمیر، فاکتور و تحویل را تکمیل کنید.`);
      router.push(`/repairs/${ticketId}`);
    } catch (e: any) {
      toast(e.message ?? "خطا در پذیرش سریع", "error");
      if (savedTicket) router.push(`/repairs/${savedTicket}`);
    } finally {
      setBusy(false);
    }
  };

  const [workflowMode,setWorkflowMode]=useState<string|null>(null),[workflowError,setWorkflowError]=useState(''),[workflowRetry,setWorkflowRetry]=useState(0);
  useEffect(()=>{const controller=new AbortController();fetch('/api/repairs/workflow',{signal:controller.signal}).then(async r=>{const result=await r.json();if(!r.ok)throw Error(result.error);return result;}).then(result=>{setWorkflowMode(result.mode);setWorkflowError('');}).catch(error=>{if(error.name!=='AbortError')setWorkflowError(error.message);});return()=>controller.abort();},[workflowRetry]);
  if(workflowError)return <div className="card m-4 p-5" role="alert"><p>{workflowError}</p><button className="btn-secondary mt-3" onClick={()=>setWorkflowRetry(v=>v+1)}>تلاش دوباره</button></div>;
  if(workflowMode==null)return <div className="p-6 text-sm text-zinc-500" role="status">در حال بررسی مسیر پذیرش…</div>;
  if(workflowMode!=='legacy')return <div className="mx-auto max-w-3xl p-4 sm:p-6"><div className="card card-pad space-y-4"><h1 className="page-title">پذیرش با ارجاع مشخص</h1><p className="text-sm leading-8 text-zinc-500">در مسیر فعلی شعبه، ابتدا پذیرش را ثبت کنید. پس از ارجاع مدیر یا انتخاب از صف آزاد، اقلام و مراحل تعمیر را از پروندهٔ همان دستگاه ادامه دهید.</p><Link href="/repairs/new" className="btn-primary">ثبت پذیرش</Link><Link href="/repairs/queue" className="btn-secondary mr-2">کارتابل تعمیر</Link></div></div>;
  const canFinish = (mobile.trim().length >= 10) && (custFound || (custName.trim()&&custSurname.trim())) && catalog && deviceFormComplete(catalog,devType,deviceValues);

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">پذیرش سریع حضوری</h1>
        <Link href="/repairs/new" className="text-sm text-brand-600 hover:underline">پذیرش کامل ←</Link>
      </div>
      <p className="text-sm text-zinc-500 mt-0.5">ثبت پذیرش، اقلام و پیش‌دریافت؛ سپس تکمیل مراحل تعمیر، صدور فاکتور و تحویل.</p>

      <div className="grid md:grid-cols-2 gap-4 mt-4">
        {/* ستون ۱: مشتری و دستگاه */}
        <div className="card card-pad space-y-3">
          <div className="text-[13px] font-semibold text-zinc-500">۱. مشتری و دستگاه</div>
          <div>
            <label className="label" htmlFor="q-mobile">موبایل *</label>
            <div className="flex gap-1.5">
              <input id="q-mobile" className="input" dir="ltr" placeholder="۰۹۱۲۳۴۵۶۷۸۹" value={mobile}
                onChange={(e) => { setMobile(e.target.value); setCustFound(null); }} onBlur={findCustomer} />
              <button className="btn-secondary btn-sm shrink-0" onClick={findCustomer} disabled={searching}>
                {searching ? "…" : "جستجو"}
              </button>
            </div>
            {custFound && <p className="text-xs text-emerald-600 mt-1"> مشتری موجود: {custFound.label}</p>}
            {!custFound && mobile.length >= 10 && (
              <div className="grid sm:grid-cols-2 gap-2 mt-2"><div><label className="label" htmlFor="quick-first-name">نام *</label><input id="quick-first-name" required className="input" value={custName} onChange={event=>setCustName(event.target.value)}/></div><div><label className="label" htmlFor="quick-last-name">نام خانوادگی *</label><input id="quick-last-name" required className="input" value={custSurname} onChange={event=>setCustSurname(event.target.value)}/></div></div>
            )}
          </div>
          {catalogError&&<p role="alert" className="text-sm text-red-600">{catalogError} <button type="button" className="btn-ghost" onClick={retryCatalog}>تلاش دوباره</button></p>}
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className="label" htmlFor="q-type">نوع دستگاه</label>
              <SearchableSelect id="q-type" className="input" value={devType} onChange={(e) => {setDevType(e.target.value);setDeviceValues({brand:deviceValues.brand,model:deviceValues.model});}}>
                {(catalog?.types.filter(t=>t.active)??[]).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </SearchableSelect>
            </div>
            <div className="col-span-2">{catalog&&<DeviceRegistrationFields catalog={catalog} type={devType} values={deviceValues} onChange={setDeviceValues} prefix="quick"/>}</div>
          </div>
        </div>

        {/* ستون ۲: ایراد و اقلام */}
        <div className="card card-pad space-y-3">
          <div className="text-[13px] font-semibold text-zinc-500">۲. ایراد و خدمات</div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_TYPES.map((t) => (
              <button key={t.id} onClick={() => setRepType(t.label)}
                className={`rounded-full border px-2.5 py-1 text-xs transition ${repType === t.label ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300" : "border-zinc-200 dark:border-zinc-700"}`}
                aria-pressed={repType === t.label}>
                {t.label}
              </button>
            ))}
          </div>
          <div>
            <label className="label" htmlFor="q-problem">توضیح ایراد</label>
            <input id="q-problem" className="input" value={problem} onChange={(e) => setProblem(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="q-labor">اجرت</label>
              <input id="q-labor" className="input" placeholder="شرح" value={laborName} onChange={(e) => setLaborName(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="q-laborp">مبلغ اجرت (تومان)</label>
              <input id="q-laborp" className="input num" dir="ltr" value={laborPrice} onChange={(e) => setLaborPrice(e.target.value.replace(/[^\d]/g, ""))} />
            </div>
            <div>
              <label className="label" htmlFor="q-part">قطعه</label>
              <input id="q-part" className="input" placeholder="شرح" value={partsName} onChange={(e) => setPartsName(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="q-partp">مبلغ قطعه (تومان)</label>
              <input id="q-partp" className="input num" dir="ltr" value={partsPrice} onChange={(e) => setPartsPrice(e.target.value.replace(/[^\d]/g, ""))} />
            </div>
          </div>

          {/* قفل امنیتی دستگاه */}
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <label className="label" htmlFor="q-sec">قفل امنیتی دستگاه</label>
              <SearchableSelect id="q-sec" className="input w-36" value={secType} onChange={(e) => { setSecType(e.target.value); if (!e.target.value) setSecValue(""); }}>
                <option value="">ندارد</option>
                <option value="pattern">الگو</option>
                <option value="passcode">رمز PIN</option>
                <option value="password">گذرواژه</option>
              </SearchableSelect>
            </div>
            {secType === "pattern" && (
              <div className="flex justify-center">
                <PatternLock value={secValue} onChange={setSecValue} />
              </div>
            )}
            {secType && secType !== "pattern" && (
              <input type="password" className="input" placeholder="مقدار" value={secValue} onChange={(e) => setSecValue(e.target.value)} autoComplete="off" />
            )}
          </div>
        </div>
      </div>

      {/* تسویه و تحویل */}
      <div className="card card-pad mt-4">
        <div className="text-[13px] font-semibold text-zinc-500 mb-3">۳. تسویه و تحویل</div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="q-pay">روش پرداخت</label>
            <SearchableSelect id="q-pay" className="input w-40" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
              <option value="cash">نقد</option>
              <option value="card">کارتخوان</option>
              <option value="transfer">حواله</option>
              <option value="credit">نسیه</option>
            </SearchableSelect>
          </div>
          <div>
            <label className="label" htmlFor="q-recv">دریافتی (تومان)</label>
            <input id="q-recv" className="input num w-40" dir="ltr" placeholder={String(total)} value={received} onChange={(e) => setReceived(e.target.value.replace(/[^\d]/g, ""))} />
          </div>
          <div className="text-sm">
            <span className="text-zinc-400">جمع: </span>
            <span className="font-bold text-lg">{total.toLocaleString("fa-IR")}</span> <span className="text-xs text-zinc-400">تومان</span>
          </div>
          <button className="btn-primary btn-lg mr-auto" onClick={finish} disabled={!canFinish || busy || !!createdTicket}>
             {busy ? "در حال ثبت…" : "ثبت و ادامهٔ تعمیر"}
          </button>
        </div>
        {payMethod === "credit" && <p className="text-xs text-amber-600 mt-2">بدهی پس از صدور فاکتور محاسبه می‌شود؛ تحویل تابع مراحل مجاز تعمیر است.</p>}
        {createdTicket && <Link className="btn-secondary mt-2" href={`/repairs/${createdTicket}`}>ادامهٔ پذیرش ثبت‌شده</Link>}
      </div>
    </div>
  );
}
