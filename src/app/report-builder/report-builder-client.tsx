"use client";

import { SearchableSelect } from "@/components/searchable-select";


import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ui";
import { fmtMoney, fmtDate, toFaDigits } from "@/lib/format";
import { escapeHtml } from "@/lib/html";

type Col = { key: string; label: string; type?: "money" | "date" | "num" };
type Source = { key: string; label: string; cols: Col[]; filters: Array<{ key: string; label: string; type: string }> };
type Saved = { id: number; name: string; source: string; config: string };

const todayISO = () => new Date().toISOString().slice(0, 10);
const monthAgo = () => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

/** تبدیل جدول به CSV با BOM فارسی برای Excel */
function toCsv(cols: Col[], rows: Record<string, any>[]): string {
  const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = cols.map((c) => esc(c.label)).join(",");
  const body = rows.map((r) => cols.map((c) => esc(r[c.key])).join(",")).join("\n");
  return "\uFEFF" + head + "\n" + body;
}

export function ReportBuilderClient({ saved: initialSaved }: { saved: Saved[] }) {
  const toast = useToast();
  const [sources, setSources] = useState<Source[]>([]);
  const [saved, setSaved] = useState<Saved[]>(initialSaved);
  const [source, setSource] = useState("repairs");
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(todayISO());
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [selectedCols, setSelectedCols] = useState<string[]>([]);
  const [sort, setSort] = useState("");
  const [desc, setDesc] = useState(true);
  const [result, setResult] = useState<{ cols: Col[]; rows: Record<string, any>[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [showSave, setShowSave] = useState(false);

  useEffect(() => {
    fetch("/api/report-builder").then((r) => r.json()).then((d) => {
      setSources(d.sources ?? []);
      setSaved(d.saved ?? []);
    }).catch(() => {});
  }, []);

  const src = sources.find((s) => s.key === source);

  useEffect(() => {
    if (src) { setSelectedCols(src.cols.map((c) => c.key)); setSort(src.cols[0]?.key ?? ""); setFilters({}); setResult(null); }
  }, [source, sources.length]);

  const run = async (override?: Partial<{ source: string; from: string; to: string; filters: any; cols: string[]; sort: string; desc: boolean }>) => {
    setBusy(true);
    try {
      const body = {
        source: override?.source ?? source,
        from: override?.from ?? from,
        to: override?.to ?? to,
        filters: override?.filters ?? filters,
        cols: override?.cols ?? selectedCols,
        sort: override?.sort ?? sort,
        desc: override?.desc ?? desc,
      };
      const res = await fetch("/api/report-builder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error);
      setResult({ cols: d.cols, rows: d.rows });
      return d;
    } catch (e: any) {
      toast(e.message ?? "خطا در اجرای گزارش", "error");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!saveName.trim()) { toast("نام گزارش را وارد کنید", "error"); return; }
    const res = await fetch("/api/report-builder", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: saveName, source, from, to, filters, cols: selectedCols, sort, desc }),
    });
    if (res.ok) { toast("گزارش ذخیره شد"); setSaveName(""); setShowSave(false); fetch("/api/report-builder").then((r) => r.json()).then((d) => setSaved(d.saved ?? [])); }
    else toast("خطا در ذخیره", "error");
  };

  const loadSaved = (s: Saved) => {
    const cfg = JSON.parse(s.config ?? "{}");
    setSource(s.source);
    if (cfg.from) setFrom(cfg.from);
    if (cfg.to) setTo(cfg.to);
    setFilters(cfg.filters ?? {});
    if (cfg.cols?.length) setSelectedCols(cfg.cols);
    if (cfg.sort) setSort(cfg.sort);
    setDesc(!!cfg.desc);
    toast(`گزارش «${s.name}» بارگذاری شد — اجرا را بزنید`);
  };

  const deleteSaved = async (id: number) => {
    await fetch(`/api/report-builder?id=${id}`, { method: "DELETE" });
    setSaved((p) => p.filter((x) => x.id !== id));
  };

  const exportCsv = () => {
    if (!result?.rows.length) return;
    const csv = toCsv(result.cols, result.rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `report-${source}-${todayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const printReport = () => {
    if (!result?.rows.length) return;
    const head = result.cols.map((c) => `<th style="border:1px solid #999;padding:6px;background:#f1f5f9">${escapeHtml(c.label)}</th>`).join("");
    const body = result.rows.map((r) => `<tr>${result.cols.map((c) => {
      let v = r[c.key] ?? "";
      if (c.type === "money" && v) v = fmtMoney(Number(v));
      if (c.type === "date" && v) v = fmtDate(String(v));
      return `<td style="border:1px solid #ccc;padding:5px;text-align:center">${escapeHtml(v)}</td>`;
    }).join("")}</tr>`).join("");
    const w = window.open("", "_blank");
    w?.document.write(`<!DOCTYPE html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><title>گزارش</title>
      <style>body{font-family:Vazirmatn,Tahoma,sans-serif;padding:20px}table{border-collapse:collapse;width:100%;font-size:12px}@page{size:A4;margin:12mm}</style></head>
      <body><h2 style="font-size:16px">گزارش ${escapeHtml(sources.find((s) => s.key === source)?.label ?? "")}</h2>
      <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`);
    w?.document.close();
    w?.print();
  };

  const cell = (c: Col, v: any) => {
    if (v == null || v === "") return "—";
    if (c.type === "money") return fmtMoney(Number(v));
    if (c.type === "date") return fmtDate(String(v));
    return String(v);
  };

  const totalMoney = useMemo(() => {
    if (!result) return null;
    const moneyCol = result.cols.find((c) => c.type === "money");
    if (!moneyCol) return null;
    return result.rows.reduce((s, r) => s + (Number(r[moneyCol.key]) || 0), 0);
  }, [result]);

  return (
    <div className="space-y-4">
      {/* گزارش‌های ذخیره‌شده */}
      {saved.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {saved.map((s) => (
            <span key={s.id} className="badge-blue flex items-center gap-1.5 cursor-pointer" onClick={() => loadSaved(s)} title="کلیک = بارگذاری">
              {s.name}
              <button className="text-red-300 hover:text-red-600" onClick={(e) => { e.stopPropagation(); deleteSaved(s.id); }} aria-label={`حذف ${s.name}`}>×</button>
            </span>
          ))}
        </div>
      )}

      {/* فرم تنظیم گزارش */}
      <section className="card card-pad space-y-3">
        <div className="grid sm:grid-cols-4 gap-2 items-end">
          <div>
            <label className="label" htmlFor="rb-src">منبع داده</label>
            <SearchableSelect id="rb-src" className="input" value={source} onChange={(e) => setSource(e.target.value)}>
              {sources.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </SearchableSelect>
          </div>
          <div>
            <label className="label" htmlFor="rb-from">از تاریخ</label>
            <input id="rb-from" type="date" dir="ltr" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="rb-to">تا تاریخ</label>
            <input id="rb-to" type="date" dir="ltr" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="flex items-center gap-3 pb-1.5">
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={desc} onChange={(e) => setDesc(e.target.checked)} /> نزولی
            </label>
          </div>
        </div>

        {src && src.filters.length > 0 && (
          <div className="grid sm:grid-cols-4 gap-2">
            {src.filters.map((f) => (
              <div key={f.key}>
                <label className="label" htmlFor={`rb-f-${f.key}`}>{f.label}</label>
                <input id={`rb-f-${f.key}`} className="input" value={filters[f.key] ?? ""} onChange={(e) => setFilters({ ...filters, [f.key]: e.target.value })} placeholder="همه" />
              </div>
            ))}
            <div>
              <label className="label" htmlFor="rb-sort">مرتب‌سازی بر اساس</label>
              <SearchableSelect id="rb-sort" className="input" value={sort} onChange={(e) => setSort(e.target.value)}>
                {src.cols.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </SearchableSelect>
            </div>
          </div>
        )}

        {/* انتخاب ستون‌ها */}
        {src && (
          <div>
            <div className="text-[12px] font-semibold text-zinc-500 mb-1.5">ستون‌های گزارش</div>
            <div className="flex flex-wrap gap-1.5">
              {src.cols.map((c) => {
                const on = selectedCols.includes(c.key);
                return (
                  <button key={c.key} onClick={() => setSelectedCols(on ? selectedCols.filter((k) => k !== c.key) : [...selectedCols, c.key])}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${on ? "bg-brand-600 text-white" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800"}`}>
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 items-center pt-1">
          <button className="btn-primary" onClick={() => run()} disabled={busy}>{busy ? "در حال اجرا…" : "▶ اجرای گزارش"}</button>
          {result && result.rows.length > 0 && (
            <>
              <button className="btn-secondary" onClick={exportCsv}>خروجی اکسل</button>
              <button className="btn-secondary" onClick={printReport}>چاپ / PDF</button>
            </>
          )}
          <button className="btn-secondary" onClick={() => setShowSave((v) => !v)}>ذخیره گزارش</button>
          {showSave && (
            <span className="inline-flex items-center gap-1.5">
              <input className="input h-9 w-44" placeholder="نام گزارش" value={saveName} onChange={(e) => setSaveName(e.target.value)} />
              <button className="btn-primary btn-sm" onClick={save}>ثبت</button>
            </span>
          )}
        </div>
      </section>

      {/* نتیجه */}
      {result && (
        <div className="card overflow-x-auto">
          <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <span className="text-sm text-zinc-500">{toFaDigits(result.rows.length)} ردیف</span>
            {totalMoney != null && <span className="text-sm font-semibold">جمع: {fmtMoney(totalMoney)}</span>}
          </div>
          <table className="w-full">
            <thead className="border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                {result.cols.map((c) => (
                  <th key={c.key} className="th cursor-pointer select-none" onClick={() => { setSort(c.key); setDesc((d) => sort === c.key ? !d : true); run({ sort: c.key, desc: sort === c.key ? !desc : true }); }}>
                    {c.label} {sort === c.key ? (desc ? "↓" : "↑") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {result.rows.map((r, i) => (
                <tr key={i} className="row-hover">
                  {result.cols.map((c) => (
                    <td key={c.key} className={`td text-[13px] ${c.type === "money" ? "num" : ""} ${c.type === "money" || c.type === "num" ? "text-center" : ""}`}>{cell(c, r[c.key])}</td>
                  ))}
                </tr>
              ))}
              {result.rows.length === 0 && <tr><td colSpan={result.cols.length} className="td text-center text-zinc-400 py-8">داده‌ای در این بازه یافت نشد</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
