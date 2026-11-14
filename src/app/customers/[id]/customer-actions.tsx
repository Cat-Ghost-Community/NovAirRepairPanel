"use client";

import { useEffect,useRef,useState } from "react";
import { useRouter } from "next/navigation";
import { EmptyState,Modal,useToast } from "@/components/ui";
import {SearchableSelect} from '@/components/searchable-select';
import {Checkbox} from '@/components/checkbox';
import {CUSTOMER_TYPES,customerTypeFa,customerTypeValue} from '@/lib/customer-type';
import {CUSTOMER_TITLES} from '@/lib/customer-identity';
import {toFaDigits} from '@/lib/format';

export function CustomerActions({ customerId, canEdit, blacklist }: { customerId: number; canEdit: boolean; canMerge: boolean; blacklist: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [confirmBlacklist, setConfirmBlacklist] = useState(false);
  const [busy,setBusy]=useState(false);
  const operation=useRef<{body:string;key:string}|null>(null);

  if (!canEdit) return null;

  const post = async (url: string, body: unknown) => {
    if(busy)return;setBusy(true);
    try{
      const json=JSON.stringify(body);if(operation.current?.body!==json)operation.current={body:json,key:crypto.randomUUID()};
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json",'Idempotency-Key':operation.current.key }, body: json });
      const data = await res.json().catch(() => ({}));
      if(!res.ok)throw new Error(data.error??'عملیات ناموفق بود');
      toast('وضعیت مشتری به‌روز شد');setConfirmBlacklist(false);operation.current=null;router.refresh();
    }catch(error){toast(error instanceof Error?error.message:'ارتباط برقرار نشد؛ دوباره تلاش کنید.','error');}
    finally{setBusy(false);}
  };

  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      <button
        className="btn-secondary btn-sm"
        disabled={busy}
        onClick={() => setConfirmBlacklist((v) => !v)}
      >
        {blacklist ? "خروج از لیست سیاه" : "لیست سیاه"}
      </button>
      <Modal open={confirmBlacklist} onClose={()=>setConfirmBlacklist(false)} dismissible={!busy} title={blacklist?'خروج از لیست سیاه':'افزودن به لیست سیاه'}>
          <p className="text-sm">
            {blacklist
              ? "این مشتری دوباره پذیرش شود؟ تاریخچه‌اش حفظ می‌شود."
              : "مشتریان سیاه‌فهرست در هر پذیرش جدید هشدار مشخص دارند. هر وقت بخواهید می‌توانید برگردانید."}
          </p>
          <div className="mt-2 flex gap-2 justify-end">
            <button className="btn-secondary btn-sm" disabled={busy} onClick={() => setConfirmBlacklist(false)}>انصراف</button>
            <button
              className={blacklist ? "btn-primary btn-sm" : "btn-danger btn-sm"}
              disabled={busy}
              onClick={() => void post(`/api/customers/${customerId}`, { action: blacklist ? "unblacklist" : "blacklist" })}
            >
              {busy?'در حال ذخیره…':'تأیید'}
            </button>
          </div>
      </Modal>
    </div>
  );
}

type MergeCandidate={id:number;first_name?:string;last_name?:string;company?:string;code?:string;mobile?:string};
const editFields=[['first_name','نام'],['last_name','نام خانوادگی'],['company','شرکت'],['mobile','موبایل'],['email','ایمیل'],['city','شهر'],['phone','تلفن'],['postal_code','کد پستی'],['tax_id','شناسه مالیاتی'],['organization_name','نام سازمان'],['national_id','کد ملی'],['job','شغل'],['nickname','نام مستعار'],['referral_source','طریقه آشنایی']] as const;
const mergeLabel=(row:MergeCandidate)=>[row.first_name,row.last_name].filter(Boolean).join(' ')||row.company||row.code||toFaDigits(row.id);
/** Native profile controls reuse the existing design and retain failed-operation
 * identities; unrelated SQLite screens continue using CustomerActions. */
