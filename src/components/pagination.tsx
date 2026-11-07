import Link from "next/link";
import { toFaDigits } from "@/lib/format";
import { PAGE_SIZES, PER_PAGE } from "@/lib/pagination";

/**
 * صفحه‌بندی — همهٔ پارامترهای جستجو (فیلترها، جستجو، مرتب‌سازی) حفظ می‌شوند.
 * - خلاصهٔ بازه «از X تا Y از Z» به‌جای شمارش کل ردیف‌ها
 * - «…» برای صفحات میانیِ خارج از دید + پرش به اولین/آخرین صفحه
 * - انتخابگر تعداد ردیف در هر صفحه (۲۰ / ۵۰ / ۱۰۰)
 * - در موبایل فقط «قبلی/بعدی» + شمارهٔ صفحهٔ جاری نمایش داده می‌شود
 */
export function Pagination({
  base,
  sp,
  page,
  totalPages,
  total,
  perPage,
  defaultPerPage = PER_PAGE,
  showSizePicker = true,
  unit = "ردیف",
}: {
  base: string;
  sp: Record<string, string | string[] | undefined>;
  page: number;
  totalPages: number;
  total: number;
  perPage: number;
  /** اندازهٔ پیش‌فرض — اگر کاربر چیز دیگری انتخاب کرده، در لینک‌ها حفظ می‌شود */
  defaultPerPage?: number;
  showSizePicker?: boolean;
  /** واژهٔ واحد شمارش در خلاصهٔ بازه — مثلاً «پذیرش» یا «سند» */
  unit?: string;
}) {
  if (total === 0) return null;

  const href = (p: number, size?: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      const val = Array.isArray(v) ? v[0] : v;
      if (val && k !== "page" && k !== "perPage") q.set(k, val);
    }
    if (p > 1) q.set("page", String(p));
    // اندازهٔ صفحه همیشه حمل می‌شود مگر پیش‌فرض باشد — تا با زدن «بعدی» از دست نرود
    const effSize = size ?? perPage;
    if (effSize !== defaultPerPage) q.set("perPage", String(effSize));
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };

  const from = (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);

  // پنجرهٔ صفحات با «…» برای صفحات میانیِ خارج از دید
  const items: Array<number | "gap"> = [];
  const win = 1;
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= page - win && p <= page + win)) {
      items.push(p);
    } else if (items[items.length - 1] !== "gap") {
      items.push("gap");
    }
  }

  const btn =
    "inline-flex h-8 min-w-8 items-center justify-center rounded-lg border px-2.5 text-xs font-medium transition " +
    "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 " +
    "hover:bg-zinc-50 dark:hover:bg-zinc-800 " +
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500";

  const navBtn = `${btn} px-3`;

  return (
    <nav
      className="flex flex-col gap-3 border-t border-zinc-200 px-3 py-3 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between sm:px-4"
      aria-label="صفحه‌بندی"
    >
      {/* خلاصهٔ بازه */}
      <p className="text-xs text-zinc-500">
        نمایش{" "}
        <span className="font-medium tabular-nums text-zinc-700 dark:text-zinc-300">
          {toFaDigits(from)}–{toFaDigits(to)}
        </span>{" "}
        از{" "}
        <span className="font-medium tabular-nums text-zinc-700 dark:text-zinc-300">{toFaDigits(total)}</span>{" "}
        {unit}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 sm:justify-end">
        {/* انتخاب تعداد ردیف در هر صفحه */}
        {showSizePicker && total > PAGE_SIZES[0] ? (
          <div className="flex shrink-0 items-center gap-1 text-xs text-zinc-500">
            <span className="hidden sm:inline">در صفحه:</span>
            {PAGE_SIZES.map((n) => (
              <Link
                key={n}
                href={href(1, n)}
                aria-current={perPage === n ? "true" : undefined}
                title={`${toFaDigits(n)} ردیف در هر صفحه`}
                className={`inline-flex h-7 min-w-[2rem] items-center justify-center rounded-md border px-1.5 tabular-nums transition ${
                  perPage === n
                    ? "border-brand-500 bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                    : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                }`}
              >
                {toFaDigits(n)}
              </Link>
            ))}
          </div>
        ) : null}

        {/* شمارهٔ صفحات — در موبایل خلاصه می‌شود */}
        {totalPages > 1 && (
          <div className="flex flex-wrap items-center gap-1">
            {page > 1 && (
              <>
                <Link href={href(page > 3 ? 1 : page - 1)} className={`${navBtn} hidden sm:inline-flex`} aria-label="صفحهٔ اول">
                  «
                </Link>
                <Link href={href(page - 1)} className={navBtn} rel="prev">
                  قبلی
                </Link>
              </>
            )}

            {items.map((it, i) =>
              it === "gap" ? (
                <span key={`g${i}`} className="select-none px-1 text-xs text-zinc-400">
                  …
                </span>
              ) : (
                <Link
                  key={it}
                  href={href(it)}
                  aria-current={it === page ? "page" : undefined}
                  aria-label={`صفحهٔ ${toFaDigits(it)}`}
                  className={`${btn} tabular-nums ${it === page ? "border-brand-600 bg-brand-600 font-semibold text-white hover:bg-brand-700" : ""}`}
                >
                  {toFaDigits(it)}
                </Link>
              ),
            )}

            {page < totalPages && (
              <>
                <Link href={href(page + 1)} className={navBtn} rel="next">
                  بعدی
                </Link>
                <Link
                  href={href(page < totalPages - 2 ? totalPages : page + 1)}
                  className={`${navBtn} hidden sm:inline-flex`}
                  aria-label="صفحهٔ آخر"
                >
                  »
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}