"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {printWhenReady} from '@/lib/print-ready';

export default function PrintControls({ paper,priceHidden=false }: { paper: string;priceHidden?:boolean }) {
  const router = useRouter();
  const [pending,startTransition]=useTransition();
  const setParam = (key: string, val: string) => {
    const sp = new URLSearchParams(window.location.search);
    sp.set(key, val);
    startTransition(()=>router.replace(`?${sp.toString()}`,{scroll:false}));
  };
  const choice="min-h-8 rounded-lg px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-60 disabled:cursor-wait";
  const selected="bg-brand-600 text-white hover:bg-brand-700",unselected="bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700";

  return (
    <div className="no-print flex flex-wrap items-center gap-3 mb-3 text-sm" aria-busy={pending}>
      <div role="group" aria-label="اندازهٔ کاغذ" className="flex flex-wrap items-center gap-2">
      <span className="text-zinc-500">سایز کاغذ:</span>
      <button type="button" disabled={pending} aria-pressed={paper==='a4'} onClick={() => setParam("paper", "a4")} className={`${choice} ${paper==='a4'?selected:unselected}`}>A4</button>
      <button type="button" disabled={pending} aria-pressed={paper==='a5'} onClick={() => setParam("paper", "a5")}
        className={`${choice} ${paper === "a5" ? selected : unselected}`}>
        A5
      </button>
      <button type="button" disabled={pending} aria-pressed={paper==='roll'} onClick={() => setParam("paper", "roll")}
        className={`${choice} ${paper === "roll" ? selected : unselected}`}>
        رول ۸ سانتی
      </button>
      </div><div role="group" aria-label="نمایش مبالغ" className="flex flex-wrap items-center gap-2">
      <span className="text-zinc-500">قیمت‌ها:</span>
      <button type="button" disabled={pending} aria-pressed={!priceHidden} onClick={() => setParam("price", "1")}
        className={`${choice} ${priceHidden ? unselected : selected}`}>
        نمایش
      </button>
      <button type="button" disabled={pending} aria-pressed={priceHidden} onClick={() => setParam("price", "0")}
        className={`${choice} ${priceHidden ? selected : unselected}`}>
        مخفی
      </button>
      </div><button type="button" disabled={pending} className="btn-primary btn-sm ms-auto" onClick={() => void printWhenReady()}>چاپ رسید / PDF</button>
    </div>
  );
}
