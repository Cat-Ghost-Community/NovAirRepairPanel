import crypto from "node:crypto";
import {deriveLoginHash} from "./credential-verification";
import { getDb } from "./db/schema";
import { createSession, hashPassword } from "./auth";
import { HttpError } from "./api";
import {postgresIntegration} from './db/pg-integration-config';
import {readyApplicationPostgres} from './db/pg-application';
import {authenticatePostgres} from './db/pg-app-auth';

const WINDOW_MS = 5 * 60 * 1000;
const DUMMY_SALT = "00000000000000000000000000000000";
/** Both the HTML form and JSON API share validation, durable throttling and audit. */
export async function authenticate(emailInput: unknown, passwordInput: unknown, previousToken?: string): Promise<string> {
  if (typeof emailInput !== "string" || typeof passwordInput !== "string"
    || emailInput.length > 254 || passwordInput.length > 1024 || !emailInput.trim() || !passwordInput) {
    throw new HttpError(400, "ایمیل و گذرواژه معتبر وارد کنید.");
  }
  const email = emailInput.trim().toLowerCase();
  if(postgresIntegration()){const {database,schema}=await readyApplicationPostgres();return authenticatePostgres(database,schema,email,passwordInput,previousToken);}
  const db = getDb();
  const key = crypto.createHash("sha256").update(email).digest("hex");
  const now = Date.now();
  // Reserve the attempt before awaiting scrypt: concurrent requests cannot bypass the limit.
  const attempt = db.prepare(`INSERT INTO login_attempts(key, count, window_start) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN window_start <= ? THEN 1 ELSE count + 1 END,
      window_start = CASE WHEN window_start <= ? THEN excluded.window_start ELSE window_start END
    RETURNING count`).get(key, now, now - WINDOW_MS, now - WINDOW_MS) as { count: number };
  if (Number(attempt.count) > 5) throw new HttpError(429, "تلاش‌های ورود زیاد بوده است. پنج دقیقه دیگر دوباره تلاش کنید.");
  db.prepare("DELETE FROM login_attempts WHERE window_start < ?").run(now - WINDOW_MS * 2);
  const user = db.prepare("SELECT id, password_hash FROM users WHERE email = ? AND is_active = 1").get(email) as { id: number; password_hash: string } | undefined;
  const modern = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(user?.password_hash ?? "");
  const legacy = /^[a-f0-9]{64}$/.test(user?.password_hash ?? "");
  const actual = await deriveLoginHash(passwordInput, modern ? modern[1] : legacy ? "repaid-static-salt" : DUMMY_SALT, !legacy);
  const expected = Buffer.from(modern ? modern[2] : legacy ? user!.password_hash : "0".repeat(64), "hex");
  if (!user || !crypto.timingSafeEqual(actual, expected)) {
    db.prepare("INSERT INTO audit_logs(action, entity) VALUES('login_failed','session')").run();
    throw new HttpError(401, "ایمیل یا گذرواژه اشتباه است.");
  }
  // Recheck after the asynchronous hash: account changes may have happened meanwhile.
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = db.prepare("SELECT id FROM users WHERE id=? AND is_active=1 AND password_hash=?").get(user.id, user.password_hash);
    if (!current) throw new HttpError(401, "اطلاعات حساب تغییر کرده است. دوباره وارد شوید.");
    if (legacy) db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hashPassword(passwordInput), user.id);
    db.prepare("DELETE FROM login_attempts WHERE key=?").run(key);
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
    if (previousToken) {
      const digest = "sha256:" + crypto.createHash("sha256").update(previousToken).digest("hex");
      db.prepare("DELETE FROM sessions WHERE token IN (?,?)").run(previousToken, digest);
    }
    const token = createSession(user.id);
    db.prepare("INSERT INTO audit_logs(user_id,action,entity) VALUES(?,'login','session')").run(user.id);
    db.exec("COMMIT");
    return token;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
