"use client";

import { SearchableSelect } from "@/components/searchable-select";


import { useCallback, useEffect, useState,useRef } from "react";
import { useToast,EmptyState } from "@/components/ui";
import { fmtDate, fmtMoney, toFaDigits,parseMoneyInput } from "@/lib/format";
import {postFinancial} from '@/lib/financial-client';
import {useRouter} from 'next/navigation';

type Serial = {
  id: number; serial: string; imei: string | null; part_name: string; part_code: string | null;
  status: string; location_name: string | null; supplier_name: string | null; cost: number|null;
  purchase_date: string | null; warranty_until: string | null; buyer_name: string | null; ticket_number: string | null;
};

const STATUS_FA: Record<string, { label: string; cls: string }> = {
  in_stock: { label: "در انبار", cls: "badge-green" },
  sold: { label: "فروخته‌شده", cls: "badge-gray" },
  in_repair: { label: "در تعمیر", cls: "badge-amber" },
  returned: { label: "مرجوعی", cls: "badge-red" },
};

export function SerialsClient({ parts, locations, suppliers,canEdit=false }: { parts: any[]; locations: any[]; suppliers: any[];canEdit?:boolean }) {
  const toast = useToast();
  const router=useRouter();
  const [rows, setRows] = useState<Serial[]>([]);
  const [stats, setStats] = useState<Array<{ status: string; c: number }>>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [saving,setSaving]=useState(false);
  const [page,setPage]=useState(1),[meta,setMeta]=useState({totalPages:1,total:0}),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState<string|null>(null);const loadVersion=useRef(0);
  const [form, setForm] = useState({ part_id: "", serial: "", imei: "", cost: "", warranty_until: "", location_id: "", supplier_id: "" });

  const load = useCallback(async(signal?:AbortSignal) => {
    const version=++loadVersion.current,isCurrent=()=>!signal?.aborted&&version===loadVersion.current;setLoading(true);setLoadError(null);
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (status) p.set("status", status);
    p.set('page',String(page));p.set('perPage','50');
    try{const response=await fetch(`/api/serials?${p}`,{signal}),d=await response.json();if(!response.ok)throw new Error(d.error??'بارگذاری سریال‌ها انجام نشد.');if(!isCurrent())return;
      setRows(d.serials ?? []);
      setStats(d.stats ?? []);
    setMeta({totalPages:d.totalPages??1,total:d.total??d.serials?.length??0});if(d.page&&d.page!==page)setPage(d.page);
    }catch(error){if(isCurrent()){setRows([]);setStats([]);setLoadError(error instanceof Error?error.message:'بارگذاری سریال‌ها انجام نشد.');}}finally{if(isCurrent())setLoading(false);}
  }, [q, status,page]);

  useEffect(() => { const controller=new AbortController(),t = setTimeout(()=>void load(controller.signal), 250); return () => {clearTimeout(t);controller.abort();}; }, [load]);

  const add = async () => {
    if(saving)return;
    if (!form.part_id || !form.serial.trim()) { toast("کالا و سریال الزامی است", "error"); return; }
    setSaving(true);try{
    await postFinancial('/api/serials',{...form,part_id:Number(form.part_id),cost:form.cost.trim()===''?null:parseMoneyInput(form.cost,'toman',true),location_id:form.location_id?Number(form.location_id):null,supplier_id:form.supplier_id?Number(form.supplier_id):null});
    toast("سریال ثبت شد");
    setForm({ part_id: "", serial: "", imei: "", cost: "", warranty_until: "", location_id: "", supplier_id: "" });
    setShowAdd(false);
    void load();router.refresh();
    }catch(error){toast(error instanceof Error?error.message:'ثبت سریال انجام نشد.','error');}finally{setSaving(false);}
  };

  const statBadges = (key: string) => stats.find((s) => s.status === key)?.c ?? 0;
  if(loadError)return <div className="card card-pad" role="alert"><EmptyState title="بارگذاری سریال‌ها انجام نشد" body={loadError} action={<button className="btn-secondary" onClick={()=>void load()}>تلاش دوباره</button>}/></div>;

  return (
    <div className="space-y-4">
      {loading&&<p className="text-sm text-zinc-500 dark:text-zinc-400" role="status">در حال بارگذاری سریال‌ها…</p>}
      {/* آمار سریع */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => {setStatus("");setPage(1);}} className={`badge-gray min-h-8 cursor-pointer ${!status ? "ring-2 ring-brand-400" : ""}`}>همه</button>
        {Object.entries(STATUS_FA).map(([k, v]) => (
          <button key={k} onClick={() => {setStatus(status === k ? "" : k);setPage(1);}} className={`${v.cls} min-h-8 cursor-pointer ${status === k ? "ring-2 ring-brand-400" : ""}`}>
            {v.label}: {toFaDigits(statBadges(k))}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input className="input flex-1 min-w-0" aria-label="جستجوی سریال" placeholder="جستجوی سریال، IMEI یا نام کالا…" value={q} onChange={(e) => {setQ(e.target.value);setPage(1);}} />
        {canEdit&&<button className="btn-primary" disabled={saving} onClick={() => setShowAdd((v) => !v)}>{showAdd ? "بستن" : "+ ثبت سریال"}</button>}
      </div>

      {showAdd && canEdit && (
        <div className="card card-pad space-y-2">
          <div className="text-[13px] font-semibold">ثبت شناسهٔ سریال کالا</div>
          <div className="grid sm:grid-cols-3 gap-2">
            <SearchableSelect disabled={saving} aria-label="کالا" className="input" value={form.part_id} onChange={(e) => setForm({ ...form, part_id: e.target.value })}>
              <option value="">کالا *</option>
              {parts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </SearchableSelect>
            <input disabled={saving} aria-label="شماره سریال" className="input" dir="ltr" placeholder="شماره سریال *" value={form.serial} onChange={(e) => setForm({ ...form, serial: e.target.value })} />
            <input disabled={saving} aria-label="IMEI" className="input" dir="ltr" placeholder="IMEI (اختیاری)" value={form.imei} onChange={(e) => setForm({ ...form, imei: e.target.value })} />
            <input disabled={saving} aria-label="بهای تمام‌شده (تومان)" inputMode="decimal" className="input num" dir="ltr" placeholder="بهای تمام‌شده (تومان)" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
            <input disabled={saving} aria-label="پایان گارانتی" className="input" type="date" dir="ltr" placeholder="گارانتی تا" value={form.warranty_until} onChange={(e) => setForm({ ...form, warranty_until: e.target.value })} />
            <SearchableSelect disabled={saving} aria-label="محل نگهداری" className="input" value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })}>
              <option value="">محل نگهداری</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </SearchableSelect>
            <SearchableSelect disabled={saving} aria-label="تأمین‌کننده" className="input" value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
              <option value="">تأمین‌کننده</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </SearchableSelect>
          </div>
          <div className="flex justify-end">
            <button className="btn-primary btn-sm" disabled={saving} onClick={add}>{saving?'در حال ثبت…':'ثبت سریال'}</button>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="th">سریال / IMEI</th><th className="th">کالا</th><th className="th">وضعیت</th>
              <th className="th hidden md:table-cell">محل</th><th className="th hidden md:table-cell">خرید</th>
              <th className="th hidden lg:table-cell">خریدار / پذیرش</th><th className="th hidden lg:table-cell">گارانتی تا</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {rows.map((s) => {
              const st = STATUS_FA[s.status] ?? { label: s.status, cls: "badge-gray" };
              return (
                <tr key={s.id} className="row-hover">
                  <td className="td font-mono text-[13px]" dir="ltr">{s.serial}{s.imei && <span className="block text-xs text-zinc-400">{s.imei}</span>}</td>
                  <td className="td">{s.part_name}</td>
                  <td className="td"><span className={st.cls}>{st.label}</span></td>
                  <td className="td hidden md:table-cell text-zinc-500">{s.location_name ?? "—"}</td>
                  <td className="td hidden md:table-cell text-zinc-500">
                    {fmtDate(s.purchase_date)}{s.cost!=null&&s.cost > 0 && <span className="block text-xs">{fmtMoney(s.cost)}</span>}
                  </td>
                  <td className="td hidden lg:table-cell text-zinc-500">{s.buyer_name ?? s.ticket_number ?? "—"}</td>
                  <td className="td hidden lg:table-cell text-zinc-500">{fmtDate(s.warranty_until)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={7}><EmptyState title="سریالی یافت نشد" body="عبارت جستجو یا وضعیت را تغییر دهید؛ برای ثبت شناسه از دکمهٔ ثبت سریال استفاده کنید."/></td></tr>
            )}
          </tbody>
        </table>
      </div>
      <nav aria-label="صفحه‌بندی سریال‌ها" className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-zinc-500 dark:text-zinc-400">صفحهٔ {toFaDigits(page)} از {toFaDigits(meta.totalPages)} · {toFaDigits(meta.total)} سریال</span>
        <div className="flex flex-wrap gap-2"><button className="btn-secondary btn-sm" disabled={loading||page<=1} onClick={()=>setPage(n=>n-1)}>قبلی</button><button className="btn-secondary btn-sm" disabled={loading||page>=meta.totalPages} onClick={()=>setPage(n=>n+1)}>بعدی</button></div>
      </nav>
    </div>
  );
}
