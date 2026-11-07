import { requireRepairAccess } from "@/lib/repair-access";
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, fail, ok, audit, requirePerm } from "@/lib/api";
import { decryptSecret } from "@/lib/repair";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = requireSession(req);
    requirePerm(session, "repairs.edit");
    const { id } = await params;
    requireRepairAccess(session, Number(id), req.cookies.get("repaid_branch")?.value);
    const db = getDb();
    const t = db.prepare("SELECT security_value_enc, number FROM repair_tickets WHERE id = ?").get(Number(id)) as any;
    if (!t?.security_value_enc) return Response.json({ error: "اطلاعات امنیتی ذخیره نشده است." }, { status: 404 });

    const value = decryptSecret(t.security_value_enc);
    // Explicit, separate audit entry for sensitive reveal — never log the value itself
    db.prepare("INSERT INTO audit_logs(user_id, action, entity, entity_id, after) VALUES(?,?,?,?,?)").run(
      session.user.id, "reveal_sensitive_credential", "repair_ticket", Number(id),
      JSON.stringify({ ticket: t.number, revealed_by: session.user.name, at: new Date().toISOString() })
    );
    audit(session, "reveal_sensitive_credential", "repair_ticket", Number(id), null, { ticket: t.number });
    return ok({ value });
  } catch (e) {
    return fail(e);
  }
}
