import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok, readJson, audit, HttpError } from "@/lib/api";
import { canForUser, PERM_TEMPLATES } from "@/lib/auth";
import { assertBranchResource } from "@/lib/branch-access";
import { BRANCH_COOKIE } from "@/lib/branch";

export const dynamic = "force-dynamic";

/** کاتالوگ کامل دسترسی‌ها برای UI سوییچی */
const PERM_CATALOG: Array<{ group: string; perms: Array<{ key: string; label: string }> }> = [
  {
    group: "پذیرش و تعمیرات",
    perms: [
      { key: "repairs.view", label: "مشاهده پذیرش‌ها" },
      { key: "repairs.create", label: "ثبت پذیرش جدید" },
      { key: "repairs.edit", label: "ویرایش پذیرش" },
      { key: "repairs.status", label: "تغییر وضعیت دستگاه" },
      { key: "repairs.deliver", label: "تحویل دستگاه به مشتری" },
      { key: "repairs.parts.add", label: "ثبت قطعه و اجرت" },
      { key: "repairs.notes", label: "نوشتن شرح کار" },
      { key: "repairs.assign", label: "ارجاع به تعمیرکار" },
    ],
  },
  {
    group: "مشتریان و دستگاه‌ها",
    perms: [
      { key: "customers.view", label: "مشاهده مشتریان" },
      { key: "customers.create", label: "ثبت مشتری جدید" },
      { key: "customers.edit", label: "ویرایش مشتری" },
      { key: "devices.view", label: "مشاهده دستگاه‌ها" },
      { key: "devices.create", label: "ثبت دستگاه" },
      { key: "devices.edit", label: "ویرایش دستگاه" },
    ],
  },
  {
    group: "انبار و خرید",
    perms: [
      { key: "inventory.view", label: "مشاهده موجودی" },
      { key: "inventory.edit", label: "ویرایش موجودی و قیمت" },
      { key: "parts.view", label: "مشاهده قطعات" },
      { key: "suppliers.view", label: "مشاهده تأمین‌کنندگان" },
      { key: "suppliers.manage", label: "مدیریت تأمین‌کنندگان" },
      { key: "purchasing.view", label: "مشاهده سفارش‌های خرید" },
      { key: "purchasing.manage", label: "ثبت و مدیریت خرید" },
    ],
  },
  {
    group: "فروش و فاکتور",
    perms: [
      { key: "sales.view", label: "مشاهده فروش‌ها" },
      { key: "sales.create", label: "ثبت فروش (POS)" },
      { key: "invoices.view", label: "مشاهده فاکتورها" },
      { key: "invoices.create", label: "صدور فاکتور" },
      { key: "invoices.edit", label: "ویرایش فاکتور" },
      { key: "estimates.view", label: "مشاهده برآوردها" },
      { key: "estimates.create", label: "ثبت برآورد" },
      { key: "estimates.send", label: "ارسال برآورد به مشتری" },
    ],
  },
  {
    group: "مالی",
    perms: [
      { key: "payments.view", label: "مشاهده پرداخت‌ها" },
      { key: "payments.create", label: "ثبت پرداخت/دریافت" },
      { key: "payments.refund", label: "ثبت برگشت وجه" },
      { key: "expenses.view", label: "مشاهده هزینه‌ها" },
      { key: "expenses.manage", label: "ثبت و ویرایش هزینه" },
      { key: "finance.view", label: "مشاهده خلاصه مالی" },
      { key: "payroll.manage", label: "مدیریت قرارداد حقوق و پیشنهاد اصلاح پورسانت" },
      { key: "finance.manage", label: "مدیریت حساب‌های بانکی و چک" },
    ],
  },
  {
    group: "ارتباطات و پشتیبانی",
    perms: [
      { key: "communication.view", label: "مشاهده پیام‌ها" },
      { key: "communication.send", label: "ارسال پیام" },
      { key: "communication.manage", label: "مدیریت قالب پیام‌ها" },
      { key: "warranty.view", label: "مشاهده گارانتی" },
      { key: "warranty.create", label: "صدور گارانتی" },
      { key: "warranty.manage", label: "رسیدگی به درخواست گارانتی" },
      { key: "complaints.view", label: "مشاهده شکایات" },
      { key: "complaints.manage", label: "رسیدگی به شکایات" },
      { key: "appointments.view", label: "مشاهده نوبت‌ها" },
      { key: "appointments.create", label: "ثبت نوبت" },
      { key: "appointments.manage", label: "مدیریت نوبت‌ها" },
    ],
  },
  {
    group: "گفتگوی داخلی",
    perms: [
      { key: "chat.view", label: "مشاهده گفتگوی داخلی" },
      { key: "chat.dm", label: "شروع گفتگوی خصوصی" },
      { key: "chat.group.create", label: "ساخت گروه" },
      { key: "chat.group.manage", label: "مدیریت گروه‌ها و اعضا" },
      { key: "chat.channel.create", label: "ساخت کانال سازمانی" },
      { key: "chat.channel.post", label: "انتشار در کانال" },
      { key: "chat.files", label: "ارسال فایل در چت" },
      { key: "chat.moderate", label: "مدیریت (حذف) پیام دیگران" },
      { key: "chat.pin", label: "سنجاق پیام و مکالمه" },
      { key: "chat.presence", label: "مشاهده وضعیت آنلاین همکاران" },
    ],
  },
  {
    group: "گزارش و مدیریت",
    perms: [
      { key: "reports.view", label: "مشاهده گزارش‌ها" },
      { key: "dashboard.view", label: "مشاهده داشبورد" },
      { key: "team.view", label: "مشاهده کارکنان" },
      { key: "team.manage", label: "مدیریت کارکنان و دسترسی‌ها" },
      { key: "settings.edit", label: "تغییر تنظیمات سیستم" },
    ],
  },
];

