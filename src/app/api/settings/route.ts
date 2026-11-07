import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok, readJson, audit, HttpError } from "@/lib/api";
import { BLOCKED_EXT } from "@/lib/chat-shared";
import { assertOutboundUrl } from "@/lib/outbound";
import { encryptCredential } from "@/lib/secrets";

/** کلیدهای مجاز تنظیمات — از نوشتن کلیدهای نامعتبر/ناشناخته جلوگیری می‌کند */
const ALLOWED_SETTING_KEYS = [
  "business_name",
  "currency_unit",
  "tax_rate",
  "vat_enabled",
  "duty_rate",
  "round_to",
  "invoice_prefix",
  "ticket_prefix",
  "diagnostic_fee",
  "default_credit_limit",
  "public_base_url",
  "postal_api_url",
  "sms_provider", "sms_api_key", "sms_sender", "sms_webhook_url",
  "chat.max_file_mb",
  "chat.allowed_ext",
  "chat.edit_window_min",
] as const;

/** بازه‌های عددی مجاز هر کلید */
const NUMERIC_RANGE: Record<string, [number, number]> = {
  tax_rate: [0, 100],
  duty_rate: [0, 100],
  round_to: [0, 1_000_000],
  diagnostic_fee: [0, 100_000_000],
  default_credit_limit: [0, 1_000_000_000],
  "chat.max_file_mb": [1, 50],
  "chat.edit_window_min": [0, 1440],
};

/** آدرس وب‌سرویس باید http/https باشد تا فقط به همان دو پروتکل درخواست برود */
function assertHttpUrl(key: string, raw: string) {
  if (!/^https?:\/\/\S+$/i.test(raw)) {
    throw new HttpError(400, `آدرس «${key}» باید با http:// یا https:// شروع شود.`);
  }
  if (key !== "public_base_url") assertOutboundUrl(raw.replace("{code}", "1234567890"));
}

export async function POST(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "settings.edit");
    const b = await readJson(req);
    const db = getDb();
    const before: Record<string, string> = {};
    const after: Record<string, string> = {};
    if (!b.values || typeof b.values !== "object" || Array.isArray(b.values)) throw new HttpError(400, "تنظیمات ارسالی معتبر نیستند.");
    db.exec("BEGIN IMMEDIATE");
    try {
    for (const [k, v] of Object.entries(b.values ?? {})) {
      const key = String(k);
      if (!(ALLOWED_SETTING_KEYS as readonly string[]).includes(key)) {
        throw new HttpError(400, `تنظیم «${key}» شناخته‌شده نیست.`);
      }
      let value = String(v ?? "").trim();
      if (key.startsWith("sms_") && !["owner", "admin"].includes(session.user.role)) throw new HttpError(403, "تنظیم درگاه پیام فقط توسط مدیر ارشد مجاز است.");
      if (value.length > 4096) throw new HttpError(400, "مقدار تنظیم بیش از حد طولانی است.");
      if (key === "sms_provider" && !["none", "kavenegar", "melipayamak", "ghasedak", "custom"].includes(value)) throw new HttpError(400, "درگاه پیامک معتبر نیست.");
      if (key === "sms_api_key") {
        if (!value) continue;
        value = encryptCredential(value);
      }

      if (NUMERIC_RANGE[key]) {
        const n = Number(value || 0);
        if (!Number.isFinite(n)) throw new HttpError(400, `مقدار «${key}» باید عدد باشد.`);
        const [min, max] = NUMERIC_RANGE[key];
        if (n < min || n > max) throw new HttpError(400, `مقدار «${key}» باید بین ${min} و ${max} باشد.`);
        value = String(Math.round(n));
      }
      if (key === "currency_unit" && !["toman", "rial"].includes(value)) {
        throw new HttpError(400, "واحد پول باید «تومان» یا «ریال» باشد.");
      }
      if (key === "vat_enabled" && !["0", "1"].includes(value)) {
        throw new HttpError(400, "وضعیت ارزش افزوده باید «روشن» یا «خاموش» باشد.");
      }
      if (key === "business_name" && !value) throw new HttpError(400, "نام کسب‌وکار نمی‌تواند خالی باشد.");
      if (key === "chat.allowed_ext") {
        const clean = [...new Set(
          value
            .split(",")
            .map((e) => e.trim().toLowerCase().replace(/^\./, ""))
            .filter((e) => /^[a-z0-9]{1,8}$/.test(e) && !BLOCKED_EXT.includes(e))
        )];
        if (!clean.length) throw new HttpError(400, "حداقل یک پسوند مجاز برای فایل‌های چت وارد کنید.");
        value = clean.join(",");
      }
      if (key.endsWith("_url") && value) assertHttpUrl(key, value);

      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as any;
      const sensitive = ["sms_api_key", "sms_webhook_url", "postal_api_url"].includes(key);
      before[key] = sensitive ? "[redacted]" : row?.value ?? "";
      db.prepare("INSERT INTO settings(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
      after[key] = sensitive ? "[redacted]" : value;
    }

    audit(session, "update", "settings", null, before, after);
    db.exec("COMMIT");
    return ok({ ok: true, keys: Object.keys(after) });
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  } catch (e) {
    return fail(e);
  }
}
