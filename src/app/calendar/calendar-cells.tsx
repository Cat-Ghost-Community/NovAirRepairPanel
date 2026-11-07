"use client";

import { useState } from "react";
import { toFaDigits, fmtMoney } from "@/lib/format";

type Ev = { kind: "check_in" | "check_out" | "installment" | "warranty"; date: string; jday: number; amount: number; title: string; href: string; status: string };

const KIND_COLOR: Record<string, string> = {
  check_in: "bg-emerald-500",
  check_out: "bg-red-500",
  installment: "bg-amber-500",
  warranty: "bg-violet-500",
};

const WEEKDAYS = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

export function CalendarCells({ jy, jm, monthLen, firstWeekday, events, todayJm }: {
  jy: number; jm: number; monthLen: number; firstWeekday: number; events: Ev[]; todayJm: number;
}) {
  const [selDay, setSelDay] = useState<number | null>(null);

  const byDay = new Map<number, Ev[]>();
  for (const e of events) {
    const d = e.jday;
    if (!d) continue;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(e);
  }

  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: monthLen }, (_, i) => i + 1),
  ];

  const selEvents = selDay ? byDay.get(selDay) ?? [] : [];
  const selTotal = selEvents.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="card card-pad">
      <div className="grid grid-cols-7 gap-1 mb-1 text-center text-xs font-medium text-zinc-400">
        {WEEKDAYS.map((w) => <div key={w}>{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />;
          const evs = byDay.get(d) ?? [];
          const isToday = d === todayJm;
          return (
            <button
              key={i}
              onClick={() => setSelDay(evs.length ? d : null)}
              className={`relative rounded-lg border p-1 min-h-16 text-right align-top transition
                ${isToday ? "border-brand-500 ring-1 ring-brand-400" : "border-zinc-200 dark:border-zinc-800"}
                ${evs.length ? "hover:bg-zinc-50 dark:hover:bg-zinc-800/60" : "opacity-60 cursor-default"}`}
            >
              <span className={`text-[13px] ${isToday ? "font-bold text-brand-600" : "text-zinc-500"}`}>{toFaDigits(d)}</span>
              <div className="flex flex-wrap gap-0.5 mt-1">
                {evs.slice(0, 4).map((e, k) => <i key={k} className={`inline-block w-2 h-2 rounded-full ${KIND_COLOR[e.kind]}`} />)}
                {evs.length > 4 && <span className="text-[10px] text-zinc-400">+{toFaDigits(evs.length - 4)}</span>}
              </div>
              {evs.length > 0 && (
                <div className="text-xs text-zinc-500 mt-0.5">
                  {toFaDigits(evs.length)} رویداد
                </div>
              )}
            </button>
          );
        })}
      </div>

      {selDay && (
        <div className="mt-4 pt-3 border-t border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-sm">روز {toFaDigits(selDay)} — {toFaDigits(selEvents.length)} رویداد</h3>
            {selTotal > 0 && <span className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">جمع: {fmtMoney(selTotal)}</span>}
          </div>
          <div className="space-y-1.5">
            {selEvents.map((e, k) => (
              <a key={k} href={e.href} className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 p-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                <i className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${KIND_COLOR[e.kind]}`} />
                <span className="flex-1">{e.title}</span>
                {e.amount > 0 && <span className="font-mono text-xs">{fmtMoney(e.amount)}</span>}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
