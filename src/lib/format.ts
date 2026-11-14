/** این ماژول باید در سرور و کلاینت قابل استفاده باشد — هیچ وابستگی به node:sqlite ندارد */
import { multiplyRial,moneyInputRial } from "@/lib/money";

/** Convert sqlite rows (null-prototype objects) into plain JSON-safe objects for client components */
export function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null));
}

export function plainRows<T>(rows: T[]): T[] {
  return JSON.parse(JSON.stringify(rows));
}

/* ------------------------------------------------------------------ */
/* واحد پول (ریال / تومان) — مقدار جهانی که در layout تنظیم می‌شود     */
/* همه مبالغ در دیتابیس به «ریال» ذخیره می‌شوند (عدد صحیح، بدون اعشار)  */
/* ------------------------------------------------------------------ */

export type CurrencyUnit = "rial" | "toman";

let CURRENCY_UNIT: CurrencyUnit = "toman";

export function setCurrencyUnit(u: CurrencyUnit) {
  if (u === "rial" || u === "toman") CURRENCY_UNIT = u;
}

export function getCurrencyUnit(): CurrencyUnit {
  return CURRENCY_UNIT;
}

/** خواندن واحد پول از تنظیمات (فقط سمت سرور — در layout از setCurrencyUnit استفاده کنید) */
export function loadCurrencyUnit(): CurrencyUnit {
  // پیاده‌سازی سرور در src/lib/currency-server.ts است تا این فایل کلاینت‌پسند بماند
  return CURRENCY_UNIT;
}

/** تبدیل عدد از واحد نمایش به ریال (برای ذخیره‌سازی) */
export function displayToRial(v: number, unit: CurrencyUnit = CURRENCY_UNIT): number {
  return multiplyRial(unit === "toman" ? 10 : 1, v);
}
/** Parse raw form text before any Number conversion, preserving the last rial.
 * Reject sub-rial values and nonnumeric text rather than stripping or rounding. */
export function parseMoneyInput(value:string,unit:CurrencyUnit=CURRENCY_UNIT,allowZero=false):number {
  const text=toEnDigits(value).trim().replace(/٬/g,',').replace(/٫/g,'.');
  if(text.includes(',')&&!/^\d{1,3}(?:,\d{3})+$/.test(text.split('.')[0]))throw new Error('جداکنندهٔ هزارگان معتبر نیست.');
  if(text.split('.').slice(1).some(part=>part.includes(',')))throw new Error('جداکنندهٔ اعشار معتبر نیست.');
  return moneyInputRial(text.replace(/,/g,''),unit,allowZero);
}

/** تبدیل ریال به واحد نمایش */
export function rialToDisplay(rial: number, unit: CurrencyUnit = CURRENCY_UNIT): number {
  return unit === "toman" ? rial / 10 : rial;
}

/* ---------------------------- اعداد فارسی ---------------------------- */

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

export function toFaDigits(s: string | number): string {
  return String(s).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
}

export function toEnDigits(s: string): string {
  return String(s)
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

/** جداکننده هزارگان با ارقام فارسی */
export function faNum(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(Number(n))) return "۰";
  return toFaDigits(Math.round(Number(n)).toLocaleString("en-US"));
}

/** تعداد: حفظ شش رقم اعشار مجاز؛ نمایش نباید مقدار کسری را صفر کند. */
export function faQty(n: number | null |undefined): string {
  if (n === null || n === undefined || isNaN(Number(n))) return "۰";
  const v = Number(n);
  const s = v % 1 === 0 ? v.toFixed(0) : v.toFixed(6).replace(/\.?0+$/, "");
  return toFaDigits(s);
}

/* ------------------------------- پول -------------------------------- */

