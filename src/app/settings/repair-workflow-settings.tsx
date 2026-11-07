'use client';
import { SearchableSelect } from "@/components/searchable-select";

import {useEffect,useRef,useState} from 'react';
import {EmptyState,Modal,useToast} from '@/components/ui';
import {Icon} from '@/components/icon';
import {faNum} from '@/lib/format';
import {REPAIR_WORKFLOW_MODES,workflowError,type RepairWorkflowMode} from '@/lib/repair-workflow-shared';

type Employee={id:number;name:string;role:string};
type Data={branch_id:number;mode:RepairWorkflowMode;revision:number;supervisors:number[];supervisor_users:Employee[];employees:Employee[];employee_total:number;employee_page:number;impact:{active:number;unassigned:number;invalid_assignments:number;open_timers:number}};
export function RepairWorkflowSettings({branches,canEdit}:{branches:{id:number;name:string}[];canEdit:boolean}){
 const [branch,setBranch]=useState(branches.length===1?String(branches[0].id):'');
 const [dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[pendingBranch,setPendingBranch]=useState<string|null>(null);
 return <div className="space-y-5 p-4 sm:p-5">
  <div className="rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm leading-7 dark:border-brand-500/20 dark:bg-brand-500/10"><strong>سه مسیر، بدون تغییر ناخواستهٔ روش فعلی</strong><p>تا زمانی که تغییر را ذخیره نکنید، گردش کار فعلی برقرار است. انتخاب هر شعبه مستقل است و ارجاع‌ها، زمان‌های کار و اسناد قبلی حذف نمی‌شوند.</p></div>
  <div className="max-w-md"><label className="label" htmlFor="workflow-branch">شعبهٔ مورد تنظیم</label><SearchableSelect id="workflow-branch" className="input" disabled={busy} value={branch} onChange={e=>{if(dirty)setPendingBranch(e.target.value);else setBranch(e.target.value);}}><option value="">یک شعبه را انتخاب کنید</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</SearchableSelect></div>
  {branch?<WorkflowEditor key={branch} branch={Number(branch)} canEdit={canEdit} onDirtyChange={setDirty} onBusyChange={setBusy}/>:<EmptyState icon="landmark" title="ابتدا شعبه را انتخاب کنید" body="روش پذیرش و ارجاع را برای هر شعبه جداگانه ببینید و تنظیم کنید."/>}
  <Modal open={pendingBranch!=null} onClose={()=>setPendingBranch(null)} title="تغییرات ذخیره‌نشده"><div className="space-y-4 text-sm leading-7"><p>تغییرات این شعبه هنوز ذخیره نشده است. برای حفظ آن‌ها به تنظیمات برگردید؛ یا بدون ذخیره، شعبه را عوض کنید.</p><div className="flex flex-wrap justify-end gap-2"><button className="btn-secondary" onClick={()=>setPendingBranch(null)}>بازگشت به تنظیمات</button><button className="btn-primary" onClick={()=>{setDirty(false);setBranch(pendingBranch??'');setPendingBranch(null);}}>تغییر شعبه بدون ذخیره</button></div></div></Modal>
 </div>;
}
function WorkflowEditor({branch,canEdit,onDirtyChange,onBusyChange}:{branch:number;canEdit:boolean;onDirtyChange:(dirty:boolean)=>void;onBusyChange:(busy:boolean)=>void}){
 const toast=useToast(),[data,setData]=useState<Data|null>(null),[mode,setMode]=useState<RepairWorkflowMode>('legacy'),[supervisors,setSupervisors]=useState<number[]>([]);
 const [error,setError]=useState(''),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0),[help,setHelp]=useState<RepairWorkflowMode|null>(null),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false);
 const [query,setQuery]=useState(''),[page,setPage]=useState(1),[employees,setEmployees]=useState<Employee[]>([]),[total,setTotal]=useState(0),[staffLoading,setStaffLoading]=useState(false),[staffError,setStaffError]=useState(''),[staffRetry,setStaffRetry]=useState(0);
 const operation=useRef<{payload:string;key:string}|null>(null);
 useEffect(()=>{
  const controller=new AbortController();
  fetch(`/api/settings/repair-workflow?branch_id=${branch}`,{signal:controller.signal}).then(async r=>{const body=await r.json();if(!r.ok)throw Error(body.error??'بارگذاری تنظیمات ناموفق بود.');return body as Data;}).then(body=>{setData(body);setMode(body.mode);setSupervisors(body.supervisors);onDirtyChange(false);setError('');}).catch(e=>{if(e.name!=='AbortError')setError(workflowError(e));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[branch,retry,onDirtyChange]);
 useEffect(()=>{
  const controller=new AbortController();const timer=setTimeout(()=>{
   setStaffLoading(true);setStaffError('');
   const params=new URLSearchParams({branch_id:String(branch),employee_q:query,employee_page:String(page)});
   fetch(`/api/settings/repair-workflow?${params}`,{signal:controller.signal}).then(async r=>{const body=await r.json();if(!r.ok)throw Error(body.error??'بارگذاری کارکنان ناموفق بود.');return body as Data;}).then(body=>{setEmployees(body.employees);setTotal(body.employee_total);}).catch(e=>{if(e.name!=='AbortError')setStaffError(workflowError(e));}).finally(()=>{if(!controller.signal.aborted)setStaffLoading(false);});
  },query?250:0);return ()=>{clearTimeout(timer);controller.abort();};
 },[branch,query,page,staffRetry]);
 const dirty=data!=null&&(mode!==data.mode||JSON.stringify([...supervisors].sort((a,b)=>a-b))!==JSON.stringify([...data.supervisors].sort((a,b)=>a-b)));
 if(loading)return <div role="status" className="space-y-3"><div className="skeleton h-24 rounded-xl"/><p className="text-sm text-zinc-500">در حال بارگذاری گردش کار…</p></div>;
 if(!data)return <div role="alert" className="card p-4"><p className="text-sm text-red-600">{error||'تنظیمات دریافت نشد.'}</p><button className="btn-secondary mt-3" onClick={()=>{setLoading(true);setRetry(v=>v+1);}}>تلاش دوباره</button></div>;
 const chooseMode=(next:RepairWorkflowMode)=>{setMode(next);onDirtyChange(next!==data.mode||JSON.stringify([...supervisors].sort((a,b)=>a-b))!==JSON.stringify([...data.supervisors].sort((a,b)=>a-b)));};
 const chooseSupervisors=(next:number[])=>{setSupervisors(next);onDirtyChange(mode!==data.mode||JSON.stringify([...next].sort((a,b)=>a-b))!==JSON.stringify([...data.supervisors].sort((a,b)=>a-b)));};
 const selected=REPAIR_WORKFLOW_MODES.find(m=>m.id===mode)!,explanation=REPAIR_WORKFLOW_MODES.find(m=>m.id===help);
 const save=async()=>{
  const body={branch_id:branch,mode,revision:data.revision,supervisors};const payload=JSON.stringify(body);
  if(operation.current?.payload!==payload)operation.current={payload,key:crypto.randomUUID()};
  setBusy(true);onBusyChange(true);setError('');
  try{
   const response=await fetch('/api/settings/repair-workflow',{method:'POST',headers:{'content-type':'application/json','idempotency-key':operation.current.key},body:payload});
   const result=await response.json();if(!response.ok)throw Error(result.error??'ذخیرهٔ گردش کار ناموفق بود.');
   setData(result);setMode(result.mode);setSupervisors(result.supervisors);onDirtyChange(false);setConfirm(false);operation.current=null;toast('گردش کار همین شعبه ذخیره شد.');
  }catch(e){setError(workflowError(e,'نتیجهٔ ذخیره دریافت نشد. با همین انتخاب دوباره تلاش کنید؛ شناسهٔ ضدتکرار حفظ شده است.'));}finally{setBusy(false);onBusyChange(false);}
 };
 return <div className="space-y-5">
  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2"><span className="badge-gray max-w-full !whitespace-normal leading-6">مسیر فعال: {REPAIR_WORKFLOW_MODES.find(m=>m.id===data.mode)?.title}</span>{dirty&&<span className="badge-amber">تغییر ذخیره‌نشده</span>}{!canEdit&&<span className="badge-amber max-w-full !whitespace-normal leading-6">فقط مشاهده؛ تغییر با مدیر شرکت است</span>}</div>
  <fieldset disabled={!canEdit||busy} className="min-w-0"><legend className="label mb-3">روش پذیرش و ارجاع تعمیر</legend><div className="grid gap-3 xl:grid-cols-3">{REPAIR_WORKFLOW_MODES.map(item=><article key={item.id} className={`min-w-0 rounded-xl border p-4 transition-colors ${mode===item.id?'border-brand-500 bg-brand-50 dark:bg-brand-500/10':'border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900'}`}>
   <label className="flex min-h-8 cursor-pointer items-start gap-2 font-semibold text-sm"><input type="radio" name="repair-workflow-mode" value={item.id} checked={mode===item.id} onChange={()=>chooseMode(item.id)} className="mt-1 accent-brand-600"/><span className="min-w-0 break-words">{item.title}</span></label><p className="mt-2 text-sm leading-7 text-zinc-500 dark:text-zinc-400">{item.summary}</p>
   <button type="button" className="btn-ghost mt-2 min-h-8 !px-0 text-xs" onClick={()=>setHelp(item.id)} aria-label={`راهنمای ${item.title}`}><Icon name="info" size={15}/>روش کار و جزئیات</button>
  </article>)}</div></fieldset>
  {!canEdit&&<div className="flex flex-wrap gap-2">{REPAIR_WORKFLOW_MODES.map(m=><button key={m.id} className="btn-ghost btn-sm" onClick={()=>setHelp(m.id)}>راهنمای {m.title}</button>)}</div>}
  <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"><h3 className="font-semibold text-sm">سرپرستان مجاز این شعبه</h3><p className="mt-1 text-sm leading-7 text-zinc-500">مدیر شرکت و مدیر همین شعبه به‌صورت پیش‌فرض مجازند. افراد انتخاب‌شده در دو مسیر جدید فقط اختیار ارجاع همین شعبه را می‌گیرند؛ اجازهٔ تغییر تنظیمات یا ارجاع به خود دریافت نمی‌کنند.</p>
   <div className="mt-3 flex flex-wrap gap-2">{supervisors.length===0?<span className="text-xs text-zinc-400">سرپرست اضافه‌ای تعیین نشده است.</span>:supervisors.map(id=>{const employee=employees.find(e=>e.id===id)??data.supervisor_users.find(e=>e.id===id);return <span key={id} className="chip max-w-full !whitespace-normal"><span className="min-w-0 break-words">{employee?.name??`کارمند ${faNum(id)}`}</span>{canEdit&&<button className="btn-ghost btn-icon !h-8 !w-8" disabled={busy} aria-label={`حذف سرپرست ${employee?.name??faNum(id)}`} onClick={()=>chooseSupervisors(supervisors.filter(n=>n!==id))}><Icon name="x" size={13}/></button>}</span>;})}</div>
   {canEdit&&<><label className="label mt-4" htmlFor="workflow-staff-search">جستجوی کارمند برای سرپرستی</label><input id="workflow-staff-search" className="input" value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}} placeholder="نام یا ایمیل کارمند همین شعبه" disabled={busy}/>
   {staffLoading?<p role="status" className="mt-3 text-sm text-zinc-500">در حال جستجوی کارکنان…</p>:staffError?<p role="alert" className="mt-3 text-sm text-red-600">{staffError} <button className="btn-ghost btn-sm" onClick={()=>setStaffRetry(v=>v+1)}>تلاش دوباره</button></p>:employees.length===0?<p className="mt-3 text-sm text-zinc-500">کارمندی با این مشخصات پیدا نشد.</p>:<div className="mt-3 grid gap-2 sm:grid-cols-2">{employees.map(e=><label key={e.id} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 p-2 text-sm dark:border-zinc-700"><input type="checkbox" checked={supervisors.includes(e.id)} disabled={busy} onChange={event=>chooseSupervisors(event.target.checked?[...supervisors,e.id]:supervisors.filter(id=>id!==e.id))}/><span className="min-w-0 break-words">{e.name}</span></label>)}</div>}
   <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500"><span>{faNum(total)} کارمند · صفحهٔ {faNum(page)}</span><div className="flex gap-2"><button className="btn-secondary btn-sm" disabled={page<=1||staffLoading||busy} onClick={()=>setPage(p=>p-1)}>قبلی</button><button className="btn-secondary btn-sm" disabled={page*20>=total||staffLoading||busy} onClick={()=>setPage(p=>p+1)}>بعدی</button></div></div></>}
  </div>
  <div className="rounded-xl bg-zinc-50 p-4 text-sm leading-7 dark:bg-zinc-800/50"><h3 className="font-semibold">اثر تغییر بر کارهای موجود</h3><p>{faNum(data.impact.active??0)} پذیرش باز، {faNum(data.impact.unassigned??0)} بدون تعمیرکار و {faNum(data.impact.open_timers??0)} زمان‌سنج باز. تغییر مسیر هیچ‌یک را حذف یا متوقف نمی‌کند.</p>{Number(data.impact.invalid_assignments)>0&&<p className="mt-2 text-amber-700 dark:text-amber-400">{faNum(data.impact.invalid_assignments)} ارجاع به کارمند غیرفعال یا شعبهٔ دیگر نیاز به بازبینی مدیر دارد.</p>}<p className="mt-2 text-zinc-500">در دو مسیر جدید، تنظیم قدیمی «فقط ارجاع‌های من» نمی‌تواند محدودیت کار روی دستگاه‌های ارجاع‌نشده را غیرفعال کند. تغییر مسیر به‌تنهایی سند مالی یا کمیسیون ایجاد نمی‌کند.</p></div>
  {error&&<div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">{error}<button className="btn-ghost btn-sm" disabled={busy} onClick={()=>{setLoading(true);setRetry(v=>v+1);}}>بازخوانی تنظیمات</button></div>}
  {canEdit&&<div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800"><p className="text-xs text-zinc-500">تغییر فقط برای همین شعبه اعمال و در سابقه ثبت می‌شود.</p><button className="btn-primary" disabled={!dirty||busy} onClick={()=>setConfirm(true)}>بررسی و ذخیره</button></div>}
  <Modal open={help!=null} onClose={()=>setHelp(null)} title={explanation?.title??'راهنمای گردش کار'}><div className="space-y-4 text-sm leading-7"><p className="text-zinc-500">{explanation?.summary}</p><ol className="space-y-3">{explanation?.steps.map((step,index)=><li key={step} className="flex items-start gap-2"><span className="badge-gray mt-1 shrink-0">{faNum(index+1)}</span><span className="min-w-0">{step}</span></li>)}</ol><div className="rounded-xl bg-brand-50 p-3 dark:bg-brand-500/10">{explanation?.note}</div><p className="text-xs text-zinc-500">محدودهٔ شعبه، سابقهٔ کار و کنترل‌های مالی در همهٔ مسیرها حفظ می‌شوند.</p><button className="btn-secondary w-full" onClick={()=>setHelp(null)}>متوجه شدم</button></div></Modal>
  <Modal open={confirm} onClose={()=>{if(!busy)setConfirm(false);}} title="تأیید تغییر مسیر شعبه"><div className="space-y-4 text-sm leading-7"><p>مسیر انتخابی: <strong>{selected.title}</strong></p><p>{selected.summary}</p><p className="rounded-lg bg-amber-50 p-3 dark:bg-amber-500/10">پس از ذخیره، دسترسی‌ها فوراً بر اساس این مسیر بررسی می‌شوند. ارجاع‌ها، زمان‌های ثبت‌شده و اسناد قبلی حفظ خواهند شد. کارهای بدون ارجاع در مسیر مدیریتی به انتخاب مدیر نیاز دارند.</p>{error&&<p role="alert" className="text-red-600">{error}</p>}<div className="flex flex-wrap justify-end gap-2"><button className="btn-secondary" disabled={busy} onClick={()=>setConfirm(false)}>بازگشت</button><button className="btn-primary" disabled={busy} onClick={()=>void save()}>{busy?'در حال ذخیره…':'ذخیرهٔ مسیر این شعبه'}</button></div></div></Modal>
 </div>;
}
