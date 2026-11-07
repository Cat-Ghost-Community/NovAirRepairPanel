"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { EmptyState } from "@/components/ui";
import { Icon } from "@/components/icon";
import { JalaliDatePicker } from "@/components/jalali-date-picker";
import { AssignModal, type AssignModalItem } from "@/components/assign-modal";
import { RepairQueueCard } from "@/components/repair-queue-card";
import { PHASE_META, type AssignTicketCard, type TechnicianOption } from "@/lib/assign-shared";
import { Checkbox } from "@/components/checkbox";
import { reconcileAssignmentSelection, selectAssignmentRange } from "@/lib/assignment-selection";
import { workflowError } from "@/lib/repair-workflow-shared";

type DashboardData = {paging?:{page:number;totalPages:number;total:number}; summary?:{awaiting:number;assigned:number;in_progress:number}; awaiting: AssignTicketCard[]; assigned: AssignTicketCard[]; technicians: TechnicianOption[] };

/**
 * کارتابل مدیر شعبه — دو ستون زنده بر اساس وضعیت ذخیره‌شده:
 * «در انتظار ارجاع» و «ارجاع‌شده به تعمیرکار» + جست‌وجوی سراسری + ارجاع تکی و گروهی.
 */
export function AssignmentClient({native=false}:{native?:boolean}={}) {
  const router = useRouter();
  const initial = useSearchParams();
  const [q, setQ] = useState(() => initial.get("q") ?? "");
  const [dateFrom, setDateFrom] = useState(() => initial.get("from") ?? "");
  const [dateTo, setDateTo] = useState(() => initial.get("to") ?? "");
  const [phase,setPhase]=useState(()=>initial.get("phase")??"");
  const [page,setPage]=useState(() => Math.max(1, Number(initial.get("page")) || 1));
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection,setSelection]=useState<Map<number,AssignTicketCard>>(new Map());
  const selected=useMemo(()=>new Set(selection.keys()),[selection]);
  const selectionRef=useRef(selection);
  const anchor=useRef<number|null>(null);
  const [notice,setNotice]=useState("");
  const changeSelection=useCallback((next:Map<number,AssignTicketCard>)=>{selectionRef.current=next;setSelection(next);},[]);
  const [modalItems, setModalItems] = useState<AssignModalItem[] | null>(null);
  const [mobileColumn, setMobileColumn] = useState<"awaiting" | "assigned" | null>(null);
  const debounceRef = useRef<number | null>(null);
  const request = useRef<AbortController | null>(null);
  // مقدار اولیه = آدرس فعلی همان mount تا در بار اول، replace و RSC fetch بی‌مورد رخ ندهد
  const lastUrlRef = useRef<string>(
    `/repairs/assignment${(() => {
      const p = new URLSearchParams();
      const q0 = initial.get("q");
      const f0 = initial.get("from");
      const t0 = initial.get("to");
      if (q0) p.set("q", q0);
      if (f0) p.set("from", f0);
      if (t0) p.set("to", t0);
      const qs = p.toString();
      return qs ? `?${qs}` : "";
    })()}`
  );

  // جست‌وجو در URL می‌ماند تا با بازگشت از صفحهٔ دستگاه، نتیجه حفظ شود
  const syncUrl = useCallback(
    (nextQ: string, nextFrom: string, nextTo: string, nextPage: number) => {
      const params = new URLSearchParams();
      if (nextQ.trim()) params.set("q", nextQ.trim());
      if (nextFrom) params.set("from", nextFrom);
      if (nextTo) params.set("to", nextTo);
      if (phase) params.set("phase",phase);
      if (nextPage > 1) params.set("page", String(nextPage));
      const qs = params.toString();
      const url = `/repairs/assignment${qs ? `?${qs}` : ""}`;
      if (url === lastUrlRef.current) return;
      lastUrlRef.current = url;
      router.replace(url, { scroll: false });
    },
    [router,phase]
  );

  const load = useCallback(async (opts?: { keepSelection?: boolean }) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const params = new URLSearchParams({page:String(page)});
      if (q.trim()) params.set("q", q.trim());
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      if (phase) params.set("phase",phase);
      const response = await fetch(`/api/repairs/assignment?${params.toString()}`, { signal: controller.signal });
      const d = await response.json();
      if (!response.ok) throw new Error(d?.error ?? "بارگذاری کارتابل ناموفق بود.");
      if (controller.signal.aborted) return;
      setData(d);
      if (d.paging) setPage(d.paging.page);
      setError(null);
      if (!opts?.keepSelection) changeSelection(new Map());
      else {
        const retained=reconcileAssignmentSelection(selectionRef.current,[...d.awaiting,...d.assigned]);
        if(retained.size<selectionRef.current.size)setNotice('انتخاب دستگاه‌های تغییرکرده یا خارج‌شده از این صفحه لغو شد؛ فهرست را بازبینی کنید.');
        changeSelection(retained);
      }
    } catch (e: any) {
      if (controller.signal.aborted) return;
      setError(workflowError(e,"بارگذاری کارتابل ناموفق بود؛ ارتباط را بررسی و دوباره تلاش کنید."));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [q, dateFrom, dateTo,page,phase,changeSelection]);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      syncUrl(q, dateFrom, dateTo, page);
      void load();
    }, 350);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      request.current?.abort();
    };
  }, [load, q, dateFrom, dateTo, page, syncUrl]);

  const cardsById = useMemo(() => {
    const m = new Map<number, AssignTicketCard>();
    for (const c of data?.awaiting ?? []) m.set(c.id, c);
    for (const c of data?.assigned ?? []) m.set(c.id, c);
    return m;
  }, [data]);

  const toggle = (id: number,shift=false) => {
    const list=window.matchMedia('(min-width: 1280px)').matches?[...(data?.awaiting??[]),...(data?.assigned??[])]:data?.awaiting.some(card=>card.id===id)?data.awaiting:data?.assigned??[];
    changeSelection(selectAssignmentRange(selectionRef.current,list,id,anchor.current,shift));
    anchor.current=id;
  };

  const toggleAll = (list: AssignTicketCard[]) => {
    const next=new Map(selectionRef.current),allSelected=list.length>0&&list.every(card=>next.has(card.id));
    for(const card of list){if(allSelected)next.delete(card.id);else next.set(card.id,card);}
    changeSelection(next);
  };

  const toModalItem = (c: AssignTicketCard): AssignModalItem => ({
    id: c.id,
    number: c.number,
    customer_name: c.customer_name,
    device_label: [c.device_brand, c.device_model].filter(Boolean).join(" ") || "دستگاه",
    expect: c.technician_id,branch_id:c.branch_id,version:c.assignment_version,workflow_revision:c.workflow_revision,
    technician_name: c.technician_name,
    phase: c.phase,
  });

  const openSingle = (c: AssignTicketCard) => setModalItems([toModalItem(c)]);
  const openBulk = () => {
    const items = [...selected].map((id) => cardsById.get(id)).filter(Boolean) as AssignTicketCard[];
    if (items.length === 0) return;
    setModalItems(items.map(toModalItem));
  };

  const clearFilters = () => {
    setPage(1); changeSelection(new Map()); setLoading(true);setPhase("");
    setQ("");
    setDateFrom("");
    setDateTo("");
  };
  const hasFilter = q.trim().length > 0 || dateFrom || dateTo || phase;
  const mixedBranches = new Set([...selected].map(id => cardsById.get(id)?.branch_id)).size > 1;
  const filterChanged = (update: () => void) => { setPage(1); setMobileColumn(null); changeSelection(new Map()); anchor.current=null;setNotice("");setLoading(true); update(); };
  const pageChanged=(next:number)=>{changeSelection(new Map());anchor.current=null;setLoading(true);setPage(next);};
  const visibleColumn = mobileColumn ?? (data?.awaiting.length ? "awaiting" : "assigned");

  return (
    <div className="mx-auto flex min-w-0 max-w-[1600px] flex-col gap-4 p-4 sm:p-6" aria-busy={loading}>
      <div className="card min-w-0 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="page-title">کارتابل ارجاع</h1>
            <p className="mt-1 text-sm leading-6 text-zinc-500">پذیرش‌ها را اولویت‌بندی کنید؛ انتخاب تکی یا گروهی، ارجاع کنترل‌شده و پیگیری مسئول هر دستگاه.</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary btn-sm" disabled={loading} onClick={() => void load({ keepSelection: true })} title="تازه‌سازی">
              <Icon name="refresh" size={14} />
              تازه‌سازی
            </button>
          </div>
        </div>

        {/* جست‌وجوی سراسری — روی هر دو ستون */}
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-0 basis-full sm:basis-64 flex-1">
            <label className="label" htmlFor="assign-q">جست‌وجوی دستگاه، مشتری یا مدل</label>
            <span className="relative block">
              <Icon name="search" size={15} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                id="assign-q"
                className="input !pr-8"
                value={q}
                onChange={(e) => filterChanged(() => setQ(e.target.value))}
                placeholder="شماره پذیرش، نام مشتری، برند/مدل، IMEI، سریال یا موبایل…"
              />
            </span>
          </div>
          <div className="min-w-0 flex-1 basis-28 sm:max-w-44">
            <label className="label" htmlFor="assign-from">پذیرش از تاریخ</label>
            <JalaliDatePicker value={dateFrom} onChange={v => filterChanged(() => setDateFrom(v))} id="assign-from" />
          </div>
          <div className="min-w-0 flex-1 basis-28 sm:max-w-44">
            <label className="label" htmlFor="assign-to">تا تاریخ</label>
            <JalaliDatePicker value={dateTo} onChange={v => filterChanged(() => setDateTo(v))} id="assign-to" />
          </div>
          {hasFilter && (
            <button className="btn-ghost btn-sm mb-0.5" onClick={clearFilters}>
              <Icon name="x" size={14} />
              پاک‌کردن جست‌وجو
            </button>
          )}
        </div>
      </div>

      {data && <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4" aria-label="خلاصه کارتابل">
        {[
          ["پذیرش در نتایج", data.paging?.total ?? data.awaiting.length + data.assigned.length],
          ["منتظر ارجاع · کل نتایج", data.summary?.awaiting ?? data.awaiting.length],
          ["در حال تعمیر · کل نتایج", data.summary?.in_progress ?? data.assigned.filter(c => c.phase === "in_progress").length],
          ["تعمیرکار در محدوده شعبه", data.technicians.length],
        ].map(([label, count]) => <div className="card min-w-0 p-3 sm:p-4" key={label}><p className="text-xs text-zinc-500">{label}</p><p className="mt-2 text-xl font-bold tabular-nums">{Number(count).toLocaleString("fa-IR")}</p></div>)}
      </div>}

      <nav className="flex flex-wrap gap-2" aria-label="فیلتر مرحله ارجاع">
        {([['','همه پذیرش‌ها'],['awaiting','در انتظار ارجاع'],['assigned','شروع‌نشده'],['in_progress','در حال تعمیر']] as const).map(([value,label])=><button key={value} className={`filter-chip ${phase===value?'filter-chip-active':'filter-chip-idle'}`} aria-pressed={phase===value} onClick={()=>filterChanged(()=>setPhase(value))}>{label}{value&&data?.summary&&<span className="opacity-75">{data.summary[value].toLocaleString('fa-IR')}</span>}</button>)}
      </nav>

      {data&&!error&&<div className="card flex min-w-0 flex-wrap items-center justify-between gap-2 px-3 py-1.5">
        <Checkbox label="انتخاب همهٔ این صفحه" checked={cardsById.size>0&&selected.size===cardsById.size} indeterminate={selected.size>0&&selected.size<cardsById.size} disabled={loading||!cardsById.size} onCheckedChange={()=>toggleAll([...cardsById.values()])}><span className="text-sm font-medium">انتخاب این صفحه</span></Checkbox>
        <p className="text-xs leading-6 text-zinc-500">انتخاب‌ها محدود به همین صفحه‌اند · برای انتخاب بازه، Shift را نگه دارید.</p>
      </div>}
      {notice&&<p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-6 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">{notice}</p>}

      {/* نوار اقدام گروهی */}
      {selected.size > 0 && (
        <div className="sticky top-0 z-30 flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 shadow-sm dark:border-brand-500/30 dark:bg-zinc-900">
          <span className="text-sm font-medium text-brand-800 dark:text-brand-300">
            تعداد دستگاه‌های انتخاب‌شده: {selected.size.toLocaleString("fa-IR")}
          </span>
          <button className="btn-primary btn-sm" disabled={loading || mixedBranches || !!error} onClick={openBulk}>
            <Icon name="user-check" size={14} />
            ارجاع به تعمیرکار
          </button>
          <button className="btn-ghost btn-sm" onClick={() => changeSelection(new Map())}>لغو انتخاب</button>
          {mixedBranches && <div className="w-full space-y-2"><p role="status" className="text-xs text-amber-700 dark:text-amber-300">برای ارجاع گروهی، دستگاه‌های یک شعبه را نگه دارید:</p><div className="flex flex-wrap gap-2">{[...new Set([...selection.values()].map(c=>c.branch_id))].map(branch=><button key={branch} className="btn-secondary btn-sm max-w-full whitespace-normal" onClick={()=>changeSelection(new Map([...selection].filter(([,card])=>card.branch_id===branch)))}>فقط { [...selection.values()].find(c=>c.branch_id===branch)?.branch_name ?? 'این شعبه'}</button>)}</div></div>}
        </div>
      )}

      {data?.paging&&<div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-zinc-500">{data.paging.total.toLocaleString('fa-IR')} پذیرش · صفحه {data.paging.page.toLocaleString('fa-IR')} از {data.paging.totalPages.toLocaleString('fa-IR')}</span><div className="flex items-center gap-2"><button className="btn-secondary btn-sm" disabled={page<=1||loading} onClick={()=>pageChanged(page-1)}>قبلی</button><button className="btn-secondary btn-sm" disabled={page>=data.paging.totalPages||loading} onClick={()=>pageChanged(page+1)}>بعدی</button></div></div>}
      <div className="min-w-0">
        {error && (
          <div className="card mb-4 border-red-200 p-4 text-center dark:border-red-500/30">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <button className="btn-secondary btn-sm mt-2" onClick={() => void load({ keepSelection: true })}>تلاش دوباره</button>
          </div>
        )}
        {loading && !data && (
          <div className="grid gap-4 lg:grid-cols-2">
            {[0, 1].map((col) => (
              <div key={col} className="space-y-3">
                <div className="skeleton h-10 w-48" />
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton h-28 w-full" />
                ))}
              </div>
            ))}
          </div>
        )}

        {data && !error && (
          <>
          <nav className="mb-3 grid grid-cols-2 gap-2 xl:hidden" aria-label="نمایش ستون کارتابل">
            {([['awaiting','در انتظار ارجاع'],['assigned','ارجاع‌شده']] as const).map(([key,label]) => <button key={key} className={visibleColumn === key ? "btn-primary" : "btn-secondary"} aria-pressed={visibleColumn === key} onClick={() => setMobileColumn(key)}>{label} <span className="text-xs">{data[key].length.toLocaleString('fa-IR')}</span></button>)}
          </nav>
          <div className={`grid min-w-0 items-start gap-4 xl:grid-cols-2 ${loading ? "pointer-events-none opacity-50" : ""}`} inert={loading}>
            <Column
              active={visibleColumn === "awaiting"}
              title="در انتظار ارجاع"
              phase="awaiting"
              count={data.awaiting.length}
              emptyBody={hasFilter ? "با این جست‌وجو دستگاهی در انتظار ارجاع پیدا نشد." : "در این صفحه دستگاهی در انتظار ارجاع نیست؛ صفحه‌های دیگر را هم بررسی کنید."}
              list={data.awaiting}
              selected={selected}
              onToggle={toggle}
              onToggleAll={toggleAll}
              onAssign={openSingle}
            />
            <Column
              active={visibleColumn === "assigned"}
              title="ارجاع‌شده به تعمیرکار"
              phase="assigned"
              count={data.assigned.length}
              emptyBody={hasFilter ? "با این جست‌وجو دستگاهی در این ستون پیدا نشد." : "دستگاهی ارجاع نشده است — از ستون کنار ارجاع دهید."}
              list={data.assigned}
              selected={selected}
              onToggle={toggle}
              onToggleAll={toggleAll}
              onAssign={openSingle}
            />
          </div>
          </>
        )}
      </div>

      {modalItems && (
        <AssignModal
          open
          items={modalItems}
          onClose={() => setModalItems(null)}
          onDone={() => void load({ keepSelection: true })}
        />
      )}
    </div>
  );
}

