'use client';
import {useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {useToast} from '@/components/ui';
import {DocumentBrand,DocumentFooter} from '@/components/document-print';
import {parsePrintSettings,PRINT_SETTING_KEYS,printSettingError,type PrintSettingKey} from '@/lib/print-settings';

const selects:Partial<Record<PrintSettingKey,Array<[string,string]>>>= {
 print_paper:[['a4','A4'],['a5','A5']],print_receipt_paper:[['a5','A5'],['a4','A4'],['roll','رول ۸۰ میلی‌متر']],
 print_density:[['standard','معمولی'],['compact','فشرده']],print_header_align:[['right','راست‌چین'],['center','وسط‌چین']],print_show_signature:[['1','نمایش'],['0','مخفی']],
};
const fields:Array<[PrintSettingKey,string]>=[['print_paper','کاغذ فاکتور، برآورد و صورت‌حساب'],['print_receipt_paper','کاغذ پیش‌فرض رسید پذیرش'],['print_font_size','اندازهٔ قلم چاپ (۹ تا ۱۴ پوینت)'],['print_margin','حاشیهٔ کاغذ (۵ تا ۲۰ میلی‌متر)'],['print_density','فاصلهٔ ردیف‌ها'],['print_accent','رنگ سربرگ'],['print_header_align','چینش سربرگ'],['print_show_signature','محل امضای دستی و مهر'],['business_phone','تلفن روی اسناد'],['business_address','نشانی روی اسناد'],['print_footer','متن پایانی روی اسناد']];
export function PrintSettingsForm({values,name}:{values:Record<string,string>;name:string}){
 const [form,setForm]=useState(()=>parsePrintSettings(values)),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const lock=useRef(false),router=useRouter(),toast=useToast();
 const errors=Object.fromEntries(PRINT_SETTING_KEYS.map(key=>[key,printSettingError(key,form[key])]));
 const invalid=Object.values(errors).some(Boolean),preview=parsePrintSettings(form);
 async function save(event:React.FormEvent){
  event.preventDefault();if(lock.current||invalid)return;lock.current=true;setBusy(true);setError('');
  try{
   const response=await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:form})});
   const result=await response.json();if(!response.ok)throw Error(result.error??'تنظیمات چاپ ذخیره نشد.');toast('تنظیمات چاپ ذخیره شد.');router.refresh();
  }catch(cause){setError(cause instanceof Error?cause.message:'ارتباط برقرار نشد؛ دوباره تلاش کنید.');}finally{lock.current=false;setBusy(false);}
 }
 return <form onSubmit={event=>void save(event)} className="space-y-5 p-5"><p className="text-sm leading-7 text-zinc-500">تنظیمات ظاهر هنگام چاپ اعمال می‌شوند؛ مبلغ، شماره و سوابق مالی اسناد تغییر نمی‌کنند. تصویر امضای ثبت‌شده همیشه حفظ و نمایش داده می‌شود. برای PDF، در پنجرهٔ چاپ «Save as PDF» را انتخاب و سربرگ و پابرگ مرورگر را خاموش کنید.</p>
  <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">{fields.map(([key,label])=><label key={key} className={['business_address','print_footer'].includes(key)?'sm:col-span-2':''}><span className="label">{label}</span>
   {selects[key]?<select aria-label={label} className="input" value={form[key]} onChange={event=>setForm(previous=>({...previous,[key]:event.target.value}))}>{selects[key]?.map(([value,text])=><option key={value} value={value}>{text}</option>)}</select>:
    ['business_address','print_footer'].includes(key)?<textarea aria-label={label} className="input min-h-20" maxLength={600} value={form[key]} onChange={event=>setForm(previous=>({...previous,[key]:event.target.value}))}/>:
    <input aria-label={label} className="input" type={key==='print_accent'?'color':['print_font_size','print_margin'].includes(key)?'number':'text'} min={key==='print_font_size'?9:5} max={key==='print_font_size'?14:20} step={1} maxLength={key==='business_phone'?80:undefined} dir="ltr" value={form[key]} aria-invalid={!!errors[key]} onChange={event=>setForm(previous=>({...previous,[key]:event.target.value}))}/>}
   {errors[key]&&<span className="mt-1 block text-xs text-red-600" role="alert">{errors[key]}</span>}
  </label>)}</fieldset>
  <p className="text-xs leading-6 text-zinc-500">در رسید رول ۸۰ میلی‌متری، قلم ۱۰ پوینت و حاشیهٔ ۳ میلی‌متر برای حفظ فضای مفید و خوانایی ثابت است.</p>
  <section aria-label="پیش‌نمایش نمونهٔ سند" className="rounded-lg border border-zinc-200 bg-white p-5 text-zinc-900" style={{fontSize:Number(preview.print_font_size)+'pt','--document-accent':preview.print_accent} as React.CSSProperties}>
   <p className="mb-4 text-xs text-zinc-500">پیش‌نمایش نمونه؛ سند مالی نیست. صفحه‌بندی نهایی در پیش‌نمایش چاپ دیده می‌شود.</p>
   <div style={{color:preview.print_accent}}><DocumentBrand name={name||'نام کسب‌وکار'} settings={preview}/></div><div className="my-3 border-t" style={{borderColor:preview.print_accent}}/>
   <div className="flex justify-between gap-3" style={{paddingBlock:preview.print_density==='compact'?'1.5mm':'2.5mm'}}><span>خدمات تعمیر — شرح عملیات</span><span>مبلغ طبق فاکتور</span></div>
   {preview.print_show_signature==='1'&&<div className="mt-6 flex justify-between gap-3 text-sm"><span>امضای مشتری</span><span>مهر و امضای تعمیرگاه</span></div>}<DocumentFooter settings={preview}/>
  </section>
  {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
  <button className="btn-primary" type="submit" disabled={busy||invalid}>{busy?'در حال ذخیره…':'ذخیره تنظیمات چاپ'}</button>
 </form>;
}
