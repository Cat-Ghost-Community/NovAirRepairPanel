import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresChatHttp} from '@/lib/db/pg-chat-http';
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok, readJson } from "@/lib/api";
import { HttpError } from "@/lib/api";
import {
  createGroupConversation,
  ensureDirectConversation,
  ensureEntityConversation,
  listConversations,
  presenceVisible,
  rateLimit,
  touchPresence,
} from "@/lib/chat";

export const dynamic = "force-dynamic";

/** فهرست مکالمه‌های من — فیلتر/جست‌وجو سمت سرور */
export async function GET(req: NextRequest) {
  if(postgresIntegration())return postgresChatHttp(req,'conversations');
  try {
    const session = requireSession(req);
    requirePerm(session, "chat.view");
    touchPresence(session.user.id);
    const sp = req.nextUrl.searchParams;
    const data = listConversations(getDb(), session, {
      filter: String(sp.get("filter") ?? "all"),
      q: String(sp.get("q") ?? ""),
      withPresence: presenceVisible(session),
    });
    return ok({ conversations: data });
  } catch (e) {
    return fail(e);
  }
}

/** ساخت مکالمه: خصوصی، گروه، کانال یا مکالمهٔ عملیاتی مرتبط با پذیرش */
export async function POST(req: NextRequest) {
  if(postgresIntegration())return postgresChatHttp(req,'conversations');
  try {
    const session = requireSession(req);
    requirePerm(session, "chat.view");
    const b = await readJson(req);
    const db = getDb();
    if (b.customer_id != null || (b.scope != null && b.scope !== "internal") || (b.audience != null && b.audience !== "internal")) {
      throw new HttpError(410, "چت در این نسخه فقط برای کارکنان داخلی فعال است.");
    }

    if (b.entity_type != null) {
      const id = Number(b.entity_id);
      if (!Number.isFinite(id)) throw new HttpError(400, "موجودیت نامعتبر است.");
      const res = ensureEntityConversation(db, session, String(b.entity_type), id);
      return ok({ id: res.id, created: res.created });
    }
    if (b.type === "direct") {
      requirePerm(session, "chat.dm");
      rateLimit(`conv:${session.user.id}`, 20, 60_000);
      const id = ensureDirectConversation(db, session, Number(b.user_id));
      return ok({ id });
    }
    if (b.type === "group" || b.type === "channel") {
      requirePerm(session, b.type === "group" ? "chat.group.create" : "chat.channel.create");
      rateLimit(`conv:${session.user.id}`, 10, 10 * 60_000);
      const id = createGroupConversation(db, session, {
        type: b.type,
        title: String(b.title ?? ""),
        description: b.description == null ? "" : String(b.description),
        memberIds: Array.isArray(b.member_ids) ? b.member_ids.map(Number) : [],
        avatar_color: b.avatar_color == null ? undefined : String(b.avatar_color),
      });
      return ok({ id });
    }
    throw new HttpError(400, "نوع مکالمه نامعتبر است.");
  } catch (e) {
    return fail(e);
  }
}
