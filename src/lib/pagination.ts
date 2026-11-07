// این ماژول عمداً هیچ وابستگی به دیتابیس/Node ندارد تا کامپوننت‌های
// سمت کلاینت هم بتوانند بدون مشکل bundle آن را import کنند.

export const PER_PAGE = 50;

/** اندازه‌های صفحه که در انتخابگر صفحه‌بندی به کاربر پیشنهاد می‌شود */
export const PAGE_SIZES = [20, 50, 100] as const;

/** پارامترهای صفحه‌بندی از searchParams — صف شروع از ۱ */
export function pageParams(sp: URLSearchParams, defaultPerPage = PER_PAGE) {
  const page = Math.max(1, Math.floor(Number(sp.get("page")) || 1));
  const perPage = Math.min(200, Math.max(1, Math.floor(Number(sp.get("perPage")) || defaultPerPage)));
  return { page, perPage, offset: (page - 1) * perPage };
}

/** متادیتای صفحه‌بندی برای پاسخ */
export function pageMeta(page: number, perPage: number, total: number) {
  return { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) };
}

type SearchLike = URLSearchParams | Record<string, string | string[] | undefined>;

function toSearchParams(sp: SearchLike): URLSearchParams {
  if (sp instanceof URLSearchParams) return sp;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val != null && val !== "") q.set(k, val);
  }
  return q;
}

/**
 * صفحه‌بندی کامل برای صفحات فهرست: پارامترها را می‌خواند و صفحه را
 * داخل بازهٔ معتبر (بر اساس تعداد کل) نگه می‌دارد تا «از X تا Y» هرگز
 * از محدودهٔ واقعی داده بیرون نزند.
 */
export function resolvePaging(sp: SearchLike, total: number, defaultPerPage = PER_PAGE) {
  const q = toSearchParams(sp);
  const { perPage } = pageParams(q, defaultPerPage);
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(1, Math.floor(Number(q.get("page")) || 1)), totalPages);
  return { page, perPage, offset: (page - 1) * perPage, totalPages, total };
}

/** شمارش کل یک کوئری — شکل SQL باید بدون ORDER BY/LIMIT باشد */
export function countOf(db: any, sql: string, params: any[] = []): number {
  const countSql = `SELECT COUNT(*) c FROM (${sql})`;
  return Number(db.prepare(countSql).get(...params)?.c ?? 0);
}

