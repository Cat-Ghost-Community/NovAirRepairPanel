"use client";

import { useEffect, useRef, useState } from "react";
import { EmptyState, useToast } from "@/components/ui";
import { Icon } from "@/components/icon";
import { fmtDate, toFaDigits } from "@/lib/format";

type Entry = { id: number; serial: string | null; imei: string | null; reason: string; created_at: string };

/** لیست سیاه دستگاه‌ها — افزودن با سریال/IMEI و امکان حذف اشتباه‌ها (ثبت در رخدادها) */
export function BlacklistManager() {
  const toast = useToast();
  const addOperation=useRef<{payload:string;key:string}|null>(null);
  const removeKeys=useRef(new Map<number,string>());
  const inFlight=useRef(false);
  const [page,setPage]=useState(1);
  const [totalPages,setTotalPages]=useState(1);
  const [total,setTotal]=useState(0);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serial, setSerial] = useState("");
  const [imei, setImei] = useState("");
  const [reason, setReason] = useState("");

  const load = async (target=1) => {
    setLoading(true);
    try {
      const response=await fetch(`/api/devices/blacklist?page=${target}&perPage=50`);
      const data=await response.json();
      if(!response.ok||data.error)throw new Error(data.error??'فهرست خوانده نشد.');
      setEntries(data.entries??[]);setPage(target);setTotalPages(data.totalPages??1);setTotal(data.total??data.entries?.length??0);setFailed(false);
    } catch {setFailed(true);} finally {setLoading(false);}
  };
  useEffect(()=>{void load();},[]);

  const add = async () => {
    if(inFlight.current)return;
    if (!serial.trim() && !imei.trim()) {
      toast("برای افزودن، سریال یا IMEI را وارد کنید.", "error");
      return;
    }
    inFlight.current=true;setBusy(true);
    const payload=JSON.stringify({serial:serial.trim()||null,imei:imei.trim()||null,reason:reason.trim()||'لیست سیاه'});
    if(addOperation.current?.payload!==payload)addOperation.current={payload,key:crypto.randomUUID()};
    try {
      const res = await fetch("/api/devices/check", {
        method: "POST",
        headers: { "Content-Type": "application/json", "idempotency-key":addOperation.current.key },
        body:payload,
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) throw new Error(d.error ?? "خطا در ثبت.");
      toast("دستگاه به لیست سیاه اضافه شد");
      addOperation.current=null;
      setSerial("");
      setImei("");
      setReason("");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "خطا در ثبت", "error");
    } finally {
      inFlight.current=false;setBusy(false);
    }
  };

  const remove = async (entry: Entry) => {
    if(inFlight.current||!confirm('این دستگاه از فهرست سیاه خارج شود؟'))return;
    inFlight.current=true;setBusy(true);
    if(!removeKeys.current.has(entry.id))removeKeys.current.set(entry.id,crypto.randomUUID());
    try {
      const response=await fetch(`/api/devices/blacklist?id=${entry.id}`,{method:'DELETE',headers:{'idempotency-key':removeKeys.current.get(entry.id)!}});
      const data=await response.json();if(!response.ok||data.error)throw new Error(data.error??'خروج از فهرست انجام نشد.');
      removeKeys.current.delete(entry.id);toast('از فهرست سیاه خارج شد');await load();
    }catch(error){toast(error instanceof Error?error.message:'ارتباط قطع شد؛ دوباره تلاش کنید.','error');}
    finally{inFlight.current=false;setBusy(false);}
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3 sm:px-5 dark:border-zinc-800/70">
        <span className="chip">{toFaDigits(total)} دستگاه در لیست سیاه</span>
      </div>

      <div className="grid gap-3 border-b border-zinc-100 px-4 py-4 sm:grid-cols-3 sm:px-5 dark:border-zinc-800/70">
        <div>
          <label className="label" htmlFor="bl-serial">سریال</label>
          <input id="bl-serial" className="input" dir="ltr" value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="SN123456" />
        </div>
        <div>
          <label className="label" htmlFor="bl-imei">IMEI</label>
          <input id="bl-imei" className="input" dir="ltr" inputMode="numeric" value={imei} onChange={(e) => setImei(e.target.value)} placeholder="356938035643809" />
        </div>
        <div>
          <label className="label" htmlFor="bl-reason">دلیل</label>
          <input id="bl-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلاً سرقتی" />
        </div>
        <div className="sm:col-span-3">
          <button className="btn-primary btn-sm" onClick={add} disabled={busy || (!serial.trim() && !imei.trim())}>
            <Icon name="plus" size={15} /> {busy ? "در حال ثبت…" : "افزودن به لیست سیاه"}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="px-5 py-8 text-center text-sm text-zinc-400">در حال بارگذاری…</p>
      ) : failed ? (
        <EmptyState
          icon="triangle-alert"
          title="لیست سیاه خوانده نشد"
          body="ارتباط با سرور برقرار نشد — اتصال را بررسی کنید."
          action={<button className="btn-primary" onClick={() => void load()}>تلاش دوباره</button>}
        />
      ) : entries.length === 0 ? (
        <EmptyState
          icon="shield"
          title="لیست سیاه خالی است"
          body="اگر دستگاه سرقتی یا مشکل‌سازی دارید، سریال یا IMEI آن را اینجا ثبت کنید تا هنگام پذیرش هشدار بگیرید."
        />
      ) : (
        <div className="max-h-80 space-y-2 overflow-y-auto p-4">
          {entries.map((e) => (
            <div
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50/50 px-3 py-2 text-sm dark:border-red-500/30 dark:bg-red-500/10"
            >
              <div className="min-w-0">
                <div className="font-mono text-xs" dir="ltr">
                  {e.serial || "—"} / {e.imei || "—"}
                </div>
                <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="text-red-600 dark:text-red-400">{e.reason}</span>
                  {e.created_at ? ` · ${fmtDate(e.created_at)}` : ""}
                </div>
              </div>
              <button className="btn-ghost btn-sm btn-icon" aria-label="حذف از لیست سیاه" disabled={busy} onClick={() => void remove(e)}>
                <Icon name="trash" size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
      {totalPages>1&&<div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 p-4 dark:border-zinc-800">
        <button className="btn-secondary btn-sm" disabled={loading||busy||page<=1} onClick={()=>void load(page-1)}>صفحه قبل</button>
        <span className="text-xs text-zinc-500">صفحه {toFaDigits(page)} از {toFaDigits(totalPages)}</span>
        <button className="btn-secondary btn-sm" disabled={loading||busy||page>=totalPages} onClick={()=>void load(page+1)}>صفحه بعد</button>
      </div>}
    </div>
  );
}
