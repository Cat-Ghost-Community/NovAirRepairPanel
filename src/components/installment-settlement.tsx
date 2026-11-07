"use client";

import { SearchableSelect } from "@/components/searchable-select";

import { useEffect,useId,useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal,EmptyState,useToast } from '@/components/ui';
import { postFinancial } from '@/lib/financial-client';
import { fmtMoney,faNum,toEnDigits } from '@/lib/format';
import { rial } from '@/lib/money';

export function InstallmentSettlement({id,invoiceId,remaining,canReceive,label='دریافت/تخصیص'}:{id:number;invoiceId:number;remaining:number;canReceive:boolean;label?:string}){
 const prefix=useId(),router=useRouter(),toast=useToast(),[open,setOpen]=useState(false),[mode,setMode]=useState('existing'),[amount,setAmount]=useState(String(remaining)),[payment,setPayment]=useState(''),[reference,setReference]=useState(''),[method,setMethod]=useState('cash'),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [term,setTerm]=useState(''),[query,setQuery]=useState(''),[page,setPage]=useState(1),[reload,setReload]=useState(0),[done,setDone]=useState(''),[receiptError,setReceiptError]=useState(''),[data,setData]=useState<{receipts:Array<{id:number;number:string;available:number}>;totalPages:number}|null>(null);
 const key=`${invoiceId}:${page}:${query}:${reload}`;
 useEffect(()=>{if(!open||mode!=='existing')return;const controller=new AbortController();void(async()=>{try{const r=await fetch(`/api/installments?view=receipts&invoice_id=${invoiceId}&page=${page}&q=${encodeURIComponent(query)}`,{signal:controller.signal,cache:'no-store'}),v=await r.json();if(!r.ok)throw new Error(v.error);if(!controller.signal.aborted){setData(v);setReceiptError('');}}catch(e){if(!controller.signal.aborted)setReceiptError(e instanceof Error&&!(e instanceof TypeError)?e.message:'ارتباط برقرار نشد؛ دوباره دریافت کنید.');}finally{if(!controller.signal.aborted)setDone(key);}})();return()=>controller.abort();},[open,mode,invoiceId,page,query,reload,key]);
 const submit=async()=>{if(busy)return;setBusy(true);setError('');try{
  const money=rial(toEnDigits(amount));if(!confirmed||reference.trim().length<5)throw new Error('بررسی وجه و مرجع واقعی را تأیید کنید.');
  const result=await postFinancial<{accounting_state:string}>('/api/installments',mode==='existing'?{action:'allocate',id,payment_id:Number(payment),amount:money,reference}:{action:'pay',id,amount:money,reference,method,confirmed:true});
  toast(result.accounting_state==='posted'?'رسید و تخصیص ثبت شد.':'تخصیص ثبت شد؛ دفترکل در انتظار بررسی است.');setOpen(false);setReference('');setConfirmed(false);setPayment('');router.refresh();
 }catch(e){setError(e instanceof Error?e.message:'عملیات انجام نشد.');}finally{setBusy(false);}};
 return <><button className="btn-secondary btn-sm" onClick={()=>{setAmount(String(remaining));setError('');setOpen(true);}}>{label}</button><Modal open={open} onClose={()=>{if(!busy)setOpen(false);}} title="تسویهٔ قسط با رسید معتبر"><div className="space-y-3 min-w-0">
  <p className="text-sm text-zinc-500">این فرم انتقال وجه انجام نمی‌دهد. رسید موجود دوباره ایجاد نمی‌شود؛ فقط وجه واقعاً تسویه‌شده قابل تخصیص است.</p>
  {error&&<p role="alert" className="text-red-600 break-words">{error}</p>}
  <label className="label" htmlFor={`${prefix}-mode`}>منبع وجه</label><SearchableSelect className="input" id={`${prefix}-mode`} disabled={busy} value={mode} onChange={e=>{setMode(e.target.value);setConfirmed(false);}}><option value="existing">تخصیص رسید ثبت‌شده</option>{canReceive&&<option value="new">ثبت وجه جدیدِ انجام‌شده</option>}</SearchableSelect>
  {mode==='existing'?<div className="space-y-2"><label className="label" htmlFor={`${prefix}-receipt`}>رسید همین فاکتور</label><SearchableSelect className="input" id={`${prefix}-receipt`} disabled={busy||done!==key} value={payment} onChange={e=>setPayment(e.target.value)}><option value="">انتخاب رسید</option>{payment&&!data?.receipts.some(p=>p.id===Number(payment))&&<option value={payment}>شناسهٔ {faNum(Number(payment))}</option>}{data?.receipts.map(p=><option key={p.id} value={p.id}>{p.number} · {fmtMoney(p.available,'rial')}</option>)}</SearchableSelect>
   <div className="flex flex-wrap gap-2"><label className="sr-only" htmlFor={`${prefix}-search`}>جست‌وجوی رسید</label><input className="input flex-1 min-w-0" id={`${prefix}-search`} maxLength={100} value={term} disabled={busy} onChange={e=>setTerm(e.target.value)}/><button className="btn-secondary" disabled={busy||done!==key} onClick={()=>{setPage(1);setQuery(term);setReload(n=>n+1);}}>جست‌وجو</button></div>
   {done!==key?<p role="status">در حال دریافت رسیدها…</p>:receiptError?<div role="alert"><p>{receiptError}</p><button className="btn-secondary" onClick={()=>setReload(n=>n+1)}>دریافت دوباره</button></div>:!data?.receipts.length?<EmptyState title="رسید تخصیص‌نیافته یافت نشد" body="رسیدهای لحاظ‌شده در ماندهٔ آغاز برنامه یا چک وصول‌نشده، دوباره مصرف نمی‌شوند."/>:null}
   <div className="flex flex-wrap items-center gap-2"><button className="btn-secondary" disabled={busy||done!==key||page<=1} onClick={()=>setPage(n=>n-1)}>قبلی</button><span>{faNum(page)} از {faNum(data?.totalPages??1)}</span><button className="btn-secondary" disabled={busy||done!==key||page>=(data?.totalPages??1)} onClick={()=>setPage(n=>n+1)}>بعدی</button></div>
  </div>:<><label className="label" htmlFor={`${prefix}-method`}>روش وجه تأییدشده</label><SearchableSelect className="input" id={`${prefix}-method`} disabled={busy} value={method} onChange={e=>setMethod(e.target.value)}><option value="cash">نقد</option><option value="card">کارتخوان</option><option value="transfer">حوالهٔ تأییدشده</option></SearchableSelect></>}
  <label className="label" htmlFor={`${prefix}-amount`}>مبلغ تخصیص (ریال)؛ سقف {fmtMoney(remaining,'rial')}</label><input className="input" id={`${prefix}-amount`} dir="ltr" inputMode="numeric" disabled={busy} value={amount} onChange={e=>setAmount(e.target.value)}/>
  <label className="label" htmlFor={`${prefix}-reference`}>مرجع واقعی دریافت/بررسی رسید</label><input className="input" id={`${prefix}-reference`} maxLength={1000} disabled={busy} value={reference} onChange={e=>setReference(e.target.value)}/>
  <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/><span>تسویهٔ واقعی وجه و مرجع آن را بررسی کرده‌ام.</span></label>
  <button className="btn-primary" disabled={busy||!confirmed||reference.trim().length<5||mode==='existing'&&!payment} onClick={()=>void submit()}>{busy?'در حال ثبت…':'ثبت تخصیص معتبر'}</button>
 </div></Modal></>;
}
