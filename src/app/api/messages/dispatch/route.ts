import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok, readJson, audit, HttpError } from "@/lib/api";
import { assertOutboundUrl } from "@/lib/outbound";
import { decryptCredential } from "@/lib/secrets";
import { activeBranch, BRANCH_COOKIE } from "@/lib/branch";
import { assertBranchResource } from "@/lib/branch-access";

export const dynamic = "force-dynamic";

/** صف پیام‌ها + ارسال دستی/تلاش مجدد/لغو */
export async function GET(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "communication.view");
    const db = getDb();
    const branch = activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    const status = req.nextUrl.searchParams.get("status");
    let sql = `SELECT m.*, COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'') customer_name, c.mobile, u.name user_name
      FROM messages m
      LEFT JOIN customers c ON c.id = m.customer_id
      LEFT JOIN users u ON u.id = m.user_id
      LEFT JOIN repair_tickets t ON t.id=m.ticket_id
      WHERE m.channel='sms' AND (? IS NULL OR COALESCE(m.branch_id,t.branch_id,c.branch_id,(SELECT MIN(a.branch_id) FROM customer_branch_access a WHERE a.customer_id=m.customer_id HAVING COUNT(*)=1))=?)`;
    const params: any[] = [branch, branch];
    if (status) { sql += " AND m.status = ?"; params.push(status); }
    sql += " ORDER BY m.created_at DESC LIMIT 200";
    const rows = db.prepare(sql).all(...params) as any[];
    const counts = db.prepare(`SELECT m.status, COUNT(*) c FROM messages m LEFT JOIN repair_tickets t ON t.id=m.ticket_id LEFT JOIN customers c ON c.id=m.customer_id
      WHERE m.channel='sms' AND (? IS NULL OR COALESCE(m.branch_id,t.branch_id,c.branch_id,(SELECT MIN(a.branch_id) FROM customer_branch_access a WHERE a.customer_id=m.customer_id HAVING COUNT(*)=1))=?) GROUP BY m.status`).all(branch, branch) as any[];
    const provider = (db.prepare("SELECT value FROM settings WHERE key = 'sms_provider'").get() as any)?.value ?? "none";
    return ok({ messages: rows, counts, provider });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "communication.send");
    const b = await readJson(req);
    const db = getDb();
    const branch = activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    if (b.action !== "retry_all_failed") {
      assertBranchResource(db, session, req.cookies.get(BRANCH_COOKIE)?.value, "message", b.id);
      const source = db.prepare("SELECT channel FROM messages WHERE id=?").get(Number(b.id)) as { channel: string };
      if (source.channel !== "sms") throw new HttpError(410, "این مسیر ارتباطی در دسترس نیست.");
    }
    if (b.action === "retry" || b.action === "send_now") {
      const msg = db.prepare("UPDATE messages SET status='sending' WHERE id=? AND direction='out' AND status IN ('queued','failed') RETURNING *").get(Number(b.id)) as any;
      if (!msg) throw new HttpError(409, "پیام قابل ارسال نیست؛ وضعیت صف را تازه‌سازی کنید.");
      const result = await trySend(db, msg);
      db.prepare("UPDATE messages SET status = ? WHERE id = ?").run(result.ok ? "sent" : result.uncertain ? "unknown" : "failed", msg.id);
      audit(session, "edit", "message", msg.id, null, { action: b.action, result: result.ok ? "sent" : result.error });
      return ok({ done: true, sent: result.ok, error: result.ok ? undefined : result.error });
    }
    if (b.action === "cancel") {
      const changed = db.prepare("UPDATE messages SET status = 'cancelled' WHERE id = ? AND status = 'queued' RETURNING id").get(Number(b.id));
      if (!changed) throw new HttpError(409, "این پیام دیگر در صف نیست. وضعیت را تازه‌سازی کنید.");
      audit(session, "cancel", "message", Number(b.id));
      return ok({ done: true });
    }
    if (b.action === "retry_all_failed") {
      const failed = db.prepare(`SELECT m.* FROM messages m LEFT JOIN repair_tickets t ON t.id=m.ticket_id LEFT JOIN customers c ON c.id=m.customer_id
        WHERE m.status='failed' AND m.direction='out' AND m.channel='sms'
        AND (? IS NULL OR COALESCE(m.branch_id,t.branch_id,c.branch_id,(SELECT MIN(a.branch_id) FROM customer_branch_access a WHERE a.customer_id=m.customer_id HAVING COUNT(*)=1))=?) LIMIT 50`).all(branch, branch) as any[];
      let sent = 0;
      for (const f of failed) {
        const msg = db.prepare("UPDATE messages SET status='sending' WHERE id=? AND status='failed' RETURNING *").get(f.id) as any;
        if (!msg) continue;
        const r = await trySend(db, msg);
        db.prepare("UPDATE messages SET status = ? WHERE id = ?").run(r.ok ? "sent" : r.uncertain ? "unknown" : "failed", msg.id);
        if (r.ok) sent++;
      }
      return ok({ done: true, retried: failed.length, sent });
    }
    return fail(new Error("عملیات نامعتبر"));
  } catch (e) {
    return fail(e);
  }
}

