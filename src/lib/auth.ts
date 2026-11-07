import {ROLE_PERMISSIONS} from './auth-roles';
import { NextRequest } from "next/server";
import { getDb } from "./db/schema";
import crypto from "node:crypto";
import { hasPerm } from "./perms-shared";

export type Session = {
  user: {
    id: number;
    name: string;
    email: string;
    role: string;
    branch_id: number | null;
    avatar_color: string;
  };
};

const SESSION_COOKIE = "repaid_session";

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 32, { N: 32768, maxmem: 64 * 1024 * 1024 }).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(pw: string, hash: string): boolean {
  try {
    const modern = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(hash);
    if (!modern && !/^[a-f0-9]{64}$/.test(hash)) return false;
    const derived = modern
      ? crypto.scryptSync(pw, modern[1], 32, { N: 32768, maxmem: 64 * 1024 * 1024 })
      : crypto.scryptSync(pw, "repaid-static-salt", 32);
    return crypto.timingSafeEqual(derived, Buffer.from(modern ? modern[2] : hash, "hex"));
  } catch {
    return false;
  }
}

export function createSession(userId: number): string {
  const db = getDb();
  const token = crypto.randomBytes(24).toString("hex");
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  db.prepare("INSERT INTO sessions(token, user_id, expires_at) VALUES(?,?,?)").run(sessionDigest(token), userId, expires);
  return token;
}

export function destroySession(token: string | undefined) {
  if (!token) return;
  getDb().prepare("DELETE FROM sessions WHERE token IN (?, ?)").run(token, sessionDigest(token));
}

function sessionDigest(token: string): string {
  return "sha256:" + crypto.createHash("sha256").update(token).digest("hex");
}

export function getSession(req: NextRequest): Session | null {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return getSessionByToken(token);
}

