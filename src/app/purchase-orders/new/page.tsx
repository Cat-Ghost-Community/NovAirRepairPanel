"use client";

import { SearchableSelect } from "@/components/searchable-select";


import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast, EmptyState } from "@/components/ui";
import { fmtMoney, toFaDigits, parseMoneyInput, moneyDisplayValue, getCurrencyUnit } from "@/lib/format";
import { multiplyRial, percentRial, sumRial } from "@/lib/money";
import { postFinancial } from "@/lib/financial-client";

export default function NewPOPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const toast = useToast();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [parts, setParts] = useState<any[]>([]);
  const [supplierId, setSupplierId] = useState(sp.get("supplier_id") ?? "");
  const [expected, setExpected] = useState("");
  const [shipping, setShipping] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Array<{ part_id: string; qty: number; unit_cost: number;unit_cost_input?:string }>>([]);
  const [busy, setBusy] = useState(false);
  const [taxRate, setTaxRate] = useState<number | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoadError("");
    const get = async (url: string) => {
      const response = await fetch(url, { signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "بارگذاری اطلاعات خرید انجام نشد.");
      return body;
    };
    Promise.all([get("/api/suppliers"), get("/api/parts"), get("/api/invoices/config")])
      .then(([supplierData, partData, config]) => {
        if (controller.signal.aborted) return;
        setSuppliers(supplierData.suppliers ?? []);
        setParts(partData.parts ?? []);
        setTaxRate(config.tax_rate);
      }).catch(error => { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "بارگذاری اطلاعات خرید انجام نشد."); });
    return () => controller.abort();
  }, [reload]);

  const addLine = () => setLines([...lines, { part_id: "", qty: 1, unit_cost: 0 }]);
  const setLine = (i: number, patch: any) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) => setLines(lines.filter((_, j) => j !== i));

  let totals: { items: number; tax: number; shipping: number; total: number } | null = null;
  let pricedLines:typeof lines|null=null;
  try {
    pricedLines=lines.map(line=>({...line,unit_cost:line.unit_cost_input===undefined?line.unit_cost:parseMoneyInput(line.unit_cost_input||'0',undefined,true)}));
    const items = sumRial(pricedLines.map(line => multiplyRial(line.unit_cost, line.qty)));
    const tax = percentRial(items, taxRate ?? 0);
    const freight = parseMoneyInput(shipping||'0',undefined,true);
    totals = { items, tax, shipping: freight, total: sumRial([items, tax, freight]) };
  } catch { /* Invalid input is shown below and cannot be submitted. */ }

  const submit = async (send: boolean) => {
    if (taxRate == null || !totals || !pricedLines || loadError) { toast("اطلاعات مالی یا مبلغ سفارش معتبر نیست؛ ابتدا خطا را برطرف کنید.", "error"); return; }
    setBusy(true);
    try {
      const data = await postFinancial<{ id: number; number: string }>("/api/purchase-orders", {
          supplier_id: Number(supplierId),
          expected_date: expected || null,
          shipping: totals.shipping,
          expected_total: totals.total,
          notes,
          send,
          items: pricedLines.filter((l) => l.part_id && l.qty > 0).map((l) => {
            const p = parts.find((x) => String(x.id) === l.part_id);
            return { part_id: Number(l.part_id), name: p?.name ?? "قطعه", qty: l.qty, unit_cost: l.unit_cost };
          }),
      });
      toast(`${data.number} ثبت شد`);
      router.push(`/purchase-orders/${data.id}`);
    } catch (e: any) {
      toast(e.message, "error");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <h1 className="text-xl font-bold tracking-tight">سفارش خرید جدید</h1>
      {loadError && <div role="alert" className="card card-pad mt-4 text-sm text-red-600">{loadError}<button type="button" className="btn-secondary btn-sm ms-2" onClick={() => setReload(value => value + 1)}>تلاش دوباره</button></div>}
      {taxRate == null && !loadError && <p role="status" className="mt-4 text-sm text-zinc-500">در حال بارگذاری اطلاعات خرید…</p>}
      <div className="card card-pad mt-4 space-y-4">
        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <label className="label" htmlFor="sup">تأمین‌کننده *</label>
            <SearchableSelect id="sup" className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">انتخاب تأمین‌کننده…</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </SearchableSelect>
          </div>
          <div><label className="label" htmlFor="exp">تحویل مورد انتظار</label><input id="exp" type="date" className="input" value={expected} onChange={(e) => setExpected(e.target.value)} /></div>
          <div><label className="label" htmlFor="ship">حمل و نقل ({getCurrencyUnit() === "toman" ? "تومان" : "ریال"})</label><input id="ship" type="number" min="0" step="0.1" className="input" value={shipping} onChange={(e) => setShipping(e.target.value)} /></div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="label !mb-0">اقلام</span>
            <button className="btn-secondary btn-sm" onClick={addLine}>+ افزودن قلم</button>
          </div>
          <div className="space-y-2">
            {lines.length === 0 && <EmptyState title="قلمی انتخاب نشده است" body="با دکمهٔ افزودن قلم، کالای موردنظر را انتخاب کنید." />}
            {lines.map((l, i) => (
              <div key={i} className="flex flex-wrap gap-2 items-center min-w-0">
                <SearchableSelect className="input flex-1 min-w-0 min-[375px]:min-w-32" value={l.part_id} aria-label="قطعه"
                  onChange={(e) => {
                    const p = parts.find((x) => String(x.id) === e.target.value);
                    setLine(i, { part_id: e.target.value, unit_cost: p ? p.purchase_price || Math.round((p.avg_cost ?? 0)) : 0,unit_cost_input:undefined });
                  }}>
                  <option value="">انتخاب قطعه…</option>
                  {parts.map((p) => <option key={p.id} value={p.id}>{p.name} — موجودی {toFaDigits(p.stock)}</option>)}
                </SearchableSelect>
                <input type="number" min={1} className="input !w-20" value={l.qty} aria-label="تعداد" onChange={(e) => setLine(i, { qty: Number(e.target.value) })} />
                <input type="text" inputMode="decimal" className="input !w-28" value={l.unit_cost_input??moneyDisplayValue(l.unit_cost)} aria-label="قیمت واحد" onChange={(e) => setLine(i,{unit_cost_input:e.target.value})} />
                <button className="btn-ghost btn-sm text-red-600" onClick={() => removeLine(i)} aria-label="حذف ردیف"><X size={13} /></button>
              </div>
            ))}
          </div>
        </div>

        <div className="text-right text-sm space-y-1 border-t border-zinc-200 dark:border-zinc-800 pt-3">
          {totals && taxRate != null ? <><div className="text-zinc-500">کالاها: {fmtMoney(totals.items)} · مالیات ({toFaDigits(taxRate)}٪): {fmtMoney(totals.tax)} · حمل‌ونقل: {fmtMoney(totals.shipping)}</div>
          <div className="text-lg font-bold break-words">جمع کل: {fmtMoney(totals.total)}</div></> : <p role={taxRate == null ? "status" : "alert"} className={taxRate == null ? "text-zinc-500" : "text-red-600"}>{taxRate == null ? "در انتظار اطلاعات مالی…" : "مبلغ، تعداد یا تنظیمات مالی معتبر نیست."}</p>}
        </div>

        <textarea className="input min-h-16" placeholder="یادداشت برای تأمین‌کننده…" value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="یادداشت‌ها" />

        <div className="flex justify-end gap-2">
          <button className="btn-secondary" disabled={busy || taxRate == null || !!loadError || !totals || !supplierId || lines.length === 0} onClick={() => submit(false)}>ذخیره پیش‌نویس</button>
          <button className="btn-primary" disabled={busy || taxRate == null || !!loadError || !totals || !supplierId || lines.length === 0} onClick={() => submit(true)}>ذخیره و ارسال به تأمین‌کننده</button>
        </div>
      </div>
    </div>
  );
}
