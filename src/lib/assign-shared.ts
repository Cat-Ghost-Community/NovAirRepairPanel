/**
 * مفاهیم مشترک کارتابل ارجاع — بدون وابستگی سروری (کلاینت و سرور).
 *
 * «فاز» از روی وضعیتِ ذخیره‌شده در دیتابیس مشتق می‌شود (منبع حقیقت: status + technician).
 * رنگ لبهٔ کارت‌ها دقیقاً از همین فاز می‌آید تا در همهٔ نماهای مدیریتی یکسان بماند:
 *   قرمز = ارجاع‌شده ولی تعمیر شروع نشده
 *   زرد  = تعمیر در جریان
 *   سبز  = آماده تحویل / تحویل‌شده
 *   خاکستری = در انتظار ارجاع (خنثی) یا بسته‌شده
 */

export type RepairPhase = "awaiting" | "assigned" | "in_progress" | "ready" | "closed";

/** وضعیت‌های آمادهٔ تحویل (یا بعد از آن) — فاز سبز */
const READY_SET = ["Ready for Pickup", "Delivered"];
/** وضعیت‌هایی که یعنی تعمیر/عیب‌یابی عملاً شروع شده — فاز زرد */
const PROGRESS_SET = [
  "Diagnosing",
  "In Repair",
  "Waiting for Parts",
  "Parts Available",
  "Quality Control",
  "Returned for Rework",
  "Warranty",
];

export function repairPhase(input: {
  status_name: string | null | undefined;
  status_category?: string | null;
  technician_id?: number | null;
}): RepairPhase {
  const name = String(input.status_name ?? "");
  const category = String(input.status_category ?? "");
  if (READY_SET.includes(name) || (category === "done" && name !== "")) return "ready";
  if (category === "closed") return "closed";
  if (PROGRESS_SET.includes(name) || (category === "active" && !["Estimate Prepared"].includes(name))) return "in_progress";
  if (input.technician_id == null) return "awaiting";
  return "assigned";
}

export type PhaseMeta = {
  label: string;
  short: string;
  border: string;
  badge: string;
  dot: string;
  icon: string;
};

export const PHASE_META: Record<RepairPhase, PhaseMeta> = {
  awaiting: {
    label: "در انتظار ارجاع",
    short: "بدون تعمیرکار",
    border: "border-r-4 border-r-zinc-300 dark:border-r-zinc-600",
    badge: "badge-gray",
    dot: "bg-zinc-400",
    icon: "clock",
  },
  assigned: {
    label: "ارجاع‌شده — تعمیر شروع نشده",
    short: "شروع‌نشده",
    border: "border-r-4 border-r-red-500",
    badge: "badge-red",
    dot: "bg-red-500",
    icon: "user-check",
  },
  in_progress: {
    label: "در حال تعمیر",
    short: "در حال تعمیر",
    border: "border-r-4 border-r-amber-400",
    badge: "badge-amber",
    dot: "bg-amber-400",
    icon: "wrench",
  },
  ready: {
    label: "آماده تحویل",
    short: "آماده تحویل",
    border: "border-r-4 border-r-emerald-500",
    badge: "badge-green",
    dot: "bg-emerald-500",
    icon: "package-check",
  },
  closed: {
    label: "بسته‌شده",
    short: "بسته‌شده",
    border: "border-r-4 border-r-zinc-300 dark:border-r-zinc-600",
    badge: "badge-gray",
    dot: "bg-zinc-400",
    icon: "ban",
  },
};

export type AssignTicketCard = {
  branch_name?: string | null;
  technician2_name?: string | null;
  branch_id?:number;
  assignment_version?:number;work_version?:number;
  workflow_revision?:number;
  technician2_id?:number|null;
  id: number;
  number: string;
  customer_id: number;
  customer_name: string;
  customer_mobile: string | null;
  device_brand: string | null;
  device_model: string | null;
  device_type: string | null;
  created_at: string;
  status_name: string;
  status_color: string | null;
  status_category: string | null;
  technician_id: number | null;
  technician_name: string | null;
  technician_color: string | null;
  assigned_at: string | null;
  estimated_completion: string | null;
  priority: string | null;
  phase: RepairPhase;
  delayed: boolean;
  /** وضعیت‌های بعدی مجاز (برای دکمه‌های اقدام کارتابل تعمیرکار) */
  allowed_next?: string[];
};

export type TechnicianOption = {
  id: number;
  name: string;
  avatar_color: string | null;
  branch_id: number | null;
  branch_name: string | null;
  active_count: number;   // ارجاع‌های باز روی دست تعمیرکار
  in_progress_count: number; // از آن‌ها، در حال تعمیر
};

export type AssignResult = {
  ticket_id: number;
  number?: string;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
};

export const DEVICE_TYPE_FA_ASSIGN: Record<string, string> = {
  mobile: "موبایل", laptop: "لپ‌تاپ", desktop: "دسکتاپ", tablet: "تبلت",
  console: "کنسول بازی", smartwatch: "ساعت هوشمند", printer: "پرینتر",
  network: "تجهیزات شبکه", other: "سایر",
};

/** بازهٔ تاریخ پذیرش → شرایط SQL (ISO میلادی؛ UI با تقویم جلالی ISO می‌فرستد) */
export function isIsoDate(v: string | null | undefined): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ""));
}
