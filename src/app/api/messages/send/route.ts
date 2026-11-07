import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, ok, fail, readJson, audit } from "@/lib/api";
import {recordBranchId,BRANCH_COOKIE} from "@/lib/branch";

export const dynamic = "force-dynamic";

/** ارسال دستی پیام به مشتری — در صف ثبت می‌شود تا سرویس SMS آن را ارسال کند */
export async function POST(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "communication.send");
    const body = (await readJson(req)) as Record<string, any>;
    const { customer_id, body: text, channel } = body;
    if (channel != null && channel !== "sms") return Response.json({ error: "فقط اعلان پیامکی پشتیبانی می‌شود؛ چت مشتری فعال نیست." }, { status: 400 });
    if (!customer_id || !text?.trim()) return Response.json({ error: "مشتری و متن پیام الزامی است." }, { status: 400 });
    const db = getDb();
    const customer = db.prepare("SELECT id FROM customers WHERE id = ?").get(Number(customer_id)) as any;
    if (!customer) return Response.json({ error: "مشتری یافت نشد." }, { status: 404 });

    const id = db
      .prepare("INSERT INTO messages(customer_id, direction, channel, body, status, user_id,branch_id) VALUES(?,?,?,?,?,?,?)")
      .run(Number(customer_id), "out", channel ?? "sms", String(text).trim(), "queued", session.user.id,recordBranchId(session,req.cookies.get(BRANCH_COOKIE)?.value)).lastInsertRowid as number;
    audit(session, "create", "message", id, null, { customer_id, channel });
    return ok({ id });
  } catch (e) {
    return fail(e);
  }
}