/**
 * تلاش ارسال واقعی پیام از طریق درگاه تعریف‌شده در تنظیمات.
 * اگر provider = none یا کلید نباشد، خطا برمی‌گردد تا پیام در صف بماند.
 */
async function trySend(db: any, msg: any): Promise<{ ok: boolean; error?: string; uncertain?: boolean }> {
  const get = (k: string) => (db.prepare("SELECT value FROM settings WHERE key = ?").get(k) as any)?.value ?? "";
  const provider = get("sms_provider");
  const mobile = msg.customer_id
    ? (db.prepare("SELECT mobile FROM customers WHERE id = ?").get(msg.customer_id) as any)?.mobile
    : null;
  if (!mobile) return { ok: false, error: "شماره موبایل مشتری ثبت نشده است" };
  if (!msg.body?.trim()) return { ok: false, error: "متن پیام خالی است" };

  if (provider === "none" || !provider) {
    return { ok: false, error: "درگاه پیامک تنظیم نشده — از تنظیمات درگاه را پیکربندی کنید" };
  }

  const storedKey = get("sms_api_key");
  let apiKey: string;
  try { apiKey = storedKey.startsWith("v2.") ? decryptCredential(storedKey) : storedKey; }
  catch { return { ok: false, error: "کلید درگاه قابل بازیابی نیست. تنظیمات کلید رمزگذاری را بررسی کنید." }; }
  const sender = get("sms_sender");
  if (!apiKey) return { ok: false, error: "کلید API درگاه پیامک ثبت نشده است" };

  try {
    let url = "", payload: any = null;
    if (provider === "kavenegar") {
      url = `https://api.kavenegar.com/v1/${encodeURIComponent(apiKey)}/sms/send.json?receptor=${encodeURIComponent(mobile)}&sender=${encodeURIComponent(sender)}&message=${encodeURIComponent(msg.body)}`;
    } else if (provider === "melipayamak") {
      url = "https://rest.payamak-panel.com/api/SendSMS/SendSMS";
      payload = { username: apiKey.split("|")[0] ?? "", password: apiKey.split("|")[1] ?? "", to: mobile, from: sender, text: msg.body };
    } else if (provider === "ghasedak") {
      url = "https://gateway.ghasedak.me/rest/api/v1/WebService/SendSingleSMS";
      payload = { receptor: mobile, lineNumber: sender, message: msg.body, clientReferenceId: String(msg.id), udh: true };
    } else if (provider === "custom") {
      url = get("sms_webhook_url");
      if (!url) return { ok: false, error: "آدرس وب‌هوک درگاه سفارشی تنظیم نشده است" };
      payload = { to: mobile, from: sender, text: msg.body };
    } else {
      return { ok: false, error: "درگاه پیامک ناشناخته است" };
    }

    let target: URL;
    try { target = assertOutboundUrl(url); }
    catch { return { ok: false, error: "دامنه درگاه مجاز نیست. تنظیمات امن استقرار را بررسی کنید." }; }
    const res = await fetch(target, {
      redirect: "error",
      method: payload ? "POST" : "GET",
      headers: { "Content-Type": provider === "melipayamak" ? "application/x-www-form-urlencoded" : "application/json", ...(provider === "ghasedak" ? { ApiKey: apiKey } : provider === "custom" ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: payload ? provider === "melipayamak" ? new URLSearchParams(payload).toString() : JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { ok: false, uncertain: res.status >= 500, error: `درگاه پاسخ ${res.status} داد` };
    const result = await res.json();
    const accepted = provider === "kavenegar" ? result?.return?.status === 200 && Array.isArray(result.entries) && result.entries.length > 0
      : provider === "melipayamak" ? Number(result?.RetStatus) === 1 && Number(result?.Value) > 0
      : provider === "ghasedak" ? result?.IsSuccess === true && result?.StatusCode === 200 && Boolean(result?.Data?.MessageId)
      : result?.ok === true;
    if (!accepted) return { ok: false, error: "درگاه پذیرش پیام را تأیید نکرد. گزارش درگاه را بررسی کنید." };
    return { ok: true };
  } catch {
    return { ok: false, uncertain: true, error: "پاسخ معتبر از درگاه دریافت نشد. پیش از تلاش مجدد، وضعیت پیام را نزد درگاه بررسی کنید." };
  }
}
