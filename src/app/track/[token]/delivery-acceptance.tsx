'use client';
import {useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {SignaturePad} from '@/components/signature-pad';
import {Checkbox} from '@/components/checkbox';
import {DELIVERY_CONSENT} from '@/lib/delivery-signature-shared';

export function DeliveryAcceptance({token,customerName}:{token:string;customerName:string}){
 const router=useRouter(),[name,setName]=useState(customerName),[signature,setSignature]=useState<string|null>(null),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),lock=useRef(false);
 async function submit(event:React.FormEvent){
  event.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{
   const response=await fetch('/api/track/delivery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,signed_name:name.trim(),signature,consent})});
   const data=await response.json();if(!response.ok)throw Error(data.error??'امضا ثبت نشد.');router.refresh();
  }catch(cause){setError(cause instanceof Error?cause.message:'ارتباط برقرار نشد؛ دوباره تلاش کنید.');}finally{setBusy(false);lock.current=false;}
 }
 return <section className="card card-pad space-y-3 border-brand-300 dark:border-brand-700"><h2 className="font-semibold">تأیید دریافت دستگاه</h2>
  <p className="text-sm leading-7 text-zinc-600 dark:text-zinc-300">تعمیرگاه درخواست امضای تحویل را فعال کرده است. فقط پس از دریافت واقعی دستگاه، رسید را امضا کنید. تصویر امضا، نام، زمان و مفاد تأیید در سابقه نگهداری می‌شوند.</p>
  <form onSubmit={submit} className="space-y-3"><fieldset disabled={busy} className="space-y-3">
   <label className="block"><span className="label">نام و نام خانوادگی تحویل‌گیرنده *</span><input className="input" autoComplete="name" minLength={3} maxLength={120} required value={name} onChange={event=>setName(event.target.value)}/></label>
   <SignaturePad label="امضای تحویل‌گیرنده" disabled={busy} onChange={setSignature}/>
   <Checkbox label="تأیید دریافت واقعی دستگاه" checked={consent} disabled={busy} onCheckedChange={setConsent}><span className="text-sm leading-7">{DELIVERY_CONSENT}</span></Checkbox>
  </fieldset>{error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
  <button className="btn-primary w-full" type="submit" disabled={busy||!signature||!consent||name.trim().length<3}>{busy?'در حال ثبت…':'ثبت امضا و تأیید دریافت'}</button>
  </form>
 </section>;
}
