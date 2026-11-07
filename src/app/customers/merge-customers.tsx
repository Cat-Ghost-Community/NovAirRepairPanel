"use client";

import { SearchableSelect } from "@/components/searchable-select";


import { useState } from "react";
import { useToast } from "@/components/ui";

type C = { id: number; name: string; mobile: string | null };

/** ادغام دو حساب مشتری تکراری — همه رکوردها به حساب اصلی منتقل و تکراری بایگانی می‌شود */
export function MergeCustomers({ customers }: { customers: C[] }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [master, setMaster] = useState("");
  const [dup, setDup] = useState("");
  const [busy, setBusy] = useState(false);

  const merge = async () => {
    if (!master || !dup) { toast("هر دو حساب را انتخاب کنید", "error"); return; }
    if (master === dup) { toast("حساب اصلی و تکراری نمی‌توانند یکی باشند", "error"); return; }
    const m = customers.find((c) => c.id === Number(master));
    const d = customers.find((c) => c.id === Number(dup));
    if (!confirm(`اطلاعات مجاز «${d?.name}» در «${m?.name}» ادغام و حساب تکراری بایگانی شود؟ حساب دارای سابقهٔ مالی یا متعلق به شعبهٔ دیگر ادغام نمی‌شود.`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/customers/merge", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ master_id: Number(master), duplicate_id: Number(dup) }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error);
      toast("حساب‌ها با موفقیت ادغام شدند");
      setOpen(false); setMaster(""); setDup("");
      window.location.reload();
    } catch (e: any) {
      toast(e.message ?? "خطا", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="btn-secondary" onClick={() => setOpen(true)} title="ادغام حساب‌های تکراری">⇄ ادغام</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="card card-pad w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="section-title mb-0">ادغام حساب‌های تکراری</h3>
            <p className="text-xs text-zinc-400">فقط حساب‌های هم‌شعبه و فاقد سابقهٔ مالی قابل ادغام‌اند. اسناد مالی و مالکیت تاریخی تغییر نمی‌کنند؛ موارد دیگر نیازمند بررسی مدیر شرکت هستند.</p>
            <div>
              <label className="label" htmlFor="merge-master">حساب اصلی (نگه‌داشته می‌شود)</label>
              <SearchableSelect id="merge-master" className="input" value={master} onChange={(e) => setMaster(e.target.value)}>
                <option value="">انتخاب…</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name} {c.mobile ? `— ${c.mobile}` : ""}</option>)}
              </SearchableSelect>
            </div>
            <div>
              <label className="label" htmlFor="merge-dup">حساب تکراری (بایگانی می‌شود)</label>
              <SearchableSelect id="merge-dup" className="input" value={dup} onChange={(e) => setDup(e.target.value)}>
                <option value="">انتخاب…</option>
                {customers.filter((c) => c.id !== Number(master)).map((c) => <option key={c.id} value={c.id}>{c.name} {c.mobile ? `— ${c.mobile}` : ""}</option>)}
              </SearchableSelect>
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => setOpen(false)}>انصراف</button>
              <button className="btn-primary" onClick={merge} disabled={busy || !master || !dup}>{busy ? "در حال ادغام…" : "ادغام حساب‌ها"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
