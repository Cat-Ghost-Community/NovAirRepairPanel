"use client";

import { StatusBadge } from "@/components/ui";
import { Icon } from "@/components/icon";
import { statusFa } from "@/lib/status-fa";
import { toFaDigits } from "@/lib/format";

type S = { id: number; name: string; color: string; category: string; allowed_next: string[]; notify: boolean; sla: number | null };

const CATEGORY_FA: Record<string, string> = { open: "باز", waiting: "در انتظار", active: "در جریان", done: "پایان‌یافته", closed: "بسته" };

/** نقشهٔ گردش کار: هر وضعیت با رنگ، شمار پذیرش‌های فعلی و انتقال‌های مجاز */
export function StatusList({ statuses, counts = {} }: { statuses: S[]; counts?: Record<string, number> }) {
  const byName = new Map(statuses.map((s) => [s.name, s]));
  return (
    <div className="space-y-2">
      {statuses.map((s, index) => (
        <div key={s.id} className="rounded-xl border border-zinc-200 p-3 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[11px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              {toFaDigits(index + 1)}
            </span>
            <StatusBadge name={s.name} color={s.color} />
            <span className="chip">{CATEGORY_FA[s.category] ?? s.category}</span>
            {s.notify && (
              <span className="badge-blue">
                <Icon name="send" size={12} /> اطلاع به مشتری
              </span>
            )}
            {s.sla != null && <span className="chip">مهلت {toFaDigits(s.sla)} ساعت</span>}
            <span className="ms-auto text-xs text-zinc-500 dark:text-zinc-400">
              اکنون: {toFaDigits(Number(counts[s.name] ?? 0))} پذیرش
            </span>
          </div>
          {s.allowed_next.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-zinc-400">انتقال مجاز به:</span>
              {s.allowed_next.map((n) => {
                const target = byName.get(n);
                return (
                  <span
                    key={n}
                    className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-2 py-0.5 dark:border-zinc-700"
                    style={target ? { backgroundColor: `${target.color}18` } : undefined}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: target?.color ?? "#d4d4d8" }} aria-hidden />
                    {statusFa(n)}
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="mt-2 text-xs text-zinc-400">این وضعیت، پایان مسیر است — انتقال بعدی ندارد.</p>
          )}
        </div>
      ))}
    </div>
  );
}
