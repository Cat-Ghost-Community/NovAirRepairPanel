"use client";

import { SearchableSelect } from "@/components/searchable-select";


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar, Modal } from "@/components/ui";
import { Icon } from "@/components/icon";
import { toast } from "sonner";
import { PHASE_META, type AssignResult, type TechnicianOption } from "@/lib/assign-shared";

export type AssignModalItem = {
  id: number;
  number: string;
  customer_name: string;
  device_label: string;
  expect: number | null;
  branch_id?:number;
  version?:number;workflow_revision?:number;
  technician_name: string | null;
  phase: string;
};

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data as any)?.error ?? "عملیات ناموفق بود — دوباره تلاش کنید.");
  return data as T;
}

/**
 * مودال ارجاع به تعمیرکار — تک‌دستگاهی و گروهی از یک مسیر.
 * سه گام: انتخاب تعمیرکار → تایید خلاصه → نتیجهٔ هر دستگاه.
 */
export function AssignModal({
  open,
  onClose,
  onDone,
  items,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  items: AssignModalItem[];
}) {
  const [step, setStep] = useState<"pick" | "confirm" | "result">("pick");
  const [technicians, setTechnicians] = useState<TechnicianOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [techId, setTechId] = useState<number | null>(null);
  const [technicianSearch, setTechnicianSearch] = useState("");
  const [selectedTechnician,setSelectedTechnician]=useState<TechnicianOption|null>(null);
  const [nativePaging,setNativePaging]=useState<boolean|null>(null);
  const [technicianPage,setTechnicianPage]=useState(1),[hasMore,setHasMore]=useState(false),[loading,setLoading]=useState(false);
  const primaryRequest=useRef<AbortController|null>(null),pagingMode=useRef<boolean|null>(null);
  const [helperSearch,setHelperSearch]=useState(''),[helpers,setHelpers]=useState<TechnicianOption[]>([]),[selectedHelper,setSelectedHelper]=useState<TechnicianOption|null>(null);
  const [helperPage,setHelperPage]=useState(1),[helperMore,setHelperMore]=useState(false),[helperLoading,setHelperLoading]=useState(false),[helperError,setHelperError]=useState(''),[helperRetry,setHelperRetry]=useState(0);
  const helperRequest=useRef<AbortController|null>(null);
  const submitted=useRef<{payload:string;key:string}|null>(null);
  const [retry, setRetry] = useState(0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [pauseTimers,setPauseTimers]=useState(false);
  const [helperId,setHelperId]=useState('keep');
  const [operationKey,setOperationKey]=useState('');
  const [results, setResults] = useState<{ results: AssignResult[]; summary: { ok: number; skipped: number; failed: number } } | null>(null);

  const reasonRequired = useMemo(
    () => items.some((it) => it.expect != null),
    [items]
  );
  const isBulk = items.length > 1;
  const branchId=items[0]?.branch_id;
  const mixedBranches=items.some(item=>item.branch_id!==branchId);
  const target = selectedTechnician;
  const remoteQuery=nativePaging===false?'':technicianSearch;

  useEffect(() => {
    if (!open) return;
    setStep("pick");
    setTechId(null);
    setSelectedTechnician(null);setNativePaging(null);pagingMode.current=null;submitted.current=null;
    setTechnicianPage(1);setHasMore(false);setHelpers([]);setSelectedHelper(null);setHelperSearch('');setHelperPage(1);setHelperMore(false);setHelperError('');
    setTechnicianSearch("");
    setReason("");setPauseTimers(false);setHelperId('keep');setOperationKey(crypto.randomUUID());
    setResults(null);
    setLoadError(null);
    setTechnicians(null);
  }, [open,branchId,mixedBranches]);

  const fetchTechnicians=useCallback(async(query:string,page:number,signal:AbortSignal)=>{
    if(mixedBranches)throw Error('برای ارجاع گروهی، دستگاه‌های یک شعبه را انتخاب کنید.');
    const params=new URLSearchParams({q:query,page:String(page),perPage:'50'});if(branchId!=null)params.set('branch_id',String(branchId));
    const response=await fetch('/api/repairs/technicians?'+params,{signal}),data=await response.json();
    if(!response.ok)throw Error(data?.error??'بارگذاری تعمیرکاران ناموفق بود؛ دوباره تلاش کنید.');
    if(!data||!Array.isArray(data.technicians)||data.technicians.some((row:TechnicianOption)=>!row||!Number.isSafeInteger(row.id)||row.id<=0||typeof row.name!=='string'))throw Error('پاسخ تعمیرکاران معتبر نیست؛ صفحه را تازه کنید.');
    const native=typeof data.hasMore==='boolean';if(native&&(!Number.isSafeInteger(data.page)||data.page!==page||data.technicians.length>50))throw Error('صفحهٔ تعمیرکاران معتبر نیست؛ دوباره تلاش کنید.');
    return {native,rows:(data.technicians as TechnicianOption[]).filter(row=>branchId==null||row.branch_id===branchId),hasMore:native&&data.hasMore===true};
  },[branchId,mixedBranches]);
  const loadPrimary=useCallback(async(page:number,append:boolean,controller:AbortController)=>{
    setLoading(true);setLoadError(null);
    try{const result=await fetchTechnicians(remoteQuery.trim(),page,controller.signal);if(controller.signal.aborted)return;
      if(pagingMode.current!=null&&pagingMode.current!==result.native)throw Error('روش دریافت تعمیرکاران تغییر کرده است؛ پنجره را دوباره باز کنید.');
      pagingMode.current=result.native;setNativePaging(result.native);setTechnicians(previous=>append?[...(previous??[]),...result.rows.filter(row=>!previous?.some(old=>old.id===row.id))]:result.rows);setTechnicianPage(page);setHasMore(result.hasMore);
    }catch(error){if(!controller.signal.aborted)setLoadError(error instanceof Error?error.message:'بارگذاری تعمیرکاران ناموفق بود.');}finally{if(!controller.signal.aborted)setLoading(false);}
  },[fetchTechnicians,remoteQuery]);
  useEffect(()=>{if(!open)return;primaryRequest.current?.abort();const controller=new AbortController();primaryRequest.current=controller;const timer=setTimeout(()=>void loadPrimary(1,false,controller),remoteQuery?250:0);return()=>{clearTimeout(timer);primaryRequest.current?.abort();};},[open,loadPrimary,retry,remoteQuery]);
  const loadHelpers=useCallback(async(page:number,append:boolean,controller:AbortController)=>{
    setHelperLoading(true);setHelperError('');try{const result=await fetchTechnicians(helperSearch.trim(),page,controller.signal);if(controller.signal.aborted)return;if(!result.native)throw Error('صفحه‌بندی تعمیرکار دوم در دسترس نیست؛ پنجره را دوباره باز کنید.');setHelpers(previous=>append?[...previous,...result.rows.filter(row=>!previous.some(old=>old.id===row.id))]:result.rows);setHelperPage(page);setHelperMore(result.hasMore);}catch(error){if(!controller.signal.aborted)setHelperError(error instanceof Error?error.message:'بارگذاری تعمیرکار دوم ناموفق بود.');}finally{if(!controller.signal.aborted)setHelperLoading(false);}
  },[fetchTechnicians,helperSearch]);
  useEffect(()=>{if(!open||nativePaging!==true)return;helperRequest.current?.abort();const controller=new AbortController();helperRequest.current=controller;const timer=setTimeout(()=>void loadHelpers(1,false,controller),helperSearch?250:0);return()=>{clearTimeout(timer);helperRequest.current?.abort();};},[open,nativePaging,loadHelpers,helperRetry,helperSearch]);

  if (!open) return null;

  const submit = async () => {
    if (techId == null||!target) return;
    setBusy(true);
    try {
      const payload={items:items.map(it=>({id:it.id,expect:it.expect,version:it.version,workflow_revision:it.workflow_revision})),technician_id:techId,reason:reason.trim()||null,pause_timers:pauseTimers,helper_id:helperId==='keep'?undefined:helperId===''?null:Number(helperId)};
      const signature=JSON.stringify(payload);if(submitted.current?.payload!==signature)submitted.current={payload:signature,key:submitted.current?crypto.randomUUID():operationKey};
      const data = await postJSON<{ results: AssignResult[]; summary: { ok: number; skipped: number; failed: number } }>(
        "/api/repairs/assign",
        {...payload,operation_key:submitted.current.key}
      );
      if(!data||!Array.isArray(data.results)||!data.summary||!Number.isSafeInteger(data.summary.ok)||!Number.isSafeInteger(data.summary.failed)||!Number.isSafeInteger(data.summary.skipped))throw Error('نتیجهٔ ارجاع دریافت نشد؛ با همین انتخاب دوباره تلاش کنید.');
      setResults(data);
      setStep("result");
      const { ok, skipped, failed } = data.summary;
      if (failed === 0) {
        toast.success(
          skipped > 0
            ? `${ok} دستگاه ارجاع شد${skipped ? ` — ${skipped} مورد از قبل ارجاع بود` : ""}`
            : `${ok} دستگاه به ${target?.name ?? "تعمیرکار"} ارجاع شد`
        );
      } else {
        toast.error(`${ok + skipped} مورد ثبت شد، ${failed} مورد ناموفق — جزئیات را ببینید`);
      }
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "ارجاع ناموفق بود");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={isBulk ? `ارجاع گروهی ${items.length} دستگاه` : "ارجاع به تعمیرکار"} wide>
      {step === "pick" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-800/40">
            {isBulk ? (
              <>
                <div className="font-medium">{`تعداد دستگاه‌های انتخاب‌شده: ${items.length.toLocaleString("fa-IR")}`}</div>
                <ul className="mt-1.5 max-h-28 space-y-0.5 overflow-y-auto text-xs text-zinc-500">
                  {items.map((it) => (
                    <li key={it.id}>
                      <span className="font-mono">{it.number}</span> — {it.customer_name} · {it.device_label}
                      {it.expect != null && <span className="text-amber-600"> (ارجاع مجدد)</span>}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <div className="font-mono font-semibold">{items[0]?.number}</div>
                <div className="mt-0.5 text-zinc-600 dark:text-zinc-300">
                  {items[0]?.customer_name} · {items[0]?.device_label}
                </div>
                {items[0]?.expect != null && (
                  <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    این دستگاه الان روی دست «{items[0]?.technician_name ?? "—"}» است — عملیات «ارجاع مجدد» ثبت می‌شود.
                  </div>
                )}
              </>
            )}
          </div>

          <div>
            <div className="label mb-1.5">انتخاب تعمیرکار</div>
            {loadError && (
              <div role="alert" className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400"><p>{loadError}</p><button className="btn-secondary btn-sm mt-2" onClick={() => setRetry(n => n+1)}>تلاش دوباره</button></div>
            )}
            {!technicians && !loadError && (
              <div className="space-y-2" role="status" aria-label="در حال دریافت تعمیرکاران">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton h-12 w-full" />
                ))}
              </div>
            )}
            {technicians?.length === 0&&!loading&&!loadError && <p role="status" className="py-3 text-center text-sm text-zinc-400">{technicianSearch.trim()?'تعمیرکاری پیدا نشد؛ نام دیگری جستجو کنید.':'تعمیرکار فعالی در محدودهٔ شما ثبت نشده است.'}</p>}
            <label className="label" htmlFor="assign-technician-search">جستجوی تعمیرکار</label>
            <input id="assign-technician-search" type="search" className="input mb-2" value={technicianSearch} maxLength={100} disabled={busy} onChange={e => setTechnicianSearch(e.target.value)} placeholder="نام تعمیرکار یا شعبه…" />
            {loading&&technicians&&<p role="status" className="text-xs text-zinc-500 py-2">در حال جست‌وجوی تعمیرکاران…</p>}
            {nativePaging===false&&technicians && technicians.length > 0 && !technicians.some(t => `${t.name} ${t.branch_name ?? ""}`.includes(technicianSearch.trim())) && <p role="status" className="py-3 text-sm text-zinc-500">تعمیرکاری پیدا نشد؛ نام دیگری جستجو کنید.</p>}
            {target&&<p className="chip mb-2 max-w-full !whitespace-normal break-words" role="status">انتخاب‌شده: {target.name}</p>}
            <div className="max-h-64 space-y-1.5 overflow-y-auto overscroll-contain" aria-busy={loading}>
              {technicians?.filter(t => nativePaging===true||`${t.name} ${t.branch_name ?? ""}`.includes(technicianSearch.trim())).map((t) => (
                <button
                  key={t.id}
                  disabled={loading||busy}
                  onClick={() => {setTechId(t.id);setSelectedTechnician(t);if(helperId===String(t.id)){setHelperId('keep');setSelectedHelper(null);}}}
                  aria-pressed={techId === t.id}
                  className={`flex min-h-8 w-full items-center gap-2.5 rounded-xl border p-2.5 text-right transition-colors focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-50 ${
                    techId === t.id
                      ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                      : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
                  }`}
                >
                  <Avatar name={t.name} color={t.avatar_color ?? undefined} size={34} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{t.name}</span>
                    <span className="block text-[11px] text-zinc-400">
                      {t.branch_name ? `${t.branch_name} · ` : ""}
                      {t.active_count > 0 ? `${t.active_count} دستگاه باز روی دست` : "بدون کار باز"}
                      {t.in_progress_count > 0 ? ` (${t.in_progress_count} در حال تعمیر)` : ""}
                    </span>
                  </span>
                  {techId === t.id && <Icon name="check-circle" size={17} className="shrink-0 text-brand-600" />}
                </button>
              ))}
            </div>
            {nativePaging&&hasMore&&<button className="btn-secondary btn-sm mt-2" disabled={loading||busy} onClick={()=>{primaryRequest.current?.abort();const controller=new AbortController();primaryRequest.current=controller;void loadPrimary(technicianPage+1,true,controller);}}>{loading?'در حال دریافت…':'تعمیرکاران بیشتر'}</button>}
          </div>

          <div>
            <label className="label" htmlFor="assign-reason">
              دلیل {reasonRequired ? <span className="text-red-500">(الزامی برای ارجاع مجدد)</span> : <span className="text-zinc-400">(اختیاری)</span>}
            </label>
            <textarea
              id="assign-reason"
              className="input"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="مثلاً: تخصص متفاوت، مرخصی همکار، تعادل بار کاری…"
            />
          </div>
          <div className="space-y-3 rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800">
            <div><label className="label" htmlFor="assign-helper">تعمیرکار دوم</label><SearchableSelect id="assign-helper" className="input" value={helperId} disabled={busy} onSearchChange={nativePaging===true?setHelperSearch:undefined} onChange={e=>{const value=e.target.value;setHelperId(value);setSelectedHelper(value==='keep'||value===''?null:(nativePaging?helpers:technicians)?.find(row=>String(row.id)===value)??selectedHelper);}}><option value="keep">حفظ تعمیرکار دوم فعلی</option><option value="">بدون تعمیرکار دوم</option>{[...(selectedHelper&&selectedHelper.id!==techId?[selectedHelper]:[]),...(nativePaging?helpers:technicians??[]).filter(t=>t.id!==techId&&t.id!==selectedHelper?.id)].map(t=><option key={t.id} value={t.id}>{t.name}{t.branch_name?` — ${t.branch_name}`:''}</option>)}</SearchableSelect>
             {helperLoading&&<p role="status" className="text-xs text-zinc-500 mt-2">در حال جست‌وجوی تعمیرکار دوم…</p>}
             {helperError&&<div role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400"><p>{helperError}</p><button className="btn-secondary btn-sm mt-2" disabled={helperLoading} onClick={()=>setHelperRetry(n=>n+1)}>تلاش دوباره برای تعمیرکار دوم</button></div>}
             {nativePaging&&!helperLoading&&!helperError&&helpers.filter(row=>row.id!==techId).length===0&&<p role="status" className="text-xs text-zinc-500 mt-2">تعمیرکار دوم دیگری پیدا نشد؛ عبارت دیگری جستجو کنید.</p>}
             {nativePaging&&helperMore&&<button className="btn-secondary btn-sm mt-2" disabled={helperLoading||busy} onClick={()=>{helperRequest.current?.abort();const controller=new AbortController();helperRequest.current=controller;void loadHelpers(helperPage+1,true,controller);}}>{helperLoading?'در حال دریافت…':'تعمیرکاران دوم بیشتر'}</button>}
            </div>
            <label className="flex min-h-8 items-start gap-2"><input type="checkbox" checked={pauseTimers} onChange={e=>setPauseTimers(e.target.checked)} className="mt-1" /><span>توقف زمان‌سنج‌های تعمیرکار قبلی و ثبت تحویل کار؛ زمان و سابقهٔ کار حفظ می‌شود.</span></label>
          </div>

          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={onClose}>انصراف</button>
            <button
              className="btn-primary"
              disabled={techId == null || !target || (reasonRequired && !reason.trim())}
              onClick={() => setStep("confirm")}
            >
              ادامه — تایید نهایی
            </button>
          </div>
        </div>
      )}

      {step === "confirm" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="text-sm">
              <span className="text-zinc-500">مقصد: </span>
              <span className="font-semibold">{target?.name}</span>
              {target?.branch_name && <span className="text-xs text-zinc-400"> · {target.branch_name}</span>}
            </div>
            {helperId!=='keep'&&<div className="mt-1 text-sm break-words"><span className="text-zinc-500">تعمیرکار دوم: </span>{helperId===''?'بدون تعمیرکار دوم':selectedHelper?.name}</div>}
            <div className="mt-1 text-sm">
              <span className="text-zinc-500">{isBulk ? "دستگاه‌ها: " : "دستگاه: "}</span>
              {isBulk ? `${items.length.toLocaleString("fa-IR")} دستگاه` : `${items[0]?.number} — ${items[0]?.customer_name}`}
            </div>
            {reason.trim() && (
              <div className="mt-1 text-sm">
                <span className="text-zinc-500">دلیل: </span>
                {reason.trim()}
              </div>
            )}
            {items.some((it) => it.expect != null) && (
              <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                موردهایی که از قبل ارجاع شده‌اند، به‌عنوان «ارجاع مجدد» ثبت می‌شوند و در مسیر تعمیر دستگاه باقی می‌مانند.
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" disabled={busy} onClick={() => setStep("pick")}>بازگشت</button>
            <button className="btn-primary" disabled={busy} onClick={() => void submit()}>
              {busy ? "در حال ارجاع…" : isBulk ? "تایید و ارجاع گروهی" : "تایید ارجاع"}
            </button>
          </div>
        </div>
      )}

      {step === "result" && results && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="badge-green">{results.summary.ok} ارجاع موفق</span>
            {results.summary.skipped > 0 && <span className="badge-gray">{results.summary.skipped} بدون تغییر</span>}
            {results.summary.failed > 0 && <span className="badge-red">{results.summary.failed} ناموفق</span>}
          </div>
          {results.summary.failed > 0 && (
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-red-200 bg-red-50/60 p-2.5 dark:border-red-500/30 dark:bg-red-500/10">
              {results.results
                .filter((r) => !r.ok)
                .map((r) => (
                  <div key={r.ticket_id} className="text-xs text-red-700 dark:text-red-400">
                    <span className="font-mono">{r.number ?? r.ticket_id}</span> — {r.reason}
                  </div>
                ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button className="btn-primary" onClick={onClose}>بستن</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** خروجی کوچک برای نمایش فاز در لیست‌ها (مشترک با کارت‌ها) */
export function PhaseBadge({ phase }: { phase: string }) {
  const meta = PHASE_META[phase as keyof typeof PHASE_META] ?? PHASE_META.assigned;
  return (
    <span className={`${meta.badge} inline-flex items-center gap-1`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.short}
    </span>
  );
}
