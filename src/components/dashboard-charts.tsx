"use client";

import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { faNum, toFaDigits } from "@/lib/format";

const short = (d: string) => {
  const j = new Intl.DateTimeFormat("fa-IR-u-nu-latn", { calendar: "persian", month: "numeric", day: "numeric" });
  try {
    return j.format(new Date(d + "T00:00:00Z"));
  } catch {
    return d.slice(5);
  }
};

/** محور مبالغ: هزار/میلیون با ارقام فارسی تا برچسب‌ها کوتاه بمانند */
const moneyTick = (v: number) => {
  const abs = Math.abs(Number(v) || 0);
  if (abs >= 1_000_000) return `${toFaDigits((Number(v) / 1_000_000).toFixed(1).replace(/\.0$/, ""))}م`;
  if (abs >= 1_000) return `${toFaDigits(Math.round(Number(v) / 1_000))}ه`;
  return toFaDigits(Math.round(Number(v)));
};

export function DashboardCharts({
  revenue,
  repairs,
  unit = "تومان",
}: {
  revenue: Array<{ d: string; v: number }>;
  repairs: Array<{ d: string; c: number }>;
  unit?: string;
}) {
  const hasData = revenue.some((r) => Number(r.v) > 0) || repairs.some((r) => Number(r.c) > 0);
  if (!hasData) {
    return <p className="py-10 text-center text-sm text-zinc-400">در ۳۰ روز گذشته فروش یا پذیرشی ثبت نشده است.</p>;
  }

  const box = "rounded-xl border border-zinc-100 p-3 dark:border-zinc-800/70";
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className={box}>
        <div className="mb-2 flex items-center justify-between text-[13px]">
          <span className="font-medium text-zinc-600 dark:text-zinc-300">وصول‌شده‌ها</span>
          <span className="text-zinc-400">{unit}</span>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={revenue} margin={{ top: 4, right: 4, bottom: 0, left: -14 }}>
            <defs>
              <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3563f6" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#3563f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#8884" vertical={false} />
            <XAxis dataKey="d" tickFormatter={short} tick={{ fontSize: 11 }} interval="preserveStartEnd" tickMargin={6} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={moneyTick} width={44} />
            <Tooltip formatter={(v: any) => [`${faNum(Math.round(Number(v)))} ${unit}`, "وصول‌شده"]} labelFormatter={(l: any) => short(String(l))} />
            <Area type="monotone" dataKey="v" stroke="#3563f6" fill="url(#rev)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className={box}>
        <div className="mb-2 flex items-center justify-between text-[13px]">
          <span className="font-medium text-zinc-600 dark:text-zinc-300">پذیرش‌های جدید</span>
          <span className="text-zinc-400">تعداد</span>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={repairs} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#8884" vertical={false} />
            <XAxis dataKey="d" tickFormatter={short} tick={{ fontSize: 11 }} interval="preserveStartEnd" tickMargin={6} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} tickFormatter={(v: number) => toFaDigits(v)} width={34} />
            <Tooltip formatter={(v: any) => [`${faNum(Number(v))} پذیرش`, "پذیرش"]} labelFormatter={(l: any) => short(String(l))} />
            <Bar dataKey="c" fill="#8b5cf6" radius={[4, 4, 0, 0]} maxBarSize={20} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
