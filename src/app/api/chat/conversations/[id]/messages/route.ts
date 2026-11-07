import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresChatHttp} from '@/lib/db/pg-chat-http';
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok, readJson } from "@/lib/api";
import { fetchMessages, postMessage, requireConversation, touchPresence } from "@/lib/chat";

export const dynamic = "force-dynamic";

/** پیام‌های صفحه‌بندی‌شدهٔ مکالمه (before/after/around برای پرش و بارگذاری تدریجی) */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if(postgresIntegration())return postgresChatHttp(req,'messages',Number((await params).id));
  try {
    const session = requireSession(req);
    requirePerm(session, "chat.view");
    const { id } = await params;
    touchPresence(session.user.id);
    const sp = req.nextUrl.searchParams;
    const num = (k: string) => (sp.get(k) == null || sp.get(k) === "" ? null : Number(sp.get(k)));
    const data = fetchMessages(getDb(), session, Number(id), {
      beforeId: num("before_id"),
      afterId: num("after_id"),
      aroundId: num("around_id"),
      limit: num("limit") ?? undefined,
    });
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}

/** ارسال پیام — idempotent با client_key (ارسال دوباره همان client_key پیام تکراری نمی‌سازد) */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if(postgresIntegration())return postgresChatHttp(req,'messages',Number((await params).id));
  try {
    const session = requireSession(req);
    requirePerm(session, "chat.view");
    const { id } = await params;
    const convId = Number(id);
    const b = await readJson(req);
    const db = getDb();
    const { conv, member } = requireConversation(db, convId, session.user.id);
    if (Array.isArray(b.attachment_ids) && b.attachment_ids.length) requirePerm(session, "chat.files");
    const res = postMessage(db, session, conv, member, {
      body: String(b.body ?? ""),
      client_key: b.client_key == null ? null : String(b.client_key),
      reply_to_id: b.reply_to_id == null ? null : Number(b.reply_to_id),
      attachment_ids: Array.isArray(b.attachment_ids) ? b.attachment_ids.map(Number) : [],
      mentions: Array.isArray(b.mentions) ? b.mentions.map(Number) : [],
    });
    return ok({ message: res.message, duplicate: res.duplicate });
  } catch (e) {
    return fail(e);
  }
}