export function getSessionByToken(token: string | undefined): Session | null {
  if (!token || !/^[a-f0-9]{48}$/.test(token)) return null;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, u.branch_id, u.avatar_color, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token IN (?, ?) AND u.is_active = 1`
    )
    .get(token, sessionDigest(token)) as any;
  if (!row) return null;
  if (!Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= Date.now()) {
    destroySession(token);
    return null;
  }
  return {
    user: {
      id: Number(row.id),
      name: String(row.name),
      email: String(row.email),
      role: String(row.role),
      branch_id: row.branch_id == null ? null : Number(row.branch_id),
      avatar_color: String(row.avatar_color ?? "#0ea5e9"),
    },
  };
}

export function sessionCookie(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.REPAID_COOKIE_SECURE === "0" ? false : process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  };
}

// ---- RBAC ----

export {ROLE_LABELS,ROLE_PERMISSIONS} from './auth-roles';

export function can(role: string, perm: string): boolean {
  return canForUser(role, perm, null);
}

/**
 * بررسی دسترسی برای یک نشست واقعی — همیشه مجوزهای شخصی کاربر را لحاظ می‌کند.
 * همهٔ صفحات و مسیرها باید از این تابع استفاده کنند تا ویرایش دسترسی‌ها در
 * «کارکنان» واقعاً اثر کند (can(role) مجوزهای شخصی را نادیده می‌گیرد).
 */
export function canUser(session: Session | null | undefined, perm: string): boolean {
  if (!session) return false;
  return canForUser(session.user.role, perm, session.user.id);
}

/**
 * نگهبان ساده: آیا این نشست دسترسی موردنظر را دارد؟
 * (محدودهٔ شعبه در `src/lib/branch.ts` تعیین می‌شود)
 */
export function guard(session: Session | null | undefined, perm?: string): boolean {
  if (!session) return false;
  if (!perm) return true;
  return canUser(session, perm);
}

/**
 * بررسی دسترسی: اول دسترسی شخصی کاربر (user_permissions)، بعد نقش.
 * deny شخصی همیشه برنده است؛ allow شخصی نقش را override می‌کند؛
 * wildcard شخصی (مثل repairs.*) هم پشتیبانی می‌شود.
 */
/**
 * فهرست مؤثر مجوزهای کاربر: مجوزهای نقش + استثناهای شخصی (allow/deny).
 * سمت سرور محاسبه و به پوستهٔ کلاینت پاس داده می‌شود تا منو و دکمه‌ها
 * دقیقاً مثل سرور فیلتر شوند.
 */
export function effectivePermissions(role: string, userId: number | null | undefined): string[] {
  const base = new Set<string>(ROLE_PERMISSIONS[role] ?? []);
  if (userId == null) return [...base];
  const db=getDb();
  if(db.prepare("SELECT 1 FROM users u JOIN branches b ON b.id=u.branch_id JOIN repair_workflow_supervisors s ON s.user_id=u.id AND s.branch_id=u.branch_id JOIN branch_repair_workflows w ON w.branch_id=u.branch_id WHERE u.id=? AND u.is_active=1 AND b.is_active=1 AND w.mode!='legacy'").get(userId)){base.add('repairs.assign');base.add('repairs.view');}
  const rows = getDb().prepare("SELECT perm, effect FROM user_permissions WHERE user_id = ?").all(userId);
  for (const r of rows) {
    const perm = String(r.perm);
    if (r.effect === "allow") base.add(perm);
    else if (r.effect === "deny") base.add(`!${perm}`);
  }
  return [...base];
}

export function canForUser(role: string, perm: string, userId: number | null | undefined): boolean {
  return hasPerm(effectivePermissions(role, userId), perm);
}

/** قالب‌های آماده دسترسی — رشته‌های perm جدا شده با فاصله */
const CHAT_BASE = ["chat.view", "chat.dm", "chat.files", "chat.presence"];
export const PERM_TEMPLATES: Record<string, { label: string; perms: string[] }> = {
  accountant: { label: "حسابدار", perms: ["invoices.*", "payments.*", "expenses.*", "reports.view", "finance.*", "customers.view", "repairs.view", "sales.view", "dashboard.view", ...CHAT_BASE] },
  warehouse: { label: "انباردار", perms: ["inventory.*", "suppliers.*", "purchasing.*", "parts.view", "reports.view", "dashboard.view", "devices.view", ...CHAT_BASE] },
  reception: { label: "پذیرش", perms: ["repairs.view", "repairs.create", "repairs.edit", "repairs.status", "repairs.deliver", "customers.*", "devices.*", "estimates.*", "invoices.view", "invoices.create", "payments.*", "sales.*", "communication.*", "appointments.*", "complaints.view", "complaints.manage", "warranty.view", "warranty.create", "dashboard.view", "chat.group.create", "chat.pin", ...CHAT_BASE] },
  senior_tech: { label: "تعمیرکار ارشد", perms: ["repairs.*", "devices.view", "customers.view", "estimates.*", "inventory.view", "dashboard.view", "warranty.view", "communication.send", "reports.view", ...CHAT_BASE] },
  cashier: { label: "فروشنده صندوق", perms: ["sales.*", "customers.*", "inventory.view", "invoices.*", "payments.*", "dashboard.view", "devices.view", ...CHAT_BASE] },
  viewer: { label: "فقط مشاهده", perms: ["repairs.view", "customers.view", "devices.view", "inventory.view", "invoices.view", "payments.view", "reports.view", "dashboard.view", "estimates.view", "finance.view", ...CHAT_BASE] },
};

/**
 * پرچم‌های رفتاری (در جدول settings با کلید flag:* ذخیره می‌شود) — این‌ها «مجوز» نیستند
 * و نباید در فهرست مجوزهای نقش قرار بگیرند، وگرنه با wildcardها تداخل می‌کنند:
 * hide.prices           → تعمیرکاران قیمت قطعات و اجرت‌ها را نمی‌بینند
 * repairs.only_assigned → تعمیرکار فقط پذیرش‌های دست خودش را می‌بیند
 * hide.costs            → حاشیه سود و بهای تمام‌شده فقط برای مدیر/حسابدار
 */
export const FLAGS = {
  HIDE_PRICES: "hide.prices",
  ONLY_ASSIGNED: "repairs.only_assigned",
  HIDE_COSTS: "hide.costs",
} as const;

export const FLAG_LABELS: Record<string, string> = {
  "hide.prices": "مخفی‌کردن قیمت قطعات و اجرت‌ها از تعمیرکاران",
  "repairs.only_assigned": "تعمیرکار فقط پذیرش‌های دست خودش را ببیند",
  "hide.costs": "مخفی‌کردن بهای تمام‌شده و حاشیه سود از غیرمدیران",
};

/** برچسب فارسی مجوزها — برای ویرایشگر دسترسی کارکنان */
export const PERM_LABELS: Record<string, string> = {
  "repairs.view": "مشاهده پذیرش‌ها",
  "repairs.create": "ثبت پذیرش",
  "repairs.edit": "ویرایش پذیرش",
  "repairs.status": "تغییر وضعیت پذیرش",
  "repairs.deliver": "تحویل دستگاه",
  "repairs.assign": "ارجاع دستگاه به تعمیرکار",
  "repairs.parts.add": "افزودن قطعه/اجرت",
  "repairs.notes": "ثبت یادداشت کار",
  "customers.view": "مشاهده مشتریان",
  "customers.edit": "ویرایش مشتریان",
  "customers.create": "ثبت مشتری",
  "devices.view": "مشاهده دستگاه‌ها",
  "inventory.view": "مشاهده انبار",
  "inventory.edit": "عملیات انبار",
  "inventory.manage": "مدیریت انبار",
  "suppliers.view": "مشاهده تأمین‌کنندگان",
  "suppliers.manage": "مدیریت تأمین‌کنندگان",
  "purchasing.view": "مشاهده خرید",
  "purchasing.manage": "مدیریت خرید",
  "sales.view": "مشاهده فروش",
  "sales.create": "ثبت فروش",
  "invoices.view": "مشاهده فاکتورها",
  "invoices.create": "صدور فاکتور",
  "invoices.edit": "ویرایش فاکتور",
  "payments.view": "مشاهده پرداخت‌ها",
  "payments.create": "ثبت پرداخت",
  "payments.refund": "استرداد وجه",
  "estimates.view": "مشاهده برآوردها",
  "estimates.create": "ثبت برآورد",
  "estimates.send": "ارسال برآورد",
  "expenses.view": "مشاهده هزینه‌ها",
  "expenses.manage": "مدیریت هزینه‌ها",
  "finance.view": "مشاهده مالی",
  "finance.edit": "عملیات مالی",
  "finance.manage": "مدیریت مالی",
  "reports.view": "مشاهده گزارش‌ها",
  "warranty.view": "مشاهده گارانتی",
  "warranty.create": "ثبت گارانتی",
  "complaints.view": "مشاهده شکایات",
  "complaints.manage": "مدیریت شکایات",
  "appointments.view": "مشاهده نوبت‌ها",
  "appointments.manage": "مدیریت نوبت‌ها",
  "communication.send": "ارسال پیام",
  "communication.manage": "مدیریت ارتباطات",
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
  "team.view": "مشاهده کارکنان",
  "team.manage": "مدیریت کارکنان",
  "settings.edit": "ویرایش تنظیمات",
  "settings.view": "مشاهده تنظیمات",
  "portal.manage": "مدیریت پرتال مشتری",
  "dashboard.view": "مشاهده داشبورد",
};

/** آیا پرچم رفتاری برای این نقش روشن است؟ (کاربر را هم لحاظ می‌کند) */
export function flagEnabledForUser(session: Session | null | undefined, flag: string): boolean {
  if (!session) return false;
  return flagEnabledFor(session.user.role, flag);
}
export function flagEnabledFor(role: string, flag: string): boolean {
  // نقش‌های مدیریتی هیچ‌وقت محدود نمی‌شوند
  if (["owner", "admin"].includes(role)) return false;
  const r = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(`flag:${flag}`);
  if (r) return r.value === "1";
  // پیش‌فرض برای تعمیرکار: قیمت‌ها مخفی
  return role === "technician" && flag === "hide.prices";
}
