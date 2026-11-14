'use client';
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {Modal,useToast} from './ui';
import {DeviceRegistrationFields} from './device-registration-fields';
import {SearchableSelect} from './searchable-select';
import {DEVICE_COLUMNS,DEVICE_CONDITION_LABELS,type DeviceCatalog} from '@/lib/device-catalog';

export function DeviceEditor({deviceId,canEdit}:{deviceId:number;canEdit:boolean}){
 const router=useRouter(),toast=useToast(),[open,setOpen]=useState(false),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [source,setSource]=useState<{device:Record<string,unknown>;catalog:DeviceCatalog}|null>(null),[form,setForm]=useState<Record<string,unknown>>({});
 const operation=useRef<{body:string;key:string}|null>(null);
 useEffect(()=>{
  if(!open)return;const controller=new AbortController();setLoading(true);setError('');setSource(null);
  void fetch('/api/devices/'+deviceId,{signal:controller.signal,cache:'no-store'}).then(async response=>{
   const data=await response.json();if(!response.ok)throw Error(data.error??'دریافت مشخصات دستگاه انجام نشد.');
   if(controller.signal.aborted)return;
   const specs=JSON.parse(data.device.specs??'{}');
   const custom_fields=Object.fromEntries(Object.entries(specs).filter(([key])=>key.startsWith('custom_')).map(([key,value])=>[key.split(':')[0],value]));
   setSource(data);setForm({...data.device,custom_fields});
  }).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'دریافت مشخصات انجام نشد.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[open,deviceId]);
 if(!canEdit)return null;
 const type=String(form.type??''),definition=source?.catalog.types.find(row=>row.id===type);
 const fields=new Set(definition?.fields.map(field=>field.id));
 const extra=Object.entries(DEVICE_COLUMNS).filter(([key])=>!fields.has(key)).map(([id,label])=>({id,label,required:false,kind:['purchase_date','warranty_until'].includes(id)?'date' as const:id==='battery_health'?'number' as const:id==='condition'?'select' as const:'text' as const,...(id==='condition'?{options:Object.keys(DEVICE_CONDITION_LABELS)}:{})}));
 const save=async(event:React.FormEvent)=>{
  event.preventDefault();if(!source||busy)return;setBusy(true);setError('');
  const values=Object.fromEntries(Object.keys(DEVICE_COLUMNS).map(key=>[key,form[key]??null]));
  const body=JSON.stringify({...values,type,custom_fields:form.custom_fields??{},expected_updated_at:source.device.updated_at??null});
  if(operation.current?.body!==body)operation.current={body,key:crypto.randomUUID()};
  try{
   const response=await fetch('/api/devices/'+deviceId,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':operation.current.key},body});
   const result=await response.json();if(!response.ok)throw Error(result.error??'ویرایش دستگاه ثبت نشد.');
   operation.current=null;setOpen(false);toast('مشخصات دستگاه به‌روز شد.');router.refresh();
  }catch(cause){setError(cause instanceof Error?cause.message:'ارتباط برقرار نشد؛ دوباره تلاش کنید.');}finally{setBusy(false);}
 };
 return <>
  <button type="button" className="btn-secondary btn-sm" onClick={()=>setOpen(true)}>ویرایش مشخصات دستگاه</button>
  <Modal open={open} onClose={()=>setOpen(false)} title="ویرایش دستگاه پذیرفته‌شده" wide dismissible={!busy}>
   {loading?<p role="status">در حال دریافت مشخصات…</p>:source?<form onSubmit={save} className="space-y-4">
    <p className="text-sm text-zinc-500">مالک دستگاه و سوابق پذیرش تغییر نمی‌کنند؛ اصلاح مشخصات در سابقه ثبت می‌شود.</p>
    <fieldset disabled={busy} className="space-y-4">
     <label className="block"><span className="label">نوع دستگاه</span><SearchableSelect value={type} onChange={event=>setForm(previous=>({...previous,type:event.target.value,custom_fields:{}}))}>{source.catalog.types.filter(row=>row.active||row.id===source.device.type).map(row=><option key={row.id} value={row.id}>{row.label}{row.active?'':' (بازنشسته)'}</option>)}</SearchableSelect></label>
     <DeviceRegistrationFields catalog={source.catalog} type={type} values={form} onChange={setForm} prefix="edit-device"/>
     <details className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700"><summary className="cursor-pointer text-sm font-medium">سایر مشخصات اختیاری</summary><div className="mt-3"><DeviceRegistrationFields catalog={{...source.catalog,types:source.catalog.types.map(row=>row.id===type?{...row,fields:extra}:row)}} type={type} values={form} onChange={setForm} prefix="edit-extra"/></div></details>
    </fieldset>
    {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2"><button type="button" disabled={busy} className="btn-secondary" onClick={()=>setOpen(false)}>انصراف</button><button type="submit" disabled={busy} className="btn-primary">{busy?'در حال ذخیره…':'ذخیره مشخصات'}</button></div>
   </form>:<div role="alert" className="space-y-3"><p className="text-red-600">{error}</p><button type="button" className="btn-secondary" onClick={()=>setOpen(false)}>بستن و تلاش دوباره</button></div>}
  </Modal>
 </>;
}
