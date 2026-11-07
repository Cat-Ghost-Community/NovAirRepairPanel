"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {EmptyState} from '@/components/ui';
import { Icon } from "@/components/icon";
import { toFaDigits } from "@/lib/format";

export type ShellItem = { id: string; title: string; icon: string; group: string; keywords?: string };

/**
 * پوستهٔ تنظیمات: در هر لحظه فقط یک بخش نشان داده می‌شود (صفحهٔ کوتاه و مرتب).
 * بخش انتخاب‌شده در `#بخش` آدرس نگه داشته می‌شود تا رفرش و لینک اشتراکی همان جا باز کند.
 */
export function SettingsShell({ items, panes }: { items: ShellItem[]; panes: Record<string,ReactNode> }) {
  const [active, setActive] = useState(items[0]?.id ?? "");
  const [q, setQ] = useState("");

  // همگام‌سازی با هش آدرس (ورود از لینک یا دکمه‌های خلاصهٔ بالای صفحه)
  useEffect(() => {
    const apply = () => {
      const id = window.location.hash.replace("#", "");
      if (id && items.some((i) => i.id === id)) setActive(id);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [items]);

  const go = (id: string) => {
    setActive(id);
    if (window.location.hash !== `#${id}`) window.history.replaceState(null, "", `#${id}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const filtered = useMemo(() => {
    const needle = q.trim();
    if (!needle) return items;
    return items.filter((i) => i.title.includes(needle) || (i.keywords ?? "").includes(needle));
  }, [items, q]);

  const groups = useMemo(() => {
    const map = new Map<string, ShellItem[]>();
    for (const i of filtered) map.set(i.group, [...(map.get(i.group) ?? []), i]);
    return [...map.entries()];
  }, [filtered]);

  const activeIndex = Math.max(0, items.findIndex((i) => i.id === active));
  const current = items[activeIndex];
  const currentPane=panes[current?.id];

  const search = (id:string) => (
    <div className="relative">
      <Icon name="search" size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400" />
      <input
        id={id}
        className="input pr-9"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="جستجوی تنظیمات… مثلاً مالیات، شعبه، گارانتی"
        aria-label="جستجوی تنظیمات"
        autoComplete="off"
      />
    </div>
  );

  const tabButton = (item: ShellItem, compact = false) => {
    const on = item.id === active;
    return (
      <button
        key={item.id}
        type="button"
        role="tab"
        id={`tab-${item.id}${compact ? '-mobile' : ''}`}
        aria-selected={on}
        aria-controls={`pane-${item.id}`}
        onClick={() => go(item.id)}
        className={
          compact
            ? `${on ? "btn-primary" : "btn-secondary"} btn-sm shrink-0`
            : `flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-right text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${
                on
                  ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`
        }
      >
        <Icon name={item.icon} size={15} className={compact ? "" : "shrink-0 opacity-70"} />
        <span className={compact ? "" : "min-w-0 flex-1 truncate"}>{item.title}</span>
      </button>
    );
  };

  return (
    <div className="mt-5 grid min-w-0 grid-cols-1 items-start gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
      {/* موبایل و تبلت: نوار تب چسبان */}
      <div className="sticky top-14 z-20 -mx-4 mb-1 min-w-0 border-b border-zinc-200 bg-zinc-50/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:hidden dark:border-zinc-800 dark:bg-zinc-950/95">
        {search('settings-search-mobile')}
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="بخش‌های تنظیمات">
          {filtered.map((i) => tabButton(i, true))}
          {filtered.length === 0 && <span className="py-1 text-xs text-zinc-500">بخشی با این نام پیدا نشد.</span>}
        </div>
      </div>

      {/* دسکتاپ: فهرست تب‌ها */}
      <aside className="hidden self-start lg:sticky lg:top-20 lg:block">
        <div className="space-y-3">
          <div className="card card-pad">
            <label className="label" htmlFor="settings-search">جستجو در تنظیمات</label>
            {search('settings-search')}
            <div className="mt-3 space-y-3" role="tablist" aria-label="بخش‌های تنظیمات" aria-orientation="vertical">
              {groups.map(([group, list]) => (
                <div key={group}>
                  <div className="mb-1 px-1 text-[11px] font-semibold text-zinc-400 dark:text-zinc-500">{group}</div>
                  <div className="space-y-0.5">{list.map((i) => tabButton(i))}</div>
                </div>
              ))}
              {filtered.length === 0 && (
                <p className="px-1 py-2 text-xs text-zinc-500">تنظیمی با این نام پیدا نشد — عبارت دیگری را امتحان کنید.</p>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* در هر لحظه فقط یک بخش */}
      <div className="min-w-0">
        <div id={`pane-${current?.id}`} role="tabpanel" aria-labelledby={`tab-${current?.id}`}>
          {currentPane??<EmptyState title="بخش تنظیمات یافت نشد" body="صفحه را دوباره بارگذاری کنید؛ اگر مشکل ادامه داشت به مدیر سامانه اطلاع دهید."/>}
        </div>

        {items.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <button type="button" className="btn-secondary btn-sm" disabled={activeIndex === 0} onClick={() => go(items[activeIndex - 1].id)}>
              <Icon name="chevron-right" size={15} /> {activeIndex > 0 ? items[activeIndex - 1].title : "بخش قبلی"}
            </button>
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              بخش {toFaDigits(activeIndex + 1)} از {toFaDigits(items.length)}
            </span>
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={activeIndex === items.length - 1}
              onClick={() => go(items[activeIndex + 1].id)}
            >
              {activeIndex < items.length - 1 ? items[activeIndex + 1].title : "بخش بعدی"} <Icon name="chevron-left" size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
