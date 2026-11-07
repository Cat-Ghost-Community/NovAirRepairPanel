import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok, readJson, audit } from "@/lib/api";

export const dynamic = "force-dynamic";

/** الگوهای پذیرش — برای پذیرش سریع دستگاه‌های تکراری */
export async function GET(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "repairs.view");
    const db = getDb();
    const rows = db.prepare("SELECT * FROM repair_templates WHERE 1=1 ORDER BY use_count DESC, name LIMIT 50").all() as any[];
    return ok({ templates: rows });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "settings.edit");
    const b = await readJson(req);
    const db = getDb();
    const id = db
      .prepare("INSERT INTO repair_templates(name, device_type, brand, model, repair_type, problem, services, parts, est_duration_hours, est_cost) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(
        b.name, b.device_type ?? null, b.brand ?? null, b.model ?? null, b.repair_type ?? null, b.problem ?? null,
        JSON.stringify(b.services ?? []), JSON.stringify(b.parts ?? []), b.est_duration_hours ?? null, b.est_cost ?? null
      ).lastInsertRowid as number;
    audit(session, "create", "repair_template", id, null, { name: b.name });
    return ok({ id });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "settings.edit");
    const b = await readJson(req);
    const db = getDb();
    if (b.increment_use) {
      db.prepare("UPDATE repair_templates SET use_count = use_count + 1 WHERE id = ?").run(b.id);
    }
    return ok({ done: true });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "settings.edit");
    const id = Number(req.nextUrl.searchParams.get("id"));
    const db = getDb();
    db.prepare("DELETE FROM repair_templates WHERE id = ?").run(id);
    audit(session, "delete", "repair_template", id, null, null);
    return ok({ done: true });
  } catch (e) {
    return fail(e);
  }
}
