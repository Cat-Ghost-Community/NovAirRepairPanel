import crypto from "node:crypto";
import { getDb } from "./db/schema";
import { HttpError } from "./api";

export function issueTrackingToken(ticketId: number): string {
  const token = crypto.randomBytes(32).toString("hex");
  const db = getDb();
  db.prepare("DELETE FROM tracking_tokens WHERE expires_at <= ?").run(Date.now());
  db.prepare("INSERT INTO tracking_tokens(token_hash,ticket_id,expires_at) VALUES(?,?,?)")
    .run(crypto.createHash("sha256").update(token).digest("hex"), ticketId, Date.now() + 24 * 60 * 60 * 1000);
  return token;
}

export function resolveTrackingToken(token: unknown): number | null {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = getDb().prepare("SELECT ticket_id FROM tracking_tokens WHERE token_hash=? AND expires_at > ?")
    .get(crypto.createHash("sha256").update(token).digest("hex"), Date.now());
  return row ? Number(row.ticket_id) : null;
}

export function trackingRateLimit(key: string, maximum: number): void {
  const now = Date.now();
  const cutoff = now - 5 * 60 * 1000;
  getDb().prepare("DELETE FROM login_attempts WHERE key LIKE 'track:%' AND window_start<?").run(cutoff-5*60*1000);
  const row = getDb().prepare(`INSERT INTO login_attempts(key,count,window_start) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_start <= ? THEN 1 ELSE count+1 END,
    window_start=CASE WHEN window_start <= ? THEN excluded.window_start ELSE window_start END
    RETURNING count`).get("track:" + crypto.createHash("sha256").update(key).digest("hex"), now, cutoff, cutoff) as { count: number };
  if (row.count > maximum) throw new HttpError(429, "تلاش‌های زیادی ثبت شده است. پنج دقیقه دیگر دوباره تلاش کنید.");
}
