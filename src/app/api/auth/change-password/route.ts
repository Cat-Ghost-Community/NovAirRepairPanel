import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, fail, ok, readJson, audit, HttpError } from "@/lib/api";
import { hashPassword, verifyPassword, createSession, sessionCookie } from "@/lib/auth";
import { atomic } from "@/lib/db/transaction";
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {readyApplicationPostgres} from '@/lib/db/pg-application';
import {changePostgresPassword} from '@/lib/db/pg-app-auth';
import {postgresFailure} from '@/lib/db/pg-http';
import {isSameOriginMutation} from '@/lib/request-security';
import {readRequestJson} from '@/lib/request-json';

export const dynamic = "force-dynamic";

/** تغییر رمز عبور توسط خود کاربر — نیازمند رمز فعلی */
export async function POST(req: NextRequest) {
  if(postgresIntegration())try{
    if(!isSameOriginMutation(req))throw new HttpError(403,'درخواست از منبع غیرمجاز رد شد.');
    const body=await readRequestJson(req),{database,schema}=await readyApplicationPostgres();const token=await changePostgresPassword(database,schema,req.cookies.get('repaid_session')?.value,body.current_password,body.new_password);
    const response=NextResponse.json({ok:true});response.cookies.set(sessionCookie(token));return response;
  }catch(error){return postgresFailure(error);}
  try {
    const session = requireSession(req);
    const b = await readJson(req);
    const db = getDb();

    const current = String(b.current_password ?? "");
    const next = String(b.new_password ?? "");
    if (next.length < 12 || next.length > 1024) throw new HttpError(400, "گذرواژه جدید باید بین ۱۲ تا ۱۰۲۴ نویسه باشد.");
    if (current.length > 1024) throw new HttpError(400, "گذرواژه فعلی معتبر نیست.");

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(session.user.id) as any;
    if (!user || !verifyPassword(current, user.password_hash))
      throw new HttpError(400, "گذرواژه فعلی درست نیست.");

    const passwordHash = hashPassword(next);
    const token = atomic(db, () => {
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, user.id);
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
      audit(session, "update", "user", user.id, null, { action: "change_password" });
      return createSession(user.id);
    });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(sessionCookie(token));
    return response;
  } catch (e) {
    return fail(e);
  }
}
