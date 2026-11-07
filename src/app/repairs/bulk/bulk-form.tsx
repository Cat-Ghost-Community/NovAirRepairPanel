"use client";

import { SearchableSelect } from "@/components/searchable-select";


import { useState,useEffect,useRef } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui";
import {parseMoneyInput} from '@/lib/format';
import {postFinancial} from '@/lib/financial-client';
import {Checkbox} from '@/components/checkbox';

type DeviceRow = { type: string; brand: string; model: string; serial: string; problem: string };

const DEVICE_TYPES: Array<[string, string]> = [
  ["phone", "موبایل"], ["laptop", "لپ‌تاپ"], ["desktop", "رایانه رومیزی"],
  ["tablet", "تبلت"], ["console", "کنسول بازی"], ["smartwatch", "ساعت هوشمند"],
  ["network", "تجهیزات شبکه"], ["printer", "پرینتر"], ["other", "سایر"],
];

export function BulkIntakeForm({ defaultStatusId, technicians,canAssign=false,canReceive=false }: { defaultStatusId: number; technicians: any[];canAssign?:boolean;canReceive?:boolean }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [custQuery, setCustQuery] = useState("");
  const [custResults, setCustResults] = useState<any[]>([]);
  const [customerLoading,setCustomerLoading]=useState(false),[customerError,setCustomerError]=useState('');
  const customerRequest=useRef<AbortController|null>(null);
  useEffect(()=>()=>customerRequest.current?.abort(),[]);
  const [technicianId, setTechnicianId] = useState("");
  const [priority, setPriority] = useState("normal");
  const [deposit, setDeposit] = useState("");
  const [cashConfirmed,setCashConfirmed]=useState(false),[cashReference,setCashReference]=useState('');
  const [devices, setDevices] = useState<DeviceRow[]>([
    { type: "phone", brand: "", model: "", serial: "", problem: "" },
    { type: "phone", brand: "", model: "", serial: "", problem: "" },
  ]);

  const setRow = (i: number, patch: Partial<DeviceRow>) =>
    setDevices((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));

  const searchCust = (v: string) => {
    customerRequest.current?.abort();setCustomerError('');setCustomerLoading(false);
    setCustQuery(v);
    if (v.trim().length < 2) { setCustResults([]); return; }
    const controller=new AbortController();customerRequest.current=controller;setCustomerLoading(true);
    fetch(`/api/customers/lookup?q=${encodeURIComponent(v)}`,{signal:controller.signal})
      .then(async r=>{const body=await r.json();if(!r.ok)throw new Error(body.error??'جستجوی مشتری انجام نشد.');return body;})
      .then(d=>{if(!controller.signal.aborted)setCustResults(d.customers??[]);})
      .catch(error=>{if(!controller.signal.aborted){setCustResults([]);setCustomerError(error instanceof Error?error.message:'جستجوی مشتری انجام نشد.');}})
      .finally(()=>{if(!controller.signal.aborted)setCustomerLoading(false);});
  };

  const addRow = () => setDevices((p) => [...p, { type: "phone", brand: "", model: "", serial: "", problem: "" }]);
  const removeRow = (i: number) => setDevices((p) => p.filter((_, idx) => idx !== i));

  const submit = async () => {
    if(busy)return;
    if (!customerId) { toast("ابتدا مشتری را انتخاب کنید", "error"); return; }
    const valid = devices;
    if (valid.length < 2||valid.some(d=>!d.brand.trim()||!d.model.trim()||!d.problem.trim())) { toast("برند، مدل و ایراد همهٔ دستگاه‌ها را کامل کنید؛ هیچ ردیفی خودکار حذف نمی‌شود.", "error"); return; }
    setBusy(true);
    try {
      const amount=deposit.trim()?parseMoneyInput(deposit,'toman',true):0;
      if(amount>0&&(!canReceive||!cashConfirmed||cashReference.trim().length<5))throw new Error('تحویل واقعی وجه نقد و مرجع مستند دریافت را تأیید کنید.');
      const d=await postFinancial<{group_id:string;receipt?:{number:string;accounting_state:string}}>("/api/repairs/bulk", {
          customer_id: customerId,
          devices: valid.map((d) => ({
            type: d.type, brand: d.brand.trim(), model: d.model.trim(),
            serial: d.serial.trim() || undefined, problem: d.problem.trim(),
            priority, source: "حضوری",
          })),
          technician_id: canAssign&&technicianId ? Number(technicianId) : undefined,
          priority,cash_receipt:amount>0?{amount,method:'cash',confirmed:cashConfirmed,reference:cashReference.trim()}:undefined,
        });
      toast(`${String(valid.length).replace(/\d/g, (x) => "۰۱۲۳۴۵۶۷۸۹"[+x])} دستگاه با قبض گروهی ثبت شد${d.receipt?`؛ رسید نقدی ${d.receipt.number} ثبت شد`:''}`);
      router.push(`/repairs/group-receipt/${d.group_id}`);
    } catch (e: any) {
      toast(e.message ?? "خطا در ثبت گروهی", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset disabled={busy} aria-busy={busy} className="space-y-4 min-w-0">
      <legend className="sr-only">پذیرش گروهی و دریافت نقدی</legend>
      {/* مشتری */}
      <section className="card card-pad space-y-3">
        <h2 className="section-title mb-0">مشتری</h2>
        {customerId ? (
          <div className="flex items-center justify-between rounded-lg bg-brand-50 dark:bg-brand-500/10 px-3 py-2">
            <span className="text-sm font-medium">
              {custResults.find((c) => c.id === customerId)?.first_name ?? ""} {custResults.find((c) => c.id === customerId)?.last_name ?? ""}
            </span>
            <button className="text-xs text-brand-600 hover:underline" onClick={() => { setCustomerId(null); setCustQuery(""); }}>تغییر</button>
          </div>
        ) : (
          <div className="relative">
            <input className="input" placeholder="جستجوی مشتری (نام، موبایل…) *" value={custQuery} onChange={(e) => searchCust(e.target.value)} aria-label="جستجوی مشتری" />
            {custQuery.trim().length>=2 && (
              <div className="absolute z-10 top-full mt-1 w-full card divide-y divide-zinc-100 dark:divide-zinc-800 max-h-48 overflow-y-auto">
                {customerLoading?<p role="status" className="p-3 text-sm text-zinc-500">در حال جستجوی مشتری…</p>:customerError?<div role="alert" className="p-3 text-sm text-red-600">{customerError}<button className="btn-secondary btn-sm mt-2" onClick={()=>searchCust(custQuery)}>تلاش دوباره</button></div>:custResults.length===0?<p role="status" className="p-3 text-sm text-zinc-500">مشتری پیدا نشد؛ نام کامل یا شمارهٔ همراه را جستجو کنید.</p>:custResults.map((c) => (
                  <button key={c.id} className="block w-full text-right px-3 py-2 text-[13px] hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    onClick={() => { customerRequest.current?.abort();setCustomerLoading(false);setCustomerId(c.id); setCustQuery(""); setCustResults([c]); }}>
                    {c.first_name} {c.last_name} <span className="text-zinc-400">{c.mobile}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* دستگاه‌ها */}
      <section className="space-y-3">
        {devices.map((d, i) => (
          <div key={i} className="card card-pad space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold">دستگاه {["۱","۲","۳","۴","۵","۶","۷","۸","۹"][i] ?? i + 1}</span>
              {devices.length > 2 && (
                <button className="text-xs text-red-500 hover:underline" onClick={() => removeRow(i)}>حذف</button>
              )}
            </div>
            <div className="grid sm:grid-cols-4 gap-2">
              <SearchableSelect className="input" value={d.type} onChange={(e) => setRow(i, { type: e.target.value })} aria-label="نوع دستگاه">
                {DEVICE_TYPES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </SearchableSelect>
              <input className="input" placeholder="برند *" value={d.brand} onChange={(e) => setRow(i, { brand: e.target.value })} />
              <input className="input" placeholder="مدل *" value={d.model} onChange={(e) => setRow(i, { model: e.target.value })} />
              <input className="input" dir="ltr" placeholder="سریال / IMEI" value={d.serial} onChange={(e) => setRow(i, { serial: e.target.value })} />
            </div>
            <input className="input" placeholder="ایراد اعلام‌شده *" value={d.problem} onChange={(e) => setRow(i, { problem: e.target.value })} />
          </div>
        ))}
        <button className="btn-secondary w-full" disabled={devices.length>=100} onClick={addRow}>+ افزودن دستگاه دیگر</button>
      </section>

      {/* تنظیمات مشترک */}
      <section className="card card-pad grid sm:grid-cols-3 gap-2 items-end">
        <div>
          <label className="label" htmlFor="bulk-tech">ارجاع به تعمیرکار</label>
          <SearchableSelect id="bulk-tech" disabled={!canAssign} className="input" value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
            <option value="">نوبت میز کار</option>
            {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </SearchableSelect>
        </div>
        <div>
          <label className="label" htmlFor="bulk-pri">اولویت</label>
          <SearchableSelect id="bulk-pri" className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="low">کم</option>
            <option value="normal">معمولی</option>
            <option value="high">زیاد</option>
            <option value="urgent">فوری</option>
          </SearchableSelect>
        </div>
        <div>
          <label className="label" htmlFor="bulk-dep">دریافت نقدی گروه (تومان)</label>
          <input id="bulk-dep" className="input num" inputMode="decimal" dir="ltr" placeholder="۰" value={deposit} onChange={(e) => setDeposit(e.target.value)} disabled={!canReceive||busy} aria-describedby="bulk-deposit-state" />
          <p id="bulk-deposit-state" className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{canReceive?'اختیاری؛ یک رسید پیش‌دریافت برای مشتری ثبت می‌شود. تقسیم مبلغ میان دستگاه‌ها خودکار نیست؛ تخصیص به فاکتورها با تأیید مستقل انجام می‌شود.':'مجوز دریافت وجه ندارید؛ پذیرش بدون دریافت نقدی قابل ثبت است.'}</p>
        </div>
        {canReceive&&deposit.trim()&&<div className="sm:col-span-3 space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <label className="label" htmlFor="bulk-cash-reference">مرجع یکتای دریافت نقدی</label>
          <input id="bulk-cash-reference" className="input" value={cashReference} maxLength={500} disabled={busy} onChange={e=>setCashReference(e.target.value)} placeholder="شمارهٔ سند صندوق یا مرجع تحویل وجه"/>
          <Checkbox checked={cashConfirmed} disabled={busy} label="وجه نقد واقعاً تحویل گرفته شد" onCheckedChange={setCashConfirmed}><span className="text-sm min-w-0">وجه نقد واقعاً تحویل گرفته شد؛ این ثبت، درخواست پرداخت یا انتقال بانکی نیست.</span></Checkbox>
        </div>}
      </section>

      <div className="flex justify-end gap-2">
        <button className="btn-primary" onClick={submit} disabled={busy || !customerId}>
          {busy ? "در حال ثبت…" : "ثبت پذیرش گروهی"}
        </button>
      </div>
    </fieldset>
  );
}
