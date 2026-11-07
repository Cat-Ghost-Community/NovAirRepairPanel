import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, ok, fail, readJson, audit } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = requireSession(req);
    requirePerm(session, "communication.manage");
    const { id } = await params;
    const db = getDb();
    const tpl = db.prepare("SELECT * FROM message_templates WHERE id = ?").get(Number(id)) as any;
    if (!tpl) return Response.json({ error: "قالب پیام یافت نشد." }, { status: 404 });

    const body = (await readJson(req)) as Record<string, any>;
    if(body.channel!=null && body.channel!=="sms")return Response.json({error:"در این نسخه فقط اعلان پیامکی پشتیبانی می‌شود."},{status:400});
    const next: Record<string, unknown> = {};
    if (typeof body.body === "string" && body.body.trim()) next.body = body.body.trim();
    if (typeof body.subject === "string") next.subject = body.subject.trim() || null;
    if (typeof body.is_active === "number") next.is_active = body.is_active ? 1 : 0;
    if (body.channel === "sms") next.channel = "sms";

    if (Object.keys(next).length === 0) return Response.json({ error: "تغییری ارسال نشده است." }, { status: 400 });

    const sets = Object.keys(next).map((k) => `${k} = ?`).join(", ");
    db.prepare(`UPDATE message_templates SET ${sets} WHERE id = ?`).run(...(Object.values(next) as any[]), Number(id));
    audit(session, "update", "message_template", Number(id), tpl, next);
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
