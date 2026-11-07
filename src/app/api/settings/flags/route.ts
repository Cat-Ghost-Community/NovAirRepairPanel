import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, fail, ok, readJson, audit, requirePerm } from "@/lib/api";

export const dynamic = "force-dynamic";

const KNOWN = ["hide.prices", "repairs.only_assigned", "hide.costs"];

export async function GET(req: NextRequest) {
  try {
    const session = requireSession(req);
    if (!["owner", "admin", "manager"].includes(session.user.role)) {
      return Response.json({ error: "دسترسی غیرمجاز" }, { status: 403 });
    }
    const db = getDb();
    const flags: Record<string, boolean> = {};
    for (const k of KNOWN) {
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(`flag:${k}`) as any;
      flags[k] = row ? row.value === "1" : false;
    }
    return ok({ flags });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = requireSession(req);
    if (!["owner", "admin"].includes(session.user.role)) {
      return Response.json({ error: "فقط مدیر می‌تواند دسترسی‌ها را تغییر دهد." }, { status: 403 });
    }
    const b = await readJson(req);
    if (!KNOWN.includes(b.flag)) return Response.json({ error: "فلگ نامعتبر است." }, { status: 400 });
    const db = getDb();
    db.prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(`flag:${b.flag}`, b.value ? "1" : "0");
    audit(session, "update", "access_flag", null, null, { flag: b.flag, value: !!b.value });
    return ok({ done: true });
  } catch (e) {
    return fail(e);
  }
}
