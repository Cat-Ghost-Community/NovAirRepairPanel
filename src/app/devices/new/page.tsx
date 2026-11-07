"use client";



import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/components/ui";
import {DeviceRegistrationFields,useDeviceCatalog} from '@/components/device-registration-fields';
import {deviceFormComplete,deviceFormPayload} from '@/lib/device-catalog';
import { Icon } from "@/components/icon";

export default function NewDevicePage() {
  const router = useRouter();
  const sp = useSearchParams();
  const toast = useToast();
  const {catalog,error:catalogError,retry:retryCatalog}=useDeviceCatalog();
  const [customerId, setCustomerId] = useState(sp.get("customer_id") ?? "");
  const [custQuery, setCustQuery] = useState("");
  const [lookup,setLookup]=useState<{key:string;results:Array<{id:number;first_name:string|null;last_name:string|null;mobile:string|null}>;label:string;error:string|null}>({key:'',results:[],label:'',error:null});
  const lookupKey=customerId?'customer:'+customerId:custQuery.trim()?'query:'+custQuery.trim():'';
  const custLoading=lookupKey!==''&&lookup.key!==lookupKey;
  const custError=lookup.key===lookupKey?lookup.error:null;
  const custResults=lookup.key===lookupKey?lookup.results:[];
  const custLabel=lookup.key===lookupKey?lookup.label:'';
  const [preferredType, setType] = useState("mobile");
  const type=catalog?.types.some(t=>t.id===preferredType&&t.active)?preferredType:catalog?.types.find(t=>t.active)?.id??preferredType;
  const [form, setForm] = useState<any>({ brand: "", model: "", condition:"good" });
  const [busy, setBusy] = useState(false);
  const operation=useRef<{body:string;key:string}|null>(null);

  useEffect(() => {
    const controller=new AbortController();
    if(customerId){
      void fetch(`/api/customers/${customerId}`,{signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error??'مشتری یافت نشد.');if(!controller.signal.aborted)setLookup({key:lookupKey,results:[],label:[data.customer.first_name,data.customer.last_name].filter(Boolean).join(' ')||data.customer.company||data.customer.code,error:null});}).catch(error=>{if(!controller.signal.aborted)setLookup({key:lookupKey,results:[],label:'',error:error instanceof Error?error.message:'مشتری را دوباره انتخاب کنید.'});});
      return()=>controller.abort();
    }
    if (!custQuery.trim())return;
    const t = setTimeout(async () => {
      try{const res = await fetch(`/api/customers?q=${encodeURIComponent(custQuery)}`,{signal:controller.signal}),data=await res.json();if(!res.ok||!Array.isArray(data.customers))throw new Error(data.error??'جست‌وجوی مشتری انجام نشد.');if(!controller.signal.aborted)setLookup({key:lookupKey,results:data.customers,label:'',error:null});}
      catch(error){if(!controller.signal.aborted)setLookup({key:lookupKey,results:[],label:'',error:error instanceof Error?error.message:'جست‌وجوی مشتری انجام نشد.'});}
    }, 200);
    return () => {clearTimeout(t);controller.abort();};
  }, [custQuery, customerId,lookupKey]);

  const submit = async () => {
    setBusy(true);
    try {
      const body=JSON.stringify({ ...deviceFormPayload(catalog!,type,form), customer_id: Number(customerId), force: false });
      if(operation.current?.body!==body)operation.current={body,key:crypto.randomUUID()};
      const res = await fetch("/api/devices", {
        method: "POST", headers: { "Content-Type": "application/json",'Idempotency-Key':operation.current.key },
        body,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast("دستگاه اضافه شد");
      router.push(`/devices/${data.id}`);
    } catch (e: any) {
      toast(e.message ?? "افزودن دستگاه ناموفق بود", "error");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <h1 className="text-xl font-bold tracking-tight">افزودن دستگاه</h1>
      <div className="card card-pad mt-4 space-y-3">
        <div>
          <label className="label" htmlFor="cust">مالک دستگاه *</label>
          {customerId ? (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{custLabel}</span>
              <button className="btn-ghost btn-sm" onClick={() => { setCustomerId("");setCustQuery(''); }}>تغییر</button>
            </div>
          ) : (
            <>
              <input id="cust" className="input" placeholder="جستجوی مشتری با نام یا شماره…" value={custQuery} onChange={(e) => setCustQuery(e.target.value)} />
              {custResults.length > 0 && (
                <div className="mt-1 border border-zinc-200 dark:border-zinc-800 rounded-lg divide-y divide-zinc-100 dark:divide-zinc-800 max-h-40 overflow-y-auto">
                  {custResults.map((c) => (
                    <button key={c.id} onClick={() => { setCustomerId(String(c.id)); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800">
                      {c.first_name} {c.last_name} <span className="text-zinc-400">{c.mobile}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {custLoading&&<p className="mt-2 text-sm text-zinc-500" role="status">در حال دریافت اطلاعات مشتری…</p>}
          {custError&&<p className="mt-2 text-sm text-red-600" role="alert">{custError} مشتری را دوباره انتخاب کنید.</p>}
          {!custLoading&&!custError&&!customerId&&custQuery.trim()&&custResults.length===0&&<p className="mt-2 text-sm text-zinc-500">مشتری یافت نشد؛ نام یا شمارهٔ دیگری جست‌وجو کنید.</p>}
        </div>
        <div>
          <div className="label">نوع دستگاه</div>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {(catalog?.types.filter(t=>t.active)??[]).map((t) => (
              <button key={t.id} onClick={() => {setType(t.id);setForm({brand:form.brand,model:form.model});}}
                className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs ${type === t.id ? "border-brand-500 bg-brand-50 dark:bg-brand-500/15" : "border-zinc-200 dark:border-zinc-800"}`}>
                <Icon name={t.icon} size={14} className="opacity-70" />
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {catalogError&&<p role="alert" className="text-sm text-red-600">{catalogError} <button type="button" className="btn-ghost" onClick={retryCatalog}>تلاش دوباره</button></p>}
        {!catalog&&!catalogError&&<p role="status">در حال دریافت انواع دستگاه…</p>}
        {catalog&&<DeviceRegistrationFields catalog={catalog} type={type} values={form} onChange={setForm}/>}
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={() => router.back()}>انصراف</button>
          <button className="btn-primary" disabled={busy || custLoading || !!custError || !customerId || !catalog || !deviceFormComplete(catalog,type,form)} onClick={submit}>{busy ? "در حال ذخیره…" : "ذخیره دستگاه"}</button>
        </div>
      </div>
    </div>
  );
}