function canonicalDisplayNumber(value: number|bigint, unit: CurrencyUnit, grouping: boolean): string {
  // Keep the last rial even near MAX_SAFE_INTEGER; dividing a Number by ten
  // can lose the fractional toman at that magnitude.
  if (typeof value==='bigint'||Number.isSafeInteger(value)) {
    const signed = BigInt(value);
    const amount = signed < BigInt(0) ? -signed : signed;
    const divisor = BigInt(unit === "toman" ? 10 : 1);
    let whole = String(amount / divisor);
    if (grouping) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const fraction = amount % divisor;
    return `${value < 0 ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
  }
  // Some legacy report expressions still produce fractional rials. Formatting
  // them does not certify or mutate their accounting basis.
  return (unit === "toman" ? value / 10 : value).toLocaleString("en-US", { useGrouping: grouping, maximumFractionDigits: 2 });
}

/** قالب اصلی مبالغ: ورودی ریال، خروجی بر اساس واحد فعال */
export function fmtMoney(rial: number|bigint | null | undefined, unit?: CurrencyUnit): string {
  const u = unit ?? CURRENCY_UNIT;
  return `${fmtMoneyNumber(rial,u)} ${currencyUnitLabel(u)}`;
}

/** Printed tables put the unit in the column heading without changing precision. */
export function fmtMoneyNumber(rial:number|bigint|null|undefined,unit:CurrencyUnit=CURRENCY_UNIT):string{
  return toFaDigits(canonicalDisplayNumber(rial??0,unit,true));
}
export function currencyUnitLabel(unit:CurrencyUnit=CURRENCY_UNIT):string{
  return unit==='toman'?'تومان':'ریال';
}

/** فقط عدد (بدون واحد) بر اساس واحد فعال — برای فرم‌ها */
export function moneyDisplayValue(rial: number | null | undefined, unit?: CurrencyUnit): string {
  const u = unit ?? CURRENCY_UNIT;
  return canonicalDisplayNumber(rial ?? 0, u, false);
}

/** خلاصه مبالغ بزرگ: ۱۲٫۵ میلیون تومان */
export function fmtMoneyShort(rial: number | null | undefined, unit?: CurrencyUnit): string {
  const u = unit ?? CURRENCY_UNIT;
  const v = rialToDisplay(rial ?? 0, u);
  const label = u === "toman" ? "تومان" : "ریال";
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${toFaDigits((v / 1_000_000_000).toFixed(1).replace(/\.0$/, ""))} میلیارد ${label}`;
  if (abs >= 1_000_000) return `${toFaDigits((v / 1_000_000).toFixed(1).replace(/\.0$/, ""))} میلیون ${label}`;
  if (abs >= 10_000) return `${faNum(v / 1000)} هزار ${label}`;
  return `${faNum(v)} ${label}`;
}

/* --------------------------- تاریخ شمسی ----------------------------- */

/* استفاده از Intl.DateTimeFormat با تقویم persian — دقیق و مطابق تقویم رسمی ایران */

const faParts = (date: Date) => {
  const fmt = new Intl.DateTimeFormat("en-US", { calendar: "persian", timeZone: "UTC", year: "numeric", month: "numeric", day: "numeric" });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { jy: get("year"), jm: get("month"), jd: get("day") };
};

export function toJalaali(gy: number, gm: number, gd: number) {
  return faParts(new Date(Date.UTC(gy, gm - 1, gd, 12)));
}

export function toGregorian(jy: number, jm: number, jd: number) {
  // جستجوی دودویی روی روز میلادی — اولین روزی که jy/jm/jd یا بعدش باشد
  let lo = Date.UTC(jy + 620, 0, 1, 12);
  // بالای بازه باید تا پایان اسفند (تا ۲۰/۲۱ مارس سال بعد) پوشش دهد
  let hi = Date.UTC(jy + 622, 3, 1, 12);
  while (hi - lo > 43200000) {
    const mid = Math.floor((lo + hi) / 2);
    const p = faParts(new Date(mid));
    const before = p.jy < jy || (p.jy === jy && (p.jm < jm || (p.jm === jm && p.jd < jd)));
    if (before) lo = mid; else hi = mid;
  }
  const d = new Date(hi);
  return { gy: d.getUTCFullYear(), gm: d.getUTCMonth() + 1, gd: d.getUTCDate() };
}

export const JALALI_MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
export const WEEK_DAYS = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];
const WEEK_SHORT = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

