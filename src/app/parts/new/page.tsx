"use client";

import { SearchableSelect } from "@/components/searchable-select";


import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui";
import { postFinancial } from "@/lib/financial-client";
import { parseMoneyInput, getCurrencyUnit,faNum } from "@/lib/format";

export default function NewPartPage() {
  const router = useRouter();
  const toast = useToast();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ name: "", sku: "", category: "", brand: "", compatibility: "", purchase_price: "", price: "", min_stock: 0, reorder_point: "" });
  const [openingQty, setOpeningQty] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/suppliers").then((r) => r.json()).then((d) => setSuppliers(d.suppliers ?? []));
  }, []);

  const submit = async () => {
    if (openingQty > 0 && form.purchase_price === "") { toast("برای افتتاحیه، بهای واحد را وارد کنید؛ کالای رایگان را با صفر مشخص کنید.", "error"); return; }
    setBusy(true);
    try {
      const data = await postFinancial<{ id: number }>("/api/parts", {
          ...form,
          purchase_price: parseMoneyInput(String(form.purchase_price||'0'),undefined,true),
          price: parseMoneyInput(String(form.price||'0'),undefined,true),
          opening_qty: openingQty,
          min_stock: Number(form.min_stock ?? 0),
          reorder_point: form.reorder_point ? Number(form.reorder_point) : null,
      });
      toast("کالا ایجاد شد");
      router.push(`/parts/${data.id}`);
    } catch (e: any) {
      toast(e.message, "error");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <h1 className="text-xl font-bold tracking-tight">کالای جدید</h1>
      <div className="card card-pad mt-4 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2"><label className="label" htmlFor="nm">نام کالا *</label><input id="nm" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="label" htmlFor="sku">کد کالا (خالی = خودکار)</label><input id="sku" className="input" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></div>
          <div><label className="label" htmlFor="cat">دسته‌بندی</label><input id="cat" className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="مثلاً قطعات موبایل" /></div>
          <div><label className="label" htmlFor="br">برند</label><input id="br" className="input" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></div>
          <div><label className="label" htmlFor="cmp">سازگار با</label><input id="cmp" className="input" value={form.compatibility} onChange={(e) => setForm({ ...form, compatibility: e.target.value })} placeholder="مثلاً iPhone 13" /></div>
          <div><label className="label" htmlFor="pp">قیمت خرید ({getCurrencyUnit() === "toman" ? "تومان" : "ریال"})</label><input id="pp" type="number" min="0" step="0.1" className="input" value={form.purchase_price} onChange={(e) => setForm({ ...form, purchase_price: e.target.value })} /></div>
          <div><label className="label" htmlFor="pr">قیمت فروش ({getCurrencyUnit() === "toman" ? "تومان" : "ریال"})</label><input id="pr" type="number" min="0" step="0.1" className="input" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
          <div><label className="label" htmlFor="ms">حداقل موجودی</label><input id="ms" type="number" className="input" value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: e.target.value })} /></div>
          <div><label className="label" htmlFor="part-quantity-precision">حداکثر رقم اعشار تعداد</label><SearchableSelect id="part-quantity-precision" className="input" disabled={busy} value={form.quantity_precision??6} onChange={e=>setForm({...form,quantity_precision:Number(e.target.value)})}>{[0,1,2,3,4,5,6].map(n=><option key={n} value={n}>{n===0?'فقط عدد صحیح':faNum(n)}</option>)}</SearchableSelect></div>
          <div><label className="label" htmlFor="rp">نقطه سفارش</label><input id="rp" type="number" className="input" value={form.reorder_point} onChange={(e) => setForm({ ...form, reorder_point: e.target.value })} /></div>
          <div>
            <label className="label" htmlFor="sup">تأمین‌کننده ترجیحی</label>
            <SearchableSelect id="sup" className="input" value={form.preferred_supplier_id ?? ""} onChange={(e) => setForm({ ...form, preferred_supplier_id: e.target.value })}>
              <option value="">—</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </SearchableSelect>
          </div>
          <div><label className="label" htmlFor="oq">موجودی اولیه</label><input id="oq" type="number" className="input" value={openingQty} onChange={(e) => setOpeningQty(Number(e.target.value))} /></div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={() => router.back()}>انصراف</button>
          <button className="btn-primary" disabled={busy || !form.name} onClick={submit}>{busy ? "در حال ذخیره…" : "ایجاد کالا"}</button>
        </div>
      </div>
    </div>
  );
}
