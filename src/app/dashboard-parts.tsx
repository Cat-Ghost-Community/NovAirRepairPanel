import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icon";

const TONES: Record<string, string> = {
  brand: "bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300",
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300",
  emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300",
  red: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300",
  purple: "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300",
  zinc: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

export type Tone = keyof typeof TONES;

/** پهنای هر ویجت در شبکهٔ ۶ ستونی داشبورد (کلاس ثابت تا Tailwind آن را بسازد) */
export const WIDGET_SPAN: Record<string, string> = {
  quick: "lg:col-span-6",
  queue: "lg:col-span-4",
  charts: "lg:col-span-4",
  shopStats: "lg:col-span-4",
  money: "lg:col-span-2",
  upcoming: "lg:col-span-2",
  inventory: "lg:col-span-2",
  statusChart: "lg:col-span-2",
  recentPayments: "lg:col-span-2",
  secondary: "lg:col-span-2",
};

/** پنل داشبورد: سرصفحهٔ ثابت ۴۸ پیکسلی با آیکون/عنوان/نشان شمارش و بدنهٔ هم‌ارتفاع (اختیاری اسکرول‌دار) */
export function Panel({
  title,
  icon,
  tone = "zinc",
  href,
  hrefLabel = "همه",
  badge,
  scroll = false,
  className = "",
  bodyClassName,
  children,
}: {
  title: string;
  icon: string;
  tone?: Tone;
  href?: string;
  hrefLabel?: string;
  badge?: ReactNode;
  scroll?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section className={`card flex h-full flex-col overflow-hidden ${className}`}>
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-zinc-100 px-4 sm:px-5 dark:border-zinc-800/70">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${TONES[tone]}`} aria-hidden>
            <Icon name={icon} size={15} />
          </span>
          <h2 className="truncate text-[14px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{title}</h2>
          {badge != null && badge !== "" && <span className="badge-gray tabular-nums">{badge}</span>}
        </div>
        {href && (
          <Link href={href} className="btn-ghost btn-sm shrink-0">
            {hrefLabel} <Icon name="chevron-left" size={14} />
          </Link>
        )}
      </header>
      <div className={`min-w-0 flex-1 ${scroll ? "max-h-[340px] overflow-y-auto" : ""} ${bodyClassName ?? "p-4 sm:p-5"}`}>{children}</div>
    </section>
  );
}

/** کاشی شاخص کلیدی — هم‌ارتفاع، با آیکون و رنگ معنایی */
export function KpiTile({
  href,
  icon,
  label,
  value,
  tone = "brand",
  alert = false,
}: {
  href?: string;
  icon: string;
  label: string;
  value: string | number;
  tone?: Tone;
  alert?: boolean;
}) {
  return (
    <Link
      href={href ?? "#"}
      className={`kpi flex h-full items-center gap-3 transition-colors hover:border-brand-300 dark:hover:border-brand-700 ${
        alert ? "ring-1 ring-amber-400" : ""
      }`}
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${TONES[tone]}`} aria-hidden>
        <Icon name={icon} size={19} />
      </span>
      <span className="min-w-0">
        <span className="kpi-label block truncate">{label}</span>
        <span className={`kpi-value block !text-xl sm:!text-[22px] ${alert ? "text-amber-600 dark:text-amber-400" : ""}`}>{value}</span>
      </span>
    </Link>
  );
}

/** آمار کوچک داخل پنل‌ها — اندازه و فاصلهٔ یکدست */
export function MiniStat({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex min-h-[68px] flex-col justify-between rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
      <div className="flex items-center gap-1.5 text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
        <Icon name={icon} size={12} className="shrink-0 opacity-60" />
        <span className="truncate">{label}</span>
      </div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}
