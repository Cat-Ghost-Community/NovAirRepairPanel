"use client";
import {postFinancial} from '@/lib/financial-client';

import {useRouter} from 'next/navigation';
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/ui";
import { toFaDigits } from "@/lib/format";
const utcTime=(value:string)=>/[zZ]|[+-]\d\d(?::?\d\d)?$/.test(value)?value:value.replace(' ','T')+'Z';

/**
 * شمارندهٔ زندهٔ «در حال کار ۰۴:۱۲» برای زمان‌سنج‌های باز.
 * در گزارش کار تعمیرکار (تب گاه‌شمار) استفاده میشود.
 */
export function LiveElapsed({ startedAt }: { startedAt: string }) {
  const [sec, setSec] = useState<number | null>(null);

  useEffect(() => {
    const started = new Date(utcTime(String(startedAt))).getTime();
    if (!Number.isFinite(started)) return;
    const tick = () => setSec(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  const text =
    sec == null
      ? "—"
      : toFaDigits(`${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`);

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
      در حال کار {text}
    </span>
  );
}

/** زمان‌سنج کار روی پذیرش — شروع/پایان برای تعمیرکار، ثبت دستی برای همه */
export function TimeTracker({ ticketId, canTrack,snapshot,native=false,closed=false,sourceVersion,pending=false }: { ticketId: number; canTrack: boolean;native?:boolean;closed?:boolean;sourceVersion?:number;pending?:boolean;snapshot?:{totalMinutes:number;lastEntryId:number;running:{id:number;started_at:string}|null} }) {
  const toast = useToast(),router=useRouter();
  const [workVersion,setWorkVersion]=useState<number|null>(null);
  const [loadError,setLoadError]=useState('');
  const [lastEntryId,setLastEntryId]=useState(0);
  const [total, setTotal] = useState(0);
  const [running, setRunning] = useState<{ id: number; started_at: string } | null>(snapshot?.running??null);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualMins, setManualMins] = useState("");
  const [manualNote, setManualNote] = useState("");
  const blocked=busy||pending||(native&&(workVersion==null||workVersion!==sourceVersion));

  const load = useCallback(async (signal?:AbortSignal) => {
    if(snapshot&&!native)return {...snapshot,work_version:undefined};
    const response=await fetch(`/api/repairs/${ticketId}/time`,{cache:'no-store',signal}),data=await response.json();
    if(!response.ok)throw new Error(data.error??'خواندن سوابق زمان ناموفق بود.');
    if(native&&sourceVersion!=null&&data.work_version>sourceVersion&&!signal?.aborted)router.refresh();
    return data as {totalMinutes:number;lastEntryId:number;running:{id:number;started_at:string}|null;work_version?:number};
  }, [ticketId,snapshot,native,sourceVersion,router]);
  const apply=useCallback((data:{totalMinutes:number;lastEntryId:number;running:{id:number;started_at:string}|null;work_version?:number})=>{setTotal(data.totalMinutes);setLastEntryId(Number(data.lastEntryId??0));setRunning(data.running??null);setWorkVersion(native?Number(data.work_version):null);setLoadError('');},[native]);
  useEffect(()=>{const controller=new AbortController();void load(controller.signal).then(data=>{if(!controller.signal.aborted)apply(data);}).catch(error=>{if(!controller.signal.aborted)setLoadError(error instanceof Error?error.message:'خواندن سوابق زمان ناموفق بود.');});return()=>controller.abort();},[load,apply]);

  // تیک هر ثانیه برای نمایش زمان جاری
  useEffect(() => {
    if (!running) return;
    const tick = () => setElapsed(Math.floor((Date.now() - new Date(utcTime(running.started_at)).getTime()) / 1000));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [running]);

  const call = async (body: any, msg: string) => {
    if(blocked)return;
    setBusy(true);
    try {
      const d=await postFinancial(`/api/repairs/${ticketId}/time`,{...body,previous_entry_id:lastEntryId,...(native?{expected_work_version:workVersion}:{})});
      toast(msg);
      apply(await load());router.refresh();
      return d;
    } catch (e: any) {
      toast(e.message ?? "خطا", "error");
    } finally {
      setBusy(false);
    }
  };

  const addManual = async () => {
    const mins = Number(manualMins);
    if (!mins || mins <= 0) { toast("دقیقه نامعتبر است", "error"); return; }
    const saved=await call({ action: "manual", minutes: mins, note: manualNote }, "زمان دستی ثبت شد");
    if(saved){setManualMins(""); setManualNote(""); setShowManual(false);}
  };

  const fmt = (s: number) => {
    const m = Math.floor(s / 60), sec = s % 60;
    return toFaDigits(`${String(m).padStart(2, "۰")}:${String(sec).padStart(2, "۰")}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {loadError&&<span role="alert" className="text-red-600">{loadError}</span>}
      <span className="badge-gray">⏱ زمان کار: {toFaDigits(String(Math.floor(total / 60)))} ساعت و {toFaDigits(String(total % 60))} دقیقه</span>
      {snapshot&&!native&&running&&<span className="badge-green">زمان‌سنج ثبت‌شده در حال اجراست؛ کنترل آن در این اتصال غیرفعال است.</span>}
      {canTrack && !loadError && (!native||workVersion!=null) && running && (
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-1 text-xs font-medium dark:bg-emerald-500/10 dark:text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> در حال کار {fmt(elapsed)}
          </span>
          <button className="btn-secondary btn-sm" disabled={blocked} onClick={() => call({ action: "stop" }, "زمان‌سنج متوقف شد")}>
            توقف
          </button>
        </span>
      )}
      {canTrack && !running && (
        <button className="btn-primary btn-sm" disabled={blocked} onClick={() => call({ action: "start" }, "زمان‌سنج شروع شد")}>
          ▶ شروع کار
        </button>
      )}
      {canTrack&&!closed&&!loadError&&(!native||workVersion!=null)&&<button disabled={blocked} className="text-xs text-brand-600 hover:underline" onClick={() => setShowManual((v) => !v)}>
        {showManual ? "بستن" : "+ ثبت دستی"}
      </button>}
      {canTrack&&showManual && (
        <span className="inline-flex items-center gap-1.5">
          <input className="input num w-20 h-8 text-sm" dir="ltr" placeholder="دقیقه" value={manualMins} onChange={(e) => setManualMins(e.target.value)} aria-label="دقیقه" />
          <input className="input h-8 text-sm w-40" placeholder="یادداشت (اختیاری)" value={manualNote} onChange={(e) => setManualNote(e.target.value)} aria-label="یادداشت" />
          <button className="btn-primary btn-sm" onClick={addManual} disabled={blocked}>ثبت</button>
        </span>
      )}
    </div>
  );
}
