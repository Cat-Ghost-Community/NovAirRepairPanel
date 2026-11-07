"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import type { JourneyEvent, JourneySummary } from "@/lib/journey";
import { fmtDateTime, timeAgo } from "@/lib/format";

const KIND_META: Record<JourneyEvent["kind"], { icon: string; tone: string; label: string }> = {
  accept: { icon: "inbox", tone: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300", label: "پذیرش" },
  assign: { icon: "user-check", tone: "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400", label: "ارجاع" },
  reassign: { icon: "refresh", tone: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400", label: "ارجاع مجدد" },
  status: { icon: "activity", tone: "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400", label: "وضعیت" },
  transfer: { icon: "reply-all", tone: "bg-purple-50 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400", label: "انتقال" },
  time: { icon: "timer", tone: "bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-400", label: "زمان کار" },
  note: { icon: "pencil", tone: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300", label: "یادداشت" },
  item: { icon: "package", tone: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400", label: "قطعه/اجرت" },
  attachment: { icon: "paperclip", tone: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300", label: "پیوست" },
  estimate: { icon: "clipboard-check", tone: "bg-cyan-50 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-400", label: "برآورد" },
  invoice: { icon: "receipt", tone: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400", label: "فاکتور" },
  payment: { icon: "banknote", tone: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400", label: "پرداخت" },
  message: { icon: "chat", tone: "bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400", label: "ارتباط" },
  warranty: { icon: "shield", tone: "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400", label: "گارانتی" },
  delivery: { icon: "truck", tone: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400", label: "تحویل" },
  audit: { icon: "shield", tone: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300", label: "رخداد" },
};

/** دکمهٔ «مسیر تعمیر» + کشوی خط زمانی کامل — از هرجا که جزئیات دستگاه باز می‌شود قابل استفاده است */
export function JourneyButton({
  ticketId,
  ticketNumber,
  compact,
  className,
}: {
  ticketId: number;
  ticketNumber?: string;
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className={`btn-secondary btn-sm text-[11px] no-underline ${compact ? "!h-7 !px-2" : "inline-flex items-center gap-1.5"} ${className ?? ""}`}
        onClick={() => setOpen(true)}
        title="مسیر تعمیر — تاریخچهٔ کامل فعالیت‌ها"
      >
        <Icon name="route" size={12} />
        مسیر تعمیر
      </button>
      {open && <JourneyDrawer ticketId={ticketId} ticketNumber={ticketNumber} onClose={() => setOpen(false)} />}
    </>
  );
}

export function JourneyDrawer({ ticketId, ticketNumber, onClose }: { ticketId: number; ticketNumber?: string; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<JourneyEvent[]>([]);
  const [summary, setSummary] = useState<JourneySummary | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/repairs/${ticketId}/journey`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "بارگذاری مسیر تعمیر ناموفق بود.");
      setEvents(data.events ?? []);
      setSummary(data.summary ?? null);
    } catch (e: any) {
      setError(e?.message ?? "بارگذاری مسیر تعمیر ناموفق بود.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="مسیر تعمیر">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full flex-col bg-white shadow-2xl sm:w-[520px] dark:bg-zinc-900">
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
          <div className="flex min-w-0 items-center gap-2">
            <Icon name="route" size={17} className="shrink-0 text-brand-600" />
            <h3 className="truncate text-sm font-semibold">مسیر تعمیر {ticketNumber ? <span className="font-mono text-zinc-400">· {ticketNumber}</span> : null}</h3>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button className="btn-ghost btn-sm btn-icon" onClick={() => void load()} aria-label="بارگذاری مجدد" title="بارگذاری مجدد">
              <Icon name="refresh" size={15} />
            </button>
            <button className="btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="بستن">
              <Icon name="x" size={16} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {loading && (
            <div className="space-y-3" role="status" aria-label="در حال بارگذاری">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex gap-3">
                  <div className="skeleton h-8 w-8 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <div className="skeleton h-4 w-2/3" />
                    <div className="skeleton h-3 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {error && !loading && (
            <div className="py-10 text-center">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              <button className="btn-secondary btn-sm mt-2" onClick={() => void load()}>تلاش دوباره</button>
            </div>
          )}

          {!loading && !error && summary && (
            <>
              <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-zinc-200 p-3 text-xs sm:grid-cols-3 dark:border-zinc-800">
                <Milestone label="پذیرش" at={summary.accepted_at} icon="inbox" />
                <Milestone label="ارجاع" at={summary.assigned_at} icon="user-check" />
                <Milestone label="شروع تعمیر" at={summary.started_at} icon="wrench" />
                <Milestone label="آماده تحویل" at={summary.completed_at} icon="package-check" />
                <Milestone label="تحویل" at={summary.delivered_at} icon="truck" />
                <div className="col-span-2 sm:col-span-1">
                  <div className="text-[10px] text-zinc-400">وضعیت فعلی</div>
                  <div className="mt-0.5 truncate font-medium" style={summary.status_color ? { color: summary.status_color } : undefined}>
                    {summary.status_name ?? "—"}
                  </div>
                  {summary.technician_name && <div className="text-[10px] text-zinc-400">تعمیرکار: {summary.technician_name}</div>}
                </div>
              </div>

              {events.length === 0 ? (
                <p className="py-8 text-center text-sm text-zinc-400">رویدادی برای این دستگاه ثبت نشده است.</p>
              ) : (
                <ol className="relative space-y-4 border-r border-zinc-200 pr-5 dark:border-zinc-800">
                  {events.map((ev) => {
                    const meta = KIND_META[ev.kind] ?? KIND_META.audit;
                    return (
                      <li key={ev.key} className="relative">
                        <span className={`absolute -right-[31px] flex h-6 w-6 items-center justify-center rounded-full ${meta.tone}`}>
                          <Icon name={meta.icon} size={12} />
                        </span>
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="text-[11px] font-semibold text-zinc-400">{meta.label}</span>
                          <span className="text-[11px] text-zinc-400" title={ev.at}>
                            {fmtDateTime(ev.at)} · {timeAgo(ev.at)}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[13px] font-medium leading-6">{ev.title}</div>
                        {ev.detail && <div className="mt-0.5 whitespace-pre-wrap break-words text-xs leading-5 text-zinc-500 dark:text-zinc-400" dir="auto">{ev.detail}</div>}
                        {(ev.actor_name || ev.meta?.reason) && (
                          <div className="mt-0.5 text-[11px] text-zinc-400">
                            {ev.actor_name ? `مسئول عملیات: ${ev.actor_name}` : ""}
                            {ev.meta?.reason && ev.actor_name ? " · " : ""}
                            {ev.meta?.reason ? `دلیل: ${ev.meta.reason}` : ""}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function Milestone({ label, at, icon }: { label: string; at: string | null; icon: string }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[10px] text-zinc-400">
        <Icon name={icon} size={10} />
        {label}
      </div>
      <div className={`mt-0.5 font-medium ${at ? "" : "text-zinc-300 dark:text-zinc-600"}`}>
        {at ? `${fmtDateTime(at)}` : "—"}
      </div>
    </div>
  );
}
