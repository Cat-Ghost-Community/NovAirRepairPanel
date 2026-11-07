import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, fail, ok, readJson } from "@/lib/api";
import { activeBranch, BRANCH_COOKIE } from "@/lib/branch";
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresNotificationsHttp} from '@/lib/db/pg-notifications-http';

export async function GET(req: NextRequest) {
  if(postgresIntegration())return postgresNotificationsHttp(req);
  try {
    const session = requireSession(req);
    const db = getDb();
    const branch = activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    const notifications = db
      .prepare("SELECT * FROM notifications WHERE user_id = ? AND (? IS NULL OR branch_id=?) ORDER BY created_at DESC LIMIT 30")
      .all(session.user.id, branch, branch) as any[];
    const unread = (db.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0 AND (? IS NULL OR branch_id=?)").get(session.user.id, branch, branch) as any).c;
    return ok({ notifications, unread });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  if(postgresIntegration())return postgresNotificationsHttp(req);
  try {
    const session = requireSession(req);
    const body = await readJson(req);
    const db = getDb();
    const branch = activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    if (body.action === "mark_all_read") {
      db.prepare("UPDATE notifications SET read = 1 WHERE user_id = ? AND (? IS NULL OR branch_id=?)").run(session.user.id, branch, branch);
    } else if (body.action === "mark_read" && body.id) {
      db.prepare("UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ? AND (? IS NULL OR branch_id=?)").run(body.id, session.user.id, branch, branch);
    }
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
