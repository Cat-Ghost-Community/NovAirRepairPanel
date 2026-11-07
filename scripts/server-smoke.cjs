#!/usr/bin/env node
/**
 * تست دودی سرور تولیدی «تعمیرکار»
 *
 * همهٔ بخش‌های سایت را روی یک سرور در حال اجرا بررسی می‌کند:
 *   1) /api/health بدون احراز هویت باید 200 بدهد
 *   2) ورود با حساب مالک و دریافت کوکی نشست
 *   3) همهٔ صفحه‌ها با نشست باید 200/3xx بدهند (هیچ 5xx یا حلقهٔ ریدایرکت نباشد)
 *   4) مسیرهای API بدون نشست باید 401 بدهند (نه 500)
 *
 * اجرا:
 *   node scripts/server-smoke.cjs                       # http://127.0.0.1:3000
 *   BASE_URL=http://127.0.0.1:3210 node scripts/server-smoke.cjs
 *   EMAIL=owner@repaid.local PASSWORD=demo1234 node scripts/server-smoke.cjs
 *
 * کد خروج 1 در صورت وجود خطا ⇒ مناسب برای گیت پیش از استقرار.
 */
const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const EMAIL = process.env.EMAIL || "owner@repaid.local";
const PASSWORD = process.env.PASSWORD || "demo1234";
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 30000);

/** صفحه‌های عمومی که بدون نشست هم باید بالا بیایند */
const PUBLIC_PAGES = ["/login", "/track"];

/** همهٔ بخش‌های محافظت‌شدهٔ سایت */
const PAGES = [
  "/",
  "/appointments",
  "/audit",
  "/bank",
  "/calendar",
  "/chat",
  "/checks",
  "/communication",
  "/complaints",
  "/customers",
  "/customers/new",
  "/daily-report",
  "/devices",
  "/devices/new",
  "/estimates",
  "/expenses",
  "/expenses/new",
  "/finance",
  "/installments",
  "/inventory-tools",
  "/invoices",
  "/invoices/new",
  "/labels",
  "/outbox",
  "/parts",
  "/parts/new",
  "/payments",
  "/payments/new",
  "/payroll",
  "/pos",
  "/purchase-orders",
  "/purchase-orders/new",
  "/repairs",
  "/repairs/assignment",
  "/repairs/board",
  "/repairs/bulk",
  "/repairs/new",
  "/repairs/queue",
  "/repairs/quick",
  "/report-builder",
  "/reports",
  "/reports/iran",
  "/reports/vat",
  "/serials",
  "/settings",
  "/suppliers",
  "/suppliers/new",
  "/team",
  "/warranty",
];

/** مسیرهای API که با GET باید بدون خطای سرور پاسخ دهند */
const API_GETS = [
  "/api/health",
  "/api/search?q=",
  "/api/notifications",
  "/api/branches",
  "/api/chat/conversations",
  "/api/chat/events?cursor=0",
  "/api/chat/search?q=%D8%AA%D8%B3%D8%AA",
  "/api/chat/summary",
  "/api/chat/users",
  "/api/parts/search?q=",
  "/api/repairs/assignment",
  "/api/repairs/queue",
  "/api/repairs/technicians",
  "/api/serials?q=",
  "/api/customers/lookup?q=",
  "/api/settings",
  "/api/settings/flags",
  "/api/team/permissions",
  "/api/services",
  "/api/reports/iran?from=1400/01/01&to=1400/12/29",
  "/api/daily-reports?from=1400/01/01&to=1400/12/29",
  "/api/repair-templates",
  "/api/intake-questions",
  "/api/warranties",
  "/api/payroll?from=1400/01/01&to=1400/12/29",
];

const crypto = require("node:crypto");
const results = { pass: 0, fail: [], skip: [] };

function record(ok, label, detail) {
  if (ok) {
    results.pass += 1;
  } else {
    results.fail.push(`${label} → ${detail}`);
  }
}

function skip(label, why) {
  results.skip.push(`${label} (${why})`);
}

