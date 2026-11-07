"use client";
import {postFinancial} from '@/lib/financial-client';
import {AvailableRepairs} from './available-repairs';

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {useRouter}from 'next/navigation';
import { EmptyState } from "@/components/ui";
import { Icon } from "@/components/icon";
import { RepairQueueCard } from "@/components/repair-queue-card";
import { statusFa } from "@/lib/status-fa";
import type { AssignTicketCard } from "@/lib/assign-shared";
import { toast } from "sonner";

type QueueData = {mode?:string;paging?:{page:number;totalPages:number;total:number}; not_started: AssignTicketCard[]; in_progress: AssignTicketCard[]; ready: AssignTicketCard[] };

async function postJSON(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "عملیات ناموفق بود.");
  return data;
}

/** کارتابل تعمیرکار — دستگاه‌های ارجاع‌شده به من، با اقدام «شروع تعمیر» و گام‌های بعدی مجاز */
export function QueueClient({ userName,allowClaim=false,native=false }: { userName: string;allowClaim?:boolean;native?:boolean }) {
  const router=useRouter();
  const [page,setPage]=useState(1);
  const [data, setData] = useState<QueueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/repairs/queue?page=${page}`);
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.error ?? "بارگذاری کارتابل ناموفق بود.");
      setData(d);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "بارگذاری کارتابل ناموفق بود.");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const startRepair = async (card: AssignTicketCard) => {
    setBusyId(card.id);
    try {
      await postFinancial(`/api/repairs/${card.id}/start`,{version:card.assignment_version,workflow_revision:card.workflow_revision,...(native?{expected_work_version:card.work_version}:{})});
      toast.success(`کار روی ${card.number} شروع شد و زمان‌سنج روشن است`);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "شروع تعمیر ناموفق بود");
    } finally {
      setBusyId(null);
    }
  };

  const transition = async (card: AssignTicketCard, status: string) => {
    if(status==='Cancelled'){router.push(`/repairs/${card.id}#cancellation`);return;}
    setBusyId(card.id);
    try {
      if(native)await postFinancial(`/api/repairs/${card.id}/status`,{status,expected_work_version:card.work_version});else await postJSON(`/api/repairs/${card.id}/status`, { status });
      toast.success(`وضعیت ${card.number} به «${statusFa(status)}» تغییر کرد`);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "تغییر وضعیت ناموفق بود");
    } finally {
      setBusyId(null);
    }
  };

  const total = data?.paging?.total ?? (data ? data.not_started.length + data.in_progress.length + data.ready.length : 0);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-200 bg-white px-4 pb-3 pt-5 sm:px-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">کارتابل من</h1>
            <p className="mt-0.5 text-sm text-zinc-500">
              {userName} عزیز — دستگاه‌های ارجاع‌شده به شما این‌جاست. تعمیر را صریح شروع کنید تا وضعیت و زمان‌سنج ثبت شود.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="badge-gray">{total.toLocaleString("fa-IR")} دستگاه</span>
            <button className="btn-secondary btn-sm" onClick={() => void load()} title="تازه‌سازی">
              <Icon name="refresh" size={14} />
              تازه‌سازی
            </button>
            <Link href="/repairs/board" className="btn-secondary btn-sm no-underline">تابلوی وضعیت</Link>
          </div>
        </div>
      </div>

      {native&&<p className="mx-4 mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 sm:mx-6 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" role="status">ارجاع، شروع کار و زمان‌سنج فعال است. تحویل و لغو تا تکمیل یکپارچه‌سازی مالی در دسترس نیست.</p>}
      {data?.paging&&<div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6"><span className="text-xs text-zinc-500">{data.paging.page.toLocaleString('fa-IR')} / {data.paging.totalPages.toLocaleString('fa-IR')}</span><div className="flex gap-2"><button className="btn-secondary btn-sm" disabled={page<=1||loading} onClick={()=>setPage(p=>p-1)}>قبلی</button><button className="btn-secondary btn-sm" disabled={page>=data.paging.totalPages||loading} onClick={()=>setPage(p=>p+1)}>بعدی</button></div></div>}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {allowClaim&&data?.mode==='shared'&&<AvailableRepairs onClaimed={()=>void load()}/>}
        {error && (
          <div className="card mb-4 border-red-200 p-4 text-center dark:border-red-500/30">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <button className="btn-secondary btn-sm mt-2" onClick={() => void load()}>تلاش دوباره</button>
          </div>
        )}
        {loading && !data && (
          <div className="grid gap-4 xl:grid-cols-3">
            {[0, 1, 2].map((col) => (
              <div key={col} className="space-y-3">
                <div className="skeleton h-10 w-44" />
                {[0, 1].map((i) => (
                  <div key={i} className="skeleton h-28 w-full" />
                ))}
              </div>
            ))}
          </div>
        )}

        {data && (
          <div className="grid items-start gap-4 xl:grid-cols-3">
            <section className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/40" aria-label="در انتظار شروع">
              <header className="mb-3 flex flex-wrap items-center gap-2 px-1">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500" aria-hidden />
                <h2 className="text-[15px] font-bold">در انتظار شروع</h2>
                <span className="badge-red">{data.not_started.length.toLocaleString("fa-IR")}</span>
              </header>
              {data.not_started.length === 0 ? (
                <EmptyState icon="user-check" title="موردی نیست" body="دستگاه ارجاع‌شده‌ای در انتظار شروع ندارید." />
              ) : (
                <div className="space-y-2.5">
                  {data.not_started.map((c) => (
                    <RepairQueueCard
                      key={c.id}
                      card={c}
                      actions={
                        <button
                          className="btn-primary btn-sm !h-7 !px-2 text-[11px]"
                          disabled={busyId === c.id}
                          onClick={() => void startRepair(c)}
                        >
                          <Icon name="wrench" size={12} />
                          {busyId === c.id ? "در حال شروع…" : data.mode==='legacy'?'شروع تعمیر':'دریافت و شروع کار'}
                        </button>
                      }
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/40" aria-label="در حال تعمیر">
              <header className="mb-3 flex flex-wrap items-center gap-2 px-1">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" aria-hidden />
                <h2 className="text-[15px] font-bold">در حال تعمیر</h2>
                <span className="badge-amber">{data.in_progress.length.toLocaleString("fa-IR")}</span>
              </header>
              {data.in_progress.length === 0 ? (
                <EmptyState icon="wrench" title="موردی نیست" body="دستگاهی در حال تعمیر ندارید." />
              ) : (
                <div className="space-y-2.5">
                  {data.in_progress.map((c) => (
                    <RepairQueueCard
                      key={c.id}
                      card={c}
                      actions={
                        <>
                          {(c.allowed_next ?? []).slice(0, 3).map((s) => (
                            <button
                              key={s}
                              className="btn-secondary btn-sm !h-7 !px-2 text-[11px]"
                              disabled={native||busyId === c.id}
                              onClick={() => void transition(c, s)}
                            >
                              {statusFa(s)}
                            </button>
                          ))}
                        </>
                      }
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/40" aria-label="آماده تحویل">
              <header className="mb-3 flex flex-wrap items-center gap-2 px-1">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" aria-hidden />
                <h2 className="text-[15px] font-bold">آماده تحویل</h2>
                <span className="badge-green">{data.ready.length.toLocaleString("fa-IR")}</span>
              </header>
              {data.ready.length === 0 ? (
                <EmptyState icon="package-check" title="موردی نیست" body="دستگاه آمادهٔ تحویلی روی دست شما نیست." />
              ) : (
                <div className="space-y-2.5">
                  {data.ready.map((c) => (
                    <RepairQueueCard
                      key={c.id}
                      card={c}
                      actions={
                        <Link href={`/repairs/${c.id}`} className="btn-primary btn-sm !h-7 !px-2 text-[11px] no-underline">
                          <Icon name="truck" size={12} />
                          تحویل از صفحهٔ پذیرش
                        </Link>
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
