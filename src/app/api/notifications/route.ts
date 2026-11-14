import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, fail, ok, readJson } from "@/lib/api";
import { activeBranch, BRANCH_COOKIE } from "@/lib/branch";
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresNotificationsHttp} from '@/lib/db/pg-notifications-http';
import {notificationScope} from '@/lib/notification-delivery';
import {validate,HttpError} from '@/lib/api';

export async function GET(req: NextRequest) {
  if(postgresIntegration())return postgresNotificationsHttp(req);
  try {
    const session = requireSession(req);
    const db = getDb();
    const branch = activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    const scope=notificationScope(session,branch);
    const notifications = db
      .prepare(`SELECT n.* FROM notifications n WHERE ${scope.sql} ORDER BY n.created_at DESC,n.id DESC LIMIT 30`)
      .all(...scope.params) as any[];
    const unread = (db.prepare(`SELECT COUNT(*) c FROM notifications n WHERE ${scope.sql} AND COALESCE(n.read,0)=0`).get(...scope.params) as {c:number}).c;
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
    const scope=notificationScope(session,branch);
    if (body.action === "mark_all_read") {
      db.prepare(`UPDATE notifications AS n SET read = 1 WHERE ${scope.sql}`).run(...scope.params);
    } else if (body.action === "mark_read" && body.id) {
      const id=validate.id(body.id);
      const found=db.prepare(`SELECT n.id FROM notifications n WHERE n.id=? AND ${scope.sql}`).get(id,...scope.params);if(!found)throw new HttpError(404,'اعلان یافت نشد.');
      db.prepare(`UPDATE notifications AS n SET read=1 WHERE n.id=? AND ${scope.sql}`).run(id,...scope.params);
    } else {
      throw new HttpError(400,'عملیات اعلان معتبر نیست.');
    }
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
