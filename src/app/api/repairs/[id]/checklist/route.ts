import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresRepairWorkHttp} from '@/lib/db/pg-repair-work-http';
import {atomicRepairMutation} from '@/lib/api';
import { requireRepairAccess } from "@/lib/repair-access";
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, fail, ok, readJson, requirePerm } from "@/lib/api";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if(postgresIntegration())return postgresRepairWorkHttp(req,Number((await params).id),'checklist');
  try {
    const session = requireSession(req);
    requirePerm(session, "repairs.edit");
    const { id } = await params;
    requireRepairAccess(session, Number(id), req.cookies.get("repaid_branch")?.value);
    const { index, done } = await readJson(req);
    const db = getDb();
    return atomicRepairMutation(db,req,session,Number(id),()=>{
    const t = db.prepare("SELECT checklist FROM repair_tickets WHERE id = ?").get(Number(id)) as any;
    if (!t) return Response.json({ error: "یافت نشد" }, { status: 404 });
    const checklist = JSON.parse(t.checklist ?? "[]");
    if (checklist[index]) checklist[index].done = !!done;
    db.prepare("UPDATE repair_tickets SET checklist = ? WHERE id = ?").run(JSON.stringify(checklist), Number(id));
    return ok({ ok: true });
    });
  } catch (e) {
    return fail(e);
  }
}