export async function GET(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "team.view");
    const db = getDb();
    const userId = req.nextUrl.searchParams.get("user_id");
    if (userId) assertBranchResource(db, session, req.cookies.get(BRANCH_COOKIE)?.value, "user", userId);
    const perms = userId
      ? db.prepare("SELECT perm, effect FROM user_permissions WHERE user_id = ?").all(Number(userId))
      : [];
    return ok({ catalog: PERM_CATALOG, templates: PERM_TEMPLATES, userPerms: perms });
  } catch (e) {
    return fail(e);
  }
}

/** ذخیره دسترسی‌های یک کاربر — آرایه کامل {perm, effect} جایگزین می‌شود */
export async function PUT(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "team.manage");
    const b = await readJson(req);
    const db = getDb();
    const userId = Number(b.user_id);
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new HttpError(400, "کاربر نامعتبر است.");
    // Assigning access is an administrative trust boundary, independent of settings editing.
    if (!["owner", "admin"].includes(session.user.role)) throw new HttpError(403, "فقط مدیر ارشد می‌تواند دسترسی کارکنان را تغییر دهد.");
    const target = db.prepare("SELECT role FROM users WHERE id=?").get(userId);
    if (!target) throw new HttpError(404, "کاربر یافت نشد.");
    if (target.role === "owner" && session.user.role !== "owner") throw new HttpError(403, "تغییر دسترسی مالک مجاز نیست.");
    if (userId === session.user.id) throw new HttpError(403, "تغییر دسترسی حساب خودتان مجاز نیست.");
    if (!Array.isArray(b.perms) || b.perms.length > 200) throw new HttpError(400, "فهرست دسترسی‌ها معتبر نیست.");
    const allowed = new Set([
      ...PERM_CATALOG.flatMap(group => group.perms.map(p => p.key)),
      ...Object.values(PERM_TEMPLATES).flatMap(template => template.perms),
    ]);
    for (const p of b.perms) {
      if (!p || typeof p.perm !== "string" || !allowed.has(p.perm) || !["allow", "deny"].includes(p.effect)) {
        throw new HttpError(400, "مجوز یا نوع دسترسی معتبر نیست.");
      }
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM user_permissions WHERE user_id = ?").run(userId);
      const ins = db.prepare("INSERT OR REPLACE INTO user_permissions(user_id, perm, effect) VALUES(?,?,?)");
      for (const p of b.perms) ins.run(userId, p.perm, p.effect);
      audit(session, "edit", "user_permissions", userId, null, { count: b.perms.length });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return ok({ done: true, count: (b.perms ?? []).length });
  } catch (e) {
    return fail(e);
  }
}
