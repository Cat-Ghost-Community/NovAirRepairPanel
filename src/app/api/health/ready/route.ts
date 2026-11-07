import { getDb } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();
    const owner = db.prepare("SELECT id FROM users WHERE role='owner' AND is_active=1 LIMIT 1").get();
    const configured = process.env.NODE_ENV !== "production" || /^[a-f0-9]{64}$/i.test(process.env.REPAID_ENCRYPTION_KEY ?? "");
    let originConfigured = process.env.NODE_ENV !== "production";
    if (!originConfigured && process.env.APP_ORIGIN) {
      const url = new URL(process.env.APP_ORIGIN);
      originConfigured = url.origin === process.env.APP_ORIGIN && (url.protocol === "https:" && process.env.REPAID_COOKIE_SECURE !== "0"
        || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && process.env.REPAID_COOKIE_SECURE === "0");
    }
    const ready = Boolean(owner && configured && originConfigured);
    return Response.json({ status: ready ? "ready" : "not_ready" }, { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "not_ready" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
