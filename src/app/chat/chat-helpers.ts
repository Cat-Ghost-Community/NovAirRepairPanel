"use client";

/**
 * ابزارهای سمت کلاینت چت — قالب‌بندی زمان/روز، فراخوانی API با خطای فارسی،
 * متن غنی (منشن/لینک) و نگاشت رنگ و حرف اول آواتار.
 */

const pendingChatKeys=new Map<string,string>();
/** Keep an uncertain request's identity through a retry/reload; confirmed results retire it. */
export async function chatMutationIdentity(url:string,payload:string|ArrayBuffer){
  const input=typeof payload==='string'?new TextEncoder().encode(payload):new Uint8Array(payload),prefix=new TextEncoder().encode(url+'\n'),joined=new Uint8Array(prefix.length+input.length);joined.set(prefix);joined.set(input,prefix.length);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',joined)),byte=>byte.toString(16).padStart(2,'0')).join(''),storageKey='repaid.chat.pending.'+digest;
  let key=pendingChatKeys.get(storageKey);try{key=key??sessionStorage.getItem(storageKey)??undefined;}catch{/* Memory identity remains available when browser storage is disabled. */}
  key=key??crypto.randomUUID();pendingChatKeys.set(storageKey,key);try{sessionStorage.setItem(storageKey,key);}catch{/* No credentials or message bodies are stored. */}
  return {key,confirm(){if(pendingChatKeys.get(storageKey)===key)pendingChatKeys.delete(storageKey);try{if(sessionStorage.getItem(storageKey)===key)sessionStorage.removeItem(storageKey);}catch{/* Browser storage is optional. */}}};
}
export async function chatFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const headers=new Headers(init?.headers),mutation=!['GET','HEAD'].includes((init?.method??'GET').toUpperCase());
  let requestBody=init?.body,logicalBody=typeof requestBody==='string'?requestBody:'',messageBody:Record<string,unknown>|null=null;
  if(mutation&&/\/api\/chat\/conversations\/\d+\/messages(?:\?|$)/.test(url)&&typeof requestBody==='string'){
    try{const parsed:unknown=JSON.parse(requestBody);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)){messageBody=parsed as Record<string,unknown>;const {client_key:ignoredClientKey,...logical}=messageBody;void ignoredClientKey;logicalBody=JSON.stringify(logical);}}catch{/* Invalid JSON remains subject to server validation. */}
  }
  const identity=mutation&&!headers.has('idempotency-key')?await chatMutationIdentity(url,logicalBody):null;
  if(identity&&messageBody)requestBody=JSON.stringify({...messageBody,client_key:identity.key});
  if(init?.body&&!headers.has('Content-Type'))headers.set('Content-Type','application/json');if(identity)headers.set('idempotency-key',identity.key);
  const res = await fetch(url, {
    ...init,
    body:requestBody,
    headers,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if(data!=null&&(res.ok||res.status>=400&&res.status<500&&![401,403,408,425,429].includes(res.status)))identity?.confirm();
  if (!res.ok) {
    throw new Error(data?.error ?? "ارتباط برقرار نشد — دوباره تلاش کنید.");
  }
  if(data==null)throw new Error('پاسخ سرور معتبر نیست؛ با همان درخواست دوباره تلاش کنید.');
  return data as T;
}

function toFa(s: string | number): string {
  return String(s).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

/** ساعت UTC ذخیره‌شده در دیتابیس → HH:MM به وقت محلی مرورگر */
export function fmtClock(dt: string | null | undefined): string {
  if (!dt) return "";
  const d = parseUtc(dt);
  if (!d) return "";
  return toFa(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
}

export function parseUtc(dt: string): Date | null {
  if (!dt) return null;
  const s = dt.includes("T") ? dt : dt.replace(" ", "T") + "Z";
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function dayKey(dt: string): string {
  const d = parseUtc(dt);
  if (!d) return "";
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** «امروز» / «دیروز» / تاریخ شمسی */
export function dayLabel(dt: string): string {
  const d = parseUtc(dt);
  if (!d) return "";
  const today = new Date();
  const y = new Date(today.getTime() - 86400000);
  const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return "امروز";
  if (same(d, y)) return "دیروز";
  return jalaliShort(d);
}

function jalaliShort(d: Date): string {
  try {
    const parts = new Intl.DateTimeFormat("fa-IR", { year: "numeric", month: "long", day: "numeric" }).format(d);
    return parts;
  } catch {
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  }
}

export function initials(name: string): string {
  return (name ?? "?").split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("");
}

const AVATAR_COLORS = ["#0ea5e9", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#ef4444", "#6366f1", "#14b8a6"];

export function colorFor(name: string, color?: string | null): string {
  if (color) return color;
  let h = 0;
  for (const ch of name ?? "") h = (h * 31 + ch.charCodeAt(0)) % 997;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function presenceText(online?: boolean, lastSeen?: string | null): string {
  if (online) return "آنلاین";
  if (!lastSeen) return "آفلاین";
  const d = parseUtc(lastSeen);
  if (!d) return "آفلاین";
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 2) return "آخرین فعالیت: همین الان";
  if (mins < 60) return `آخرین فعالیت: ${toFa(mins)} دقیقه پیش`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `آخرین فعالیت: ${toFa(hrs)} ساعت پیش`;
  return `آخرین فعالیت: ${jalaliShort(d)}`;
}

/** یافتن منشن‌ها و لینک‌ها در متن — بدون HTML، فقط قطعه‌بندی برای رندر React */
export type BodyPart = { type: "text" | "link" | "mention"; text: string; userId?: number };

export function splitBody(text: string, mentionNames: Array<{ id: number; name: string }>): BodyPart[] {
  if (!text) return [];
  const sorted = [...mentionNames].filter((m) => m.name).sort((a, b) => b.name.length - a.name.length);
  const pattern = ["(https?:\\/\\/[^\\s]+)"];
  const names = sorted.map((m) => `@${escapeRe(m.name)}`);
  if (names.length) pattern.push(`(${names.join("|")})`);
  const re = new RegExp(pattern.join("|"), "g");
  const parts: BodyPart[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ type: "text", text: text.slice(last, m.index) });
    if (m[0].startsWith("http")) parts.push({ type: "link", text: m[0] });
    else {
      const name = m[0].slice(1);
      const found = sorted.find((x) => x.name === name);
      parts.push({ type: "mention", text: m[0], userId: found?.id });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: "text", text: text.slice(last) });
  return parts;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const MONTHLY_MUTE_OPTIONS: Array<{ label: string; minutes: number | null }> = [
  { label: "۱ ساعت", minutes: 60 },
  { label: "۸ ساعت", minutes: 480 },
  { label: "۱ هفته", minutes: 7 * 24 * 60 },
  { label: "همیشه", minutes: null },
];
