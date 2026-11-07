"use client";
import {useEffect,useState} from 'react';
import {SignatureView} from '@/components/signature-pad';
import {fmtDateTime,toFaDigits} from '@/lib/format';
import type {DailyReport} from './report-sheet';

type Version={revision:number;snapshot:DailyReport;reason:string;created_at:string};
export function ReportHistory({report}:{report:DailyReport}){
 const [open,setOpen]=useState(false),[before,setBefore]=useState<number|null>(null),[reload,setReload]=useState(0);
 const [result,setResult]=useState<{versions:Version[];next:number|null}|null>(null),[error,setError]=useState(''),[loadedKey,setLoadedKey]=useState('');
 const requestKey=`${report.report_date}:${report.user_id}:${report.revision}:${before}:${reload}`,loading=loadedKey!==requestKey;
 useEffect(()=>{if(!open)return;const controller=new AbortController();
 void(async()=>{try{
  const params=new URLSearchParams({history:report.report_date});if(report.user_id)params.set('user_id',String(report.user_id));if(before!=null)params.set('before_revision',String(before));
  const response=await fetch('/api/daily-reports?'+params,{signal:controller.signal,cache:'no-store'}),data=await response.json();if(!response.ok)throw new Error(data.error||'سابقه دریافت نشد.');if(!controller.signal.aborted){setResult(data);setError('');}
 }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'سابقه دریافت نشد.');}finally{if(!controller.signal.aborted)setLoadedKey(requestKey);}})();return()=>controller.abort();
 },[open,before,report.report_date,report.user_id,requestKey]);
 return <div className="space-y-2"><button className="btn-ghost btn-sm" aria-expanded={open} onClick={()=>{if(!open)setReload(n=>n+1);setOpen(v=>!v);}}>{open?'بستن سابقه':'سابقهٔ نسخه‌های گزارش'}</button>{open&&<div className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
 {loading?<p className="text-sm text-zinc-500" role="status">در حال دریافت سابقه…</p>:error?<div role="alert"><p className="text-sm text-red-500">{error}</p><button className="btn-secondary mt-2" onClick={()=>setReload(n=>n+1)}>تلاش دوباره</button></div>:result?.versions.length?result.versions.map(v=><details key={v.revision} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"><summary className="min-h-8 cursor-pointer text-sm font-medium focus-visible:outline-2 focus-visible:outline-brand-500">نسخهٔ {toFaDigits(v.revision+1)} · {fmtDateTime(v.created_at)}</summary><p className="mt-2 whitespace-pre-wrap break-words text-sm">{v.snapshot.summary}</p>{([['دستاوردها','achievements'],['موانع','blockers'],['برنامهٔ فردا','tomorrow']] as const).map(([label,key])=>v.snapshot[key]&&<p key={key} className="mt-2 whitespace-pre-wrap break-words text-sm"><strong>{label}: </strong>{v.snapshot[key]}</p>)}<p className="mt-2 text-xs text-zinc-500">زمان ثبت‌شده: {toFaDigits(v.snapshot.worked_minutes)} دقیقه · {v.snapshot.shift_start} تا {v.snapshot.shift_end}</p>{v.snapshot.signature_data&&<div className="mt-3"><SignatureView dataUrl={v.snapshot.signature_data} alt="امضای نسخهٔ محفوظ گزارش" signedAt={v.snapshot.submitted_at??undefined}/></div>}<p className="mt-2 break-words text-xs text-zinc-500">{v.reason}</p></details>):<p className="text-sm text-zinc-500">نسخهٔ بایگانی‌شده‌ای وجود ندارد؛ نسخهٔ فعلی هنگام ثبت اصلاحیه محفوظ می‌شود.</p>}
 {!loading&&!error&&<div className="flex flex-wrap gap-2">{before!=null&&<button className="btn-secondary btn-sm" onClick={()=>setBefore(null)}>جدیدترین نسخه‌ها</button>}{result?.next!=null&&<button className="btn-secondary btn-sm" onClick={()=>setBefore(result.next)}>نسخه‌های قدیمی‌تر</button>}</div>}
 </div>}</div>;
}
