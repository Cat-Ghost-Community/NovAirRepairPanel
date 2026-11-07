import { NextRequest } from "next/server";
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresBranchesHttp} from '@/lib/db/pg-branches';
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok, readJson, audit, HttpError } from "@/lib/api";
import { activeBranch, BRANCH_COOKIE, canSwitchBranch } from "@/lib/branch";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if(postgresIntegration())return postgresBranchesHttp(req);
  try {
    const session = requireSession(req);
    const branch = activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    const db = getDb();
    const branches = db.prepare(
      `SELECT b.*,
        (SELECT COUNT(*) FROM users u WHERE u.branch_id = b.id AND u.is_active = 1) staff_count,
        (SELECT COUNT(*) FROM repair_tickets t WHERE t.branch_id = b.id AND t.status_id IN (SELECT id FROM repair_statuses WHERE is_open = 1)) open_repairs
       FROM branches b WHERE (? IS NULL OR b.id=?) ORDER BY b.id`
    ).all(branch, branch);
    return ok({ branches });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  if(postgresIntegration())return postgresBranchesHttp(req);
  try {
    const session = requireSession(req);
    requirePerm(session, "settings.edit");
    if (!canSwitchBranch(session.user.role)) throw new HttpError(403, "مدیریت شعبه‌ها فقط برای مدیر شرکت مجاز است.");
    const b = await readJson(req);
    if (!b.name?.trim()) return fail(new Error("نام شعبه الزامی است"));
    const db = getDb();
    const id = db.prepare("INSERT INTO branches(name, code, address, city, phone) VALUES(?,?,?,?,?)")
      .run(b.name.trim(), b.code ?? b.name.trim().slice(0, 3).toUpperCase(), b.address ?? "", b.city ?? "", b.phone ?? "")
      .lastInsertRowid as number;
    audit(session, "create", "branch", id, null, { name: b.name });
    return ok({ id });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: NextRequest) {
  if(postgresIntegration())return postgresBranchesHttp(req);
  try {
    const session = requireSession(req);
    requirePerm(session, "settings.edit");
    if (!canSwitchBranch(session.user.role)) throw new HttpError(403, "مدیریت شعبه‌ها فقط برای مدیر شرکت مجاز است.");
    const b = await readJson(req);
    const db = getDb();
    db.prepare("UPDATE branches SET name = COALESCE(?, name), code = COALESCE(?, code), address = COALESCE(?, address), city = COALESCE(?, city), phone = COALESCE(?, phone) WHERE id = ?")
      .run(b.name ?? null, b.code ?? null, b.address ?? null, b.city ?? null, b.phone ?? null, Number(b.id));
    audit(session, "edit", "branch", Number(b.id), null, b);
    return ok({ done: true });
  } catch (e) {
    return fail(e);
  }
}
