'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {Modal,useToast} from '@/components/ui';
import {CodePreview} from '@/components/code-preview';

export function DeliverSignatureButton({ticketId,color}:{ticketId:number;statusName:string;customerName:string;color?:string}){
 const router=useRouter(),toast=useToast(),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[trackingUrl,setTrackingUrl]=useState(''),[error,setError]=useState('');
 async function request(){
  if(busy)return;setBusy(true);setError('');
  try{
   const response=await fetch('/api/repairs/'+ticketId+'/delivery-request',{method:'POST',headers:{'Content-Type':'application/json'}}),data=await response.json();
   if(!response.ok)throw Error(data.error??'درخواست امضا ثبت نشد.');setTrackingUrl(data.tracking_url);toast('امضای تحویل در صفحهٔ پیگیری مشتری فعال شد.');router.refresh();
  }catch(cause){setError(cause instanceof Error?cause.message:'ارتباط برقرار نشد؛ دوباره تلاش کنید.');}finally{setBusy(false);}
 }
 return <>
  <button type="button" className="btn-secondary btn-sm" style={color?{borderColor:color+'88'}:undefined} onClick={()=>{setOpen(true);setError('');}}>درخواست امضای تحویل</button>
  <Modal open={open} onClose={()=>setOpen(false)} dismissible={!busy} title="امضای تحویل توسط مشتری">
   <div className="space-y-4"><p className="text-sm leading-7">مشتری با شمارهٔ پذیرش و تلفن ثبت‌شده وارد صفحهٔ پیگیری می‌شود و پس از دریافت دستگاه، رسید را روی دستگاه خودش امضا می‌کند. ثبت تحویل نهایی و پورسانت پس از تأیید مشتری انجام می‌شود.</p>
    {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
    {trackingUrl?<div role="status" className="space-y-3"><p className="text-sm text-emerald-600">پیوند خصوصی امضا آماده است. فقط در اختیار تحویل‌گیرنده قرار دهید؛ درخواست امضا حداکثر ۲۴ ساعت اعتبار دارد.</p><div className="flex flex-wrap items-center gap-3"><CodePreview text={trackingUrl} label="پیوند خصوصی امضای تحویل" size={80}/><button type="button" className="btn-secondary" onClick={()=>{void navigator.clipboard.writeText(trackingUrl).then(()=>toast('پیوند کپی شد.')).catch(()=>setError('کپی خودکار انجام نشد؛ پیوند را از کادر زیر کپی کنید.'));}}>کپی پیوند</button><a href={trackingUrl} target="_blank" rel="noreferrer" className="btn-secondary">صفحهٔ مشتری</a></div><input className="input text-xs" dir="ltr" aria-label="پیوند خصوصی امضای تحویل" readOnly value={trackingUrl} onFocus={event=>event.target.select()}/></div>:<button type="button" className="btn-primary" disabled={busy} onClick={()=>void request()}>{busy?'در حال ثبت…':'فعال‌سازی درخواست امضا'}</button>}
   </div>
  </Modal>
 </>;
}