export function parseDate(d: string | Date | null | undefined): Date | null {
  if (!d) return null;
  if (d instanceof Date) return isNaN(d.getTime()) ? null : d;
  const s = String(d).trim();
  // yyyy-mm-dd یا yyyy-mm-dd HH:MM:SS → UTC (بدون وابستگی به فرمت دقیق)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/);
  if (m) {
    // اگر ساعت/دقیقه در رشته نبود، ساعت ۱۲ در نظر گرفته می‌شود (رفتار قبلی برای تاریخ خام)
    const base = new Date(
      Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
        Number(m[4] ?? 12), Number(m[5] ?? 0), Number(m[6] ?? 0)),
    );
    if (base.getUTCFullYear() !== Number(m[1]) || base.getUTCMonth()+1 !== Number(m[2]) || base.getUTCDate() !== Number(m[3])
      || Number(m[4] ?? 12) > 23 || Number(m[5] ?? 0) > 59 || Number(m[6] ?? 0) > 59) return null;
    if (m[7]) {
      const zoned = new Date(s.replace(" ","T"));
      return Number.isNaN(zoned.getTime()) ? null : zoned;
    }
    return base;
  }
  const date = new Date(s);
  return isNaN(date.getTime()) ? null : date;
}

function presentationDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { calendar:"persian", timeZone:"Asia/Tehran", year:"numeric", month:"numeric", day:"numeric" }).formatToParts(date);
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value);
  return { jy:value("year"), jm:value("month"), jd:value("day") };
}

/** تاریخ شمسی: ۱۴۰۴/۰۷/۰۱ */
export function fmtDate(d: string | Date | null | undefined): string {
  const date = parseDate(d);
  if (!date) return "—";
  const j = presentationDate(date);
  return toFaDigits(`${j.jy}/${String(j.jm).padStart(2, "0")}/${String(j.jd).padStart(2, "0")}`);
}

/** تاریخ بلند: ۱ مهر ۱۴۰۴ */
export function fmtDateLong(d: string | Date | null | undefined): string {
  const date = parseDate(d);
  if (!date) return "—";
  const j = presentationDate(date);
  return `${toFaDigits(j.jd)} ${JALALI_MONTHS[j.jm - 1]} ${toFaDigits(j.jy)}`;
}

/** تاریخ و ساعت شمسی: ۱۴۰۴/۰۷/۰۱ - ۱۴:۳۰ */
export function fmtDateTime(d: string | Date | null | undefined): string {
  const date = parseDate(d);
  if (!date) return "—";
  const clock = new Intl.DateTimeFormat("fa-IR", { timeZone:"Asia/Tehran", hour:"2-digit", minute:"2-digit", hourCycle:"h23" }).format(date);
  return `${fmtDate(date)} - ${clock}`;
}

/** «۳ دقیقه پیش» به فارسی */
export function timeAgo(d: string | Date | null | undefined): string {
  const date = parseDate(d);
  if (!date) return "—";
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "همین الان";
  if (mins < 60) return `${toFaDigits(mins)} دقیقه پیش`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${toFaDigits(hrs)} ساعت پیش`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${toFaDigits(days)} روز پیش`;
  return fmtDate(date);
}

export function daysSince(d: string | null | undefined): number {
  if (!d) return 0;
  const date = parseDate(d);
  if (!date) return 0;
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

/** رشته ISO (yyyy-mm-dd) از تاریخ شمسی — برای ذخیره در دیتابیس */
export function jalaaliToISO(jy: number, jm: number, jd: number): string {
  const g = toGregorian(jy, jm, jd);
  return `${g.gy}-${String(g.gm).padStart(2, "0")}-${String(g.gd).padStart(2, "0")}`;
}

/** تاریخ امروز به شمسی */
export function todayJalaali() {
  const now = new Date();
  return toJalaali(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** ISO تاریخ امروز به وقت تهران (+3:30) */
export function todayISO(): string {
  const now = new Date(Date.now() + 3.5 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}

export { WEEK_SHORT };
