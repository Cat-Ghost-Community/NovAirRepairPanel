"use client";

import { SearchableSelect } from "@/components/searchable-select";


import { useState,useRef,useEffect } from "react";
import { useRouter } from "next/navigation";
import { useToast, Modal, Field } from "@/components/ui";
import { toFaDigits } from "@/lib/format";

type Customer = { id: number; first_name: string; last_name: string; mobile: string };
type Ticket = { id: number; number: string; customer_id: number };

const PRIORITY_FA: Record<string, string> = { low: "کم", normal: "معمولی", high: "زیاد", urgent: "فوری" };
const CATEGORY_OPTIONS = ["کیفیت تعمیر", "تأخیر در تحویل", "رفتار پرسنل", "قیمت و صورتحساب", "قطعه معیوب", "گم‌شدن لوازم", "سایر"];

export function NewComplaintButton({ customers, tickets,remote=false }: { customers: Customer[]; tickets: Ticket[];remote?:boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [ticketId, setTicketId] = useState("");
  const [category, setCategory] = useState(CATEGORY_OPTIONS[0]);
  const [priority, setPriority] = useState("normal");
  const [description, setDescription] = useState("");
  const requestIdentity=useRef<{payload:string;key:string}|null>(null);
  const [customerOptions,setCustomerOptions]=useState(customers),[ticketOptions,setTicketOptions]=useState(tickets),[customerQuery,setCustomerQuery]=useState(''),[ticketQuery,setTicketQuery]=useState(''),[customerPage,setCustomerPage]=useState(1),[ticketPage,setTicketPage]=useState(1),[customerMore,setCustomerMore]=useState(false),[ticketMore,setTicketMore]=useState(false),[selectorBusy,setSelectorBusy]=useState({customers:false,tickets:false}),[selectorErrors,setSelectorErrors]=useState({customers:'',tickets:''});
  useEffect(()=>{
    if(!remote||!open)return;const controller=new AbortController(),timer=setTimeout(async()=>{setSelectorBusy(v=>({...v,customers:true}));try{const response=await fetch(`/api/complaints?view=customers&q=${encodeURIComponent(customerQuery)}&page=${customerPage}`,{signal:controller.signal}),data=await response.json();if(!response.ok)throw Error(data.error);setCustomerOptions(previous=>{const selected=previous.filter(c=>String(c.id)===customerId),rows=customerPage===1?[...selected,...data.customers]:[...previous,...data.customers];return [...new Map(rows.map(c=>[c.id,c])).values()];});setCustomerMore(data.hasMore===true);setSelectorErrors(v=>({...v,customers:''}));}catch(error){if(!controller.signal.aborted)setSelectorErrors(v=>({...v,customers:error instanceof Error?error.message:'دریافت مشتریان ناموفق بود.'}));}finally{if(!controller.signal.aborted)setSelectorBusy(v=>({...v,customers:false}));}},180);return()=>{controller.abort();clearTimeout(timer);};
  },[remote,open,customerQuery,customerPage,customerId]);
  useEffect(()=>{
    if(!remote||!open)return;const controller=new AbortController(),timer=setTimeout(async()=>{setSelectorBusy(v=>({...v,tickets:true}));try{const response=await fetch(`/api/complaints?view=tickets&q=${encodeURIComponent(ticketQuery)}&page=${ticketPage}${customerId?`&customer_id=${customerId}`:''}`,{signal:controller.signal}),data=await response.json();if(!response.ok)throw Error(data.error);setTicketOptions(previous=>ticketPage===1?data.tickets:[...previous,...data.tickets]);setTicketMore(data.hasMore===true);setSelectorErrors(v=>({...v,tickets:''}));}catch(error){if(!controller.signal.aborted)setSelectorErrors(v=>({...v,tickets:error instanceof Error?error.message:'دریافت پذیرش‌ها ناموفق بود.'}));}finally{if(!controller.signal.aborted)setSelectorBusy(v=>({...v,tickets:false}));}},180);return()=>{controller.abort();clearTimeout(timer);};
  },[remote,open,ticketQuery,ticketPage,customerId]);

  const filteredTickets = customerId ? ticketOptions.filter((t) => t.customer_id === Number(customerId)) : ticketOptions;

  const submit = async () => {
    if (!customerId || !description.trim()) {
      toast("مشتری و شرح شکایت الزامی است.", "error");
      return;
    }
    setBusy(true);
    try {
      const payload=JSON.stringify({customer_id:Number(customerId),ticket_id:ticketId?Number(ticketId):null,category,priority,description:description.trim()});
      if(requestIdentity.current?.payload!==payload)requestIdentity.current={payload,key:crypto.randomUUID()};
      const res = await fetch("/api/complaints", {
        method: "POST",
        headers: { "content-type": "application/json",'idempotency-key':requestIdentity.current.key },
        body:payload,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if(!Number.isSafeInteger(data.id)||data.id<1)throw new Error('پاسخ ثبت شکایت معتبر نیست؛ دوباره با همان درخواست تلاش کنید.');
      requestIdentity.current=null;
      toast("شکایت با موفقیت ثبت شد");
      setOpen(false);
      setCustomerId(""); setTicketId(""); setDescription(""); setPriority("normal");
      router.refresh();
    } catch (e: any) {
      toast(e.message ?? "ثبت شکایت ناموفق بود", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="btn-primary btn-sm" onClick={() => setOpen(true)}>+ ثبت شکایت جدید</button>
      <Modal open={open} onClose={() => setOpen(false)} title="ثبت شکایت جدید">
        <div className="space-y-3">
          <Field label="مشتری *">
            <SearchableSelect className="input w-full" value={customerId} onSearchChange={remote?q=>{setCustomerQuery(q);setCustomerPage(1);}:undefined} onChange={(e) => { setCustomerId(e.target.value); setTicketId("");setTicketPage(1); }}>
              <option value="">— انتخاب مشتری —</option>
              {customerOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.first_name} {c.last_name} {c.mobile ? `· ${toFaDigits(c.mobile)}` : ""}</option>
              ))}
            </SearchableSelect>
            {remote&&<div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500" aria-live="polite">{selectorBusy.customers?'در حال دریافت مشتریان…':selectorErrors.customers?<span role="alert" className="text-red-600">{selectorErrors.customers}</span>:customerMore&&<button type="button" className="btn-ghost btn-sm" onClick={()=>setCustomerPage(p=>p+1)}>نمایش مشتریان بیشتر</button>}</div>}
          </Field>
          <Field label="پذیرش مرتبط (اختیاری)">
            <SearchableSelect className="input w-full" value={ticketId} onSearchChange={remote?q=>{setTicketQuery(q);setTicketPage(1);}:undefined} onChange={(e) => setTicketId(e.target.value)}>
              <option value="">— بدون پذیرش —</option>
              {filteredTickets.map((t) => (
                <option key={t.id} value={t.id}>{t.number}</option>
              ))}
            </SearchableSelect>
            {remote&&<div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500" aria-live="polite">{selectorBusy.tickets?'در حال دریافت پذیرش‌ها…':selectorErrors.tickets?<span role="alert" className="text-red-600">{selectorErrors.tickets}</span>:ticketMore&&<button type="button" className="btn-ghost btn-sm" onClick={()=>setTicketPage(p=>p+1)}>نمایش پذیرش‌های بیشتر</button>}</div>}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="دسته‌بندی">
              <SearchableSelect className="input w-full" value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </SearchableSelect>
            </Field>
            <Field label="اولویت">
              <SearchableSelect className="input w-full" value={priority} onChange={(e) => setPriority(e.target.value)}>
                {Object.entries(PRIORITY_FA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </SearchableSelect>
            </Field>
          </div>
          <Field label="شرح شکایت *">
            <textarea className="input w-full min-h-24" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="مشکل مشتری را دقیق بنویسید…" />
          </Field>
          <div className="flex gap-2 justify-end pt-2">
            <button className="btn-secondary btn-sm" onClick={() => setOpen(false)}>انصراف</button>
            <button className="btn-primary btn-sm" disabled={busy} onClick={submit}>{busy ? "در حال ثبت…" : "ثبت شکایت"}</button>
          </div>
        </div>
      </Modal>
    </>
  );
}
