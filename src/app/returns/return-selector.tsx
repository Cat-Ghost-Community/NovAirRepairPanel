"use client";

import { SearchableSelect } from "@/components/searchable-select";

import { useId,useEffect,useState } from 'react';
import { faNum,fmtMoney } from '@/lib/format';
import { EmptyState } from '@/components/ui';

type Option={id:number;label:string;amount?:number|null};
/** Fetch only after opening search: warehouse controls do not generate N+1
 * requests for every line merely because a return is displayed. */
export function ReturnSelector({entity,returnId,value,onSelect,initial=[],label,disabled=false,inputId}:{entity:'invoice'|'payment'|'location'|'customer'|'supplier';returnId?:number;value:number;onSelect:(id:number)=>void;initial?:Option[];label:string;disabled?:boolean;inputId?:string}){
 const generatedId=useId(),id=inputId??generatedId,[open,setOpen]=useState(false),[search,setSearch]=useState(''),[query,setQuery]=useState(''),[page,setPage]=useState(1),[retry,setRetry]=useState(0);
 const [result,setResult]=useState<{options:Option[];page:number;totalPages:number}|null>(null),[done,setDone]=useState(''),[error,setError]=useState('');
 const key=`${entity}:${returnId??0}:${query}:${page}:${retry}`;
 useEffect(()=>{if(!open)return;const controller=new AbortController();void(async()=>{try{
  const params=new URLSearchParams({view:'selector',entity,q:query,page:String(page)});if(returnId)params.set('return_id',String(returnId));
  const response=await fetch(`/api/returns?${params}`,{signal:controller.signal,cache:'no-store'}),data=await response.json();if(!response.ok)throw new Error(data.error);
  if(!controller.signal.aborted){setResult(data);setError('');}
 }catch(e){if(!controller.signal.aborted)setError(e instanceof Error&&!(e instanceof TypeError)&&!(e instanceof SyntaxError)?e.message:'دریافت گزینه‌ها انجام نشد؛ اتصال را بررسی و دوباره تلاش کنید.');}finally{if(!controller.signal.aborted)setDone(key);}})();return()=>controller.abort();},[open,entity,returnId,query,page,retry,key]);
 const options=open?result?.options??[]:initial,loading=open&&done!==key;
 const selected=options.some(o=>o.id===value)?null:initial.find(o=>o.id===value);
 return <div className="space-y-2 min-w-0">
  <label className="label" htmlFor={id}>{label}</label>
  <SearchableSelect id={id} className="input" disabled={disabled||loading} value={value||''} onChange={e=>onSelect(Number(e.target.value))}>
   <option value="">انتخاب کنید</option>{selected&&<option value={selected.id}>{selected.label}</option>}{value&&!selected&&!options.some(o=>o.id===value)&&<option value={value}>شناسهٔ {faNum(value)}</option>}
   {options.map(o=><option key={o.id} value={o.id}>{o.label}{o.amount!=null?` · ${fmtMoney(o.amount,'rial')}`:''}</option>)}
  </SearchableSelect>
  <button type="button" className="btn-ghost btn-sm" disabled={disabled} aria-expanded={open} aria-controls={`${id}-search`} onClick={()=>setOpen(v=>!v)}>{open?'بستن جست‌وجو':'جست‌وجو و موارد بیشتر'}</button>
  {open&&<div id={`${id}-search`} className="space-y-2">
   <div className="flex flex-wrap gap-2"><label className="sr-only" htmlFor={`${id}-term`}>جست‌وجوی {label}</label><input className="input flex-1 min-w-0" id={`${id}-term`} maxLength={100} disabled={disabled} value={search} onChange={e=>setSearch(e.target.value)}/><button type="button" className="btn-secondary" disabled={disabled||loading} onClick={()=>{setPage(1);setQuery(search);setRetry(n=>n+1);}}>جست‌وجو</button></div>
   {loading?<p role="status">در حال دریافت گزینه‌ها…</p>:error?<div role="alert"><p className="text-red-600">{error}</p><button type="button" className="btn-secondary" disabled={disabled||loading} onClick={()=>setRetry(n=>n+1)}>دریافت دوباره</button></div>:!options.length?<EmptyState title="گزینه‌ای یافت نشد" body="عبارت جست‌وجو را تغییر دهید یا صفحهٔ نخست را بررسی کنید."/>:null}
   <div className="flex flex-wrap items-center gap-2"><button type="button" className="btn-secondary" disabled={disabled||loading||page<=1} onClick={()=>setPage(n=>n-1)}>قبلی</button><span className="text-sm">صفحهٔ {faNum(page)} از {faNum(result?.totalPages??1)}</span><button type="button" className="btn-secondary" disabled={disabled||loading||page>=(result?.totalPages??1)} onClick={()=>setPage(n=>n+1)}>بعدی</button></div>
  </div>}
 </div>;
}
