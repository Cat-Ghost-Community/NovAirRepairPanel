/** Canonical existing chart; initialization is explicit and does not invent openings. */
export type AccountClass = "asset" | "liability" | "equity" | "revenue" | "expense" | "cogs";
export const DEFAULT_ACCOUNTING_CHART: Array<[string, string, AccountClass, "debit" | "credit"]> = [
  ["1000", "صندوق", "asset", "debit"], ["1010", "وجوه در راه و تسویه", "asset", "debit"],
  ["1020", "حساب‌های بانکی", "asset", "debit"], ["1100", "حساب‌های دریافتنی مشتریان", "asset", "debit"],
  ["1110", "موجودی کالا", "asset", "debit"], ["1120", "کار در جریان تعمیر", "asset", "debit"],
  ["1200", "مالیات خرید قابل بررسی", "asset", "debit"], ["1300", "حساب واسط شعب", "asset", "debit"],
  ["1310", "مطالبات کالای برگشتی نزد تأمین‌کننده", "asset", "debit"],
  ["1320", "مطالبات کارکنان بابت اضافه‌پرداخت مصوب", "asset", "debit"],
  ["2000", "حساب‌های پرداختنی تأمین‌کنندگان", "liability", "credit"], ["2010", "پیش‌دریافت مشتریان", "liability", "credit"],
  ["2020", "مالیات پرداختنی", "liability", "credit"], ["2030", "پورسانت پرداختنی", "liability", "credit"],
  ["2040", "هزینه‌های پرداختنی", "liability", "credit"], ["2100", "کالای دریافت‌شدهٔ فاکتورنشده", "liability", "credit"],
  ["3000", "حقوق مالکانه و ماندهٔ افتتاحیهٔ مصوب", "equity", "credit"],
  ["4000", "درآمد فروش کالا", "revenue", "credit"], ["4010", "درآمد خدمات تعمیر", "revenue", "credit"],
  ["5000", "بهای تمام‌شدهٔ کالای فروش‌رفته", "cogs", "debit"], ["5010", "بهای تمام‌شدهٔ تعمیر", "cogs", "debit"],
  ["6000", "هزینه‌های عملیاتی", "expense", "debit"], ["6010", "هزینهٔ پورسانت", "expense", "debit"],
  ["6020", "کسری و آسیب موجودی", "expense", "debit"],
];
