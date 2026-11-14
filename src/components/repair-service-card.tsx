'use client';
import {useState} from 'react';
import {SearchableSelect} from './searchable-select';
import {useToast} from './ui';
import {fmtMoney,moneyDisplayValue,parseMoneyInput,toFaDigits} from '@/lib/format';
import {REPAIR_SERVICE_LABEL} from '@/lib/charge-category';

type Service={id:number;name:string;price:number;warranty_days?:number};
type Tariff={id:number;title:string;device_type:string;brand?:string;labor_price:number;warranty_days?:number};
export function RepairServiceCard({ticketId,services,tariffs,busy,call,hidePrices}:{ticketId:number;services:Service[];tariffs:Tariff[];busy:boolean;hidePrices:boolean;call:(url:string,body:Record<string,unknown>,message?:string)=>Promise<unknown>}){
 const [source,setSource]=useState(''),[name,setName]=useState(''),[price,setPrice]=useState(''),toast=useToast();
 const [type,id]=source.split(':'),service=type==='service'?services.find(row=>row.id===Number(id)):undefined,tariff=type==='tariff'?tariffs.find(row=>row.id===Number(id)):undefined;
 const reference=service?.price??tariff?.labor_price;
 async function add(){
  try{
   const body:Record<string,unknown>={kind:service?'service':'labor',...(service?{ref_id:service.id}:tariff?{tariff_id:tariff.id}:{name:name.trim()})};
   if(price.trim()!=='')body.unit_price=parseMoneyInput(price,undefined,true);
   if(!service&&!tariff&&price.trim()==='')throw Error('مبلغ خدمات را صریح وارد کنید؛ خدمت رایگان را با صفر مشخص کنید.');
   const result=await call('/api/repairs/'+ticketId+'/items',body,'خدمات تعمیر افزوده شد.');
   if(result){setSource('');setName('');setPrice('');}
  }catch(cause){toast(cause instanceof Error?cause.message:'مبلغ معتبر نیست.','error');}
 }
 return <section className="card card-pad space-y-3"><h3 className="section-title">افزودن {REPAIR_SERVICE_LABEL}</h3>
  <p className="text-xs leading-6 text-zinc-500">تعرفه، خدمت آماده و ثبت دستی، همگی در یک گروه خدمات تعمیر قرار می‌گیرند.</p>
  <label className="block"><span className="label">شرح خدمات / تعرفه</span><SearchableSelect value={source} disabled={busy} onChange={event=>{setSource(event.target.value);setPrice('');setName('');}}>
   <option value="">ثبت دستی خدمات تعمیر</option>
   {services.map(row=><option key={'service:'+row.id} value={'service:'+row.id}>{row.name}{hidePrices?'':' — '+fmtMoney(row.price)}</option>)}
   {tariffs.map(row=><option key={'tariff:'+row.id} value={'tariff:'+row.id}>{row.title} · {row.device_type}{row.brand?' · '+row.brand:''}{hidePrices?'':' — '+fmtMoney(row.labor_price)}</option>)}
  </SearchableSelect></label>
  {!source&&<label className="block"><span className="label">شرح عملیات</span><input className="input" maxLength={200} disabled={busy} value={name} onChange={event=>setName(event.target.value)} placeholder="مثلاً تعمیر برد دستگاه"/></label>}
  {(!hidePrices||!source)&&<label className="block"><span className="label">مبلغ خدمات</span><input className="input" inputMode="decimal" dir="ltr" disabled={busy} value={price} onChange={event=>setPrice(event.target.value)} placeholder={reference==null?'مبلغ را وارد کنید':moneyDisplayValue(reference)}/></label>}
  {(service?.warranty_days??tariff?.warranty_days)!=null&&<p className="text-xs text-zinc-500">ضمانت: {toFaDigits(service?.warranty_days??tariff?.warranty_days??0)} روز</p>}
  <button type="button" className="btn-primary btn-sm w-full" disabled={busy||(!source&&!name.trim())} onClick={()=>void add()}>افزودن خدمات تعمیر</button>
 </section>;
}
