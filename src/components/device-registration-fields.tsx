'use client';
import {useEffect,useState} from 'react';
import type {DeviceCatalog} from '@/lib/device-catalog';
import {SearchableSelect} from './searchable-select';
import {JalaliDatePicker} from './jalali-date-picker';
import {toEnDigits} from '@/lib/format';
export function useDeviceCatalog(){
 const [catalog,setCatalog]=useState<DeviceCatalog|null>(null),[error,setError]=useState(''),[version,retry]=useState(0);
 useEffect(()=>{const controller=new AbortController();fetch('/api/device-types',{signal:controller.signal,cache:'no-store'}).then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error??'دریافت انواع دستگاه ناموفق بود.');setCatalog(data);setError('');}).catch(error=>{if(!controller.signal.aborted)setError(error.message);});return()=>controller.abort();},[version]);
 return {catalog,error,retry:()=>{setCatalog(null);setError('');retry(v=>v+1);}};
}
export function DeviceRegistrationFields({catalog,type,values,onChange,prefix='device'}:{catalog:DeviceCatalog;type:string;values:Record<string,unknown>;onChange:(next:Record<string,unknown>)=>void;prefix?:string}){
 const fields=catalog.types.find(t=>t.id===type)?.fields??[];
 const custom=values.custom_fields&&typeof values.custom_fields==='object'?values.custom_fields as Record<string,unknown>:{};
 return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{fields.map(field=>{
  const key=field.id,id=['device','dv'].includes(prefix)&&(key==='brand'||key==='model')?key:prefix+'-'+key,value=key.startsWith('custom_')?custom[key]:values[key];
  const change=(value:unknown)=>onChange(key.startsWith('custom_')?{...values,custom_fields:{...custom,[key]:value}}:{...values,[key]:value});
  return <div key={key} className="min-w-0"><label htmlFor={id} className="label">{field.label}{field.required?' *':''}</label>
   {field.kind==='select'?<SearchableSelect id={id} value={String(value??'')} onChange={event=>change(event.target.value)} required={field.required}><option value="">انتخاب کنید</option>{field.options?.map(option=><option key={option} value={option}>{option}</option>)}</SearchableSelect>:
    field.kind==='checkbox'?<input id={id} type="checkbox" className="h-5 w-5 accent-brand-600" checked={value===true||value==='true'||value==='1'} required={field.required} onChange={event=>change(String(event.target.checked))}/>:
    field.kind==='date'?<JalaliDatePicker id={id} value={String(value??'')} clearable={!field.required} onChange={change}/>:
    key==='notes'?<textarea id={id} className="input" rows={3} value={String(value??'')} maxLength={4000} required={field.required} onChange={event=>change(event.target.value)}/>:
    <input id={id} className="input" value={String(value??'')} required={field.required} type="text" inputMode={field.kind==='number'?'decimal':undefined} dir={['imei','imei2','serial','mac'].includes(key)||field.kind==='number'?'ltr':undefined} maxLength={key.startsWith('custom_')?1000:160} onChange={event=>change(field.kind==='number'?toEnDigits(event.target.value):event.target.value)}/>}</div>;
 })}</div>;
}
