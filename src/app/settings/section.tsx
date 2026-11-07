import type { ReactNode } from "react";
import { Icon } from "@/components/icon";
import { toFaDigits } from "@/lib/format";

type Tone = "brand" | "amber" | "emerald" | "red" | "zinc" | "purple";

const TONES: Record<Tone, string> = {
  brand: "bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300",
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300",
  emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300",
  red: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300",
  purple: "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300",
  zinc: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

/**
 * قالب یکدست هر بخش تنظیمات: شماره، آیکون، عنوان، توضیح، نشان و بدنه.
 * سربرگ را همین قالب می‌سازد تا هیچ بخشی سرصفحهٔ اختصاصی و ناهمگون نداشته باشد.
 */
export function SettingsSection({
  id,
  index,
  icon,
  title,
  desc,
  badge,
  tone = "brand",
  children,
}: {
  id: string;
  index: number;
  icon: string;
  title: string;
  desc: string;
  badge?: ReactNode;
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-24 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-shadow hover:shadow dark:border-zinc-800 dark:bg-zinc-900"
    >
      <header className="flex flex-wrap items-start gap-3 border-b border-zinc-100 bg-zinc-50/70 px-4 py-4 sm:px-5 dark:border-zinc-800/70 dark:bg-zinc-900/60">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${TONES[tone]}`} aria-hidden>
          <Icon name={icon} size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-zinc-200/70 px-2 py-0.5 text-[10px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              {toFaDigits(index)}
            </span>
            <h2 className="text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{title}</h2>
            {badge}
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-zinc-500 dark:text-zinc-400">{desc}</p>
        </div>
      </header>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** کاشی خلاصه در سربرگ صفحه — با لنگر به بخش مربوطه می‌پرد */
export function SettingsStat({
  href,
  icon,
  label,
  value,
  tone = "zinc",
}: {
  href: string;
  icon: string;
  label: string;
  value: string;
  tone?: Tone;
}) {
  return (
    <a
      href={href}
      className="group flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 transition-colors hover:border-brand-300 hover:bg-brand-50/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-brand-700 dark:hover:bg-brand-500/5"
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TONES[tone]}`} aria-hidden>
        <Icon name={icon} size={17} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">{label}</span>
        <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{value}</span>
      </span>
    </a>
  );
}
