import { getSetting } from "@/lib/repair";
import { assertOutboundUrl } from "./outbound";

/**
 * تاریخچه وضعیت مرسوله پستی از سامانه رهگیری پست ایران.
 * - چند endpoint شناخته‌شده به‌ترتیب امتحان می‌شود (در صورت در دسترس بودن)
 * - URL سفارشی از تنظیمات: settings → postal_api_url (با {code}) — مثلاً وب‌سرویس apieco
 * - کش ۱۰ دقیقه‌ای در حافظه تا صفحه پیگیری کند نشود
 * - در صورت خطا/عدم دسترسی: آرایه خالی برمی‌گردد و رابط فقط لینک رهگیری دستی را نشان می‌دهد
 */
export type PostalEvent = { title: string; date: string; location?: string };

const cache = new Map<string, { t: number; events: PostalEvent[] | null }>();
const CACHE_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 4000;

function extractEvents(data: any): PostalEvent[] {
  // جستجوی بازگشتی: اولین آرایه‌ای از آبجکت‌هایی که شبیه رویداد رهگیری‌اند
  const looksLikeEvent = (o: any) =>
    o && typeof o === "object" && !Array.isArray(o) &&
    Object.keys(o).some((k) => /date|time/i.test(k)) &&
    Object.keys(o).some((k) => /desc|status|title|state|event|details/i.test(k));

  const found: any[] = [];
  const walk = (v: any, depth = 0) => {
    if (found.length || depth > 6) return;
    if (Array.isArray(v)) {
      if (v.length > 0 && v.every(looksLikeEvent)) { found.push(...v); return; }
      v.forEach((x) => walk(x, depth + 1));
    } else if (v && typeof v === "object") {
      Object.values(v).forEach((x) => walk(x, depth + 1));
    }
  };
  walk(data);

  return found
    .map((e) => ({
      title: String(e.desc ?? e.description ?? e.status ?? e.title ?? e.event ?? e.EventDesc ?? e.Status ?? "").trim(),
      date: String(e.date ?? e.Date ?? e.eventDate ?? e.SendDate ?? e.datetime ?? e.DateTime ?? "").trim(),
      location: e.location ?? e.city ?? e.office ?? e.Location ?? undefined,
    }))
    .filter((e) => e.title);
}

export async function fetchPostalEvents(code: string): Promise<PostalEvent[]> {
  const clean = String(code ?? "").trim();
  if (!clean) return [];

  const hit = cache.get(clean);
  if (hit && Date.now() - hit.t < CACHE_MS) return hit.events ?? [];

  const endpoints: string[] = [];
  // endpoint سفارشی از تنظیمات (مثلاً وب‌سرویس apieco با کلید)
  const custom = getSetting("postal_api_url", "");
  if (custom) endpoints.push(custom.replace("{code}", encodeURIComponent(clean)));
  endpoints.push(
    `https://tracking.post.ir/api/v1/track/${encodeURIComponent(clean)}`,
    `https://tracking.post.ir/api/Track?code=${encodeURIComponent(clean)}`,
  );

  // همه endpointها به‌صورت موازی — حداکثر انتظار = TIMEOUT_MS (نه به‌ازای هر endpoint)
  const attempts = await Promise.allSettled(
    endpoints.map(async (url) => {
      const res = await fetch(assertOutboundUrl(url), {
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Accept: "application/json", "User-Agent": "RePaird/1.0 (+tracking)" },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { throw new Error("non-json"); }
      const events = extractEvents(data);
      if (events.length === 0) throw new Error("no events");
      return events;
    })
  );

  for (const a of attempts) {
    if (a.status === "fulfilled") {
      cache.set(clean, { t: Date.now(), events: a.value });
      return a.value;
    }
  }

  cache.set(clean, { t: Date.now(), events: null });
  return [];
}
