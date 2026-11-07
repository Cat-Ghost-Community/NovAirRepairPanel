/**
 * ثابت‌ها و نوع‌های امن‌ برای مرورگر — نباید هیچ وابستگی به دیتابیس داشته باشند،
 * وگرنه `node:sqlite` به باندل کلاینت کشیده می‌شود و بیلد شکست می‌خورد.
 */

export const MOODS: Array<{ value: number; emoji: string; label: string; ring: string }> = [
  { value: 5, emoji: "🤩", label: "عالی", ring: "ring-emerald-400" },
  { value: 4, emoji: "🙂", label: "خوب", ring: "ring-lime-400" },
  { value: 3, emoji: "😐", label: "معمولی", ring: "ring-amber-400" },
  { value: 2, emoji: "😕", label: "خسته", ring: "ring-orange-400" },
  { value: 1, emoji: "😣", label: "سخت", ring: "ring-red-400" },
];

export const moodByValue = (v: number | null | undefined) =>
  MOODS.find((m) => m.value === Number(v)) ?? MOODS[2];

/** یک روز از داده‌های واقعیِ کارِ کارمند */
export type DayActivity = {
  workedMinutes: number;
  ticketCount: number;
  tickets: Array<{
    number: string;
    minutes: number;
    estimated: boolean;
    customer: string;
    device: string;
    status: string;
    statusColor: string;
  }>;
  statusChanges: Array<{ ticket: string; to: string; toColor: string; note: string }>;
  notes: Array<{ ticket: string; body: string }>;
  deliveries: number;
  estimatesApproved: number;
};