"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { fmtDate, fmtMoney } from "@/lib/format";

const short = (d: string) => fmtDate(d);

export function FinanceCharts({ flow }: { flow: Array<{ d: string; inflow: number; outflow: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={flow} margin={{ top: 4, right: 4, bottom: 0, left: -14 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#8884" vertical={false} />
        <XAxis dataKey="d" tickFormatter={short} tick={{ fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => fmtMoney(v)} />
        <Tooltip formatter={(v, n) => [fmtMoney(Number(v)), n === "inflow" ? "ورود وجه" : "خروج وجه"]} labelFormatter={(l) => short(String(l))} />
        <Legend formatter={(v: any) => (v === "inflow" ? "ورود وجه" : "خروج وجه")} />
        <Bar dataKey="inflow" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={14} />
        <Bar dataKey="outflow" fill="#ef4444" radius={[3, 3, 0, 0]} maxBarSize={14} />
      </BarChart>
    </ResponsiveContainer>
  );
}
