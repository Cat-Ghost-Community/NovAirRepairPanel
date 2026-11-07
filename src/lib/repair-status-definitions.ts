/** Existing default operational states; no database initialization or policy changes. */
export const DEFAULT_STATUSES: Array<{
  name: string;
  category: string;
  color: string;
  sla: number | null;
  notify: boolean;
  next: string[];
  desc: string;
}> = [
  { name: "New", category: "open", color: "#64748b", sla: 24, notify: true, next: ["Received", "Cancelled"], desc: "تیکت تازه ثبت شده است" },
  { name: "Received", category: "open", color: "#0ea5e9", sla: 24, notify: true, next: ["Waiting for Diagnosis", "Diagnosing", "Cancelled"], desc: "دستگاه پذیرش شد" },
  { name: "Waiting for Diagnosis", category: "waiting", color: "#8b5cf6", sla: 48, notify: false, next: ["Diagnosing", "Cancelled"], desc: "در نوبت عیب‌یابی" },
  { name: "Diagnosing", category: "active", color: "#f59e0b", sla: 24, notify: true, next: ["Estimate Prepared", "Waiting for Parts", "In Repair", "No Fault Found", "Unrepairable", "Waiting for Customer Approval"], desc: "تکنسین در حال بررسی دستگاه است" },
  { name: "Estimate Prepared", category: "active", color: "#0ea5e9", sla: 4, notify: false, next: ["Waiting for Customer Approval", "Cancelled"], desc: "برآورد هزینه تنظیم شد" },
  { name: "Waiting for Customer Approval", category: "waiting", color: "#eab308", sla: 72, notify: true, next: ["Approved", "Cancelled", "Unrepairable"], desc: "منتظر پاسخ مشتری" },
  { name: "Approved", category: "open", color: "#10b981", sla: 24, notify: false, next: ["Waiting for Parts", "In Repair", "Parts Available"], desc: "برآورد تأیید شد، کار در نوبت است" },
  { name: "Waiting for Parts", category: "waiting", color: "#f97316", sla: 168, notify: true, next: ["Parts Available", "Cancelled", "Unrepairable"], desc: "قطعه سفارش داده شده" },
  { name: "Parts Available", category: "open", color: "#14b8a6", sla: 24, notify: false, next: ["In Repair"], desc: "قطعه رسید، آماده شروع کار" },
  { name: "In Repair", category: "active", color: "#3b82f6", sla: 48, notify: true, next: ["Quality Control", "Waiting for Parts", "Returned for Rework"], desc: "دستگاه روی میز کار" },
  { name: "Quality Control", category: "active", color: "#a855f7", sla: 4, notify: false, next: ["Ready for Pickup", "In Repair", "Returned for Rework"], desc: "تست نهایی" },
  { name: "Ready for Pickup", category: "done", color: "#22c55e", sla: null, notify: true, next: ["Delivered", "Returned for Rework"], desc: "آماده تحویل — مشتری مطلع شود" },
  { name: "Delivered", category: "done", color: "#059669", sla: null, notify: false, next: ["Warranty", "Returned for Rework"], desc: "به مشتری تحویل داده شد" },
  { name: "Warranty", category: "active", color: "#e11d48", sla: 48, notify: false, next: ["Quality Control", "Ready for Pickup", "Delivered"], desc: "تعمیر گارانتی" },
  { name: "Returned for Rework", category: "active", color: "#ef4444", sla: 24, notify: false, next: ["Diagnosing", "In Repair", "Waiting for Parts"], desc: "ایراد برگشت — دوباره بررسی شود" },
  { name: "Cancelled", category: "closed", color: "#71717a", sla: null, notify: true, next: [], desc: "توسط پرسنل یا مشتری لغو شد" },
  { name: "Unrepairable", category: "closed", color: "#71717a", sla: null, notify: true, next: [], desc: "اقتصادی قابل تعمیر نیست" },
  { name: "No Fault Found", category: "closed", color: "#71717a", sla: null, notify: true, next: [], desc: "ایرادی مشاهده نشد" },
];