function Column({
  active,
  title,
  phase,
  count,
  list,
  emptyBody,
  selected,
  onToggle,
  onToggleAll,
  onAssign,
}: {
  active: boolean;
  title: string;
  phase: "awaiting" | "assigned";
  count: number;
  list: AssignTicketCard[];
  emptyBody: string;
  selected: Set<number>;
  onToggle: (id: number,shiftKey?:boolean) => void;
  onToggleAll: (list: AssignTicketCard[]) => void;
  onAssign: (c: AssignTicketCard) => void;
}) {
  const meta = PHASE_META[phase];
  const allSelected = list.length > 0 && list.every((c) => selected.has(c.id));
  const someSelected = list.some(c=>selected.has(c.id));
  return (
    <section className={`${active ? "" : "hidden xl:block"} min-w-0 rounded-2xl border border-zinc-200 bg-zinc-100/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/40`} aria-label={title}>
      <header className="mb-3 flex flex-wrap items-center gap-2 px-1">
        <span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} aria-hidden />
        <h2 className="text-[15px] font-bold">{title}</h2>
        <span className="badge-gray" title="تعداد در این صفحه">{count.toLocaleString("fa-IR")}</span>
        <span className="flex-1" />
        {list.length > 0 && (
          <Checkbox label={`انتخاب همهٔ ستون ${title}`} checked={allSelected} indeterminate={someSelected&&!allSelected} onCheckedChange={()=>onToggleAll(list)}><span className="text-xs text-zinc-500">انتخاب ستون</span></Checkbox>
        )}
      </header>
      {list.length === 0 ? (
        <EmptyState icon={phase === "awaiting" ? "clipboard-check" : "user-check"} title="موردی نیست" body={emptyBody} />
      ) : (
        <div className="space-y-2.5">
          {list.map((c) => (
            <RepairQueueCard
              key={c.id}
              card={c}
              selectable
              selected={selected.has(c.id)}
              onToggleSelect={onToggle}
              canAssign
              onAssign={onAssign}
            />
          ))}
        </div>
      )}
    </section>
  );
}
