"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui";
import { postFinancial } from "@/lib/financial-client";

export function PoActions({ poId, status, openItems }: { poId: number; status: string; openItems: Array<{ id: number; name: string; remaining: number }> }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [qtys, setQtys] = useState<Record<number, number>>(Object.fromEntries(openItems.map((i) => [i.id, i.remaining])));

  const call = async (body: any, msg: string) => {
    setBusy(true);
    try {
      await postFinancial(`/api/purchase-orders/${poId}`, body);
      toast(msg);
      setReceiving(false);
      router.refresh();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  if (status === "received" || status === "cancelled") return null;

  const canReceive = Object.values(qtys).some((q) => q > 0);

  return (
    <div className="mt-4 pt-3 border-t border-zinc-200 dark:border-zinc-800">
      <div className="flex flex-wrap gap-2">
        {status === "draft" && <button className="btn-primary btn-sm" disabled={busy} onClick={() => call({ action: "send" }, "سفارش خرید ارسال‌شده علامت خورد")}>ارسال به تأمین‌کننده</button>}
        {["draft", "sent", "partially_received"].includes(status) && (
          <button className="btn-secondary btn-sm" disabled={busy || openItems.length === 0} onClick={() => setReceiving((v) => !v)}>دریافت کالا</button>
        )}
        <button className="btn-ghost btn-sm text-red-600" disabled={busy} onClick={() => call({ action: "cancel" }, "سفارش خرید لغو شد")}>لغو سفارش</button>
      </div>
      {receiving && (
        <div className="mt-3 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 space-y-2">
          <div className="text-[13px] font-medium">تعداد دریافتی را وارد کنید (دریافت جزئی پشتیبانی می‌شود):</div>
          {openItems.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center gap-3 text-sm min-w-0">
              <span className="flex-1 min-w-0 break-words">{i.name}</span>
              <span className="text-zinc-400 text-xs">مانده {i.remaining}</span>
              <input type="number" min={0} max={i.remaining} value={qtys[i.id] ?? 0} aria-label={`تعداد دریافت ${i.name}`}
                className="input !w-20 !py-1.5"
                onChange={(e) => setQtys({ ...qtys, [i.id]: Math.min(i.remaining, Math.max(0, Number(e.target.value))) })} />
            </div>
          ))}
          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-secondary btn-sm" onClick={() => setReceiving(false)}>انصراف</button>
            <button className="btn-primary btn-sm" disabled={busy || !canReceive} onClick={() => call({ action: "receive", items: openItems.map((i) => ({ item_id: i.id, qty: qtys[i.id] ?? 0 })) }, "کالا دریافت شد — موجودی به‌روزرسانی شد")}>
              تأیید دریافت
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
