"use client";

import { SearchableSelect } from "@/components/searchable-select";


import { Check, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ui";
import { toFaDigits } from "@/lib/format";

type Catalog = { group: string; perms: Array<{ key: string; label: string }> };
type Perm = { perm: string; effect: "allow" | "deny" };

/** ویرایشگر دسترسی ریز کاربر — خروجی PUT به /api/team/permissions */
export function PermissionsEditor({ users, currentUserRole }: { users: Array<{ id: number; name: string; role: string }>; currentUserRole: string }) {
  const toast = useToast();
  const [catalog, setCatalog] = useState<Catalog[]>([]);
  const [templates, setTemplates] = useState<Record<string, { label: string; perms: string[] }>>({});
  const [userId, setUserId] = useState<number>(users[0]?.id ?? 0);
  const [perms, setPerms] = useState<Map<string, "allow" | "deny">>(new Map());
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    fetch("/api/team/permissions").then((r) => r.json()).then((d) => {
      setCatalog(d.catalog ?? []);
      setTemplates(d.templates ?? {});
    }).catch(() => {});
  }, []);

  const load = (uid: number) => {
    setLoading(true);
    setDirty(false);
    fetch(`/api/team/permissions?user_id=${uid}`).then((r) => r.json()).then((d) => {
      const m = new Map<string, "allow" | "deny">();
      for (const p of d.userPerms ?? []) m.set(p.perm, p.effect);
      setPerms(m);
    }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { if (userId) load(userId); }, [userId]);

  const toggle = (key: string, effect: "allow" | "deny") => {
    setPerms((prev) => {
      const next = new Map(prev);
      if (next.get(key) === effect) next.delete(key);
      else next.set(key, effect);
      return next;
    });
    setDirty(true);
  };

  const applyTemplate = (key: string) => {
    const tpl = templates[key];
    if (!tpl) return;
    const m = new Map<string, "allow" | "deny">();
    for (const p of tpl.perms) m.set(p, "allow");
    setPerms(m);
    setDirty(true);
    toast(`قالب «${tpl.label}» اعمال شد — برای ثبت، ذخیره کنید`);
  };

  const copyFrom = (sourceId: number) => {
    const source = users.find((u) => u.id === sourceId);
    if (!source) return;
    setLoading(true);
    fetch(`/api/team/permissions?user_id=${sourceId}`).then((r) => r.json()).then((d) => {
      const m = new Map<string, "allow" | "deny">();
      for (const p of d.userPerms ?? []) m.set(p.perm, p.effect);
      setPerms(m);
      setDirty(true);
      toast(`دسترسی از «${source.name}» کپی شد — برای ثبت، ذخیره کنید`);
    }).catch(() => {}).finally(() => setLoading(false));
  };

  const save = async () => {
    const res = await fetch("/api/team/permissions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, perms: [...perms.entries()].map(([perm, effect]) => ({ perm, effect })) }),
    });
    if (res.ok) { toast("دسترسی‌ها ذخیره شد"); setDirty(false); }
    else toast("خطا در ذخیره دسترسی‌ها", "error");
  };

  const resetToRole = () => { setPerms(new Map()); setDirty(true); };

  const allowedCount = useMemo(() => [...perms.values()].filter((e) => e === "allow").length, [perms]);

  const selectedUser = users.find((u) => u.id === userId);

  return (
    <section className="card card-pad">
      <h2 className="section-title mb-1">دسترسی‌های دقیق کاربر</h2>
      <p className="text-xs text-zinc-400 mb-3">
        دسترسی شخصی بر نقش اولویت دارد. بدون هیچ تنظیم شخصی، دسترسی‌های نقش اعمال می‌شود. «ممنوع» همیشه برنده است.
      </p>

      <div className="flex flex-wrap items-end gap-2 mb-4">
        <div>
          <label className="label" htmlFor="perm-user">کاربر</label>
          <SearchableSelect id="perm-user" className="input w-56" value={userId} onChange={(e) => setUserId(Number(e.target.value))}>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </SearchableSelect>
        </div>
        <div>
          <label className="label" htmlFor="perm-tpl">قالب آماده</label>
          <SearchableSelect id="perm-tpl" className="input w-44" value="" onChange={(e) => e.target.value && applyTemplate(e.target.value)}>
            <option value="">اعمال قالب…</option>
            {Object.entries(templates).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
          </SearchableSelect>
        </div>
        <div>
          <label className="label" htmlFor="perm-copy">کپی از کاربر</label>
          <SearchableSelect id="perm-copy" className="input w-44" value="" onChange={(e) => e.target.value && copyFrom(Number(e.target.value))}>
            <option value="">انتخاب…</option>
            {users.filter((u) => u.id !== userId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </SearchableSelect>
        </div>
        <div className="flex gap-2 mr-auto">
          <button className="btn-secondary btn-sm" onClick={resetToRole} disabled={loading}>حالت نقش پیش‌فرض</button>
          <button className="btn-primary btn-sm" onClick={save} disabled={loading || !dirty}>
            ذخیره {dirty ? "•" : ""} {allowedCount > 0 && `(${toFaDigits(allowedCount)})`}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-400">در حال بارگذاری…</p>
      ) : (
        <div className="space-y-4">
          {catalog.map((g) => (
            <div key={g.group}>
              <div className="text-[13px] font-semibold text-zinc-500 mb-1.5">{g.group}</div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                {g.perms.map((p) => {
                  const state = perms.get(p.key);
                  return (
                    <div key={p.key} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[13px] transition ${state ? "border-brand-300 dark:border-brand-700 bg-brand-50/50 dark:bg-brand-500/5" : "border-zinc-200 dark:border-zinc-800"}`}>
                      <span className="flex-1 min-w-0 truncate" title={p.key}>{p.label}</span>
                      <button
                        type="button"
                        aria-pressed={state === "allow"}
                        onClick={() => toggle(p.key, "allow")}
                        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-medium transition ${state === "allow" ? "bg-emerald-600 text-white" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 hover:bg-emerald-100"}`}
                        title="اجازه"
                      >
                        <Check size={12} strokeWidth={3} />
                      </button>
                      <button
                        type="button"
                        aria-pressed={state === "deny"}
                        onClick={() => toggle(p.key, "deny")}
                        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-medium transition ${state === "deny" ? "bg-red-600 text-white" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 hover:bg-red-100"}`}
                        title="ممنوع (حتی اگر نقش اجازه دهد)"
                      >
                        <X size={12} strokeWidth={3} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedUser && (
        <p className="text-xs text-zinc-400 mt-3">
          نقش پایه: <span className="badge-gray">{selectedUser.role}</span> — تغییرات بعد از ذخیره فوراً روی همه مسیرهای API اعمال می‌شود.
        </p>
      )}
    </section>
  );
}
