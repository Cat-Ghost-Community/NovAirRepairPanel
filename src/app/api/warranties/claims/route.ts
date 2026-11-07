import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, ok, fail, readJson, audit } from "@/lib/api";

export const dynamic = "force-dynamic";

/** ثبت درخواست گارانتی جدید */
export async function POST(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "warranty.create");
    const body = await readJson(req);
    const { warranty_id, ticket_id, reason, cost } = body;
    if (!warranty_id || !reason) return Response.json({ error: "گارانتی و دلیل درخواست الزامی است." }, { status: 400 });
    const db = getDb();
    const w = db.prepare("SELECT * FROM warranties WHERE id = ?").get(Number(warranty_id)) as any;
    if (!w) return Response.json({ error: "گارانتی یافت نشد." }, { status: 404 });
    const today = new Date().toISOString().slice(0, 10);
    if (w.status !== "active" || w.end_date < today) {
      return Response.json({ error: "این گارانتی منقضی یا لغو شده است." }, { status: 400 });
    }
    const id = db
      .prepare("INSERT INTO warranty_claims(warranty_id, ticket_id, reason, cost, user_id) VALUES(?,?,?,?,?)")
      .run(Number(warranty_id), ticket_id ? Number(ticket_id) : null, String(reason).trim(), Number(cost) || 0, session.user.id).lastInsertRowid as number;
    audit(session, "create", "warranty_claim", id, null, { warranty_id, reason });
    return ok({ id });
  } catch (e) {
    return fail(e);
  }
}

/** رسیدگی به درخواست: تایید (resolved) یا رد (rejected) */
export async function PATCH(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "warranty.manage");
    const body = await readJson(req);
    const { claim_id, status, resolution, cost } = body as Record<string, any>;
    if (!claim_id) return Response.json({ error: "شناسه درخواست الزامی است." }, { status: 400 });
    const db = getDb();
    const claim = db.prepare("SELECT * FROM warranty_claims WHERE id = ?").get(Number(claim_id)) as any;
    if (!claim) return Response.json({ error: "درخواست یافت نشد." }, { status: 404 });
    const allowed = ["open", "investigating", "resolved", "rejected"];
    if (status && !allowed.includes(status)) return Response.json({ error: "وضعیت نامعتبر است." }, { status: 400 });

    const next: Record<string, unknown> = {};
    if (status) next.status = status;
    if (typeof resolution === "string") next.resolution = resolution.trim() || null;
    if (typeof cost === "number") next.cost = cost;

    const sets = Object.keys(next).map((k) => `${k} = ?`).join(", ");
    db.prepare(`UPDATE warranty_claims SET ${sets} WHERE id = ?`).run(...(Object.values(next) as any[]), Number(claim_id));
    audit(session, "update", "warranty_claim", Number(claim_id), claim, next);
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
