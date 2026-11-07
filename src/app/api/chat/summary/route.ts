import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresChatHttp} from '@/lib/db/pg-chat-http';
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok } from "@/lib/api";
import { chatSummary } from "@/lib/chat";

export const dynamic = "force-dynamic";

/** خلاصهٔ ناخواندهٔ چت — برای نشان منو (polling سبک) */
export async function GET(req: NextRequest) {
  if(postgresIntegration())return postgresChatHttp(req,'summary');
  try {
    const session = requireSession(req);
    requirePerm(session, "chat.view");
    const data = chatSummary(getDb(), session.user.id);
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
