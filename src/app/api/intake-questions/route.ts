import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok, readJson, audit } from "@/lib/api";

export const dynamic = "force-dynamic";

/** سوالات سفارشی پذیرش — مدیریت و لیست */
export async function GET(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "repairs.view");
    const db = getDb();
    const all = req.nextUrl.searchParams.get("all") === "1";
    // all=1 برای مدیریت تنظیمات (شامل غیرفعال‌ها)؛ پیش‌فرض فقط فعال‌ها برای فرم پذیرش
    const rows = all
      ? db.prepare("SELECT * FROM intake_questions ORDER BY sort, id").all()
      : db.prepare("SELECT * FROM intake_questions WHERE is_active = 1 ORDER BY sort, id").all();
    return ok({ questions: rows });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "settings.edit");
    const b = await readJson(req);
    const db = getDb();
    const id = db
      .prepare("INSERT INTO intake_questions(label, type, options, is_required, show_on_receipt, sort) VALUES(?,?,?,?,?,?)")
      .run(b.label, b.type ?? "text", JSON.stringify(b.options ?? []), b.is_required ? 1 : 0, b.show_on_receipt === false ? 0 : 1, b.sort ?? 0)
      .lastInsertRowid as number;
    audit(session, "create", "intake_question", id, null, { label: b.label });
    return ok({ id });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "settings.edit");
    const b = await readJson(req);
    const db = getDb();

    // مرتب‌سازی گروهی: { order: [id1, id2, ...] } — ترتیب آرایه = مقدار sort جدید
    if (Array.isArray(b.order)) {
      const upd = db.prepare("UPDATE intake_questions SET sort = ? WHERE id = ?");
      b.order.forEach((id: number, idx: number) => upd.run(idx + 1, Number(id)));
      audit(session, "edit", "intake_question", 0, null, { order: b.order });
      return ok({ done: true, count: b.order.length });
    }

    db.prepare("UPDATE intake_questions SET label = COALESCE(?, label), type = COALESCE(?, type), options = COALESCE(?, options), is_required = COALESCE(?, is_required), is_active = COALESCE(?, is_active), sort = COALESCE(?, sort) WHERE id = ?")
      .run(b.label ?? null, b.type ?? null, b.options ? JSON.stringify(b.options) : null, b.is_required ?? null, b.is_active ?? null, b.sort ?? null, b.id);
    audit(session, "edit", "intake_question", b.id, null, b);
    return ok({ done: true });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "settings.edit");
    const id = Number(req.nextUrl.searchParams.get("id"));
    const db = getDb();
    db.prepare("UPDATE intake_questions SET is_active = 0 WHERE id = ?").run(id);
    audit(session, "delete", "intake_question", id, null, null);
    return ok({ done: true });
  } catch (e) {
    return fail(e);
  }
}
