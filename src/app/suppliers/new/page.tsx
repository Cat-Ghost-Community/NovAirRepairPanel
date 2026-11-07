"use client";

import { SearchableSelect } from "@/components/searchable-select";


import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui";

export default function NewSupplierPage() {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<any>({ name: "", company: "", phone: "", email: "", address: "", payment_terms: "۳۰ روزه", contact_person: "" });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/suppliers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast("تأمین‌کننده اضافه شد");
      router.push(`/suppliers/${data.id}`);
    } catch (e: any) {
      toast(e.message, "error");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <h1 className="text-xl font-bold tracking-tight">تأمین‌کننده جدید</h1>
      <div className="card card-pad mt-4 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div><label className="label" htmlFor="nm">نام *</label><input id="nm" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="label" htmlFor="co">شرکت</label><input id="co" className="input" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></div>
          <div><label className="label" htmlFor="cp">شخص رابط</label><input id="cp" className="input" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></div>
          <div><label className="label" htmlFor="ph">تلفن</label><input id="ph" className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div><label className="label" htmlFor="em">ایمیل</label><input id="em" type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><label className="label" htmlFor="pt">شرایط پرداخت</label>
            <SearchableSelect id="pt" className="input" value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}>
              <option>پیش‌پرداخت</option><option>۱۵ روزه</option><option>۳۰ روزه</option><option>۶۰ روزه</option>
            </SearchableSelect>
          </div>
          <div className="sm:col-span-2"><label className="label" htmlFor="ad">نشانی</label><input id="ad" className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={() => router.back()}>انصراف</button>
          <button className="btn-primary" disabled={busy || !form.name} onClick={submit}>{busy ? "در حال ذخیره…" : "ذخیره تأمین‌کننده"}</button>
        </div>
      </div>
    </div>
  );
}
