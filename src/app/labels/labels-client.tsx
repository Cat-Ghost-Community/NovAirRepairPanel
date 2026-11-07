"use client";

import { useMemo, useState } from "react";
import { fmtMoney } from "@/lib/format";

type Part = { id: number; name: string; barcode: string | null; price: number };
type Ticket = { id: number; number: string; customer: string; device: string };

type LabelItem =
  | { kind: "part"; id: number; name: string; code: string; price: number; copies: number }
  | { kind: "ticket"; id: number; title: string; sub: string; code: string; copies: number };

export default function LabelsClient({ parts, tickets }: { parts: Part[]; tickets: Ticket[] }) {
  const [items, setItems] = useState<LabelItem[]>([]);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"part" | "ticket">("part");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (mode === "part") {
      return parts.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.barcode ?? "").includes(q)).slice(0, 30);
    }
    return tickets.filter((t) => !q || t.number.toLowerCase().includes(q) || t.customer.includes(q) || t.device.toLowerCase().includes(q)).slice(0, 30);
  }, [query, mode, parts, tickets]);

  const addItem = (item: LabelItem) => {
    setItems((list) => {
      const existing = list.find((x) => x.code === item.code);
      if (existing) return list.map((x) => (x.code === item.code ? { ...x, copies: x.copies + 1 } : x));
      return [...list, { ...item, copies: 1 }];
    });
  };

  const addBarcodeStock = () => {
    // چاپ بارکد به تعداد موجودی — فقط برای کالاهای انتخاب‌شده
    setItems((list) => list.map((x) => (x.kind === "part" ? { ...x, copies: Math.max(x.copies, 1) } : x)));
  };

  const totalLabels = items.reduce((s, i) => s + i.copies, 0);

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">چاپ برچسب و بارکد</h1>
          <p className="text-sm text-zinc-500 mt-0.5">چاپ برچسب کالاها و پذیرش‌ها — سازگار با پرینتر رول برچسب و پرینتر معمولی.</p>
        </div>
        <div className="flex gap-1.5">
          <button className={`btn-sm rounded-lg px-3 py-1.5 text-sm font-medium ${mode === "part" ? "bg-brand-600 text-white" : "card"}`} onClick={() => setMode("part")}>کالا</button>
          <button className={`btn-sm rounded-lg px-3 py-1.5 text-sm font-medium ${mode === "ticket" ? "bg-brand-600 text-white" : "card"}`} onClick={() => setMode("ticket")}>پذیرش</button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mt-4">
        {/* انتخاب */}
        <div className="card card-pad">
          <input className="input" placeholder={mode === "part" ? "جستجوی کالا…" : "جستجوی پذیرش…"} value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="mt-2 max-h-80 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
            {mode === "part" &&
              filtered.map((p: any) => (
                <button key={p.id} className="w-full text-right px-2 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800 flex justify-between items-center"
                  onClick={() => addItem({ kind: "part", id: p.id, name: p.name, code: p.barcode || `P${String(p.id).padStart(5, "0")}`, price: p.price, copies: 1 })}>
                  <span className="text-sm">{p.name}</span>
                  <span className="text-xs text-zinc-400 num">{fmtMoney(p.price)}</span>
                </button>
              ))}
            {mode === "ticket" &&
              filtered.map((t: any) => (
                <button key={t.id} className="w-full text-right px-2 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  onClick={() => addItem({ kind: "ticket", id: t.id, title: t.number, sub: `${t.customer} · ${t.device}`, code: t.number, copies: 1 })}>
                  <span className="text-sm font-medium">{t.number}</span>
                  <span className="text-xs text-zinc-400 block">{t.customer} · {t.device}</span>
                </button>
              ))}
            {filtered.length === 0 && <p className="p-3 text-sm text-zinc-400">موردی پیدا نشد.</p>}
          </div>
        </div>

        {/* سبد برچسب‌ها */}
        <div className="card card-pad">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[13px] font-semibold">برچسب‌های انتخاب‌شده ({totalLabels.toLocaleString("fa-IR")} عدد)</div>
            {items.length > 0 && <button className="text-xs text-red-500 hover:underline" onClick={() => setItems([])}>پاک کردن همه</button>}
          </div>
          <div className="max-h-60 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
            {items.map((it) => (
              <div key={it.code} className="flex items-center gap-2 py-1.5">
                <span className="text-sm flex-1">{it.kind === "part" ? it.name : `${it.title} — ${it.sub}`}</span>
                <input type="number" min={1} max={500} dir="ltr" className="input num w-16 h-7 text-xs" value={it.copies}
                  onChange={(e) => setItems((l) => l.map((x) => (x.code === it.code ? { ...x, copies: Math.max(1, Math.min(500, Number(e.target.value) || 1)) } : x)))}
                  aria-label="تعداد" />
                <button className="text-xs text-zinc-400 hover:text-red-500" onClick={() => setItems((l) => l.filter((x) => x.code !== it.code))}></button>
              </div>
            ))}
            {items.length === 0 && <p className="p-3 text-sm text-zinc-400">از ستون کنار، کالا یا پذیرش را انتخاب کنید.</p>}
          </div>
          <div className="flex gap-2 mt-3">
            <button className="btn-primary btn-sm flex-1" disabled={totalLabels === 0} onClick={() => window.print()}>
               چاپ {totalLabels > 0 ? `${totalLabels.toLocaleString("fa-IR")} برچسب` : ""}
            </button>
            {mode === "part" && <button className="btn-secondary btn-sm" onClick={addBarcodeStock} disabled={items.length === 0} title="برای هر کالا حداقل یک برچسب">تعداد = ۱</button>}
          </div>
        </div>
      </div>

      {/* پیش‌نمایش چاپ */}
      {items.length > 0 && (
        <div className="mt-6 print-area">
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
            {items.flatMap((it) =>
              Array.from({ length: it.copies }).map((_, i) => (
                <div key={`${it.code}-${i}`} className="label-card border border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg p-2 text-center print:break-inside-avoid">
                  {it.kind === "part" && (
                    <>
                      <div className="text-xs font-medium truncate">{it.name}</div>
                      <div className="text-xs num text-zinc-500">{fmtMoney((it as any).price)}</div>
                    </>
                  )}
                  {it.kind === "ticket" && (
                    <>
                      <div className="text-[13px] font-bold">{it.title}</div>
                      <div className="text-xs text-zinc-500 truncate">{it.sub}</div>
                    </>
                  )}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/barcode?text=${encodeURIComponent(it.code)}&height=32`} alt={it.code} className="mx-auto mt-1 h-8" />
                  <div className="text-[10px] text-zinc-400" dir="ltr">{it.code}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          body { background: white !important; }
          .no-print, header, nav { display: none !important; }
          .print-area { position: absolute; inset: 0; padding: 4mm !important; }
          .label-card { border-style: solid !important; break-inside: avoid; }
          @page { size: auto; margin: 5mm; }
        }
      ` }} />
    </div>
  );
}
