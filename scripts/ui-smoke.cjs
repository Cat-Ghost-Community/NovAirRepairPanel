#!/usr/bin/env node
/**
 * تست دودی مرورگری «تعمیرکار» — با مرورگر واقعی
 *
 * همهٔ صفحه‌های اصلی را با نشست مالک باز می‌کند و خطاهای کنسول/صفحه، پاسخ‌های 5xx و
 * ریدایرکت به /login را جمع می‌زند؛ سپس چند تعامل کلیدی را امتحان می‌کند.
 *
 * اجرا (سرور باید در حال اجرا باشد):
 *   npm start && node scripts/ui-smoke.cjs
 *   BASE_URL=http://127.0.0.1:3210 CHROME_PATH="C:\path\chrome.exe" node scripts/ui-smoke.cjs
 */
const fs = require("node:fs");
const path = require("node:path");

let chromium;
try {
  ({ chromium } = require("playwright-core"));
} catch {
  console.log("⚠ playwright-core نصب نیست — اجرای تست مرورگری رد شد.");
  process.exit(1);
}

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const EMAIL = process.env.EMAIL || "owner@repaid.local";
const PASSWORD = process.env.PASSWORD || "demo1234";

/** مسیر کروم: اول CHROME_PATH، بعد کش ms-playwright، بعد نصب‌های رایج */
function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const root = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  if (root && fs.existsSync(root)) {
    const dirs = fs
      .readdirSync(root)
      .filter((d) => d.startsWith("chromium-"))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const d of dirs) {
      for (const rel of ["chrome-win64/chrome.exe", "chrome-win/chrome.exe", "chrome-linux/chrome"]) {
        const p = path.join(root, d, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  const common = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  return common.find((p) => fs.existsSync(p)) || null;
}

const PAGES = [
  "/", "/settings", "/tariffs", "/suppliers", "/suppliers/1", "/repairs", "/repairs/55", "/pos",
  "/customers", "/customers/new", "/devices", "/parts", "/invoices", "/payments", "/estimates",
  "/finance", "/reports", "/team", "/inventory-tools", "/calendar", "/daily-report", "/warranty",
  "/audit", "/appointments", "/communication", "/checks", "/installments", "/bank", "/expenses",
  "/payroll", "/serials", "/labels", "/report-builder", "/outbox", "/complaints", "/track",
];

(async () => {
  const exe = findChrome();
  if (!exe) {
    console.log("⚠ کروم پیدا نشد (CHROME_PATH را تنظیم کنید یا: npx playwright install chromium) — رد شد.");
    process.exit(1);
  }
  const browser = await chromium.launch({ executablePath: exe });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "fa-IR" });
  const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
  if (login.status() !== 200) {
    console.log(`اجرای تست شکست خورد: ورود با ${EMAIL} ناموفق بود (${login.status()})`);
    await browser.close();
    process.exit(1);
  }

  const problems = [];
  let okCount = 0;
  for (const url of PAGES) {
    const page = await ctx.newPage();
    const errs = [];
    const fails = [];
    page.on("pageerror", (e) => errs.push("pageerror:" + String(e.message).slice(0, 140)));
    page.on("console", (m) => {
      if (m.type() === "error" && !m.text().includes("?_rsc=")) errs.push("console:" + m.text().slice(0, 140));
    });
    page.on("response", (r) => {
      if (r.status() >= 500) fails.push(`${r.status()} ${(r.url().split(BASE)[1] || r.url()).slice(0, 60)}`);
    });
    try {
      const resp = await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 40000 });
      await page.waitForTimeout(900);
      const overlay = await page.locator("text=/Application error|Unhandled Runtime Error|Internal Server Error/i").count();
      const landed = page.url().replace(BASE, "");
      const code = resp ? resp.status() : 0;
      const bad = code >= 400 || landed.startsWith("/login") || overlay > 0 || errs.length > 0 || fails.length > 0;
      if (bad) problems.push({ url, code, landed, overlay, errs: errs.slice(0, 2), fails: fails.slice(0, 2) });
      else okCount += 1;
      console.log(`${bad ? "FAIL" : "ok  "} ${url} -> ${code}`);
    } catch (e) {
      problems.push({ url, error: String(e.message).slice(0, 140) });
      console.log(`ERR  ${url}`);
    }
    await page.close();
  }

  const interactions = [];
  async function withPage(label, fn) {
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 120)));
    try {
      await fn(page, errs);
    } catch (e) {
      interactions.push({ what: label, error: String(e.message).slice(0, 160) });
    }
    await page.close();
  }

  await withPage("settings: تعویض تب", async (page, errs) => {
    await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded", timeout: 30000 });
    const tabs = page.getByRole("tab");
    const n = await tabs.count();
    await tabs.nth(Math.min(2, n - 1)).click();
    await page.waitForTimeout(700);
    interactions.push({ what: "settings: تعویض تب", tabs: n, hash: (await page.url()).split("#")[1] || "-", errs: errs.slice(0, 1) });
  });

  await withPage("پذیرش: تب قطعات و اجرت", async (page, errs) => {
    await page.goto(`${BASE}/repairs/55`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.getByRole("tab", { name: /قطعات و اجرت/ }).first().click();
    await page.waitForTimeout(1200);
    const card = await page.locator("text=/افزودن از تعرفه/").count();
    interactions.push({ what: "پذیرش: تب قطعات و اجرت", tariffCard: card, errs: errs.slice(0, 2) });
  });

  await withPage("تأمین‌کننده: پنل لیست خرید", async (page, errs) => {
    await page.goto(`${BASE}/suppliers/1`, { waitUntil: "domcontentloaded", timeout: 30000 });
    const found = await page.locator("text=/لیست خرید/").count();
    interactions.push({ what: "تأمین‌کننده: پنل لیست خرید", found, errs: errs.slice(0, 2) });
  });

  console.log(`\nصفحه‌های سالم: ${okCount}/${PAGES.length}`);
  console.log("=== مشکلات ===");
  console.log(JSON.stringify(problems, null, 1));
  console.log("=== تعامل‌ها ===");
  console.log(JSON.stringify(interactions, null, 1));
  await browser.close();
  process.exit(problems.length || interactions.some(item => item.error || item.errs?.length) ? 1 : 0);
})();
