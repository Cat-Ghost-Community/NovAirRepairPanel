"use client";

import { SearchableSelect } from "@/components/searchable-select";


import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast, Modal } from "@/components/ui";
import { Pencil } from "lucide-react";

type Branch = { id: number; name: string };

const ROLE_FA: Record<string, string> = {
  owner: "مدیر ارشد",
  manager: "مدیر",
  technician: "تعمیرکار",
  reception: "پذیرش",
  inventory: "انباردار",
  accountant: "حسابدار",
  sales: "فروشنده",
};

/** افزودن کاربر جدید — فقط مدیران ارشد مجاز */
export function AddUserButton({ branches }: { branches: Branch[] }) {
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: "", email: "", password: "", role: "technician", branch_id: "", phone: "" });

  const submit = async () => {
    if (busy) return;
    if (!f.branch_id && !["owner","admin","manager"].includes(f.role)) { toast("شعبه کاربر را انتخاب کنید.", "error"); return; }
    if (!f.name.trim() || !f.email.trim() || f.password.length < 12 || f.password.length > 1024) {
      toast("نام، ایمیل و گذرواژه (۱۲ تا ۱۰۲۴ نویسه) را کامل کنید.", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...f, branch_id: f.branch_id || null }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "خطا در ثبت کاربر");
      toast(`کاربر «${f.name}» اضافه شد`);
      setOpen(false);
      setF({ name: "", email: "", password: "", role: "technician", branch_id: "", phone: "" });
      router.refresh();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="btn-primary btn-sm" onClick={() => setOpen(true)}>+ افزودن کاربر</button>
      <Modal open={open} onClose={() => setOpen(false)} title="افزودن کاربر جدید">
        <div className="space-y-3">
          <div>
            <label htmlFor="add-user-name" className="label">نام و نام خانوادگی *</label>
            <input id="add-user-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="مثلاً علی رضایی" />
          </div>
          <div>
            <label htmlFor="add-user-email" className="label">ایمیل (نام کاربری ورود) *</label>
            <input id="add-user-email" className="input" dir="ltr" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="user@shop.local" />
          </div>
          <div>
            <label htmlFor="add-user-password" className="label">گذرواژه * (حداقل ۱۲ نویسه)</label>
            <input id="add-user-password" className="input" dir="ltr" type="password" autoComplete="new-password" minLength={12} maxLength={1024} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="add-user-role" className="label">نقش</label>
              <SearchableSelect id="add-user-role" className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
                {Object.entries(ROLE_FA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </SearchableSelect>
            </div>
            <div>
              <label htmlFor="add-user-branch" className="label">شعبه</label>
              <SearchableSelect id="add-user-branch" className="input" value={f.branch_id} onChange={(e) => setF({ ...f, branch_id: e.target.value })}>
                <option value="">{["owner","admin","manager"].includes(f.role) ? "همه شعبه‌ها" : "انتخاب شعبه"}</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </SearchableSelect>
            </div>
          </div>
          <div>
            <label htmlFor="add-user-phone" className="label">موبایل</label>
            <input id="add-user-phone" className="input" dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="09xxxxxxxxx" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-secondary btn-sm" onClick={() => setOpen(false)}>انصراف</button>
            <button className="btn-primary btn-sm" disabled={busy} onClick={submit}>ثبت کاربر</button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/** ویرایش کاربر — نقش/شعبه/فعال‌سازی/ریست رمز */
export function UserActions({ user, branches }: { user: { id: number; name: string; role: string; branch_id: number | null; is_active: number }; branches: Branch[] }) {
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState(user.role);
  const [branchId, setBranchId] = useState(String(user.branch_id ?? ""));
  const [newPw, setNewPw] = useState("");

  const patch = async (body: Record<string, unknown>, msg: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "خطا");
      toast(msg);
      router.refresh();
      setOpen(false);
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="btn-ghost btn-sm" onClick={() => setOpen(true)} title="ویرایش"><Pencil size={13} /></button>
      <Modal open={open} onClose={() => setOpen(false)} title={`ویرایش «${user.name}»`}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">نقش</label>
              <SearchableSelect className="input" value={role} onChange={(e) => setRole(e.target.value)}>
                {Object.entries(ROLE_FA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </SearchableSelect>
            </div>
            <div>
              <label className="label">شعبه</label>
              <SearchableSelect className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">همه شعبه‌ها</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </SearchableSelect>
            </div>
          </div>
          <div>
            <label className="label">ریست گذرواژه (خالی = بدون تغییر)</label>
            <input className="input" dir="ltr" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="گذرواژه جدید…" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-secondary btn-sm" onClick={() => setOpen(false)}>انصراف</button>
            <button
              className="btn-primary btn-sm"
              disabled={busy}
              onClick={() => {
                const body: Record<string, unknown> = { role, branch_id: branchId || null };
                if (newPw) body.password = newPw;
                patch(body, "کاربر به‌روزرسانی شد");
              }}
            >
              ذخیره
            </button>
            {user.is_active ? (
              <button className="btn-ghost btn-sm text-red-600" disabled={busy} onClick={() => patch({ is_active: 0 }, `«${user.name}» غیرفعال شد`)}>غیرفعال‌سازی</button>
            ) : (
              <button className="btn-ghost btn-sm text-emerald-600" disabled={busy} onClick={() => patch({ is_active: 1 }, `«${user.name}» فعال شد`)}>فعال‌سازی</button>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
