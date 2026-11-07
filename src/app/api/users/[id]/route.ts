import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok, readJson, audit, validate, HttpError } from "@/lib/api";
import { hashPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** ویرایش کاربر: نام/نقش/شعبه/رنگ/فعال‌غیرفعال + ریست رمز توسط مدیر */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = requireSession(req);
    requirePerm(session, "settings.edit");
    if (!["owner", "admin"].includes(session.user.role)) throw new HttpError(403, "فقط مدیر ارشد می‌تواند حساب کارکنان را تغییر دهد.");
    const { id: idRaw } = await params;
    const id = Number(idRaw);
    const b = await readJson(req);
    if (b.is_active !== undefined && typeof b.is_active !== "boolean" && b.is_active !== 0 && b.is_active !== 1) throw new HttpError(400, "وضعیت فعال بودن کاربر معتبر نیست.");
    const db = getDb();

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as any;
    if (!user) throw new HttpError(404, "کاربر یافت نشد.");
    if (user.role === "owner" && session.user.role !== "owner")
      throw new HttpError(403, "فقط مدیر ارشد می‌تواند کاربر مدیر ارشد را ویرایش کند.");

    const sets: string[] = [];
    const vals: (string | number | null)[] = [];

    if (b.name !== undefined) { sets.push("name = ?"); vals.push(validate.required(b.name, "نام کاربر")); }
    if (b.role !== undefined) {
      const role = String(b.role);
      if (!["owner", "manager", "technician", "reception", "inventory", "accountant", "sales"].includes(role))
        throw new HttpError(400, "نقش نامعتبر است.");
      if (role === "owner" && session.user.role !== "owner") throw new HttpError(403, "فقط مدیر ارشد می‌تواند نقش مدیر ارشد بدهد.");
      if (user.role === "owner" && role !== "owner") {
        const otherOwners = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'owner' AND is_active=1 AND id != ?").get(id) as any;
        if (otherOwners.c === 0) throw new HttpError(400, "حداقل یک مدیر ارشد باید باقی بماند.");
      }
      sets.push("role = ?"); vals.push(role);
    }
    if (b.branch_id !== undefined) { sets.push("branch_id = ?"); vals.push(b.branch_id || null); }
    if (b.phone !== undefined) { sets.push("phone = ?"); vals.push(b.phone ? validate.mobile(b.phone) : null); }
    if (b.avatar_color !== undefined) { sets.push("avatar_color = ?"); vals.push(String(b.avatar_color)); }
    if (b.is_active !== undefined) {
      if (user.role === "owner" && !b.is_active) {
        const otherOwners = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'owner' AND is_active = 1 AND id != ?").get(id) as any;
        if (otherOwners.c === 0) throw new HttpError(400, "حداقل یک مدیر ارشد فعال باید باقی بماند.");
      }
      sets.push("is_active = ?"); vals.push(b.is_active ? 1 : 0);
    }
    if (b.password !== undefined) {
      const pw = String(b.password);
      if (pw.length < 12 || pw.length > 1024) throw new HttpError(400, "گذرواژه باید بین ۱۲ تا ۱۰۲۴ نویسه باشد.");
      sets.push("password_hash = ?"); vals.push(hashPassword(pw));
    }

    if (sets.length === 0) throw new HttpError(400, "چیزی برای به‌روزرسانی ارسال نشده است.");
    vals.push(id);
    db.exec("BEGIN IMMEDIATE");
    try {
      requirePerm(requireSession(req), "settings.edit");
      const currentUser = db.prepare("SELECT role,branch_id FROM users WHERE id=?").get(id);
      const targetRole = String(b.role ?? currentUser?.role ?? "");
      const targetBranch = b.branch_id === undefined ? currentUser?.branch_id : b.branch_id || null;
      if (targetBranch == null && !["owner","admin"].includes(targetRole)) throw new HttpError(400, "شعبه کاربر الزامی است.");
      if (targetBranch != null && (!Number.isSafeInteger(Number(targetBranch)) || !db.prepare("SELECT id FROM branches WHERE id=? AND is_active=1").get(Number(targetBranch)))) throw new HttpError(400, "شعبه فعال معتبر انتخاب کنید.");
      if (currentUser?.role === "owner" && (targetRole !== "owner" || b.is_active === false || b.is_active === 0)) {
        const remaining = db.prepare("SELECT COUNT(*) n FROM users WHERE role='owner' AND is_active=1 AND id!=?").get(id);
        if (!Number(remaining?.n)) throw new HttpError(409, "حداقل یک مدیر ارشد فعال باید باقی بماند.");
      }
      db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
      if (["password", "role", "is_active", "branch_id"].some(key => b[key] !== undefined)) {
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
      }
      audit(session, "update", "user", id, null, { fields: sets.map((s) => s.split(" ")[0]) });
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
