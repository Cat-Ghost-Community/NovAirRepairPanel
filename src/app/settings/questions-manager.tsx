"use client";

import { SearchableSelect } from "@/components/searchable-select";


import { useEffect, useState } from "react";
import { useToast } from "@/components/ui";
import { DragSortList } from "@/components/drag-sort-list";
import { toFaDigits } from "@/lib/format";

type Question = { id: number; label: string; type: string; options: string; is_required: number; is_active?: number; sort: number };

const TYPE_FA: Record<string, string> = {
  text: "متن کوتاه", textarea: "متن بلند", select: "چندگزینه‌ای",
  boolean: "بله/خیر", number: "عدد", date: "تاریخ (تقویم شمسی)",
};

/** جدا کردن گزینه‌ها با «،» فارسی، «,» انگلیسی یا «؛» + حذف تکراری و خالی */
function splitOpts(s: string): string[] {
  return [...new Set(s.split(/[،,؛\n]/).map((x) => x.trim()).filter(Boolean))];
}

export function QuestionsManager() {
  const toast = useToast();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [label, setLabel] = useState("");
  const [type, setType] = useState("text");
  const [options, setOptions] = useState("");
  const [required, setRequired] = useState(false);
  const [editing, setEditing] = useState<Question | null>(null);

  const load = () => {
    fetch("/api/intake-questions?all=1").then((r) => r.json()).then((d) => setQuestions(d.questions ?? [])).catch(() => {});
  };
  useEffect(load, []);

  const parsedPreview = type === "select" ? splitOpts(options) : [];

  const add = async () => {
    if (!label.trim()) return;
    if (type === "select" && parsedPreview.length < 2) {
      toast("برای سوال چندگزینه‌ای حداقل ۲ گزینه جدا کنید (با «،»)", "error");
      return;
    }
    const res = await fetch("/api/intake-questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, type, options: type === "select" ? parsedPreview : [], is_required: required }),
    });
    if (res.ok) {
      toast("سوال اضافه شد");
      setLabel(""); setOptions(""); setRequired(false);
      load();
    } else toast("خطا در افزودن سوال", "error");
  };

  const saveEdit = async () => {
    if (!editing || !editing.label.trim()) return;
    const opts = editing.type === "select" ? splitOpts(editing.options || "") : [];
    if (editing.type === "select" && opts.length < 2) {
      toast("برای سوال چندگزینه‌ای حداقل ۲ گزینه لازم است", "error");
      return;
    }
    const res = await fetch("/api/intake-questions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editing.id, label: editing.label, type: editing.type, options: opts, is_required: !!editing.is_required }),
    });
    if (res.ok) {
      toast("سوال ویرایش شد");
      setEditing(null);
      load();
    } else toast("خطا در ویرایش سوال", "error");
  };

  const remove = async (id: number) => {
    const res = await fetch(`/api/intake-questions?id=${id}`, { method: "DELETE" });
    if (res.ok) { toast("سوال حذف شد"); load(); }
  };

  const reorder = async (orderedIds: number[]) => {
    // بهینه‌سازی خوش‌بینانه: ترتیب محلی فوراً عوض می‌شود، سپس ذخیره
    const map = new Map(questions.map((q) => [q.id, q]));
    setQuestions(orderedIds.map((id) => map.get(id)!).filter(Boolean));
    const res = await fetch("/api/intake-questions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: orderedIds }),
    });
    if (res.ok) toast("ترتیب سوالات ذخیره شد");
    else { toast("خطا در ذخیره ترتیب", "error"); load(); }
  };

  const toggleActive = async (q: Question) => {
    const res = await fetch("/api/intake-questions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: q.id, is_active: q.is_active === 0 ? 1 : 0 }),
    });
    if (res.ok) load();
  };

  const parsedOf = (raw: string | null): string[] => {
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return [...new Set(arr.flatMap((s: string) => splitOpts(String(s))))].filter(Boolean);
    } catch {
      return splitOpts(raw);
    }
    return [];
  };

  return (
    <div className="px-4 py-4 sm:px-5">
      {!editing && (
        <div className="grid sm:grid-cols-[1fr_auto] gap-2 items-end">
          <div>
            <label className="label" htmlFor="q-label">متن سوال</label>
            <input id="q-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="مثلاً آیا دستگاه قبلاً تعمیر شده؟" />
          </div>
          <div>
            <label className="label" htmlFor="q-type">نوع</label>
            <SearchableSelect id="q-type" className="input w-48" value={type} onChange={(e) => setType(e.target.value)}>
              {Object.entries(TYPE_FA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </SearchableSelect>
          </div>
          {type === "select" && (
            <div className="sm:col-span-2">
              <label className="label" htmlFor="q-opts">گزینه‌ها (با «،» جدا کنید)</label>
              <input id="q-opts" className="input" value={options} onChange={(e) => setOptions(e.target.value)} placeholder="مثلاً: خیر، بله در همین تعمیرگاه، بله در جای دیگر" />
              {parsedPreview.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {parsedPreview.map((o) => <span key={o} className="badge-gray">{o}</span>)}
                  <span className="text-xs text-zinc-400 self-center">{parsedPreview.length} گزینه</span>
                </div>
              )}
            </div>
          )}
          <label className="flex items-center gap-1.5 text-sm pb-2">
            <input type="checkbox" className="h-4 w-4" checked={required} onChange={(e) => setRequired(e.target.checked)} /> اجباری
          </label>
          <button className="btn-primary btn-sm" onClick={add} disabled={!label.trim()}>افزودن</button>
        </div>
      )}

      {/* ویرایش سوال */}
      {editing && (
        <div className="rounded-lg border border-brand-300 dark:border-brand-700 p-3 space-y-3 bg-brand-50/40 dark:bg-brand-500/5">
          <div className="text-[13px] font-semibold">ویرایش سوال #{editing.id}</div>
          <div className="grid sm:grid-cols-[1fr_auto] gap-2 items-end">
            <div>
              <label className="label">متن سوال</label>
              <input className="input" value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} />
            </div>
            <div>
              <label className="label">نوع</label>
              <SearchableSelect className="input w-48" value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value })}>
                {Object.entries(TYPE_FA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </SearchableSelect>
            </div>
            {editing.type === "select" && (
              <div className="sm:col-span-2">
                <label className="label">گزینه‌ها (با «،» جدا کنید)</label>
                <input className="input" value={editing.options ?? ""} onChange={(e) => setEditing({ ...editing, options: e.target.value })} />
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {parsedOf(editing.options).map((o) => <span key={o} className="badge-gray">{o}</span>)}
                </div>
              </div>
            )}
            <label className="flex items-center gap-1.5 text-sm pb-2">
              <input type="checkbox" className="h-4 w-4" checked={!!editing.is_required} onChange={(e) => setEditing({ ...editing, is_required: e.target.checked ? 1 : 0 })} /> اجباری
            </label>
          </div>
          <div className="flex gap-2 justify-end">
            <button className="btn-secondary btn-sm" onClick={() => setEditing(null)}>انصراف</button>
            <button className="btn-primary btn-sm" onClick={saveEdit}>ذخیره تغییرات</button>
          </div>
        </div>
      )}

      <div className="mt-3">
        {questions.length > 0 && (
          <p className="text-xs text-zinc-400 mb-2">برای تغییر ترتیب نمایش در فرم پذیرش، سوال‌ها را با دستگیره ⠿ بکشید و رها کنید.</p>
        )}
        <DragSortList
          items={questions}
          onReorder={reorder}
          renderItem={(q, handle) => {
            const opts = q.type === "select" ? parsedOf(q.options) : [];
            return (
              <div className={`flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-2 bg-white dark:bg-zinc-900 ${q.is_active === 0 ? "opacity-50" : ""}`}>
                {handle}
                <span className="text-sm flex-1 min-w-40">
                  {q.label}
                  {opts.length > 0 && <span className="text-xs text-zinc-400 block mt-0.5">گزینه‌ها: {opts.join(" · ")}</span>}
                </span>
                {q.is_required ? <span className="badge-red">اجباری</span> : <span className="badge-gray">اختیاری</span>}
                <span className="badge-blue">{TYPE_FA[q.type] ?? q.type}</span>
                <button className="text-xs text-brand-600 hover:underline" onClick={() => setEditing({ ...q, is_required: q.is_required })}>ویرایش</button>
                {q.is_active !== undefined && (
                  <button className="text-xs text-zinc-500 hover:underline" onClick={() => toggleActive(q)}>{q.is_active === 0 ? "فعال‌سازی" : "غیرفعال"}</button>
                )}
                <button className="text-xs text-red-500 hover:underline" onClick={() => remove(q.id)}>حذف</button>
              </div>
            );
          }}
        />
        {questions.length === 0 && <p className="text-sm text-zinc-400">هنوز سوالی تعریف نشده است.</p>}
      </div>
    </div>
  );
}
