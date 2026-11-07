import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresChatHttp} from '@/lib/db/pg-chat-http';
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok } from "@/lib/api";
import { normalizeFa } from "@/lib/chat-shared";
import { canSwitchBranch } from "@/lib/branch";

export const dynamic = "force-dynamic";

/** فهرست کارکنان برای انتخاب مخاطب/عضو — محدودهٔ شعبه رعایت می‌شود */
export async function GET(req: NextRequest) {
  if(postgresIntegration())return postgresChatHttp(req,'users');
  try {
    const session = requireSession(req);
    requirePerm(session, "chat.view");
    const db = getDb();
    const q = normalizeFa(String(req.nextUrl.searchParams.get("q") ?? "").trim());
    const branch = canSwitchBranch(session.user.role) ? null : session.user.branch_id ?? -1;
    const page = Math.max(1, Math.min(100000, Number(req.nextUrl.searchParams.get("page")) || 1));
    const rows = db
      .prepare(
        `SELECT u.id, u.name, u.role, u.branch_id, u.avatar_color, b.name branch_name,
                CASE WHEN p.last_seen_at > datetime('now','-70 seconds') THEN 1 ELSE 0 END online
         FROM users u
         LEFT JOIN branches b ON b.id = u.branch_id
         LEFT JOIN chat_presence p ON p.user_id = u.id
         WHERE u.is_active = 1 AND u.id != ? AND (? IS NULL OR u.branch_id=? OR u.role IN ('owner','admin'))
           AND (?='' OR replace(replace(u.name,'ي','ی'),'ك','ک') LIKE ? OR u.role LIKE ? OR b.name LIKE ?)
         ORDER BY u.name,u.id LIMIT 300 OFFSET ?`
      )
      .all(session.user.id, branch, branch, q, `%${q}%`, `%${q}%`, `%${q}%`, (page-1)*300) as any[];
    const users = rows
      .map((u) => ({
        id: Number(u.id),
        name: String(u.name),
        role: String(u.role),
        branch_id: u.branch_id == null ? null : Number(u.branch_id),
        branch_name: u.branch_name ?? null,
        avatar_color: String(u.avatar_color ?? "#0ea5e9"),
        online: !!Number(u.online),
      }));
    return ok({ users });
  } catch (e) {
    return fail(e);
  }
}
