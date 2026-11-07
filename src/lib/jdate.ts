/** ابزار تقویم جلالی — مبتنی بر toJalaali/toGregorian در format.ts (تقویم رسمی persian) */
import { toJalaali, toGregorian } from "./format";

export { toJalaali, toGregorian };

/** طول ماه جلالی (روزهای ماه) — اسفند کبیسه ۳۰ روز */
export function jalaaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  // کبیسه: اگر ۳۰ اسفند واقعاً همان ۳۰ اسفند باشد (نه ۱ فروردین سال بعد)، سال کبیسه است
  const g = toGregorian(jy, 12, 30);
  const back = toJalaali(g.gy, g.gm, g.gd);
  return back.jy === jy && back.jm === 12 && back.jd === 30 ? 30 : 29;
}

/** ایندکس روز هفته برای روز اول ماه جلالی: شنبه=۰ … جمعه=۶ */
export function jWeekdayIndexOfMonthStart(jy: number, jm: number): number {
  const g = toGregorian(jy, jm, 1);
  const d = new Date(Date.UTC(g.gy, g.gm - 1, g.gd));
  // JS: 0=Sunday … 6=Saturday → شنبه=6 → 0
  const jsDay = d.getUTCDay();
  return (jsDay + 1) % 7;
}

/** ایندکس روز هفته یک روز مشخص جلالی */
export function jWeekdayIndex(jy: number, jm: number, jd: number): number {
  const g = toGregorian(jy, jm, jd);
  const d = new Date(Date.UTC(g.gy, g.gm - 1, g.gd));
  return (d.getUTCDay() + 1) % 7;
}

/** امروز به شمسی */
export function todayJ(): { jy: number; jm: number; jd: number } {
  const now = new Date();
  return toJalaali(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** امروز ISO (تهران) */
export function todayISODate(): string {
  return new Date(Date.now() + 3.5 * 3600 * 1000).toISOString().slice(0, 10);
}

export const J_MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