/** نخستین رکورد دارای id را از آرایه‌های پاسخ یک API لیست برمی‌گرداند */
async function firstRow(apiPath, authed) {
  const r = await req(apiPath, authed);
  if (r.status < 200 || r.status >= 300) return null;
  let json;
  try { json = JSON.parse(r.body); } catch { return null; }
  for (const value of Object.values(json)) {
    if (Array.isArray(value) && value[0] && value[0].id != null) return value[0];
  }
  return null;
}

async function req(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + path, {
      redirect: "manual",
      signal: ctrl.signal,
      headers: { origin: BASE, ...(opts.headers || {}) },
      ...opts,
    });
    const body = await res.text().catch(() => "");
    return { status: res.status, location: res.headers.get("location") || "", setCookie: res.headers.getSetCookie?.() || [], body };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log(`\n🔎 تست دودی ${BASE}\n`);

  // 1) health
  const health = await req("/api/health");
  let healthJson = null;
  try { healthJson = JSON.parse(health.body); } catch {}
  record(
    health.status === 200 && healthJson?.status === "ok",
    "GET /api/health",
    `status=${health.status} body=${health.body.slice(0, 120)}`
  );
  if (healthJson) console.log(`   health: v${healthJson.version} · دیتابیس ${healthJson.database}`);

  // 2) صفحات عمومی
  for (const p of PUBLIC_PAGES) {
    const r = await req(p);
    record(r.status === 200, `GET ${p} (عمومی)`, `status=${r.status}`);
  }

  // 3) مسیر محافظت‌شدهٔ بدون نشست باید به /login برود
  const guard = await req("/");
  record(
    guard.status === 307 || guard.status === 302 || guard.status === 308,
    "GET / بدون نشست",
    `status=${guard.status} (انتظار ریدایرکت به /login)`
  );

  // 4) ورود
  const login = await req("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const cookie = login.setCookie.map((c) => c.split(";")[0]).join("; ");
  record(login.status === 200 && /repaid_session=/.test(cookie), "POST /api/auth/login", `status=${login.status}`);
  if (!/repaid_session=/.test(cookie)) {
    finish();
    return;
  }
  const authed = { headers: { cookie } };

  // 5) بکاپ دیتابیس (مسیر حساس، فقط با نشست)
  const backup = await req("/api/backup", authed);
  record(backup.status === 200 && backup.body.length > 0, "GET /api/backup", `status=${backup.status} bytes=${backup.body.length}`);

  // 6) همهٔ صفحه‌ها با نشست
  for (const p of PAGES) {
    const r = await req(p, authed);
    const ok = r.status >= 200 && r.status < 400;
    record(ok, `GET ${p}`, `status=${r.status}${r.location ? " → " + r.location : ""}`);
  }

  // 6.۵) مسیرهای پویا (جزئیات) — شناسهٔ هر رکورد از API لیست همان بخش گرفته می‌شود
  const detail = async (label, path) => {
    const r = await req(path, authed);
    record(
      r.status >= 200 && r.status < 400,
      `GET ${path}`,
      `status=${r.status}${r.location ? " → " + r.location : ""} (${label})`
    );
  };

  const repair = await firstRow("/api/repairs?page=1", authed);
  if (repair) {
    await detail("جزئیات پذیرش", `/repairs/${repair.id}`);
    await detail("رسید پذیرش", `/repairs/${repair.id}/receipt`);

    // «مسیر تعمیر» — ساختار رویدادها و خلاصهٔ میلستون‌ها
    const journey = await req(`/api/repairs/${repair.id}/journey`, authed);
    let journeyJson = null;
    try { journeyJson = JSON.parse(journey.body); } catch {}
    record(
      journey.status === 200 && Array.isArray(journeyJson?.events) && journeyJson?.summary && typeof journeyJson.summary === "object",
      "GET /api/repairs/[id]/journey (ساختار)",
      `status=${journey.status} events=${journeyJson?.events?.length ?? "?"}`
    );
    record(
      (journeyJson?.events ?? []).length > 0 && typeof journeyJson?.summary?.accepted_at === "string",
      "مسیر تعمیر: رویداد پذیرش و زمان ثبت دارد",
      `accepted_at=${journeyJson?.summary?.accepted_at ?? "—"}`
    );
  } else skip("مسیرهای /repairs/[id]", "داده‌ای برای پذیرش وجود ندارد");

  // کارتابل ارجاع — ساختار دو ستون + تعمیرکاران با بار کاری
  {
    const dash = await req("/api/repairs/assignment", authed);
    let dashJson = null;
    try { dashJson = JSON.parse(dash.body); } catch {}
    record(
      dash.status === 200 && Array.isArray(dashJson?.awaiting) && Array.isArray(dashJson?.assigned) && Array.isArray(dashJson?.technicians),
      "GET /api/repairs/assignment (ساختار دو ستون)",
      `status=${dash.status} awaiting=${dashJson?.awaiting?.length ?? "?"} assigned=${dashJson?.assigned?.length ?? "?"}`
    );
    const techs = dashJson?.technicians ?? [];
    if (techs.length > 0) {
      record(
        techs.every((t) => typeof t.active_count === "number" && typeof t.in_progress_count === "number"),
        "تعمیرکاران: بار کاری واقعی",
        techs.map((t) => `${t.name}:${t.active_count}`).join("، ")
      );
    } else skip("تعمیرکاران کارتابل", "تعمیرکار فعالی ثبت نشده");
  }

  const customer = await firstRow("/api/customers?page=1", authed);
  if (customer) {
    await detail("پرونده مشتری", `/customers/${customer.id}`);
    await detail("صورتحساب مشتری", `/customers/${customer.id}/statement`);
    const device = await firstRow(`/api/devices?customer_id=${customer.id}`, authed);
    if (device) await detail("جزئیات دستگاه", `/devices/${device.id}`);
    else skip("مسیر /devices/[id]", "دستگاهی برای این مشتری نیست");
  } else skip("مسیرهای /customers/[id]", "دادهای برای مشتری وجود ندارد");

  for (const [api, path] of [
    ["/api/parts?page=1", (id) => `/parts/${id}`],
    ["/api/suppliers", (id) => `/suppliers/${id}`],
    ["/api/purchase-orders?page=1", (id) => `/purchase-orders/${id}`],
    ["/api/invoices?page=1", (id) => `/invoices/${id}`],
  ]) {
    const row = await firstRow(api, authed);
    if (row) await detail("جزئیات", path(row.id));
    else skip(`جزئیات ${api}`, "رکوردی وجود ندارد");
  }

  // فاکتور یکپارچه — ساختار فهرست، تنظیمات و جزئیات
  {
    const cfg = await req("/api/invoices/config", authed);
    let cfgJson = null;
    try { cfgJson = JSON.parse(cfg.body); } catch {}
    record(
      cfg.status === 200 && typeof cfgJson?.tax_rate === "number" && typeof cfgJson?.can_invoice === "boolean",
      "GET /api/invoices/config (ساختار)",
      `status=${cfg.status} tax=${cfgJson?.tax_rate ?? "?"}`
    );
    const list = await req("/api/invoices", authed);
    let listJson = null;
    try { listJson = JSON.parse(list.body); } catch {}
    record(list.status === 200 && Array.isArray(listJson?.invoices), "GET /api/invoices (ساختار)", `count=${listJson?.invoices?.length ?? "?"}`);
    if (Array.isArray(listJson?.invoices) && listJson.invoices.length > 0) {
      const one = listJson.invoices[0];
      const det = await req(`/api/invoices/${one.id}`, authed);
      let detJson = null;
      try { detJson = JSON.parse(det.body); } catch {}
      record(
        det.status === 200 && detJson?.invoice && Array.isArray(detJson?.items) && Array.isArray(detJson?.payments),
        "GET /api/invoices/[id] (اقلام/پرداخت‌ها/چک‌ها)",
        `number=${detJson?.invoice?.number ?? "?"} items=${detJson?.items?.length ?? "?"}`
      );
      record(
        ["purchase", "sale", "repair"].includes(detJson?.invoice?.type ?? "repair"),
        "نوع فاکتور در جزئیات معتبر است",
        `type=${detJson?.invoice?.type ?? "—"}`
      );
    } else skip("جزئیات فاکتور", "فاکتوری وجود ندارد");
  }

  // صفحهٔ عمومی پیگیری با توکن مشتق‌شده از شناسهٔ پذیرش (همان الگوریتم src/app/track/[token]/page.tsx)
  if (repair) {
    const token = crypto.createHash("sha256").update(`track:${repair.id}:repaid-local-secret`).digest("hex").slice(0, 24);
    await detail("پیگیری عمومی", `/track/${token}`);
  }

  // 6.۸) چت سازمانی — پاسخ ساختاری درست (فقط خواندنی؛ نوشتن در تست‌های واحد پوشش دارد)
  {
    const list = await req("/api/chat/conversations", authed);
    let listJson = null;
    try { listJson = JSON.parse(list.body); } catch {}
    const conversationsOk = list.status === 200 && Array.isArray(listJson?.conversations);
    record(conversationsOk, "GET /api/chat/conversations (ساختار)", `status=${list.status}`);
    if (conversationsOk) {
      record(listJson.conversations.length > 0, "چت: seed دادهٔ نمونه دارد", `conversations=${listJson.conversations.length}`);
      const first = listJson.conversations[0];
      record(
        first && typeof first.unread_count === "number" && typeof first.member_count === "number",
        "چت: شمارنده‌های ناخوانده/اعضا",
        JSON.stringify(first ? { unread_count: first.unread_count, member_count: first.member_count } : null)
      );
    }
    const events = await req("/api/chat/events?cursor=0", authed);
    let evJson = null;
    try { evJson = JSON.parse(events.body); } catch {}
    record(
      events.status === 200 && typeof evJson?.cursor === "number" && Array.isArray(evJson?.events) && Array.isArray(evJson?.typing),
      "GET /api/chat/events (ساختار)",
      `status=${events.status}`
    );
    const summary = await req("/api/chat/summary", authed);
    let sumJson = null;
    try { sumJson = JSON.parse(summary.body); } catch {}
    record(
      summary.status === 200 && typeof sumJson?.unread_total === "number",
      "GET /api/chat/summary (ساختار)",
      `status=${summary.status}`
    );
  }

  // 7) API ها بدون نشست ⇒ 401 یا ریدایرکت ورود (نه ۵۰۰ و نه داده)
  for (const p of API_GETS.filter((x) => x !== "/api/health")) {
    const r = await req(p);
    const guarded = r.status === 401 || (r.status >= 300 && r.status < 400);
    record(guarded, `GET ${p} بدون نشست`, `status=${r.status} (انتظار 401 یا ریدایرکت)`);
  }

  // 8) API ها با نشست ⇒ بدون خطای سرور و بدون مسیر گمشده
  for (const p of API_GETS) {
    const r = await req(p, authed);
    const ok = r.status < 500 && r.status !== 404;
    record(ok, `GET ${p}`, `status=${r.status}${r.status >= 400 ? " " + r.body.slice(0, 200) : ""}`);
  }

  // 9) خروج
  const logout = await req("/api/auth/logout", { method: "POST", ...authed });
  record(logout.status >= 200 && logout.status < 400, "POST /api/auth/logout", `status=${logout.status}`);

  finish();
}

function finish() {
  console.log(`\n✅ موفق: ${results.pass}`);
  if (results.skip.length) {
    console.log(`⏭️  ردشده: ${results.skip.length}`);
    for (const s of results.skip) console.log("   - " + s);
  }
  if (results.fail.length) {
    console.log(`❌ ناموفق: ${results.fail.length}`);
    for (const f of results.fail) console.log("   - " + f);
    process.exit(1);
  }
  console.log("🎉 همهٔ بخش‌های سایت روی سرور سالم پاسخ می‌دهند.\n");
}

main().catch((e) => {
  console.error("اجرای تست دودی شکست خورد:", e);
  process.exit(1);
});
