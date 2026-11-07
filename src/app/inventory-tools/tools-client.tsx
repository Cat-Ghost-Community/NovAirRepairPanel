"use client";

import { SearchableSelect } from "@/components/searchable-select";


import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui";
import { postFinancial } from "@/lib/financial-client";

type Loc = { id: number; name: string; is_default: number };
type Part = { id: number; name: string; stock: number;quantity_precision:number };

export default function ToolsClient({ locations, categories, parts }: { locations: Loc[]; categories: string[]; parts: Part[] }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // قیمت گروهی
  const [pct, setPct] = useState("");
  const [dir, setDir] = useState("up");
  const [field, setField] = useState("price");
  const [category, setCategory] = useState("");

  // انتقال
  const [partId, setPartId] = useState("");
  const [fromLoc, setFromLoc] = useState(String(locations[0]?.id ?? ""));
  const [toLoc, setToLoc] = useState(String(locations[1]?.id ?? ""));
  const [qty, setQty] = useState("");

  // اکسل
  const [file, setFile] = useState<File | null>(null);

  const call = async (body: any, msg: string) => {
    setBusy(true);
    try {
      const d = await postFinancial<{ affected?: number }>("/api/inventory/tools", body);
      toast(`${msg} — ${d.affected ?? ""}${d.affected ? " قلم" : ""}`.trim());
      router.refresh();
    } catch (e: any) { toast(e.message ?? "خطا", "error"); }
    finally { setBusy(false); }
  };

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/inventory/excel", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "خطا در بارگذاری");
      toast(`${d.updated} قلم به‌روزرسانی شد، ${d.skipped} رد ناخوانا`);
      router.refresh();
    } catch (e: any) { toast(e.message ?? "خطا", "error"); }
    finally { setBusy(false); }
  };

  const selectedPart = parts.find((p) => String(p.id) === partId);
  const locName = (id: string) => locations.find((l) => String(l.id) === id)?.name ?? "—";

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">ابزارهای انبار</h1>
        <p className="text-sm text-zinc-500 mt-0.5">تغییر گروهی قیمت، انتقال بین انبارها و ورود/خروجی اکسل</p>
      </div>

      {/* تغییر گروهی قیمت */}
      <section className="card card-pad">
        <h2 className="section-title mb-1">افزایش/کاهش گروهی قیمت</h2>
        <p className="text-xs text-zinc-400 mb-3">برای تعدیل قیمت‌ها بر اساس بازار — قابل اعمال روی قیمت فروش یا خرید، همه کالاها یا یک گروه.</p>
        <div className="grid sm:grid-cols-5 gap-2 items-end">
          <div>
            <label className="label" htmlFor="bp-pct">درصد</label>
            <input id="bp-pct" type="number" dir="ltr" min={1} max={200} className="input num" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="۱۵" />
          </div>
          <div>
            <label className="label" htmlFor="bp-dir">جهت</label>
            <SearchableSelect id="bp-dir" className="input" value={dir} onChange={(e) => setDir(e.target.value)}>
              <option value="up">↑ افزایش</option>
              <option value="down">↓ کاهش</option>
            </SearchableSelect>
          </div>
          <div>
            <label className="label" htmlFor="bp-field">میدان</label>
            <SearchableSelect id="bp-field" className="input" value={field} onChange={(e) => setField(e.target.value)}>
              <option value="price">قیمت فروش</option>
              <option value="purchase_price">قیمت خرید</option>
            </SearchableSelect>
          </div>
          <div>
            <label className="label" htmlFor="bp-cat">گروه</label>
            <SearchableSelect id="bp-cat" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">همه گروه‌ها</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </SearchableSelect>
          </div>
          <button className="btn-primary" disabled={busy || !pct}
            onClick={() => { if (confirm(`قیمت ${field === "price" ? "فروش" : "خرید"} با ${pct}٪ ${dir === "up" ? "افزایش" : "کاهش"} یابد؟`)) call({ action: "bulk_price", percent: Number(pct), direction: dir, field, category: category || undefined }, "قیمت‌ها به‌روزرسانی شد"); }}>
            اعمال
          </button>
        </div>
      </section>

      {/* انتقال بین انبارها */}
      <section className="card card-pad">
        <h2 className="section-title mb-1">انتقال کالا بین انبارها</h2>
        <p className="text-xs text-zinc-400 mb-3">کالا را از یک انبار به انبار دیگر منتقل کنید — گردش در سابقه کالا ثبت می‌شود.</p>
        <div className="grid sm:grid-cols-5 gap-2 items-end">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="tr-part">کالا</label>
            <SearchableSelect id="tr-part" className="input" value={partId} onChange={(e) => setPartId(e.target.value)}>
              <option value="">انتخاب کالا…</option>
              {parts.map((p) => <option key={p.id} value={p.id}>{p.name} (موجودی کل: {p.stock.toLocaleString("fa-IR")})</option>)}
            </SearchableSelect>
          </div>
          <div>
            <label className="label" htmlFor="tr-from">از انبار</label>
            <SearchableSelect id="tr-from" className="input" value={fromLoc} onChange={(e) => setFromLoc(e.target.value)}>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </SearchableSelect>
          </div>
          <div>
            <label className="label" htmlFor="tr-to">به انبار</label>
            <SearchableSelect id="tr-to" className="input" value={toLoc} onChange={(e) => setToLoc(e.target.value)}>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </SearchableSelect>
          </div>
          <div className="flex gap-1.5 items-end">
            <div className="flex-1">
              <label className="label" htmlFor="tr-qty">تعداد</label>
              <input id="tr-qty" type="number" dir="ltr" min={10**-(selectedPart?.quantity_precision??6)} step={10**-(selectedPart?.quantity_precision??6)} className="input num" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
          </div>
        </div>
        <button className="btn-primary mt-3" disabled={busy || !partId || !qty || fromLoc === toLoc}
          onClick={() => call({ action: "transfer", part_id: Number(partId), from_location: Number(fromLoc), to_location: Number(toLoc), qty: Number(qty) },
            `${qty} عدد «${selectedPart?.name}» از ${locName(fromLoc)} به ${locName(toLoc)} منتقل شد`)}>
          انتقال
        </button>
      </section>

      {/* اکسل */}
      <section className="card card-pad">
        <h2 className="section-title mb-1">ورود و خروجی اکسل</h2>
        <p className="text-xs text-zinc-400 mb-3">فایل اکسل همه کالاها را بگیرید، قیمت/موجودی/حداقل را ویرایش کنید و دوباره بارگذاری کنید. به‌روزرسانی بر اساس ستون «شناسه» انجام می‌شود.</p>
        <div className="flex flex-wrap gap-2 items-center">
          <a href="/api/inventory/excel" className="btn-secondary"> دریافت فایل اکسل کالاها</a>
          <input type="file" accept=".xlsx,.xls,.csv" className="text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="انتخاب فایل اکسل" />
          <button className="btn-primary btn-sm" disabled={busy || !file} onClick={upload}> بارگذاری و به‌روزرسانی</button>
        </div>
      </section>
    </div>
  );
}
