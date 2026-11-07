import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresChatHttp} from '@/lib/db/pg-chat-http';
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok } from "@/lib/api";
import { rateLimit, searchChat, touchPresence } from "@/lib/chat";

export const dynamic = "force-dynamic";

/** جست‌وجوی پیام‌ها — فقط در مکالمه‌هایی که کاربر عضو آن‌هاست */
export async function GET(req: NextRequest) {
  if(postgresIntegration())return postgresChatHttp(req,'search');
  try {
    const session = requireSession(req);
    requirePerm(session, "chat.view");
    rateLimit(`search:${session.user.id}`, 60, 60_000);
    touchPresence(session.user.id);
    const sp = req.nextUrl.searchParams;
    const convId = sp.get("conversation_id");
    const from = sp.get("from");
    const data = searchChat(getDb(), session, {
      q: String(sp.get("q") ?? ""),
      conversationId: convId ? Number(convId) : null,
      fromUserId: from ? Number(from) : null,
      hasFile: sp.get("has_file") === "1",
      hasMention: sp.get("has_mention") === "1",
      limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
    });
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
