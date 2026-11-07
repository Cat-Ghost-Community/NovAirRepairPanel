import {activeBranch} from '@/lib/branch';
import {repairReadAssignedOnly} from '@/lib/repair-workflow';
import {atomicRepairMutation} from '@/lib/api';
import { requireRepairAccess } from "@/lib/repair-access";
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, fail, ok, readJson, audit, requirePerm } from "@/lib/api";
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresRepairNotesHttp} from '@/lib/db/pg-repair-notes-http';

/**
 * شرح کار: kinds = private | internal | public
 * - private: فقط نویسنده
 * - internal: پرسنل
 * - public: مشتری هم می‌بیند (فاکتور، پیامک، پورتال)
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if(postgresIntegration())return postgresRepairNotesHttp(req,Number((await params).id));
  try {
    const session = requireSession(req);
    requirePerm(session, "repairs.notes");
    const { id } = await params;
    requireRepairAccess(session, Number(id), req.cookies.get("repaid_branch")?.value);
    const b = await readJson(req);
    if (!b.body?.trim()) return Response.json({ error: "متن شرح کار خالی است." }, { status: 400 });
    const kind = ["private", "internal", "public"].includes(b.kind) ? b.kind : "internal";
    const db = getDb();
    return atomicRepairMutation(db,req,session,Number(id),()=>{
    db.prepare("INSERT INTO repair_notes(ticket_id, user_id, body, kind) VALUES(?,?,?,?)")
      .run(Number(id), session.user.id, b.body.trim(), kind);
    audit(session, "create", "repair_note", Number(id), null, { kind });
    return ok({ ok: true });
    });
  } catch (e) {
    return fail(e);
  }
}

/** جستجوی هوشمند در شرح کارهای دستگاه‌های قبلی (تجربیات مشابه) */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if(postgresIntegration())return postgresRepairNotesHttp(req,Number((await params).id));
  try {
    const session = requireSession(req);
    const { id } = await params;
    requireRepairAccess(session, Number(id), req.cookies.get("repaid_branch")?.value);
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    if (q.length < 3) return ok({ notes: [] });
    const db = getDb();
    const like = `%${q}%`;
    // شرح کارهای مشابه در پذیرش‌های دیگر + ایراد مشابه
    const notes = db
      .prepare(
        `SELECT n.body, n.kind, n.created_at, u.name author, t.number ticket_number, d.brand, d.model
         FROM repair_notes n
         JOIN users u ON u.id = n.user_id
         JOIN repair_tickets t ON t.id = n.ticket_id
         JOIN devices d ON d.id = t.device_id
         WHERE n.ticket_id != ? AND n.kind IN ('internal','public') AND (? IS NULL OR t.branch_id=?) AND (?=0 OR t.technician_id=? OR t.technician2_id=?)
           AND (n.body LIKE ? OR t.problem LIKE ?)
         ORDER BY n.created_at DESC LIMIT 20`
      )
      .all(Number(id),activeBranch(session).branchId,activeBranch(session).branchId,repairReadAssignedOnly(session)?1:0,session.user.id,session.user.id,like,like) as any[];
    return ok({ notes });
  } catch (e) {
    return fail(e);
  }
}
