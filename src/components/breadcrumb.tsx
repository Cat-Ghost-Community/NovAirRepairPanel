import Link from "next/link";

/** breadcrumb فارسی — آرایه‌ای از {label, href?}؛ آخرین آیتم بدون لینک */
export function Breadcrumb({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <nav aria-label="مسیر" className="flex items-center gap-1.5 text-xs text-zinc-400 mb-3">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span aria-hidden>‹</span>}
          {it.href ? (
            <Link href={it.href} className="hover:text-brand-600 hover:underline">{it.label}</Link>
          ) : (
            <span className="text-zinc-600 dark:text-zinc-300 font-medium">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
