/** ترجمه وضعیت‌ها به فارسی — نسخه مستقل و بدون وابستگی سرور (قابل استفاده در کلاینت) */
export const STATUS_FA: Record<string, string> = {
  "New": "جدید",
  "Received": "پذیرش شده",
  "Waiting for Diagnosis": "در انتظار عیب‌یابی",
  "Diagnosing": "در حال عیب‌یابی",
  "Estimate Prepared": "برآورد آماده شد",
  "Waiting for Customer Approval": "در انتظار تأیید مشتری",
  "Approved": "تأیید شده",
  "Waiting for Parts": "در انتظار قطعه",
  "Parts Available": "قطعه موجود شد",
  "In Repair": "در حال تعمیر",
  "Quality Control": "کنترل کیفیت",
  "Ready for Pickup": "آماده تحویل",
  "Delivered": "تحویل شده",
  "Warranty": "گارانتی",
  "Returned for Rework": "مرجوع برای بازتعمیر",
  "Cancelled": "لغو شده",
  "Unrepairable": "غیرقابل تعمیر",
  "No Fault Found": "بدون ایراد (NFF)",
};

export function statusFa(name: string): string {
  return STATUS_FA[name] ?? name;
}

/** روش دریافت دستگاه در پذیرش — حضوری یا ارسال‌شده */
export const SOURCE_FA: Record<string, string> = {
  "walk-in": "حضوری",
  shipped: "ارسال شده",
  postal: "ارسال شده",
  appointment: "از نوبت",
};

export function sourceFa(value?: string | null): string {
  const v = (value ?? "").trim();
  return SOURCE_FA[v] ?? v;
}

/** نوع دستگاه */
export const DEVICE_TYPE_FA: Record<string, string> = {
  mobile: "موبایل", laptop: "لپ‌تاپ", desktop: "دسکتاپ", tablet: "تبلت",
  console: "کنسول بازی", smartwatch: "ساعت هوشمند", printer: "پرینتر",
  network: "تجهیزات شبکه", other: "سایر",
};

/** روش پرداخت */
export const PAYMENT_METHOD_FA: Record<string, string> = {
  cash: "نقدی", card: "کارتخوان", transfer: "کارت به کارت", credit: "نسیان",
  online: "درگاه آنلاین", cheque: "چک",
};

