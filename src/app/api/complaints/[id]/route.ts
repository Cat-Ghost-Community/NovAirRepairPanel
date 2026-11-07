import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresComplaintsHttp} from '@/lib/db/pg-complaints-http';
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, ok, fail, readJson, audit } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if(postgresIntegration())return postgresComplaintsHttp(req,Number((await params).id));
  try {
    const session = requireSession(req);
    requirePerm(session, "complaints.manage");
    const { id } = await params;
    const db = getDb();
    const complaint = db.prepare("SELECT * FROM complaints WHERE id = ?").get(Number(id)) as any;
    if (!complaint) return Response.json({ error: "شکایت یافت نشد." }, { status: 404 });

    const body = (await readJson(req)) as Record<string, any>;
    const next: Record<string, unknown> = {};
    if (typeof body.status === "string") {
      const allowed = ["open", "investigating", "waiting_customer", "resolved", "closed"];
      if (!allowed.includes(body.status)) return Response.json({ error: "وضعیت نامعتبر است." }, { status: 400 });
      next.status = body.status;
    }
    if (typeof body.resolution === "string") next.resolution = body.resolution.trim() || null;
    if (typeof body.assigned_to === "number") next.assigned_to = body.assigned_to;
    if (typeof body.priority === "string") next.priority = body.priority;

    if (Object.keys(next).length === 0) return Response.json({ error: "تغییری ارسال نشده است." }, { status: 400 });

    const sets = Object.keys(next).map((k) => `${k} = ?`).join(", ");
    db.prepare(`UPDATE complaints SET ${sets} WHERE id = ?`).run(...(Object.values(next) as any[]), Number(id));
    audit(session, "update", "complaint", Number(id), complaint, next);
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
