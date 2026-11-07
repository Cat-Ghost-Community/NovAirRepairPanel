/** انواع مشتری — مشترک بین سرور و کلاینت (فقط توابع خالص، بدون وابستگی به node:sqlite) */

export const CUSTOMER_TYPES = ["regular", "returning", "colleague", "organization"] as const;

export type CustomerType = (typeof CUSTOMER_TYPES)[number];

/** Read legacy classifications without rewriting historical customer records. */
export function customerTypeValue(value:unknown):CustomerType|null{
  if(value==null||value===''||value==='new')return 'regular';
  return typeof value==='string'&&CUSTOMER_TYPES.includes(value as CustomerType)?value as CustomerType:null;
}

export const CUSTOMER_TYPE_FA: Record<CustomerType, string> = {
  regular: "مشتری عادی",
  returning: "مشتری قدیمی",
  colleague: "همکار",
  organization: "شرکت / سازمان",
};

/** کلاس نشان (badge) برای هر نوع — با کلاس‌های موجود در globals.css */
export const CUSTOMER_TYPE_BADGE: Record<CustomerType, string> = {
  regular: "badge-gray",
  returning: "badge-green",
  colleague: "badge-blue",
  organization: "badge-purple",
};

export function customerTypeFa(t: string | null | undefined): string {
  return CUSTOMER_TYPE_FA[t as CustomerType] ?? "مشتری عادی";
}

export function customerTypeBadge(t: string | null | undefined): string {
  return CUSTOMER_TYPE_BADGE[t as CustomerType] ?? "badge-gray";
}
