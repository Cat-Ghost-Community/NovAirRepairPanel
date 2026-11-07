/**
 * محدودهٔ شعبه (فقط سمت سرور — به node:sqlite وابسته است، در باندل مرورگر import نشود).
 *
 * مالک و مدیر سیستم می‌توانند همهٔ شعب را انتخاب کنند؛ مدیر شعبه و کارکنان
 * فقط شعبهٔ فعال محل اشتغال خود را می‌بینند. حساب بدون شعبه دسترسی شعبه ندارد.
 */
import type { Session } from "@/lib/auth";
import { getDb } from "@/lib/db/schema";

export const BRANCH_COOKIE = "repaid_branch";

const SWITCHER_ROLES = ["owner", "admin"];

export type BranchScope = {
  /** شعبهٔ مؤثر — null یعنی محدودیتی اعمال نشود */
  branchId: number | null;
  /** آیا کاربر همهٔ شعب را می‌بیند؟ */
  all: boolean;
  /** آیا کاربر اجازهٔ تغییر شعبه دارد؟ */
  canSwitch: boolean;
};

export function canSwitchBranch(role: string): boolean {
  return SWITCHER_ROLES.includes(role);
}

/** اولین شعبهٔ فعال — پیش‌فرض سیستم */
export function firstBranchId(): number | null {
  const row = getDb().prepare("SELECT id FROM branches WHERE is_active = 1 ORDER BY id LIMIT 1").get() as any;
  return row?.id == null ? null : Number(row.id);
}

function branchExists(id: number): boolean {
  const row = getDb().prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1").get(id) as any;
  return row?.id != null;
}

/**
 * شعبهٔ فعال را از روی نشست + کوکی انتخاب شعبه محاسبه می‌کند.
 * برای کاربران غیرمدیر، مقدار کوکی نادیده گرفته می‌شود (قفل روی شعبهٔ خود).
 */
export function activeBranch(session: Session | null | undefined, cookieValue?: string | null): BranchScope {
  const role = session?.user.role ?? "";
  const canSwitch = canSwitchBranch(role);
  const own = session?.user.branch_id ?? null;

  if (canSwitch) {
    const raw = (cookieValue ?? "").trim();
    if (raw === "all") return { branchId: null, all: true, canSwitch };
    if (raw && /^\d+$/.test(raw) && branchExists(Number(raw))) {
      return { branchId: Number(raw), all: false, canSwitch };
    }
    // پیش‌فرض مدیران: همه شعب
    return { branchId: null, all: true, canSwitch };
  }

  if (own != null && branchExists(own)) return { branchId: own, all: false, canSwitch };
  // An unassigned non-administrator has no branch access.
  return { branchId: -1, all: false, canSwitch };
}

/** قطعه‌شرط آمادهٔ SQL برای فیلتر شعبه — بدون رشته‌سازی دستی مقدار */
export function branchWhere(scope: BranchScope, alias = ""): { sql: string; params: number[] } {
  if (scope.all || scope.branchId == null) return { sql: "1=1", params: [] };
  const col = alias ? `${alias}.branch_id` : "branch_id";
  return { sql: `${col} = ?`, params: [scope.branchId] };
}

/** شعبهٔ ثبت رکورد جدید: شعبهٔ فعال کاربر؛ در نبود آن، اولین شعبهٔ فعال سیستم */
export function recordBranchId(session: Session | null | undefined, cookieValue?: string | null): number {
  const scope = activeBranch(session, cookieValue);
  if (scope.branchId === -1) throw new Error("شعبه‌ای به حساب شما اختصاص داده نشده است. با مدیر سامانه تماس بگیرید.");
  if (scope.branchId != null) return scope.branchId;
  const first = firstBranchId();
  if (first == null) throw new Error("هیچ شعبهٔ فعالی تعریف نشده است — ابتدا از تنظیمات یک شعبه اضافه کنید.");
  return first;
}