export function CustomerProfileActions({customerId,canEdit,canMerge,profile,branchId}:{customerId:number;canEdit:boolean;canMerge:boolean;profile:Record<string,unknown>;branchId?:number}){
 const router=useRouter(),toast=useToast(),[panel,setPanel]=useState<'edit'|'merge'|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const inFlight=useRef(false),operations=useRef(new Map<string,string>()),[form,setForm]=useState<Record<string,string>>({});
 const [search,setSearch]=useState(''),[page,setPage]=useState(1),[retry,setRetry]=useState(0),[selected,setSelected]=useState<MergeCandidate|null>(null),[confirmed,setConfirmed]=useState(false);
 const [lookup,setLookup]=useState<{items:MergeCandidate[];loading:boolean;error:string|null;hasMore:boolean}>({items:[],loading:false,error:null,hasMore:false});
 useEffect(()=>{
  if(panel!=='merge')return;
  const controller=new AbortController(),timer=setTimeout(()=>{
   const query=new URLSearchParams({q:search,page:String(page),perPage:'20'});if(branchId!=null)query.set('branch_id',String(branchId));
   void fetch('/api/customers?'+query,{signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error??'دریافت مشتریان انجام نشد.');if(controller.signal.aborted)return;
    const items=(data.customers as MergeCandidate[]).filter(row=>row.id!==customerId);
    setLookup(previous=>({items:page===1?items:[...new Map([...previous.items,...items].map(row=>[row.id,row])).values()],loading:false,error:null,hasMore:data.page*data.perPage<data.total}));
   }).catch(cause=>{if(!controller.signal.aborted)setLookup(previous=>({...previous,loading:false,error:cause instanceof Error?cause.message:'دریافت مشتریان انجام نشد.',hasMore:false}));});
  },250);
  return()=>{clearTimeout(timer);controller.abort();};
 },[panel,search,page,branchId,customerId,retry]);
 function open(next:'edit'|'merge'){
  setError(null);setPanel(next);
  if(next==='edit')setForm(Object.fromEntries([...editFields.map(([key])=>[key,String(profile[key]??'')]),['address',String(profile.address??'')],['notes',String(profile.notes??'')],['customer_type',customerTypeValue(profile.customer_type)??'regular'],['salutation',String(profile.salutation??'')]]));
  else{setSearch('');setPage(1);setSelected(null);setConfirmed(false);setLookup({items:[],loading:true,error:null,hasMore:false});}
 }
 async function submit(body:Record<string,unknown>){
  if(inFlight.current)return;inFlight.current=true;setBusy(true);setError(null);
  const url='/api/customers/'+customerId+(branchId==null?'':'?branch_id='+branchId),identity=url+':'+JSON.stringify(body);let key=operations.current.get(identity);if(!key){key=crypto.randomUUID();operations.current.set(identity,key);}
  try{
   const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)}),data=await response.json();if(!response.ok)throw Error(data.error??'عملیات انجام نشد.');
   operations.current.delete(identity);setPanel(null);toast(body.action==='merge_into'?'ادغام ثبت شد؛ سوابق اصلی حفظ شدند.':'مشخصات مشتری به‌روز شد.');if(body.action==='merge_into')router.replace('/customers/'+data.target);else router.refresh();
  }catch(cause){const message=cause instanceof Error?cause.message:'ارتباط برقرار نشد؛ دوباره تلاش کنید.';setError(message);toast(message,'error');}finally{inFlight.current=false;setBusy(false);}
 }
 if(!canEdit)return null;
 const options=selected&&!lookup.items.some(row=>row.id===selected.id)?[selected,...lookup.items]:lookup.items;
 return <div className="flex min-w-0 flex-wrap items-center gap-1.5">
  <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={()=>open('edit')}>ویرایش مشخصات</button>
  <CustomerActions customerId={customerId} canEdit={!busy} canMerge={false} blacklist={Number(profile.is_blacklisted)===1}/>
  {canMerge&&<button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={()=>open('merge')}>ادغام مشخصات</button>}
  <Modal open={panel==='edit'} onClose={()=>setPanel(null)} dismissible={!busy} title="ویرایش مشخصات مشتری" wide footer={<><button type="button" className="btn-secondary" disabled={busy} onClick={()=>setPanel(null)}>انصراف</button><button type="submit" form="customer-profile-edit" className="btn-primary" disabled={busy}>{busy?'در حال ذخیره…':'ذخیره مشخصات'}</button></>}>
   <form id="customer-profile-edit" onSubmit={event=>{event.preventDefault();void submit({action:'update',...form,expected_updated_at:profile.updated_at??null});}}>
    <fieldset disabled={busy} className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
     <label className="min-w-0"><span className="label">عنوان</span><SearchableSelect value={form.salutation??''} onChange={event=>setForm(previous=>({...previous,salutation:event.target.value}))}><option value="">بدون عنوان</option>{Object.entries(CUSTOMER_TITLES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</SearchableSelect></label>
     {editFields.map(([key,label])=><label key={key} className="min-w-0"><span className="label">{label}</span><input required={key==='last_name'} className="input w-full min-w-0" value={form[key]??''} type={key==='email'?'email':'text'} inputMode={['mobile','phone','postal_code'].includes(key)?'tel':undefined} dir={['email','mobile','phone'].includes(key)?'ltr':undefined} maxLength={key==='email'?254:160} onChange={event=>setForm(previous=>({...previous,[key]:event.target.value}))}/></label>)}
     <label className="min-w-0"><span className="label">نوع مشتری</span><SearchableSelect value={form.customer_type??'regular'} onChange={event=>setForm(previous=>({...previous,customer_type:event.target.value}))}>{CUSTOMER_TYPES.map(type=><option key={type} value={type}>{customerTypeFa(type)}</option>)}</SearchableSelect></label>
     {(['address','notes'] as const).map(key=><label key={key} className="min-w-0 sm:col-span-2"><span className="label">{key==='address'?'نشانی':'توضیحات'}</span><textarea className="input min-h-24 w-full resize-y" maxLength={key==='notes'?2000:1000} value={form[key]??''} onChange={event=>setForm(previous=>({...previous,[key]:event.target.value}))}/></label>)}
    </fieldset>{error&&<p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
   </form>
  </Modal>
  <Modal open={panel==='merge'} onClose={()=>setPanel(null)} dismissible={!busy} title="ادغام کنترل‌شدهٔ مشخصات" footer={<><button type="button" className="btn-secondary" disabled={busy} onClick={()=>setPanel(null)}>انصراف</button><button type="button" className="btn-primary" disabled={busy||!selected||!confirmed} onClick={()=>void submit({action:'merge_into',target_id:selected?.id})}>{busy?'در حال ثبت ادغام…':'تأیید ادغام'}</button></>}>
   <p className="mb-4 text-sm leading-7 text-zinc-600 dark:text-zinc-300">این نمایهٔ تکراری بایگانی می‌شود. فقط دستگاه‌های بدون سابقهٔ مرتبط به مقصدِ همین شعبه منتقل می‌شوند. سوابق مالی، پیش‌نویس، تعمیر و روابط عملیاتی مبدأ مانع ادغام‌اند؛ اسناد و دریافت‌های مقصد تغییر نمی‌کنند.</p>
   <label className="block min-w-0"><span className="label">مشتری مقصد؛ نگه داشته می‌شود</span><SearchableSelect disabled={busy} value={selected?String(selected.id):''} onSearchChange={value=>{if(value!==search){setSearch(value);setPage(1);setLookup(previous=>({...previous,loading:true,error:null}));}}} onChange={event=>{setSelected(options.find(row=>row.id===Number(event.target.value))??null);setConfirmed(false);}}><option value="">جست‌وجو و انتخاب مشتری…</option>{options.map(row=><option key={row.id} value={row.id}>{mergeLabel(row)}{row.mobile?' · '+toFaDigits(row.mobile):''}</option>)}</SearchableSelect></label>
   <div className="mt-3" aria-live="polite">{lookup.loading?<p className="text-sm text-zinc-500">در حال دریافت مشتریان…</p>:lookup.error?<div role="alert" className="space-y-2 text-sm text-red-600 dark:text-red-400"><p>{lookup.error}</p><button type="button" className="btn-secondary btn-sm" onClick={()=>{setPage(1);setRetry(value=>value+1);setLookup(previous=>({...previous,loading:true,error:null}));}}>تلاش دوباره</button></div>:!lookup.items.length?<EmptyState title="مشتری دیگری یافت نشد" body="عبارت دیگری را جست‌وجو کنید یا ابتدا مشتری مقصد را ثبت کنید."/>:null}{lookup.hasMore&&!lookup.loading&&<button type="button" className="btn-secondary btn-sm mt-2" onClick={()=>{setPage(previous=>previous+1);setLookup(previous=>({...previous,loading:true}));}}>نمایش مشتریان بیشتر</button>}</div>
   {selected&&<div className="mt-4 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700"><p className="break-words text-sm">مقصد: <strong>{mergeLabel(selected)}</strong></p><Checkbox checked={confirmed} disabled={busy} label="تأیید بایگانی نمایهٔ تکراری و حفظ سوابق اصلی" onCheckedChange={setConfirmed}><span className="min-w-0 break-words text-sm">بایگانی این نمایه و حفظ سوابق اصلی را تأیید می‌کنم.</span></Checkbox></div>}
   {error&&<p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
  </Modal>
 </div>;
}
