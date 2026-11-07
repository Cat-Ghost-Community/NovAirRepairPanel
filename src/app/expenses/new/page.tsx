"use client";

import { SearchableSelect } from "@/components/searchable-select";


import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui";
import { parseMoneyInput, getCurrencyUnit } from "@/lib/format";
import { postFinancial } from "@/lib/financial-client";

const CATEGORIES = ["اجاره", "قبوض", "حقوق", "ابزار", "قطعات", "حمل‌ونقل", "تبلیغات", "تعمیر و نگهداری", "سایر"];

export default function NewExpensePage() {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<any>({
    category: "قطعات", amount: "", vendor: "", method: "cash", description: "",
    date: new Date().toISOString().slice(0, 10),
  });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await postFinancial("/api/expenses", { ...form, amount: parseMoneyInput(form.amount) });
      toast("هزینه ثبت شد");
      router.push("/expenses");
    } catch (e: any) {
      toast(e.message, "error");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl p-4 sm:p-6">
      <h1 className="text-xl font-bold tracking-tight">ثبت هزینه</h1>
      <div className="card card-pad mt-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="cat">دسته‌بندی</label>
            <SearchableSelect id="cat" className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </SearchableSelect>
          </div>
          <div>
            <label className="label" htmlFor="amt">مبلغ ({getCurrencyUnit() === "toman" ? "تومان" : "ریال"}) *</label>
            <input id="amt" type="number" step="0.01" min="0.01" className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="dt">تاریخ</label>
            <input id="dt" type="date" className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="ven">فروشنده</label>
            <input id="ven" className="input" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className="label" htmlFor="mth">روش پرداخت</label>
            <SearchableSelect id="mth" className="input" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
              <option value="cash">نقدی</option><option value="card">کارتخوان</option><option value="bank_transfer">حواله بانکی</option><option value="other">سایر</option>
            </SearchableSelect>
          </div>
          <div className="col-span-2">
            <label className="label" htmlFor="desc">توضیحات</label>
            <input id="desc" className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={() => router.back()}>انصراف</button>
          <button className="btn-primary" disabled={busy || !form.amount} onClick={submit}>{busy ? "در حال ذخیره…" : "ثبت هزینه"}</button>
        </div>
      </div>
    </div>
  );
}
