import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok, readJson, audit, validate, HttpError } from "@/lib/api";
import { hashPassword } from "@/lib/auth";
import { activeBranch, BRANCH_COOKIE } from "@/lib/branch";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = requireSession(req);
    const role = req.nextUrl.searchParams.get("role");
    const db = getDb();
    const branch = activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    if (role) {
      const roles = role === "technician" ? ["technician"] : [role];
      return ok({ users: db.prepare(`SELECT id, name, role, branch_id, avatar_color FROM users WHERE role IN (${roles.map(() => "?").join(",")}) AND is_active = 1 AND (? IS NULL OR branch_id=?) ORDER BY name LIMIT 500`).all(...roles, branch, branch) as any[] });
    }
    return ok({ users: db.prepare("SELECT id, name, role, branch_id, avatar_color FROM users WHERE is_active = 1 AND (? IS NULL OR branch_id=?) ORDER BY name LIMIT 500").all(branch, branch) as any[] });
  } catch (e) {
    return fail(e);
  }
}

/** ساخت کاربر جدید — فقط مدیر ارشد */
export async function POST(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "settings.edit");
    if (!["owner", "admin"].includes(session.user.role)) throw new HttpError(403, "فقط مدیر ارشد می‌تواند حساب کارکنان بسازد.");
    const b = await readJson(req);
    const db = getDb();

    const name = validate.required(b.name, "نام کاربر");
    const email = String(b.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "ایمیل معتبر نیست.");
    const password = String(b.password ?? "");
    if (password.length < 12 || password.length > 1024) throw new HttpError(400, "گذرواژه باید بین ۱۲ تا ۱۰۲۴ نویسه باشد.");
    const role = String(b.role ?? "technician");
    if (!["owner", "manager", "technician", "reception", "inventory", "accountant", "sales"].includes(role))
      throw new HttpError(400, "نقش نامعتبر است.");
    const branchId = b.branch_id == null || b.branch_id === "" ? null : Number(b.branch_id);
    if (branchId == null && !["owner","admin"].includes(role)) throw new HttpError(400, "شعبه کاربر الزامی است.");
    if (branchId != null && (!Number.isSafeInteger(branchId) || !db.prepare("SELECT id FROM branches WHERE id=? AND is_active=1").get(branchId))) throw new HttpError(400, "شعبه فعال معتبر انتخاب کنید.");

    const dupe = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (dupe) throw new HttpError(409, "کاربری با این ایمیل قبلاً ثبت شده است.");

    // فقط owner می‌تواند owner بسازد
    if (role === "owner" && session.user.role !== "owner")
      throw new HttpError(403, "فقط مدیر ارشد می‌تواند کاربر مدیر ارشد بسازد.");

    const phone = b.phone ? validate.mobile(b.phone) : null;
    const color = String(b.avatar_color ?? "#3563f6");

    const passwordHash = hashPassword(password);
    db.exec("BEGIN IMMEDIATE");
    try {
    requirePerm(requireSession(req), "settings.edit");
    if (db.prepare("SELECT id FROM users WHERE email=?").get(email)) throw new HttpError(409, "کاربری با این ایمیل قبلاً ثبت شده است.");
    const id = db
      .prepare("INSERT INTO users(name, email, password_hash, role, branch_id, phone, avatar_color) VALUES(?,?,?,?,?,?,?)")
      .run(name, email, passwordHash, role, branchId, phone, color).lastInsertRowid as number;
    audit(session, "create", "user", id, null, { name, email, role });
    db.exec("COMMIT");
    return ok({ id, name, email, role }, { status: 201 });
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  } catch (e) {
    return fail(e);
  }
}
