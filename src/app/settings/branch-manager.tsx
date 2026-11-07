"use client";

import { useEffect, useState } from "react";
import { EmptyState, useToast } from "@/components/ui";
import { Icon } from "@/components/icon";
import { toFaDigits } from "@/lib/format";

type Branch = { id: number; name: string; code: string; address: string | null; city: string | null; phone: string | null; staff_count: number; open_repairs: number };

const EMPTY = { name: "", code: "", city: "", phone: "", address: "" };

/** مدیریت شعبه‌ها — فهرست کارتی + افزودن/ویرایش درجا با اعتبارسنجی و حالت‌های خالی/بارگذاری/خطا */
export function BranchManager({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });

  const load = () =>
    fetch("/api/branches")
      .then((r) => r.json())
      .then((d) => {
        setBranches(d.branches ?? []);
        setFailed(false);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  useEffect(() => {
    void load();
  }, []);

  const close = () => {
    setAdding(false);
    setEditing(null);
    setForm({ ...EMPTY });
  };

  const startAdd = () => {
    setEditing(null);
    setForm({ ...EMPTY });
    setAdding(true);
  };

  const startEdit = (b: Branch) => {
    setAdding(false);
    setEditing(b);
    setForm({ name: b.name, code: b.code, city: b.city ?? "", phone: b.phone ?? "", address: b.address ?? "" });
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast("نام شعبه الزامی است.", "error");
      return;
    }
    setBusy(true);
    try {
      const res = adding
        ? await fetch("/api/branches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) })
        : await fetch("/api/branches", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editing?.id, ...form }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) throw new Error(d.error ?? "خطا در ذخیره شعبه.");
      toast(adding ? "شعبه اضافه شد" : "شعبه ویرایش شد");
      close();
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "خطا در ذخیره شعبه", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3 sm:px-5 dark:border-zinc-800/70">
        <span className="chip">{toFaDigits(branches.length)} شعبه</span>
        {canEdit && !adding && !editing && (
          <button className="btn-primary btn-sm" onClick={startAdd}>
            <Icon name="plus" size={15} /> شعبهٔ جدید
          </button>
        )}
      </div>

      {(adding || editing) && (
        <div className="border-b border-zinc-200 bg-brand-50/40 px-5 py-4 dark:border-zinc-800 dark:bg-brand-500/5">
          <h3 className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-200">
            {adding ? "شعبهٔ جدید" : `ویرایش «${editing?.name}»`}
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="br-name">
                نام شعبه <span className="text-red-500">*</span>
              </label>
              <input
                id="br-name"
                className={`input ${!form.name.trim() ? "border-red-300" : ""}`}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="مثلاً شعبهٔ مرکزی"
                aria-invalid={!form.name.trim() || undefined}
              />
            </div>
            <div>
              <label className="label" htmlFor="br-code">کد شعبه (اختیاری)</label>
              <input id="br-code" className="input" dir="ltr" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="MAIN" />
            </div>
            <div>
              <label className="label" htmlFor="br-city">شهر</label>
              <input id="br-city" className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="مثلاً تهران" />
            </div>
            <div>
              <label className="label" htmlFor="br-phone">تلفن</label>
              <input id="br-phone" className="input" dir="ltr" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="۰۲۱…" />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="br-address">نشانی</label>
              <input id="br-address" className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="خیابان، پلاک، واحد" />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button className="btn-secondary btn-sm" onClick={close} disabled={busy}>انصراف</button>
            <button className="btn-primary btn-sm" onClick={save} disabled={busy || !form.name.trim()}>
              {busy ? "در حال ذخیره…" : "ذخیره"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="px-5 py-8 text-center text-sm text-zinc-400">در حال بارگذاری شعبه‌ها…</p>
      ) : failed ? (
        <EmptyState
          icon="triangle-alert"
          title="شعبه‌ها خوانده نشد"
          body="ارتباط با سرور برقرار نشد — اتصال را بررسی کنید و دوباره تلاش کنید."
          action={<button className="btn-primary" onClick={() => void load()}>تلاش دوباره</button>}
        />
      ) : branches.length === 0 ? (
        <EmptyState
          icon="landmark"
          title="شعبه‌ای ثبت نشده"
          body="اولین شعبه را اضافه کنید تا پذیرش‌ها، انبار و گزارش‌ها به آن گره بخورند."
          action={canEdit ? <button className="btn-primary" onClick={startAdd}>افزودن شعبه</button> : undefined}
        />
      ) : (
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          {branches.map((b) => (
            <div key={b.id} className="rounded-xl border border-zinc-200 p-3 transition-colors hover:border-brand-300 dark:border-zinc-800 dark:hover:border-brand-700">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{b.name}</span>
                    {b.code && <span className="badge-gray font-mono">{b.code}</span>}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {[b.city, b.address].filter(Boolean).join("، ") || "بدون نشانی"}
                    {b.phone ? ` · ${b.phone}` : ""}
                  </div>
                </div>
                {canEdit && (
                  <button className="btn-ghost btn-sm btn-icon" aria-label={`ویرایش ${b.name}`} onClick={() => startEdit(b)}>
                    <Icon name="pencil" size={15} />
                  </button>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="chip">{toFaDigits(b.staff_count)} کارمند</span>
                <span className="chip">{toFaDigits(b.open_repairs)} پذیرش باز</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
