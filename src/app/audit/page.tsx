import { requirePageAccess } from "@/lib/page-access";
import { getDb } from "@/lib/db/schema";
import { statusFa } from "@/lib/status-fa";
import { fmtDateTime, toFaDigits } from "@/lib/format";
import { Pagination } from "@/components/pagination";
import { countOf, resolvePaging } from "@/lib/pagination";
import { getSessionByToken, canUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { redirect,notFound } from "next/navigation";
import { activeBranch,BRANCH_COOKIE,canSwitchBranch } from '@/lib/branch';

export const dynamic = "force-dynamic";

const ACTION_LABELS: Record<string, string> = {
  cancel_review:'لغو عملیاتی با بررسی مالی',
  create: "ایجاد شد", update: "ویرایش شد", delete: "حذف شد", archive: "بایگانی شد", merge: "ادغام شد",
  status_change: "وضعیت تغییر کرد", stock_in: "موجودی اضافه شد", stock_out: "موجودی کسر شد",
  reveal_sensitive_credential: " نمایش اطلاعات محرمانه", refund: "بازگشت وجه ثبت شد",
  receive: "کالا دریافت شد", send: "ارسال‌شده", cancel: "لغوشده", add: "افزوده شد", remove: "حذف شد",
  upload: "بارگذاری شد", time_stop: "تایمر متوقف شد", convert: "تبدیل شد", login: "وارد شدید", logout: "خارج شدید",
  backup: "پشتیبان گرفته شد", export: "خروجی گرفته شد", import: "ورود داده شد",
  transfer: "انتقال انجام شد", transfer_reply: "پاسخ انتقال", bulk_price: "تغییر گروهی قیمت",
  installment_pay: "قسط پرداخت شد", installments_generate: "قسط‌بندی شد",
  propose:'پیشنهاد ثبت شد',approve:'تأیید مستقل ثبت شد',reject:'پیشنهاد رد شد',allocate:'رسید تخصیص یافت',reverse_allocation:'تخصیص با سند برگشت خورد',activate_credit:'نسخهٔ توافق همراه سند مالی فعال شد',
};

const ENTITY_FA: Record<string, string> = {
  repair_ticket: "پذیرش", installment: "قسط", check: "چک", invoice: "فاکتور", payment: "سند پرداخت",
  installment_schedule:'نسخهٔ توافق اقساط',
  parts: "کالاها", part: "کالا", device: "دستگاه", customer: "مشتری", settings: "تنظیمات",
  database: "پایگاه داده", access_flag: "دسترسی", user: "کاربر", branch: "شعبه", supplier: "تأمین‌کننده",
  purchase_order: "سفارش خرید", estimate: "برآورد", expense: "هزینه", bank_account: "حساب بانکی",
  repair_template: "الگوی پذیرش", intake_question: "سوال پذیرش", payroll: "حقوق", sale: "فروش",
  message: "پیام", complaint: "شکایت", appointment: "نوبت", warranty: "گارانتی", warranty_claim: "ادعای گارانتی",
  serialized_part: "کالای سریال‌دار", time_entry: "زمان تعمیر", saved_report: "گزارش ذخیره‌شده", session: "نشست",
};

const AUDIT_KEY_FA: Record<string, string> = { status: "وضعیت", number: "شماره", name: "نام", email: "ایمیل", role: "نقش", amount: "مبلغ", total: "جمع", price: "قیمت", qty: "تعداد", customer_id: "مشتری", device_id: "دستگاه", mobile: "موبایل", method: "روش", action: "عملیات", percent: "درصد", direction: "جهت", field: "فیلد", category: "دسته", label: "برچسب", type: "نوع", sku: "کد کالا", reason: "دلیل", resolution: "راه‌حل", cost: "هزینه", count: "تعداد", is_active: "فعال", branch_id: "شعبه", technician_id: "تعمیرکار", priority: "اولویت" };
const SENSITIVE = ["reveal_sensitive_credential", "refund", "stock_out", "merge", "archive"];

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageAccess("/audit");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  // Historical audit rows include company-wide configuration and predate reliable source scope.
  if (!canSwitchBranch(session.user.role) || !canUser(session,"audit.view")) notFound();
  const sp = await searchParams;
  const db = getDb();
  const scope=activeBranch(session,cookieStore.get(BRANCH_COOKIE)?.value);
  let sql = `SELECT a.*, u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE (? IS NULL OR a.branch_id=?)`;
  const params: any[] = [scope.branchId,scope.branchId];
  if (sp.action) { sql += " AND a.action = ?"; params.push(sp.action); }
  const total = countOf(db, sql, params);
  const { page, perPage, offset, totalPages } = resolvePaging(sp, total);
  sql += ` ORDER BY a.created_at DESC, a.id DESC LIMIT ${perPage} OFFSET ${offset}`;
  const logs = JSON.parse(JSON.stringify(db.prepare(sql).all(...params) as any[])) as any[];

  const actions = db.prepare("SELECT DISTINCT action FROM audit_logs WHERE (? IS NULL OR branch_id=?) ORDER BY action").all(scope.branchId,scope.branchId) as any[];

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="page-head">
        <h1 className="page-title">گزارش رخدادها</h1>
        <p className="page-sub">
          ثبت تغییرناپذیر همه اقدامات — چه کسی، چه کاری، چه زمانی، با مقادیر قبل و بعد
          {sp.action ? ` · ${ACTION_LABELS[sp.action] ?? sp.action}` : ""}
        </p>

        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">
          <a href="/audit" className={`filter-chip ${!sp.action ? "filter-chip-active" : "filter-chip-idle"}`}>همه</a>
          {actions.map((a: any) => (
            <a key={a.action} href={`/audit?action=${a.action}`} className={`filter-chip ${sp.action === a.action ? "filter-chip-active" : "filter-chip-idle"}`}>
              {ACTION_LABELS[a.action] ?? a.action}
            </a>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-zinc-200 dark:border-zinc-800">
            <tr><th className="th">زمان</th><th className="th">کاربر</th><th className="th">عملیات</th><th className="th">موجودیت</th><th className="th hidden lg:table-cell">جزئیات</th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {logs.map((l) => {
              const sensitive = SENSITIVE.includes(l.action);
              let detail = "";
              try {
                const after = l.after ? JSON.parse(l.after) : null;
                detail = after ? Object.entries(after).slice(0, 4).map(([k, v]) => { const key = AUDIT_KEY_FA[k] ?? k; let val = typeof v === "object" ? "…" : String(v).slice(0, 40); if (k === "status") val = statusFa(String(v)); return `${key}: ${val}`; }).join(" · ") : "";
              } catch {}
              return (
                <tr key={l.id} className={sensitive ? "bg-amber-50/50 dark:bg-amber-500/5" : ""}>
                  <td className="td whitespace-nowrap text-zinc-500 text-[13px]">{fmtDateTime(l.created_at)}</td>
                  <td className="td">{l.user_name ?? "سیستمی"}</td>
                  <td className="td">
                    <span className={sensitive ? "badge-amber" : "badge-gray"}>{ACTION_LABELS[l.action] ?? l.action}</span>
                  </td>
                  <td className="td text-zinc-500 text-[13px]">{ENTITY_FA[l.entity] ?? l.entity}{l.entity_id ? ` #${toFaDigits(l.entity_id)}` : ""}</td>
                  <td className="td hidden lg:table-cell text-zinc-400 text-xs max-w-md truncate">{detail}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        <Pagination base="/audit" sp={sp} page={page} totalPages={totalPages} total={total} perPage={perPage} unit="رخداد" />
      </div>
    </div>
  );
}
