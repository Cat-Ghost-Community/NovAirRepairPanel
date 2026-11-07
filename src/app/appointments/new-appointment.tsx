"use client";

import { SearchableSelect } from "@/components/searchable-select";


import {appointmentRequest} from "./appointment-request";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast, Modal, Field } from "@/components/ui";
import { toFaDigits } from "@/lib/format";

type Customer = { id: number; first_name: string; last_name: string; mobile: string };
type User = { id: number; name: string; role: string };

const TYPE_OPTIONS = ["سرویس و تعمیر", "مشاوره و برآورد", "تعویض قطعه", "نصب و راه‌اندازی", "بازیابی اطلاعات", "سایر"];

export function NewAppointmentButton({ customers, technicians, native=false }: { customers: Customer[]; technicians: User[]; native?:boolean }) {
  const inFlight=useRef(false);
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [repairType, setRepairType] = useState(TYPE_OPTIONS[0]);
  const [when, setWhen] = useState("");
  const [technicianId, setTechnicianId] = useState("");
  const [notes, setNotes] = useState("");
  const [customerOptions,setCustomerOptions]=useState(customers),[techOptions,setTechOptions]=useState(technicians);
  const [customerSearch,setCustomerSearch]=useState(''),[techSearch,setTechSearch]=useState(''),[customerPage,setCustomerPage]=useState(1),[techPage,setTechPage]=useState(1);
  const [customerMore,setCustomerMore]=useState(false),[techMore,setTechMore]=useState(false),[selectorsLoading,setSelectorsLoading]=useState(false),[selectorsError,setSelectorsError]=useState(false);
  useEffect(()=>{if(!native||!open)return;const controller=new AbortController();const timer=setTimeout(async()=>{setSelectorsLoading(true);try{const paths=[`/api/appointments?select=customers&q=${encodeURIComponent(customerSearch)}&page=${customerPage}`,`/api/appointments?select=technicians&q=${encodeURIComponent(techSearch)}&page=${techPage}`],responses=await Promise.all(paths.map(path=>fetch(path,{signal:controller.signal}))),data=await Promise.all(responses.map(r=>r.json()));if(responses.some(r=>!r.ok))throw new Error('selector');setCustomerOptions(data[0].options);setTechOptions(data[1].options);setCustomerMore(data[0].hasMore);setTechMore(data[1].hasMore);setSelectorsError(false);}catch{if(!controller.signal.aborted)setSelectorsError(true);}finally{if(!controller.signal.aborted)setSelectorsLoading(false);}},200);return()=>{clearTimeout(timer);controller.abort();};},[native,open,customerSearch,techSearch,customerPage,techPage]);

  const submit = async () => {
    if (!customerId || !when) {
      toast("مشتری و زمان نوبت الزامی است.", "error");
      return;
    }
    if(inFlight.current)return;inFlight.current=true;setBusy(true);
    try {
      await appointmentRequest('/api/appointments','POST',{customer_id:Number(customerId),repair_type:repairType,preferred_at:when,technician_id:technicianId?Number(technicianId):null,notes:notes.trim()||null});
      toast("نوبت با موفقیت ثبت شد");
      setOpen(false);
      setCustomerId(""); setWhen(""); setNotes(""); setTechnicianId("");
      router.refresh();
    } catch (e: any) {
      toast(e.message ?? "ثبت نوبت ناموفق بود", "error");
    } finally {
      inFlight.current=false;setBusy(false);
    }
  };

  return (
    <>
      <button className="btn-primary btn-sm" onClick={() => setOpen(true)}>+ ثبت نوبت جدید</button>
      <Modal open={open} onClose={() => setOpen(false)} title="ثبت نوبت جدید">
        <div className="space-y-3">
          {selectorsLoading&&<p className="text-xs text-zinc-500" role="status">در حال جست‌وجوی گزینه‌ها…</p>}
          {selectorsError&&<p className="text-xs text-red-600" role="alert">گزینه‌ها خوانده نشد؛ جست‌وجو را دوباره انجام دهید.</p>}
          <Field label="مشتری *">
            <SearchableSelect onSearchChange={native?(q)=>{setCustomerSearch(q);setCustomerPage(1);}:undefined} className="input w-full" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">— انتخاب مشتری —</option>
              {customerOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.first_name} {c.last_name} {c.mobile ? `· ${toFaDigits(c.mobile)}` : ""}</option>
              ))}
            </SearchableSelect>
            {native&&(customerPage>1||customerMore)&&<div className="mt-2 flex flex-wrap gap-2"><button className="btn-ghost btn-sm" disabled={selectorsLoading||customerPage<=1} onClick={()=>setCustomerPage(p=>p-1)}>مشتریان قبلی</button><button className="btn-ghost btn-sm" disabled={selectorsLoading||!customerMore} onClick={()=>setCustomerPage(p=>p+1)}>مشتریان بعدی</button></div>}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="نوع خدمت">
              <SearchableSelect className="input w-full" value={repairType} onChange={(e) => setRepairType(e.target.value)}>
                {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </SearchableSelect>
            </Field>
            <Field label="تاریخ و ساعت *">
              <input type="datetime-local" className="input w-full" value={when} onChange={(e) => setWhen(e.target.value)} />
            </Field>
          </div>
          <Field label="تعمیرکار تعیین‌شده (اختیاری)">
            <SearchableSelect onSearchChange={native?(q)=>{setTechSearch(q);setTechPage(1);}:undefined} className="input w-full" value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
              <option value="">— تعیین نشده —</option>
              {techOptions.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </SearchableSelect>
            {native&&(techPage>1||techMore)&&<div className="mt-2 flex flex-wrap gap-2"><button className="btn-ghost btn-sm" disabled={selectorsLoading||techPage<=1} onClick={()=>setTechPage(p=>p-1)}>تعمیرکاران قبلی</button><button className="btn-ghost btn-sm" disabled={selectorsLoading||!techMore} onClick={()=>setTechPage(p=>p+1)}>تعمیرکاران بعدی</button></div>}

          </Field>
          <Field label="یادداشت">
            <textarea className="input w-full min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="مثلاً: مشتری گفت بعدازظهر می‌آید…" />
          </Field>
          <div className="flex gap-2 justify-end pt-2">
            <button className="btn-secondary btn-sm" onClick={() => setOpen(false)}>انصراف</button>
            <button className="btn-primary btn-sm" disabled={busy||selectorsLoading||selectorsError} onClick={submit}>{busy ? "در حال ثبت…" : "ثبت نوبت"}</button>
          </div>
        </div>
      </Modal>
    </>
  );
}