/** برچسب فارسی کلیدهای دسترسی (repairs.view ← مشاهده پذیرش‌ها) */
export const PERM_FA: Record<string, string> = {
  "repairs.view": "مشاهده پذیرش‌ها",
  "repairs.create": "ثبت پذیرش جدید",
  "repairs.edit": "ویرایش پذیرش",
  "repairs.status": "تغییر وضعیت دستگاه",
  "repairs.deliver": "تحویل دستگاه به مشتری",
  "repairs.parts.add": "ثبت قطعه و اجرت",
  "repairs.notes": "نوشتن شرح کار",
  "repairs.assign": "ارجاع به تعمیرکار",
  "customers.view": "مشاهده مشتریان",
  "customers.create": "ثبت مشتری جدید",
  "customers.edit": "ویرایش مشتری",
  "devices.view": "مشاهده دستگاه‌ها",
  "devices.create": "ثبت دستگاه",
  "devices.edit": "ویرایش دستگاه",
  "parts.view": "مشاهده قطعات",
  "parts.create": "ثبت قطعه جدید",
  "parts.edit": "ویرایش قطعه",
  "parts.delete": "حذف قطعه",
  "parts.adjust": "اصلاح موجودی انبار",
  "invoices.view": "مشاهده فاکتورها",
  "invoices.create": "صدور فاکتور",
  "invoices.pay": "ثبت پرداخت فاکتور",
  "estimates.view": "مشاهده برآوردها",
  "estimates.create": "ثبت برآورد",
  "estimates.send": "ارسال برآورد به مشتری",
  "financial.view": "مشاهده امور مالی",
  "financial.manage": "مدیریت مالی",
  "payments.view": "مشاهده پرداخت‌ها",
  "payments.create": "ثبت پرداخت",
  "expenses.view": "مشاهده هزینه‌ها",
  "expenses.create": "ثبت هزینه",
  "checks.view": "مشاهده چک‌ها",
  "checks.manage": "مدیریت چک‌ها",
  "bank.view": "مشاهده حساب‌های بانکی",
  "bank.manage": "مدیریت حساب‌های بانکی",
  "installments.view": "مشاهده اقساط",
  "installments.manage": "مدیریت اقساط",
  "payroll.view": "مشاهده حقوق و دستمزد",
  "payroll.manage": "مدیریت حقوق و دستمزد",
  "purchase.view": "مشاهده سفارش‌های خرید",
  "purchase.create": "ثبت سفارش خرید",
  "purchase.receive": "دریافت کالا",
  "suppliers.view": "مشاهده تأمین‌کنندگان",
  "suppliers.manage": "مدیریت تأمین‌کنندگان",
  "team.view": "مشاهده کارکنان",
  "team.manage": "مدیریت کارکنان و دسترسی‌ها",
  "settings.view": "مشاهده تنظیمات",
  "settings.manage": "مدیریت تنظیمات",
  "reports.view": "مشاهده گزارش‌ها",
  "communication.view": "مشاهده ارتباطات",
  "communication.send": "ارسال پیام به مشتری",
  "chat.view": "مشاهده گفتگوی داخلی",
  "chat.dm": "شروع گفتگوی خصوصی",
  "chat.group.create": "ساخت گروه",
  "chat.group.manage": "مدیریت گروه‌ها و اعضا",
  "chat.channel.create": "ساخت کانال سازمانی",
  "chat.channel.post": "انتشار در کانال",
  "chat.files": "ارسال فایل در چت",
  "chat.moderate": "مدیریت پیام دیگران",
  "chat.pin": "سنجاق پیام و مکالمه",
  "chat.presence": "مشاهده وضعیت آنلاین",
  "warranty.view": "مشاهده گارانتی‌ها",
  "appointments.view": "مشاهده نوبت‌ها",
  "complaints.view": "مشاهده شکایات",
  "complaints.manage": "مدیریت شکایات",
  "audit.view": "مشاهده گزارش رخدادها",
  // دسترسی‌های گروهی (wildcard) و موارد خاص نقش‌ها
  "repairs.*": "همه دسترسی‌های پذیرش", "customers.*": "همه دسترسی‌های مشتریان",
  "devices.*": "همه دسترسی‌های دستگاه‌ها", "inventory.*": "همه دسترسی‌های انبار",
  "suppliers.*": "همه دسترسی‌های تأمین‌کنندگان", "purchasing.*": "همه دسترسی‌های خرید",
  "sales.*": "همه دسترسی‌های فروش", "invoices.*": "همه دسترسی‌های فاکتور",
  "payments.*": "همه دسترسی‌های پرداخت", "estimates.*": "همه دسترسی‌های برآورد",
  "expenses.*": "همه دسترسی‌های هزینه", "expenses.manage": "مدیریت هزینه‌ها",
  "communication.*": "همه دسترسی‌های ارتباطات", "warranty.*": "همه دسترسی‌های گارانتی",
  "warranty.create": "ثبت گارانتی", "complaints.*": "همه دسترسی‌های شکایات",
  "appointments.*": "همه دسترسی‌های نوبت‌ها", "dashboard.*": "همه دسترسی‌های داشبورد",
  "portal.manage": "مدیریت پورتال مشتری", "finance.*": "همه دسترسی‌های مالی",
  "inventory.view": "مشاهده انبار", "sales.view": "مشاهده فروش", "purchasing.view": "مشاهده خرید", "finance.view": "مشاهده امور مالی",
  "hide.prices": "پنهان‌سازی قیمت‌ها از تعمیرکار", "repairs.only_assigned": "فقط پذیرش‌های ارجاع‌شده به خود",
};

export function permFa(key: string): string {
  return PERM_FA[key] ?? key;
}
