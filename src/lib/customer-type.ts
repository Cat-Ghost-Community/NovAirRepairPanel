/** انواع مشتری — مشترک بین سرور و کلاینت (فقط توابع خالص، بدون وابستگی به node:sqlite) */

export const CUSTOMER_TYPES = ["new", "returning", "colleague", "organization"] as const;

export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const CUSTOMER_TYPE_FA: Record<CustomerType, string> = {
  new: "مشتری تازه‌کار",
  returning: "مشتری قدیمی",
  colleague: "همکار",
  organization: "شرکت / سازمان",
};

/** کلاس نشان (badge) برای هر نوع — با کلاس‌های موجود در globals.css */
export const CUSTOMER_TYPE_BADGE: Record<CustomerType, string> = {
  new: "badge-gray",
  returning: "badge-green",
  colleague: "badge-blue",
  organization: "badge-purple",
};

export function customerTypeFa(t: string | null | undefined): string {
  return CUSTOMER_TYPE_FA[t as CustomerType] ?? "مشتری تازه‌کار";
}

export function customerTypeBadge(t: string | null | undefined): string {
  return CUSTOMER_TYPE_BADGE[t as CustomerType] ?? "badge-gray";
}
