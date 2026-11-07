import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresChatHttp} from '@/lib/db/pg-chat-http';
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok } from "@/lib/api";
import { fetchEvents } from "@/lib/chat";

export const dynamic = "force-dynamic";

/** جریان رویدادها برای همگام‌سازی چند کاربر/چند تب — با polling کوتاه (cursor پایدار) */
export async function GET(req: NextRequest) {
  if(postgresIntegration())return postgresChatHttp(req,'events');
  try {
    const session = requireSession(req);
    requirePerm(session, "chat.view");
    const sp = req.nextUrl.searchParams;
    const cursor = Math.max(0, Number(sp.get("cursor") ?? 0) || 0);
    const active = sp.get("active") == null || sp.get("active") === "" ? null : Number(sp.get("active"));
    const data = fetchEvents(getDb(), session, cursor, Number.isFinite(active as number) ? active : null);
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
