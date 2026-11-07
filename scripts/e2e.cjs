/**
 * تست E2E خودکار — پوشش کامل گردش‌های کار اصلی
 * اجرا: سرور production روی 3210 در حال اجرا باشد → node scripts/e2e.cjs
 * داده‌های تستی بعد از اجرا پاک می‌شوند.
 */
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3210";
const { DatabaseSync } = require("node:sqlite");
const DB_PATH = process.env.E2E_DB || "data/repaid.db";
if (process.env.E2E_ALLOW_MUTATIONS !== "1" || !process.env.E2E_DB) throw new Error("Run only on an isolated fixture with E2E_ALLOW_MUTATIONS=1 and an explicit E2E_DB.");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : " — " + detail}`);
}

function getDb() {
  return new DatabaseSync(DB_PATH);
}

async function makeApi() {
  const db = getDb();
  const user = db.prepare("SELECT email FROM users WHERE role = 'owner' AND is_active = 1 LIMIT 1").get();
  db.close();
  const loginRes = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email: user.email, password: "demo1234" }),
  });
  const setCookie = loginRes.headers.get("set-cookie") ?? "";
  const m = setCookie.match(/repaid_session=([^;]+)/);
  if (!m) throw new Error("login failed: " + loginRes.status);
  const cookie = "repaid_session=" + m[1];
  const call = async (path, method = "GET", body) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { "content-type": "application/json", "idempotency-key": require("node:crypto").randomUUID(), cookie, origin: BASE },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { RAW: text.slice(0, 100) }; }
    return { status: res.status, data };
  };
  call.cookie = cookie;
  return call;
}

async function main() {
  const db = getDb();
  const api = await makeApi();
  const cookieFromApi = api.cookie;

  const stamp = "E2E" + Date.now().toString(36).toUpperCase();
  const created = { customers: [], devices: [], tickets: [], invoices: [], payments: [], refunds: [], sales: [], pos: [], checks: [], expenses: [], appointments: [], complaints: [], claims: [], messages: [], users: [], parts: [] };

  try {
    // ---------- ۱) گردش کار پذیرش کامل ----------
    const cust = await api("/api/customers", "POST", { first_name: "تست", last_name: stamp, mobile: "0999" + String(Date.now()).slice(-7) });
    check("ساخت مشتری", cust.status === 200 && !!cust.data.id, JSON.stringify(cust.data).slice(0, 80));
    const cid = cust.data.id; created.customers.push(cid);
    if (!cid) throw new Error("Customer fixture creation failed; dependent checks aborted.");

    const dev = await api("/api/devices", "POST", { customer_id: cid, type: "موبایل", brand: "برندتست", model: "مدلتست", serial: stamp });
    check("ساخت دستگاه", dev.status === 200 && !!dev.data.id, JSON.stringify(dev.data).slice(0, 80));
    const did = dev.data.id; created.devices.push(did);

    const rep = await api("/api/repairs", "POST", { customer_id: cid, device_id: did, problem: "تست E2E", priority: "high" });
    check("ثبت پذیرش", rep.status === 200 && !!rep.data.id, JSON.stringify(rep.data).slice(0, 80));
    const rid = rep.data.id; created.tickets.push(rid);

    // تنظیمات سایت باید پیش‌فرض‌ها را اعمال کند: هزینهٔ عیب‌یابی و سقف اعتبار مشتری
    const settingDiag = Number((db.prepare("SELECT value FROM settings WHERE key = 'diagnostic_fee'").get() ?? {}).value ?? 0);
    const ticketRow = db.prepare("SELECT diagnostic_fee FROM repair_tickets WHERE id = ?").get(rid);
    check("پیش‌فرض هزینهٔ عیب‌یابی از تنظیمات اعمال شد", Number(ticketRow.diagnostic_fee) === settingDiag, `ticket=${ticketRow.diagnostic_fee} setting=${settingDiag}`);
    const custRow = db.prepare("SELECT credit_limit FROM customers WHERE id = ?").get(cid);
    const settingCredit = Number((db.prepare("SELECT value FROM settings WHERE key = 'default_credit_limit'").get() ?? {}).value ?? 0);
    check("سقف اعتبار پیش‌فرض مشتری از تنظیمات اعمال شد", Number(custRow.credit_limit) === settingCredit, `customer=${custRow.credit_limit} setting=${settingCredit}`);

    // انتقال وضعیت‌های مجاز + تست رد غیرمجاز
    const bad = await api(`/api/repairs/${rid}/status`, "POST", { status: "Delivered" });
    check("انتقال غیرمجاز رد شد با پیام فارسی", bad.status === 400 && /[\u0600-\u06FF]/.test(bad.data.error ?? ""), JSON.stringify(bad.data).slice(0, 90));
    for (const s of ["Received", "Diagnosing", "In Repair", "Quality Control", "Ready for Pickup", "Delivered"]) {
      const r = await api(`/api/repairs/${rid}/status`, "POST", { status: s });
      check(`انتقال به ${s}`, r.status === 200, JSON.stringify(r.data).slice(0, 80));
    }

    // زمان‌سنج
    const t1 = await api(`/api/repairs/${rid}/time`, "POST", { action: "start" });
    check("شروع زمان‌سنج", t1.status === 200, JSON.stringify(t1.data).slice(0, 60));
    const t2 = await api(`/api/repairs/${rid}/time`, "POST", { action: "stop" });
    check("توقف زمان‌سنج", t2.status === 200 && typeof t2.data.minutes === "number", JSON.stringify(t2.data).slice(0, 60));

    // ---------- ۲) فروش POS ----------
    const sale = await api("/api/sales", "POST", { customer_id: cid, items: [{ kind: "part", ref_id: 5, name: "فن تست", qty: 1, unit_price: 500000 }], method: "cash" });
    check("فروش صندوق", sale.status === 200 && !!sale.data.id, JSON.stringify(sale.data).slice(0, 80));
    if (sale.data.id) created.sales.push(sale.data.id);

    // ---------- ۳) خرید + سفارش ----------
    const po = await api("/api/purchase-orders", "POST", { supplier_id: 1, items: [{ part_id: 5, name: "فن", qty: 2, unit_cost: 300000 }] });
    check("ثبت سفارش خرید", po.status === 200 && !!po.data.id, JSON.stringify(po.data).slice(0, 80));
    if (po.data.id) created.pos.push(po.data.id);

    // ---------- ۴) مالی ----------
    const chk = await api("/api/checks", "POST", { direction: "received", amount: 1000000, due_date: "2027-01-20", party_id: cid });
    check("ثبت چک", chk.status === 200 && !!chk.data.id, JSON.stringify(chk.data).slice(0, 80));
    if (chk.data.id) created.checks.push(chk.data.id);

    const exp = await api("/api/expenses", "POST", { category: "تست", amount: 100000, description: stamp });
    check("ثبت هزینه", exp.status === 200, JSON.stringify(exp.data).slice(0, 80));

    // ---------- ۵) ارتباط با مشتری ----------
    const appt = await api("/api/appointments", "POST", { customer_id: cid, device_id: did, preferred_at: "2027-01-15 10:00", notes: stamp });
    check("ثبت نوبت", appt.status === 200, JSON.stringify(appt.data).slice(0, 80));

    const compl = await api("/api/complaints", "POST", { customer_id: cid, category: "سایر", description: "شرح تست " + stamp });
    check("ثبت شکایت", compl.status === 200, JSON.stringify(compl.data).slice(0, 80));

    const msg = await api("/api/messages/send", "POST", { customer_id: cid, body: "پیام تست " + stamp });
    check("ارسال پیام", msg.status === 200, JSON.stringify(msg.data).slice(0, 80));

    // ---------- ۶) کاربران ----------
    const nu = await api("/api/users", "POST", { name: "کاربر تست", email: stamp.toLowerCase() + "@test.local", password: "test-password-123", role: "technician", branch_id: 1 });
    check("ساخت کاربر", (nu.status === 200 || nu.status === 201) && !!nu.data.id, JSON.stringify(nu.data).slice(0, 80));
    if (nu.data.id) created.users.push(nu.data.id);

    const dup = await api("/api/users", "POST", { name: "دوباره", email: stamp.toLowerCase() + "@test.local", password: "test-password-123", role: "technician", branch_id: 1 });
    check("ایمیل تکراری رد شد", dup.status === 409, JSON.stringify(dup.data).slice(0, 80));

    if (nu.data.id) {
      const upd = await api(`/api/users/${nu.data.id}`, "PATCH", { is_active: 0 });
      check("غیرفعال‌سازی کاربر", upd.status === 200, JSON.stringify(upd.data).slice(0, 60));
    }

    // رمز کم
    const sh = await api("/api/users", "POST", { name: "کم", email: stamp.toLowerCase() + "2@test.local", password: "123", role: "technician" });
    check("گذرواژه کوتاه رد شد", sh.status === 400, JSON.stringify(sh.data).slice(0, 80));

    // ---------- ۷) مالی: فاکتور، پرداخت و استرداد وجه ----------
    const item = await api(`/api/repairs/${rid}/items`, "POST", { kind: "labor", name: "اجرت تست " + stamp, unit_price: 2000000 });
    check("افزودن اجرت به پذیرش", item.status === 200, JSON.stringify(item.data).slice(0, 80));
    const inv = await api(`/api/repairs/${rid}/invoice`, "POST", {});
    check("صدور فاکتور", inv.status === 200 && !!inv.data.id, JSON.stringify(inv.data).slice(0, 80));
    const invId = inv.data.id;
    if (invId) created.invoices.push(invId);

    let paymentId = null;
    if (invId) {
      const pay = await api("/api/payments", "POST", { customer_id: cid, invoice_id: invId, amount: 2000000, method: "cash" });
      check("ثبت پرداخت روی فاکتور", pay.status === 200, JSON.stringify(pay.data).slice(0, 80));
      paymentId = pay.data.id ?? pay.data.payment_id ?? null;
      if (paymentId) created.payments.push(Number(paymentId));
    }

    if (paymentId) {
      const over = await api("/api/payments/refund", "POST", { payment_id: paymentId, amount: 9000000, reason: "بیش از سقف " + stamp });
      check("استرداد بیش از سقف رد شد", over.status >= 400, "status=" + over.status + " " + JSON.stringify(over.data).slice(0, 70));

      const ref = await api("/api/payments/refund", "POST", { payment_id: paymentId, amount: 500000, reason: "خرابی قطعه " + stamp });
      check("ثبت استرداد وجه", ref.status === 200, JSON.stringify(ref.data).slice(0, 80));
      const refundRow = db.prepare("SELECT id, amount, branch_id FROM refunds WHERE payment_id = ? ORDER BY id DESC LIMIT 1").get(paymentId);
      check("استرداد در دیتابیس ثبت و به شعبه نسبت داده شد", !!refundRow && Number(refundRow.amount) === 500000 && refundRow.branch_id != null, JSON.stringify(refundRow));
      if (refundRow) created.refunds = [Number(refundRow.id)];
    }

    // ---------- ۸) قفل شعبه و رد دسترسی غیرمجاز ----------
    const locked = db.prepare("SELECT email, branch_id FROM users WHERE role = 'technician' AND branch_id = 2 AND is_active = 1 LIMIT 1").get();
    if (locked) {
      const lg = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ email: locked.email, password: "demo1234" }) });
      const lc = (lg.headers.get("set-cookie") ?? "").match(/repaid_session=([^;]+)/);
      if (lc) {
        const cookie2 = "repaid_session=" + lc[1];
        const pageRes = await fetch(BASE + "/repairs?e2e=" + stamp, { headers: { cookie: cookie2 } });
        const html = await pageRes.text();
        const foreign = db.prepare("SELECT number FROM repair_tickets WHERE branch_id != ? LIMIT 5").all(Number(locked.branch_id)).map((r) => r.number);
        const leaked = foreign.filter((n) => html.includes(`>${n}<`) || html.includes(`"${n}"`));
        check("قفل شعبه: کاربر شعبهٔ ۲ پذیرش‌های شعبهٔ دیگر را نمی‌بیند", pageRes.status === 200 && leaked.length === 0, "leaked=" + leaked.join(","));

        const forbidden = await fetch(BASE + "/api/expenses", { method: "POST", headers: { "content-type": "application/json", cookie: cookie2, origin: BASE }, body: JSON.stringify({ category: "تست", amount: 1000, description: "نفوذ " + stamp }) });
        check("دسترسی غیرمجاز به API هزینه رد شد", forbidden.status === 403, "status=" + forbidden.status);

        const noPerm = await fetch(BASE + "/settings", { headers: { cookie: cookie2 }, redirect: "manual" });
        const noPermBody = noPerm.status === 200 ? await noPerm.text() : "";
        check("صفحهٔ تنظیمات برای کاربر بی‌مجوز بازنمی‌شود", noPerm.status === 307 || !noPermBody.includes("ذخیره تنظیمات"), "status=" + noPerm.status);
      }
    }

    // ---------- ۹) قفل شعبه روی فهرست‌های وابسته (برآورد/قسط) ----------
    const mgr = db.prepare("SELECT email, branch_id FROM users WHERE role = 'manager' AND branch_id = 2 AND is_active = 1 LIMIT 1").get();
    if (mgr) {
      const lg2 = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ email: mgr.email, password: "demo1234" }) });
      const lc2 = (lg2.headers.get("set-cookie") ?? "").match(/repaid_session=([^;]+)/);
      if (lc2) {
        const cookie3 = "repaid_session=" + lc2[1] + "; repaid_branch=" + mgr.branch_id;
        const foreignEstimates = db.prepare("SELECT e.number FROM estimates e LEFT JOIN repair_tickets t ON t.id = e.ticket_id WHERE t.branch_id IS NOT NULL AND t.branch_id != ? LIMIT 10").all(Number(mgr.branch_id)).map((r) => r.number).filter(Boolean);
        const estRes = await fetch(BASE + "/estimates?e2e=" + stamp, { headers: { cookie: cookie3 } });
        const estHtml = await estRes.text();
        const estLeak = foreignEstimates.filter((n) => estHtml.includes(`>${n}<`));
        check("قفل شعبه: مدیر شعبهٔ ۲ برآوردهای شعبهٔ دیگر را نمی‌بیند", estRes.status === 200 && estLeak.length === 0, "leaked=" + estLeak.join(","));

        const foreignInv = db.prepare("SELECT number FROM invoices WHERE branch_id IS NOT NULL AND branch_id != ? LIMIT 10").all(Number(mgr.branch_id)).map((r) => r.number).filter(Boolean);
        const insRes = await fetch(BASE + "/installments?e2e=" + stamp, { headers: { cookie: cookie3 } });
        const insHtml = await insRes.text();
        const insLeak = foreignInv.filter((n) => insHtml.includes(n));
        check("قفل شعبه: مدیر شعبهٔ ۲ اقساط فاکتورهای شعبهٔ دیگر را نمی‌بیند", insRes.status === 200 && insLeak.length === 0, "leaked=" + insLeak.join(","));
      }
    }

    // ---------- ۱۰) تنظیمات: فعال/غیرفعال کردن ارزش افزوده ----------
    const vatOff = await api("/api/settings", "POST", { values: { vat_enabled: "0" } });
    check("خاموش کردن ارزش افزوده ذخیره شد", vatOff.status === 200, "status=" + vatOff.status);
    const vatBad = await api("/api/settings", "POST", { values: { vat_enabled: "9" } });
    check("مقدار نامعتبر ارزش افزوده رد شد", vatBad.status === 400, "status=" + vatBad.status);
    const vatBack = await api("/api/settings", "POST", { values: { vat_enabled: "1" } });
    check("روشن کردن دوبارهٔ ارزش افزوده", vatBack.status === 200, "status=" + vatBack.status);

    // ---------- ۱۱) نبود شخصی‌سازی داشبورد ----------
    const dash = await api("/api/dashboard/layout");
    check("مسیر شخصی‌سازی داشبورد حذف شده", dash.status === 404, "status=" + dash.status);
    const dashPage = await fetch(BASE + "/?e2e=" + stamp, { headers: { cookie: cookieFromApi } });
    const dashHtml = await dashPage.text();
    check("داشبورد بدون ویجت چیدمان دلخواه", dashPage.status === 200 && !/dashboard-widgets|drag-sort|چیدمان دلخواه/.test(dashHtml), "status=" + dashPage.status);

    // ---------- ۱۲) سلامت API ----------
    for (const p of ["/api/parts?limit=5", "/api/branches", "/api/team/permissions", "/api/settings/flags", "/api/services"]) {
      const r = await api(p);
      check(`GET ${p}`, r.status === 200, "status=" + r.status);
    }
  } finally {
    // ---------- پاکسازی ----------
    try {
      for (const t of created.tickets) {
        db.exec(`DELETE FROM repair_status_history WHERE ticket_id=${t}`);
        db.exec(`DELETE FROM ticket_items WHERE ticket_id=${t}`);
        db.exec(`DELETE FROM time_entries WHERE ticket_id=${t}`);
        db.exec(`DELETE FROM repair_notes WHERE ticket_id=${t}`);
        db.exec(`DELETE FROM repair_tickets WHERE id=${t}`);
      }
      for (const s of created.sales) { db.exec(`DELETE FROM sale_items WHERE sale_id=${s}`); db.exec(`DELETE FROM payments WHERE sale_id=${s}`); db.exec(`DELETE FROM sales WHERE id=${s}`); }
      for (const p of created.pos) { db.exec(`DELETE FROM purchase_order_items WHERE po_id=${p}`); db.exec(`DELETE FROM purchase_orders WHERE id=${p}`); }
      for (const r of created.refunds) db.exec(`DELETE FROM refunds WHERE id=${r}`);
      for (const p of created.payments) db.exec(`DELETE FROM payments WHERE id=${p}`);
      for (const i of created.invoices) { db.exec(`DELETE FROM invoice_items WHERE invoice_id=${i}`); db.exec(`DELETE FROM payments WHERE invoice_id=${i}`); db.exec(`DELETE FROM invoices WHERE id=${i}`); }
      for (const c of created.checks) db.exec(`DELETE FROM checks WHERE id=${c}`);
      for (const a of created.appointments) db.exec(`DELETE FROM appointments WHERE id=${a}`);
      for (const c of created.complaints) db.exec(`DELETE FROM complaints WHERE id=${c}`);
      for (const u of created.users) db.exec(`DELETE FROM users WHERE id=${u}`);
      for (const d of created.devices) db.exec(`DELETE FROM devices WHERE id=${d}`);
      for (const c of created.customers) { db.exec(`DELETE FROM customer_events WHERE customer_id=${c}`); db.exec(`DELETE FROM customers WHERE id=${c}`); }
      db.exec(`DELETE FROM expenses WHERE description LIKE '%${stamp}%' OR category='تست' AND description LIKE '%E2E%'`);
      db.exec(`DELETE FROM messages WHERE body LIKE '%${stamp}%'`);
      db.exec(`DELETE FROM complaints WHERE description LIKE '%${stamp}%'`);
      db.exec(`DELETE FROM appointments WHERE notes LIKE '%${stamp}%'`);
      console.log("— داده‌های تستی پاک شد");
    } catch (e) { console.log("cleanup warn:", e.message); }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== ${results.length - failed.length}/${results.length} passed =====`);
  db.close();
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => { console.error("E2E fatal:", e.message); process.exitCode = 1; });
