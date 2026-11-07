import { getDb, nextSeq } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth";
import { ensureDefaultStatuses, getStatusByName, encryptSecret, addCustomerEvent } from "@/lib/repair";
import { moveStock } from "@/lib/inventory";

export function seedIfEmpty() {
  // Synthetic data is available only to explicitly invoked test fixtures.
  if (process.env.NODE_ENV !== "test" || process.env.REPAID_DEMO_MODE === "0") return;
  const db = getDb();
  ensureDefaultStatuses();
  const count = (db.prepare("SELECT COUNT(*) c FROM branches").get() as any).c;
  if (count > 0) return;

  // در استارت سرور ممکن است چند درخواست هم‌زمان برسند و قفل نوشتن SQLite
  // لحظه‌ای گرفته باشد؛ به‌جای رهاکردن خاموش seed، چند بار کوتاه تلاش می‌کنیم.
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      db.exec("BEGIN IMMEDIATE");
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      continue;
    }
    try {
      const again = (db.prepare("SELECT COUNT(*) c FROM branches").get() as any).c;
      if (again > 0) {
        db.exec("ROLLBACK");
        return;
      }
      doSeed(db);
      db.exec("COMMIT");
      return;
    } catch (e) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      throw e;
    }
  }
  // قفل پایدار ماند (نادر): درخواست بعدی دوباره تلاش می‌کند و از این‌جا عبور نمی‌کند
  console.warn("[repaid] seed deferred: database stayed locked; retrying on next request");
}

function doSeed(db: ReturnType<typeof getDb>) {
  console.log("[repaid] seeding Persian demo data...");

  // ---- شعب ----
  const insBranch = db.prepare("INSERT INTO branches(name, code, address, phone, city) VALUES(?,?,?,?,?)");
  const b1 = insBranch.run("شعبه مرکزی — خیابان ولیعصر", "VL", "تهران، خیابان ولیعصر، پلاک ۲۲۱۰", "۰۲۱-۸۸۷۷۶۶۵۵", "تهران").lastInsertRowid as number;
  const b2 = insBranch.run("شعبه سعادت‌آباد", "SA", "تهران، سعادت‌آباد، میدان کاج", "۰۲۱-۲۲۳۳۴۴۵۵", "تهران").lastInsertRowid as number;

  // ---- کاربران ----
  const insUser = db.prepare("INSERT INTO users(name, email, password_hash, role, branch_id, phone, avatar_color) VALUES(?,?,?,?,?,?,?)");
  const uOwner = insUser.run("دانیال وثوق", "owner@repaid.local", hashPassword("demo1234"), "owner", b1, "۰۹۱۲۱۲۳۴۵۶۷", "#7c3aed").lastInsertRowid as number;
  const uMgr = insUser.run("مریم کریمی", "manager@repaid.local", hashPassword("demo1234"), "manager", b1, "۰۹۱۲۱۲۳۴۵۶۸", "#0ea5e9").lastInsertRowid as number;
  const uMgr2 = insUser.run("پریا احمدی", "westgate@repaid.local", hashPassword("demo1234"), "manager", b2, "۰۹۱۲۱۲۳۴۵۶۹", "#f59e0b").lastInsertRowid as number;
  const uTech1 = insUser.run("جواد محمدی", "jake@repaid.local", hashPassword("demo1234"), "technician", b1, "۰۹۱۲۱۲۳۴۵۷۰", "#10b981").lastInsertRowid as number;
  const uTech2 = insUser.run("سوفیا رضایی", "sofia@repaid.local", hashPassword("demo1234"), "technician", b1, "۰۹۱۲۱۲۳۴۵۷۱", "#ef4444").lastInsertRowid as number;
  const uTech3 = insUser.run("عمر حسنی", "omar@repaid.local", hashPassword("demo1234"), "technician", b2, "۰۹۱۲۱۲۳۴۵۷۲", "#3b82f6").lastInsertRowid as number;
  const uRec = insUser.run("اطفال چن", "reception@repaid.local", hashPassword("demo1234"), "reception", b1, "۰۹۱۲۱۲۳۴۵۷۳", "#ec4899").lastInsertRowid as number;
  const uInv = insUser.run("نوید کیمیایی", "inventory@repaid.local", hashPassword("demo1234"), "inventory", b1, "۰۹۱۲۱۲۳۴۵۷۴", "#8b5cf6").lastInsertRowid as number;
  const uAcc = insUser.run("گرامس آذرمهر", "accounts@repaid.local", hashPassword("demo1234"), "accountant", b1, "۰۹۱۲۱۲۳۴۵۷۵", "#14b8a6").lastInsertRowid as number;
  const uSales = insUser.run("لیام نوذری", "sales@repaid.local", hashPassword("demo1234"), "sales", b1, "۰۹۱۲۱۲۳۴۵۷۶", "#f97316").lastInsertRowid as number;

  // پروفایل حقوق تعمیرکاران
  const insPay = db.prepare("INSERT OR REPLACE INTO payroll_profiles(user_id, salary_type, fixed_monthly, percent_repair, percent_parts, percent_only_labor, pay_period) VALUES(?,?,?,?,?,?,?)");
  insPay.run(uTech1, "mixed", 120_000_000, 30, 5, 0, "monthly");
  insPay.run(uTech2, "mixed", 100_000_000, 25, 5, 0, "monthly");
  insPay.run(uTech3, "percent", 0, 35, 8, 0, "monthly");

  // ---- انبارها ----
  const insLoc = db.prepare("INSERT INTO inventory_locations(name, branch_id, is_default) VALUES(?,?,?)");
  const l1 = insLoc.run("انبار مرکزی", b1, 1).lastInsertRowid as number;
  const l2 = insLoc.run("انبار سعادت‌آباد", b2, 0).lastInsertRowid as number;

  // ---- تنظیمات ----
  const insSetting = db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES(?,?)");
  insSetting.run("business_name", "تعمیرگاه مرکزی پارس");
  insSetting.run("tax_rate", "10");
  insSetting.run("currency_unit", "toman");
  insSetting.run("vat_enabled", "1");
  insSetting.run("date_format", "jalaali");
  insSetting.run("invoice_prefix", "F-");
  insSetting.run("ticket_prefix", "P");
  insSetting.run("diagnostic_fee", "500000");
  insSetting.run("public_base_url", "http://localhost:3210");
  insSetting.run("round_to", "1000");

  // ---- حساب‌های بانکی ----
  const insBank = db.prepare("INSERT INTO bank_accounts(name, bank_name, account_number, card_number, sheba, current_balance) VALUES(?,?,?,?,?,?)");
  const bank1 = insBank.run("حساب جاری ملت", "بانک ملت", "1234567890", "6104-3378-1234-5678", "IR120570028180010123456789", 850_000_000).lastInsertRowid as number;
  const bank2 = insBank.run("کارتخوان سامان", "بانک سامان", "9876543210", "6219-8610-9876-5432", "IR350560081180010987654321", 120_000_000).lastInsertRowid as number;

  // ---- خدمات ----
  const insService = db.prepare("INSERT INTO services(sku, name, category, description, price, cost, duration_min, warranty_days) VALUES(?,?,?,?,?,?,?,?)");
  const svc = (sku: string, name: string, cat: string, price: number, cost: number, dur: number) =>
    insService.run(sku, name, cat, `${name} توسط تکنسین مجرب`, price, cost, dur, 90).lastInsertRowid as number;
  const sScreen = svc("SVC-SCR", "تعویض صفحه‌نمایش", "موبایل", 12_900_000, 4_000_000, 60);
  const sBatt = svc("SVC-BAT", "تعویض باتری", "موبایل", 6_900_000, 2_000_000, 40);
  const sCharge = svc("SVC-CHG", "تعمیر سوکت شارژ", "موبایل", 7_900_000, 2_500_000, 50);
  const sDiag = svc("SVC-DIAG", "عیب‌یابی", "عمومی", 2_900_000, 1_000_000, 30);
  const sOS = svc("SVC-OS", "نصب ویندوز / نرم‌افزار", "کامپیوتر", 4_900_000, 1_500_000, 60);
  const sData = svc("SVC-DATA", "ریکاوری اطلاعات", "کامپیوتر", 14_900_000, 4_000_000, 120);
  const sThermal = svc("SVC-THERM", "سرویس خنک‌کننده و خمیر سیلیکون", "کامپیوتر", 3_900_000, 1_000_000, 45);
  const sLapScr = svc("SVC-LSCR", "تعویض لنپ تاپ", "کامپیوتر", 15_900_000, 6_000_000, 75);
  const sConsole = svc("SVC-CON", "تعمیر HDMI کنسول / داغ‌کردن", "گیمینگ", 9_900_000, 3_500_000, 90);
  const sLiquid = svc("SVC-LIQ", "رفع آسیب آب‌خوردگی", "موبایل", 8_900_000, 3_000_000, 120);
  const sWatch = svc("SVC-WATCH", "سرویس باتری ساعت هوشمند", "پوشیدنی", 5_900_000, 2_000_000, 40);
  const sVirus = svc("SVC-VIR", "پاکسازی ویروس و بدافزار", "کامپیوتر", 5_900_000, 1_500_000, 45);

  // ---- تأمین‌کنندگان ----
  const insSup = db.prepare("INSERT INTO suppliers(name, company, phone, email, payment_terms, contact_person) VALUES(?,?,?,?,?,?)");
  const sup1 = insSup.run("پخش قطعات موبایل پارس", "شرکت پخش پارس", "۰۲۱-۷۷۸۸۹۹۰۰", "sales@parsparts.example", "۳۰ روزه", "کارلا دیز").lastInsertRowid as number;
  const sup2 = insSup.run("کامپیوتر پارت تهران", "CP تهران", "۰۲۱-۶۶۸۸۷۷۰۰", "orders@cptehran.example", "۱۵ روزه", "بنیامین رای").lastInsertRowid as number;
  const sup3 = insSup.run("گیم‌تک", "گیم‌تک پلاس", "۰۲۱-۸۸۹۹۰۰۱۱", "hello@gametech.example", "نقدی", "ماکس وبر").lastInsertRowid as number;

  // ---- کالاها و قطعات ----
  const insPart = db.prepare(`INSERT INTO parts(sku, barcode, name, category, brand, compatibility, unit, purchase_price, avg_cost, price, min_stock, reorder_point, preferred_supplier_id, location, shelf, bin)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const part = (sku: string, name: string, cat: string, brand: string, compat: string, cost: number, price: number, min: number, rop: number, sup: number) =>
    insPart.run(sku, String(6_260_000_000_000_000 + Math.floor(Math.random() * 999_999_999_999_999)).slice(0, 16), name, cat, brand, compat, "عدد", cost, cost, price, min, rop, sup, "قفسه اصلی", `ق${1 + Math.floor(Math.random() * 4)}`, String(1 + Math.floor(Math.random() * 40))).lastInsertRowid as number;

  const pIP11S = part("PRT-IP11-SCR", "صفحه‌نمایش iPhone 11 (اورجینال)", "قطعات موبایل", "اپل", "iPhone 11", 42_000_000, 99_000_000, 3, 5, sup1);
  const pIP12S = part("PRT-IP12-SCR", "صفحه‌نمایش iPhone 12 (OLED)", "قطعات موبایل", "اپل", "iPhone 12 / 12 Pro", 56_000_000, 129_000_000, 2, 4, sup1);
  const pIP13B = part("PRT-IP13-BAT", "باتری iPhone 13", "قطعات موبایل", "اپل", "iPhone 13", 19_000_000, 49_000_000, 4, 6, sup1);
  const pSGS21S = part("PRT-SGS21-SCR", "صفحه‌نمایش Galaxy S21", "قطعات موبایل", "سامسونگ", "Galaxy S21", 51_000_000, 119_000_000, 2, 3, sup1);
  const pUSBC = part("PRT-USBC", "سوکت شارژ USB-C (یونیورسال)", "قطعات موبایل", "متفرقه", "اکثر گوشی‌های اندروید", 3_500_000, 19_000_000, 10, 15, sup1);
  const pSSD = part("PRT-SSD1TB", "حافظه NVMe SSD یک ترابایت", "قطعات کامپیوتر", "سامسونگ", "لپ‌تاپ / دسکتاپ", 69_000_000, 129_000_000, 2, 3, sup2);
  const pRAM16 = part("PRT-RAM16", "رم ۱۶ گیگابایت DDR4 لپ‌تاپ", "قطعات کامپیوتر", "کینگستون", "اکثر لپ‌تاپ‌ها", 39_000_000, 79_000_000, 3, 4, sup2);
  const pFAN = part("PRT-FAN-UNI", "فن خنک‌کننده لپ‌تاپ", "قطعات کامپیوتر", "متفرقه", "لپ‌تاپ‌های رایج", 15_000_000, 49_000_000, 2, 3, sup2);
  const pPSU = part("PRT-PSU650", "پاور ۶۵۰ وات", "قطعات کامپیوتر", "کورسیر", "کیس دسکتاپ", 49_000_000, 89_000_000, 1, 2, sup2);
  const pHDMI = part("PRT-HDMI-PS5", "پورت HDMI پلی‌استیشن ۵", "قطعات کنسول", "سونی", "PlayStation 5", 12_000_000, 59_000_000, 2, 3, sup3);
  const pXBOX = part("PRT-XBX-FAN", "فن Xbox Series", "قطعات کنسول", "مایکروسافت", "Xbox Series X", 18_000_000, 49_000_000, 1, 2, sup3);
  const pWatchB = part("PRT-WCH-BAT", "باتری ساعت هوشمند", "قطعات پوشیدنی", "متفرقه", "ساعت‌های رایج", 12_000_000, 39_000_000, 3, 4, sup1);
  const pKeyb = part("PRT-KB-US", "کیبورد لپ‌تاپ", "قطعات کامپیوتر", "متفرقه", "لپ‌تاپ‌های پرکاربرد", 22_000_000, 59_000_000, 2, 3, sup2);
  const pGlass = part("PRT-GLASS", "گلس محافظ صفحه", "لوازم جانبی", "متفرقه", "یونیورسال", 2_500_000, 15_000_000, 20, 30, sup1);
  const pCase = part("PRT-CASE", "قاب گوشی", "لوازم جانبی", "متفرقه", "مدل‌های رایج", 3_000_000, 19_000_000, 15, 20, sup1);
  const pCharge2 = part("PRT-CHG-20W", "شارژر ۲۰ وات USB-C", "لوازم جانبی", "متفرقه", "یونیورسال", 7_000_000, 29_000_000, 8, 12, sup1);

  // موجودی اولیه
  const stock: Array<[number, number, number, number]> = [
    [pIP11S, l1, 6, 42_000_000], [pIP12S, l1, 3, 56_000_000], [pIP13B, l1, 7, 19_000_000], [pSGS21S, l1, 2, 51_000_000],
    [pUSBC, l1, 24, 3_500_000], [pSSD, l1, 4, 69_000_000], [pRAM16, l1, 6, 39_000_000], [pFAN, l1, 3, 15_000_000],
    [pPSU, l1, 2, 49_000_000], [pHDMI, l1, 4, 12_000_000], [pXBOX, l1, 1, 18_000_000], [pWatchB, l1, 5, 12_000_000],
    [pKeyb, l1, 3, 22_000_000], [pGlass, l1, 40, 2_500_000], [pCase, l1, 25, 3_000_000], [pCharge2, l1, 10, 7_000_000],
    [pIP11S, l2, 2, 42_000_000], [pIP13B, l2, 3, 19_000_000], [pUSBC, l2, 10, 3_500_000], [pGlass, l2, 15, 2_500_000], [pXBOX, l2, 2, 18_000_000],
  ];
  for (const [partId, loc, qty, cost] of stock) {
    for (let i = 0; i < qty; i++) moveStock({ part_id: partId, location_id: loc, qty: 1, type: "purchase", unit_cost: cost, note: "موجودی اولیه" });
  }
  db.prepare("UPDATE inventory_stock SET qty = 1 WHERE part_id = ? AND location_id = ?").run(pIP12S, l1); // نمونه کمبود موجودی

  // ---- قالب‌های پیام ----
  const insTpl = db.prepare("INSERT OR REPLACE INTO message_templates(event, channel, body) VALUES(?,?,?)");
  const t = (event: string, body: string) => insTpl.run(event, "sms", body);
  t("New", "{{customer_name}} عزیز، به {{shop}} خوش آمدید. پذیرش {{device}} شما با شماره {{ticket}} ثبت شد. پیگیری: {{link}}");
  t("Diagnosing", "{{customer_name}} عزیز، عیب‌یابی {{device}} شما (پذیرش {{ticket}}) آغاز شد. پیگیری: {{link}}");
  t("Waiting for Customer Approval", "{{customer_name}} عزیز، برآورد هزینه {{device}} (پذیرش {{ticket}}) آماده تأیید است: {{link}}");
  t("Waiting for Parts", "اطلاعیه پذیرش {{ticket}}: دستگاه شما در انتظار قطعه است. به محض رسیدن مطلع می‌شویم — {{shop}}");
  t("In Repair", "{{device}} شما (پذیرش {{ticket}}) در حال تعمیر است — {{shop}}");
  t("Ready for Pickup", "{{customer_name}} عزیز، {{device}} شما تعمیر و آماده تحویل است. مبلغ قابل پرداخت: {{amount}}. پیگیری: {{link}}");
  t("Delivered", "ممنون از اعتماد شما {{customer_name}} عزیز. تعمیر {{ticket}} شامل گارانتی است — {{shop}}");

  // ---- مشتریان ----
  const insCust = db.prepare(`INSERT INTO customers(code, first_name, last_name, company, mobile, phone, email, address, city, tax_id, tags, is_vip, is_blacklisted, is_company, contact_person, credit_limit, notes, national_id, job, referral_source, nickname, created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString().replace("T", " ").slice(0, 19);
  const cust = (first: string, last: string, mobile: string, email: string, tags: string[], opts: any = {}) =>
    insCust.run(
      nextSeq("customer", "C"), first, last, opts.company ?? null, mobile, null, email,
      opts.address ?? "تهران، خیابان ولیعصر", opts.city ?? "تهران", opts.national_id ?? null, JSON.stringify(tags),
      opts.vip ?? 0, 0, opts.company ? 1 : 0, opts.company ? `${first} ${last}` : null,
      opts.credit_limit ?? 0, opts.notes ?? null, opts.national_id ?? null, opts.job ?? null, opts.referral_source ?? null, opts.nickname ?? null,
      day(opts.createdDaysAgo ?? 30)
    ).lastInsertRowid as number;

  const cMaya = cust("مریم", "تهرانی", "۰۹۱۲۳۴۵۶۷۰۱", "maya.t@example.com", ["خرده‌فروش"], { vip: 1, job: "پزشک", createdDaysAgo: 60, nickname: "خانم دکتر", national_id: "0076543219" });
  const cDan = cust("دانیال", "رستمی", "۰۹۱۲۳۴۵۶۷۰۲", "dan.r@example.com", ["گیمر"], { createdDaysAgo: 55, referral_source: "اینستاگرام" });
  const cAisha = cust("عایشه", "بلوری", "۰۹۱۲۳۴۵۶۷۰۳", "aisha.b@example.com", ["خرده‌فروش"], { createdDaysAgo: 45, job: "مهندس نرم‌افزار" });
  const cTom = cust("توماس", "نگارانی", "۰۹۱۲۳۴۵۶۷۰۴", "tom.n@example.com", [], { createdDaysAgo: 40 });
  const cSunrise = cust("کارول", "جکانی", "۰۹۱۲۳۴۵۶۷۰۵", "accounts@sunrise.example", ["شرکتی"], { company: "خدمات ناوگان آفتاب", vip: 1, credit_limit: 500_000_000, createdDaysAgo: 120, referral_source: "معرف" });
  const cElena = cust("النا", "پتروسیان", "۰۹۱۲۳۴۵۶۷۰۶", "elena.p@example.com", [], { createdDaysAgo: 25 });
  const cFrank = cust("فرهاد", "میرزایی", "۰۹۱۲۳۴۵۶۷۰۷", "frank.m@example.com", [], { createdDaysAgo: 20, referral_source: "تبلیغات محیطی" });
  const cJulia = cust("جولیا", "سنگی", "۰۹۱۲۳۴۵۶۷۰۸", "julia.s@example.com", ["گیمر"], { createdDaysAgo: 15 });
  const cRavi = cust("راوی", "منون", "۰۹۱۲۳۴۵۶۷۰۹", "ravi.m@example.com", [], { createdDaysAgo: 10 });
  const cHana = cust("هانا", "سوزوکی", "۰۹۱۲۳۴۵۶۷۱۰", "hana.s@example.com", ["خرده‌فروش"], { createdDaysAgo: 8 });

  // ---- دستگاه‌ها ----
  const insDev = db.prepare(`INSERT INTO devices(customer_id, type, brand, model, model_number, serial, imei, imei2, color, ram, storage, cpu, gpu, os, os_version, battery_health, carrier, condition)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const dev = (customerId: number, type: string, brand: string, model: string, extra: any = {}) => {
    const imei = type === "mobile" || type === "tablet" ? String(35_000_000_000_000_00 + Math.floor(Math.random() * 99_999_999_999_999)) : null;
    return insDev.run(
      customerId, type, brand, model, extra.model_number ?? null, extra.serial ?? String(Math.random().toString(36).slice(2, 12).toUpperCase()),
      imei, imei && Math.random() > 0.5 ? String(35_000_000_000_000_00 + Math.floor(Math.random() * 99_999_999_999_999)) : null,
      extra.color ?? "مشکی", extra.ram ?? null, extra.storage ?? null, extra.cpu ?? null, extra.gpu ?? null,
      extra.os ?? null, extra.os_version ?? null, extra.battery_health ?? null, extra.carrier ?? null,
      extra.condition ?? "خوب"
    ).lastInsertRowid as number;
  };

  const dMayaIP = dev(cMaya, "mobile", "اپل", "iPhone 11", { storage: "۶۴ گیگ", battery_health: 82, os: "iOS", os_version: "17.5", carrier: "همراه اول" });
  const dMayaMBP = dev(cMaya, "laptop", "اپل", "MacBook Pro 14", { ram: "۱۶ گیگ", storage: "۵۱۲ گیگ SSD", cpu: "M1 Pro", os: "macOS", os_version: "14.5" });
  const dDanPS5 = dev(cDan, "console", "سونی", "PlayStation 5", { storage: "۸۲۵ گیگ" });
  const dDanXbox = dev(cDan, "console", "مایکروسافت", "Xbox Series X", { storage: "۱ ترابایت" });
  const dAishaIP = dev(cAisha, "mobile", "اپل", "iPhone 12 Pro", { storage: "۲۵۶ گیگ", battery_health: 88, carrier: "ایرانسل" });
  const dTomDell = dev(cTom, "laptop", "دل", "XPS 15 9520", { ram: "۳۲ گیگ", storage: "۱ ترابایت SSD", cpu: "i7-12700H", gpu: "RTX 3050 Ti", os: "Windows", os_version: "11" });
  const dTomPixel = dev(cTom, "mobile", "گوگل", "Pixel 7", { storage: "۱۲۸ گیگ", carrier: "همراه اول" });
  const dSunriseVan = dev(cSunrise, "laptop", "لنوو", "ThinkPad T480", { ram: "۱۶ گیگ", storage: "۲۵۶ گیگ SSD", cpu: "i5-8350U", os: "Windows", os_version: "10", asset_tag: "SFS-LT-042" });
  const dSunriseTow = dev(cSunrise, "desktop", "دل", "OptiPlex 7070", { ram: "۸ گیگ", storage: "۲۵۶ گیگ SSD", cpu: "i5-9500", os: "Windows", os_version: "10" });
  const dElenaWatch = dev(cElena, "smartwatch", "سامسونگ", "Galaxy Watch 5", {});
  const dFrankTab = dev(cFrank, "tablet", "اپل", "iPad Air 4", { storage: "۶۴ گیگ" });
  const dJuliaSW = dev(cJulia, "desktop", "اچ‌پی", "Omen 30L", { ram: "۳۲ گیگ", storage: "۲ ترابایت SSD", cpu: "Ryzen 7 5800X", gpu: "RTX 3080" });
  const dRaviIP = dev(cRavi, "mobile", "اپل", "iPhone 13", { storage: "۱۲۸ گیگ", battery_health: 91 });
  const dHanaS21 = dev(cHana, "mobile", "سامسونگ", "Galaxy S21", { storage: "۱۲۸ گیگ", carrier: "رایتل" });
  const dMayaWatch = dev(cMaya, "smartwatch", "اپل", "Watch Series 8", {});

  // ---- وضعیت‌ها ----
  const stNew = getStatusByName("New")!;
  const stReceived = getStatusByName("Received")!;
  const stWaitDiag = getStatusByName("Waiting for Diagnosis")!;
  const stDiag = getStatusByName("Diagnosing")!;
  const stApproval = getStatusByName("Waiting for Customer Approval")!;
  const stParts = getStatusByName("Waiting for Parts")!;
  const stInRepair = getStatusByName("In Repair")!;
  const stQC = getStatusByName("Quality Control")!;
  const stDelivered = getStatusByName("Delivered")!;
  const stWarranty = getStatusByName("Warranty")!;

  const insTicket = db.prepare(`INSERT INTO repair_tickets(number, branch_id, customer_id, device_id, repair_type, priority, source, technician_id, status_id, substatus, problem, condition_notes, accessories, security_type, security_value_enc, security_hint, estimated_completion, ready_at, completed_at, delivered_at, diagnosis, diagnosis_outcome, root_cause, diagnostic_fee, tags, qc_status, checklist, created_by, created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const histIns = db.prepare("INSERT INTO repair_status_history(ticket_id, from_status, to_status, user_id, note) VALUES(?,?,?,?,?)");

  let ticketSeq = 0;
  const mkTicket = (opts: any) => {
    ticketSeq++;
    const number = `P${String(ticketSeq).padStart(4, "0")}`;
    const tId = insTicket.run(
      number, opts.branch_id ?? b1, opts.customer_id, opts.device_id, opts.repair_type, opts.priority ?? "normal",
      opts.source ?? "حضوری", opts.technician_id ?? null, opts.status_id.id, opts.substatus ?? null,
      opts.problem, opts.condition_notes ?? null, opts.accessories ?? null,
      opts.security_type ?? null, opts.security_value_enc ?? null, opts.security_hint ?? null,
      opts.estimated_completion ?? null, opts.ready_at ?? null, opts.completed_at ?? null, opts.delivered_at ?? null,
      opts.diagnosis ?? null, opts.diagnosis_outcome ?? null, opts.root_cause ?? null,
      opts.diagnostic_fee ?? 500_000, JSON.stringify(opts.tags ?? []), opts.qc_status ?? null,
      JSON.stringify(opts.checklist ?? []), opts.created_by ?? uRec, opts.created_at ?? day(3)
    ).lastInsertRowid as number;
    const chain: string[] = ["New", "Received", "Waiting for Diagnosis"];
    if ([stDiag.id, stApproval.id, stParts.id, stInRepair.id, stQC.id, stDelivered.id, stWarranty.id].includes(opts.status_id.id)) chain.push("Diagnosing");
    if ([stApproval.id, stParts.id, stInRepair.id, stQC.id, stDelivered.id, stWarranty.id].includes(opts.status_id.id)) chain.push("Estimate Prepared", "Waiting for Customer Approval", "Approved");
    if ([stInRepair.id, stQC.id, stDelivered.id, stWarranty.id].includes(opts.status_id.id)) chain.push("In Repair");
    if ([stQC.id, stDelivered.id].includes(opts.status_id.id)) chain.push("Quality Control");
    if ([stDelivered.id].includes(opts.status_id.id)) chain.push("Ready for Pickup", "Delivered");
    if (stWarranty.id === opts.status_id.id) chain.push("Ready for Pickup", "Delivered", "Warranty");
    let prev: number | null = null;
    for (const c of chain) {
      const s = getStatusByName(c)!;
      histIns.run(tId, prev, s.id, opts.technician_id ?? uTech1, null);
      prev = s.id;
    }
    addCustomerEvent(opts.customer_id, "repair", `پذیرش ${number} ثبت شد`, opts.problem, uRec, tId);
    return tId;
  };

  // تعمیرات تحویل‌شده (گذشته)
  const t1 = mkTicket({
    customer_id: cMaya, device_id: dMayaIP, repair_type: "تعویض صفحه‌نمایش", technician_id: uTech1,
    status_id: stDelivered, problem: "شکستگی صفحه بعد از سقوط، لمس ناپایدار",
    condition_notes: "شیشه جلو شکسته، خط و خش جزئی روی بدنه", accessories: "شارژر، قاب گوشی",
    security_type: "passcode", security_value_enc: encryptSecret("۱۹۸۸"), security_hint: "تاریخ تولد فرزندان",
    estimated_completion: day(-2), ready_at: day(6), completed_at: day(5), delivered_at: day(5),
    diagnosis: "دیجیتایزر بر اثر ضربه آسیب دیده؛ پنل OLED سطرهای مرده دارد.",
    diagnosis_outcome: "قابل تعمیر", root_cause: "ضربه فیزیکی", created_at: day(8),
    checklist: [
      { item: "تست لمس", done: true }, { item: "تست صفحه‌نمایش", done: true }, { item: "تست دوربین", done: true },
      { item: "تست اسپیکر", done: true }, { item: "تست شارژ", done: true }, { item: "تست Face ID", done: true },
    ],
  });
  moveStock({ part_id: pIP11S, location_id: l1, qty: -1, type: "repair_consumption", ref_type: "ticket", ref_id: t1, unit_cost: 42_000_000, user_id: uTech1, note: "صفحه‌نمایش iPhone 11" });

  const t2 = mkTicket({
    customer_id: cDan, device_id: dDanPS5, repair_type: "تعمیر پورت HDMI", technician_id: uTech2,
    status_id: stDelivered, problem: "بدون تصویر از HDMI، صدا دارد",
    condition_notes: "تمیز، گرد و غبار جزئی", accessories: "۱ دسته، کابل برق",
    estimated_completion: day(-1), ready_at: day(9), completed_at: day(9), delivered_at: day(9),
    diagnosis: "پین‌های پورت HDMI خمیده و لحیم سرد.", diagnosis_outcome: "قابل تعمیر", root_cause: "فشار به پورت هنگام جابجایی", created_at: day(12),
    checklist: [{ item: "تست خروجی تصویر", done: true }, { item: "تست 4K@60", done: true }, { item: "تست صدا", done: true }],
  });
  moveStock({ part_id: pHDMI, location_id: l1, qty: -1, type: "repair_consumption", ref_type: "ticket", ref_id: t2, unit_cost: 12_000_000, user_id: uTech2, note: "پورت HDMI PS5" });

  const t3 = mkTicket({
    customer_id: cTom, device_id: dTomDell, repair_type: "ارتقای SSD + نصب ویندوز", technician_id: uTech1,
    status_id: stDelivered, problem: "کندی شدید، حافظه پر، درخواست یک ترابایت و ویندوز جدید",
    accessories: "شارژر", estimated_completion: day(-1), ready_at: day(15), completed_at: day(14), delivered_at: day(14),
    diagnosis: "SSD اصلی تقریباً پر و فرسوده.", diagnosis_outcome: "قابل تعمیر", root_cause: "فرسودگی حافظه", created_at: day(16),
    checklist: [{ item: "انتقال اطلاعات", done: true }, { item: "فعال‌سازی ویندوز", done: true }, { item: "تست همه پورت‌ها", done: true }],
  });
  moveStock({ part_id: pSSD, location_id: l1, qty: -1, type: "repair_consumption", ref_type: "ticket", ref_id: t3, unit_cost: 69_000_000, user_id: uTech1, note: "SSD یک ترابایت" });

  // تعمیرات فعال
  const t4 = mkTicket({
    customer_id: cAisha, device_id: dAishaIP, repair_type: "تعویض باتری", technician_id: uTech1,
    status_id: stApproval, problem: "باتری تا ظهر خالی می‌شود، خاموشی در ۳۰٪",
    condition_notes: "وضعیت خوب، کمی فرسودگی", accessories: "شارژر",
    estimated_completion: day(-1), diagnosis: "سلامت باتری ۸۸٪ اما ولتاژ زیر بار افت می‌کند.",
    diagnosis_outcome: "قابل تعمیر", root_cause: "فرسودگی باتری", created_at: day(2),
  });
  const t5 = mkTicket({
    customer_id: cHana, device_id: dHanaS21, repair_type: "تعویض صفحه‌نمایش", technician_id: uTech2,
    status_id: stParts, problem: "شکستگی صفحه و خطوط سبز چشمک‌زن",
    condition_notes: "ترک شدید روی نمایشگر", accessories: "ندارد",
    estimated_completion: day(-3), diagnosis: "اسمبل نمایشگر آسیب دیده.", diagnosis_outcome: "قابل تعمیر",
    root_cause: "ضربه فیزیکی", created_at: day(5),
  });
  const t6 = mkTicket({
    customer_id: cDan, device_id: dDanXbox, repair_type: "داغ‌کردن / تعویض فن", technician_id: uTech3,
    status_id: stInRepair, branch_id: b2, problem: "صدای بلند فن، خاموشی هنگام بازی",
    condition_notes: "گردوخاکی", accessories: "دسته، کابل‌ها", estimated_completion: day(-1),
    diagnosis: "بلبرینگ فن خراب؛ گردوغبار زیاد.", diagnosis_outcome: "قابل تعمیر", root_cause: "فرسودگی فن + گردوغبار", created_at: day(4),
  });
  moveStock({ part_id: pXBOX, location_id: l2, qty: -1, type: "repair_consumption", ref_type: "ticket", ref_id: t6, unit_cost: 18_000_000, user_id: uTech3, note: "فن Xbox" });
  const t7 = mkTicket({
    customer_id: cSunrise, device_id: dSunriseVan, repair_type: "تعویض کیبورد", priority: "high", technician_id: uTech1,
    status_id: stQC, problem: "چند کلید بعد از ریختن قهوه کار نمی‌کند",
    condition_notes: "کلیدها چسبناک، لکه جزئی", accessories: "شارژر",
    estimated_completion: day(-1), diagnosis: "نفوذ مایع به غشای کیبورد.", diagnosis_outcome: "قابل تعمیر",
    root_cause: "آسیب مایع", created_at: day(4),
    checklist: [{ item: "تست کیبورد", done: true }, { item: "تست تاچ‌پد", done: true }, { item: "تست وای‌فای", done: true }, { item: "تست پورت‌های USB", done: true }, { item: "تست باتری", done: true }, { item: "پشتیبان‌گیری اطلاعات", done: true }],
  });
  const t8 = mkTicket({
    customer_id: cElena, device_id: dElenaWatch, repair_type: "سرویس باتری", technician_id: null,
    status_id: stWaitDiag, problem: "ساعت با هر شارژ فقط ۴ ساعت کار می‌کند",
    created_at: day(1),
  });
  const t9 = mkTicket({
    customer_id: cRavi, device_id: dRaviIP, repair_type: "تعمیر سوکت شارژ", technician_id: uTech2,
    status_id: stDiag, problem: "فقط در زوایای خاص شارژ می‌شود، کابل شل است",
    accessories: "ندارد", created_at: day(1),
  });
  const t10 = mkTicket({
    customer_id: cFrank, device_id: dFrankTab, repair_type: "تعویض صفحه‌نمایش", technician_id: null,
    status_id: stReceived, priority: "low", source: "تلفنی", problem: "صفحه شکسته اما لمس کار می‌کند",
    created_at: day(1),
  });
  const t11 = mkTicket({
    customer_id: cMaya, device_id: dMayaWatch, repair_type: "عیب‌یابی", technician_id: uTech1,
    status_id: stDiag, problem: "از بعد از آپدیت با گوشی جفت نمی‌شود", created_at: day(0),
  });
  const t12 = mkTicket({
    customer_id: cJulia, device_id: dJuliaSW, repair_type: "عیب‌یابی گرافیک", priority: "urgent", technician_id: uTech1,
    status_id: stDiag, source: "سایت", problem: "با نصب GPU صفحه سیاه می‌شود، با گرافیک داخلی کار می‌کند",
    created_at: day(0),
  });
  const t13 = mkTicket({
    customer_id: cElena, device_id: dElenaWatch, repair_type: "گارانتی — سرویس باتری", technician_id: uTech2,
    status_id: stWarranty, is_warranty: 1, problem: "باتری همچنان سریع خالی می‌شود",
    created_at: day(2),
  });

  // برآورد برای t4 (در انتظار تأیید)
  const estId = db.prepare(
    `INSERT INTO estimates(number, ticket_id, customer_id, device_id, status, subtotal, discount, tax, total, deposit, valid_until, notes, terms, public_token, created_by)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    nextSeq("estimate", "BRV-"), t4, cAisha, dAishaIP, "sent", 6_900_000 + 4_900_000, 0,
    Math.round((6_900_000 + 4_900_000) * 0.10), 6_900_000 + 4_900_000 + Math.round((6_900_000 + 4_900_000) * 0.10),
    0, new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), "تعویض باتری با ۹۰ روز گارانتی.", "برآوردها تا ۷ روز اعتبار دارند.",
    cryptoToken(), uRec
  ).lastInsertRowid as number;
  const insEI = db.prepare("INSERT INTO estimate_items(estimate_id, kind, ref_id, name, qty, unit_price, total) VALUES(?,?,?,?,?,?,?)");
  insEI.run(estId, "part", pIP13B, "باتری iPhone 13", 1, 4_900_000, 4_900_000);
  insEI.run(estId, "service", sBatt, "تعویض باتری", 1, 6_900_000, 6_900_000);
  db.prepare("UPDATE repair_tickets SET estimate_id = ? WHERE id = ?").run(estId, t4);

  // ---- فاکتورهای تعمیرات تحویل‌شده ----
  const insInv = db.prepare(`INSERT INTO invoices(number, customer_id, ticket_id, branch_id, status, date, due_date, subtotal, discount, tax, total, paid, notes, created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const mkInvoice = (customerId: number, ticketId: number, items: Array<[string, number, number, number]>, paid: number, daysAgo: number, status: string) => {
    const subtotal = items.reduce((s, i) => s + i[1] * i[2], 0);
    const tax = Math.round(subtotal * 0.10);
    const total = subtotal + tax;
    const invId = insInv.run(
      nextSeq("invoice", "F-"), customerId, ticketId, b1, status, day(daysAgo), day(daysAgo - 14),
      subtotal, 0, tax, total, paid, "با تشکر از اعتماد شما — تعمیرگاه مرکزی پارس", uAcc
    ).lastInsertRowid as number;
    const insII = db.prepare("INSERT INTO invoice_items(invoice_id, kind, ref_id, name, qty, unit_price, cost, total) VALUES(?,?,?,?,?,?,?,?)");
    for (const [name, qty, price, cost] of items) insII.run(invId, "item", null, name, qty, price, cost, qty * price);
    if (paid > 0) {
      db.prepare(`INSERT INTO payments(number, customer_id, invoice_id, ticket_id, amount, method, branch_id, user_id, created_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(
        nextSeq("payment", "D-"), customerId, invId, ticketId, paid,
        Math.random() > 0.5 ? "pos" : "cash", b1, uRec, day(daysAgo)
      );
    }
    return invId;
  };

  const inv1 = mkInvoice(cMaya, t1, [["صفحه‌نمایش iPhone 11 (اورجینال)", 1, 99_000_000, 42_000_000], ["تعویض صفحه‌نمایش", 1, 12_900_000, 4_000_000], ["گلس محافظ صفحه", 1, 1_500_000, 2_500_000]], 0, 5, "issued");
  const inv2 = mkInvoice(cDan, t2, [["پورت HDMI پلی‌استیشن ۵", 1, 59_000_000, 12_000_000], ["تعمیر HDMI کنسول", 1, 9_900_000, 3_500_000]], 118_800_000, 9, "paid");
  const inv3 = mkInvoice(cTom, t3, [["حافظه NVMe SSD یک ترابایت", 1, 129_000_000, 69_000_000], ["نصب ویندوز / نرم‌افزار", 1, 4_900_000, 1_500_000], ["انتقال اطلاعات", 1, 4_900_000, 0]], 152_900_000, 14, "paid");

  // ---- چک دریافتی نمونه ----
  db.prepare(`INSERT INTO checks(number, kind, amount, issue_date, due_date, bank_name, cheque_serial, sayad_id, payer_payee, customer_id, invoice_id, status, description, user_id, branch_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "۴۵۲۱", "received", 60_000_000, day(5), day(-10), "بانک ملی", "CH-88123", "SAY-99123", "مریم تهرانی", cMaya, inv1, "in_hand", "چک بابت فاکتور تعویض صفحه", uAcc, b1
  );

  // ---- اقساط نمونه ----
  const insInst = db.prepare("INSERT INTO installments(customer_id, invoice_id, seq, amount, due_date, status, notes) VALUES(?,?,?,?,?,?,?)");
  insInst.run(cMaya, inv1, 1, 50_000_000, day(-5), "pending", "قسط اول فاکتور صفحه‌نمایش");
  insInst.run(cMaya, inv1, 2, 50_000_000, day(25), "pending", "قسط دوم فاکتور صفحه‌نمایش");

  // ---- فروش پوز ----
  const mkSale = (items: Array<[number, string, number, number, number]>, customerId: number | null, method: string, daysAgo: number) => {
    const subtotal = items.reduce((s, i) => s + i[2] * i[3], 0);
    const tax = Math.round(subtotal * 0.10);
    const total = subtotal + tax;
    const saleId = db.prepare(`INSERT INTO sales(number, customer_id, branch_id, subtotal, tax, total, paid, status, user_id, created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      nextSeq("sale", "V-"), customerId, b1, subtotal, tax, total, total, "completed", uSales, day(daysAgo)
    ).lastInsertRowid as number;
    const insSI = db.prepare("INSERT INTO sale_items(sale_id, kind, ref_id, name, qty, unit_price, cost, total) VALUES(?,?,?,?,?,?,?,?)");
    for (const [partId, name, qty, price, cost] of items) {
      insSI.run(saleId, "product", partId, name, qty, price, cost, qty * price);
      moveStock({ part_id: partId, location_id: l1, qty: -qty, type: "sale", ref_type: "sale", ref_id: saleId, user_id: uSales, note: "فروش پوز" });
    }
    db.prepare(`INSERT INTO payments(number, customer_id, sale_id, amount, method, branch_id, user_id, created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(nextSeq("payment", "D-"), customerId ?? 0, saleId, total, method, b1, uSales, day(daysAgo));
    return saleId;
  };
  mkSale([[pGlass, "گلس محافظ صفحه", 1, 1_500_000, 2_500_000], [pCase, "قاب گوشی", 1, 1_900_000, 3_000_000]], cMaya, "pos", 6);
  mkSale([[pCharge2, "شارژر ۲۰ وات USB-C", 2, 2_900_000, 7_000_000]], null, "cash", 5);
  mkSale([[pSSD, "حافظه NVMe SSD یک ترابایت", 1, 12_900_000, 6_900_000], [pRAM16, "رم ۱۶ گیگابایت DDR4 لپ‌تاپ", 2, 7_900_000, 3_900_000]], cTom, "pos", 3);
  mkSale([[pCase, "قاب گوشی", 2, 1_900_000, 3_000_000], [pGlass, "گلس محافظ صفحه", 2, 1_500_000, 2_500_000]], cHana, "cash", 1);
  mkSale([[pCharge2, "شارژر ۲۰ وات USB-C", 1, 2_900_000, 7_000_000]], null, "pos", 0);

  // ---- سفارش خرید ----
  const poId = db.prepare(`INSERT INTO purchase_orders(number, supplier_id, branch_id, date, expected_date, status, items_total, tax, shipping, total, created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    nextSeq("po", "KH-"), sup1, b1, day(6), day(-2), "sent", 2 * 56_000_000 + 3 * 19_000_000,
    Math.round((2 * 56_000_000 + 3 * 19_000_000) * 0.10), 1_500_000,
    2 * 56_000_000 + 3 * 19_000_000 + Math.round((2 * 56_000_000 + 3 * 19_000_000) * 0.10) + 1_500_000, uInv
  ).lastInsertRowid as number;
  const insPOI = db.prepare("INSERT INTO purchase_order_items(po_id, part_id, name, qty, received_qty, unit_cost, total) VALUES(?,?,?,?,?,?,?)");
  insPOI.run(poId, pIP12S, "صفحه‌نمایش iPhone 12 (OLED)", 2, 0, 56_000_000, 112_000_000);
  insPOI.run(poId, pIP13B, "باتری iPhone 13", 3, 0, 19_000_000, 57_000_000);

  // ---- هزینه‌ها ----
  const insExp = db.prepare("INSERT INTO expenses(category, amount, date, vendor, method, branch_id, description, user_id) VALUES(?,?,?,?,?,?,?,?)");
  const exp = (cat: string, amount: number, daysAgo: number, vendor: string, desc: string) =>
    insExp.run(cat, amount, day(daysAgo), vendor, "bank_transfer", b1, desc, uAcc).lastInsertRowid as number;
  exp("اجاره", 350_000_000, 20, "ملک‌دار برج ولیعصر", "اجاره ماهانه شعبه مرکزی");
  exp("قبوض", 21_400_000, 18, "برق و گاز تهران", "برق و گاز");
  exp("حقوق", 1_950_000_000, 15, "حقوق کارکنان", "حقوق تیم (نیمه اول ماه)");
  exp("ابزار", 12_900_000, 12, "ابزار فنی پارس", "ست ابزار تخصصی + سری‌ها");
  exp("قطعات", 22_550_000, 6, "پخش قطعات موبایل پارس", "سفارش موجودی");
  exp("تبلیغات", 9_900_000, 4, "دایجیتال مارکتینگ", "کمپین محلی اینستاگرام");
  exp("حمل‌ونقل", 3_500_000, 2, "پیک موتوری", "ارسال قطعات ورودی");

  // ---- شکایت ----
  db.prepare("INSERT INTO complaints(customer_id, ticket_id, category, description, priority, status, assigned_to) VALUES(?,?,?,?,?,?,?)").run(
    cDan, t2, "کیفیت تعمیر", "پورت HDMI کار می‌کند اما درپوش پورت کمی شل است.", "low", "investigating", uMgr
  );

  // ---- نوبت ----
  db.prepare("INSERT INTO appointments(customer_id, device_id, repair_type, preferred_at, notes, status, branch_id) VALUES(?,?,?,?,?,?,?)").run(
    cRavi, dRaviIP, "ریکاوری اطلاعات", day(-2), "دوست دارد عکس‌های گوشی قدیمی را بازیابی کند.", "requested", b1
  );

  // ---- گارانتی ----
  db.prepare(`INSERT INTO warranties(kind, ticket_id, invoice_id, customer_id, start_date, end_date, days, terms, covered, status)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
    "repair", t1, inv1, cMaya, day(5), day(-85), 90, "گارانتی ۹۰ روزه تعمیر", "قطعات و اجرت تعویض صفحه‌نمایش", "active"
  );

  // برآورد تأییدشده برای t2
  const est2 = db.prepare(`INSERT INTO estimates(number, ticket_id, customer_id, device_id, status, subtotal, tax, total, approved_at, public_token, created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    nextSeq("estimate", "BRV-"), t2, cDan, dDanPS5, "approved", 6_890_000 + 9_900_000, Math.round(16_790_000 * 0.10), 16_790_000 + Math.round(16_790_000 * 0.10), day(10), cryptoToken(), uRec
  ).lastInsertRowid as number;
  insEI.run(est2, "part", pHDMI, "پورت HDMI پلی‌استیشن ۵", 1, 5_900_000, 5_900_000);
  insEI.run(est2, "service", sConsole, "تعمیر HDMI کنسول", 1, 9_900_000, 9_900_000);
  db.prepare("UPDATE repair_tickets SET estimate_id = ? WHERE id = ?").run(est2, t2);

  // ---- سوالات پذیرش سفارشی ----
  const insQ = db.prepare("INSERT INTO intake_questions(label, type, options, is_required, show_on_receipt, sort) VALUES(?,?,?,?,?,?)");
  insQ.run("دستگاه هنگام پذیرش روشن می‌شود؟", "boolean", "[]", 1, 1, 1);
  insQ.run("رمز گوشی چیست؟", "text", "[]", 0, 0, 2);
  insQ.run("آیا دستگاه قبلاً تعمیر شده؟", "select", JSON.stringify(["خیر", "بله در همین تعمیرگاه", "بله در جای دیگر"]), 0, 1, 3);

  // ---- الگوی پذیرش ----
  db.prepare("INSERT INTO repair_templates(name, device_type, brand, model, repair_type, problem, services, est_duration_hours, est_cost) VALUES(?,?,?,?,?,?,?,?,?)").run(
    "آیفون — تعویض باتری", "mobile", "اپل", "iPhone", "تعویض باتری", "باتری سریع خالی می‌شود",
    JSON.stringify([{ service_id: sBatt, name: "تعویض باتری", price: 6_900_000 }]), 1, 11_800_000
  );
  db.prepare("INSERT INTO repair_templates(name, device_type, brand, model, repair_type, problem, services, est_duration_hours, est_cost) VALUES(?,?,?,?,?,?,?,?,?)").run(
    "لپ‌تاپ — نصب ویندوز", "laptop", null, null, "نصب ویندوز / نرم‌افزار", "کندی سیستم، نیاز به ویندوز",
    JSON.stringify([{ service_id: sOS, name: "نصب ویندوز / نرم‌افزار", price: 4_900_000 }]), 1, 4_900_000
  );

  // ---- چت سازمانی: گروه، کانال، خصوصی و گفت‌وگوی عملیاتی پذیرش ----
  const insConv = db.prepare(
    "INSERT INTO chat_conversations(type, title, description, dm_key, entity_type, entity_id, branch_id, created_by, last_message_at) VALUES(?,?,?,?,?,?,?,?,?)"
  );
  const insMember = db.prepare(
    "INSERT INTO chat_members(conversation_id, user_id, role, joined_at, last_read_message_id) VALUES(?,?,?,?,?)"
  );
  const insChatMsg = db.prepare(
    "INSERT INTO chat_messages(conversation_id, sender_id, kind, body, search_text, created_at) VALUES(?,?,?,?,?,datetime('now', ?))"
  );
  const chatAt = (hoursAgo: number) => `-${hoursAgo} hours`;

  const convTeam = insConv.run("group", "هماهنگی تعمیرگاه", "هماهنگی روزانهٔ تعمیرکاران و پذیرش", null, null, null, b1, uOwner, day(0)).lastInsertRowid as number;
  insMember.run(convTeam, uOwner, "owner", day(6), 0);
  insMember.run(convTeam, uMgr, "admin", day(6), 0);
  insMember.run(convTeam, uTech1, "member", day(6), 0);
  insMember.run(convTeam, uTech2, "member", day(6), 0);
  insMember.run(convTeam, uRec, "member", day(6), 0);
  insChatMsg.run(convTeam, uRec, "text", "صبح بخیر — پذیرش امروز سه دستگاه پست شده دارد؛ کد رهگیری‌ها را در پرونده‌ها ثبت کردم.", "صبح بخیر — پذیرش امروز سه دستگاه پست شده دارد؛ کد رهگیری‌ها را در پرونده‌ها ثبت کردم.", chatAt(5));
  insChatMsg.run(convTeam, uTech1, "text", "برای لپ‌تاپ سریال ۴۴۲ قطعه رسید، تا عصر تست نهایی انجام می‌شود.", "برای لپ‌تاپ سریال ۴۴۲ قطعه رسید، تا عصر تست نهایی انجام می‌شود.", chatAt(4));
  insChatMsg.run(convTeam, uMgr, "text", "ممنون — لطفاً وضعیت را در پذیرش هم به‌روز کنید تا پیامک مشتری ارسال شود.", "ممنون — لطفاً وضعیت را در پذیرش هم به‌روز کنید تا پیامک مشتری ارسال شود.", chatAt(3));

  const convAnn = insConv.run("channel", "اطلاعیه‌های مدیریت", "اطلاعیه‌های داخلی — فقط مدیران منتشر می‌کنند", null, null, null, b1, uOwner, day(0)).lastInsertRowid as number;
  for (const uid of [uOwner, uMgr, uTech1, uTech2, uRec, uInv, uAcc, uSales]) insMember.run(convAnn, uid, uid === uOwner ? "owner" : "member", day(10), 0);
  insChatMsg.run(convAnn, uOwner, "text", "از این هفته موجودی انبار هر پنجشنبه بعدازظهر شمارش می‌شود؛ هماهنگی لازم را انجام دهید.", "از این هفته موجودی انبار هر پنجشنبه بعدازظهر شمارش می‌شود؛ هماهنگی لازم را انجام دهید.", chatAt(28));

  const convDm = insConv.run("direct", null, null, `d:${Math.min(uOwner, uMgr)}:${Math.max(uOwner, uMgr)}`, null, null, null, uOwner, day(0)).lastInsertRowid as number;
  insMember.run(convDm, uOwner, "member", day(9), 0);
  insMember.run(convDm, uMgr, "member", day(9), 0);
  insChatMsg.run(convDm, uOwner, "text", "گزارش هفتگی پورسانت را تا فردا آماده می‌کنی؟", "گزارش هفتگی پورسانت را تا فردا آماده می‌کنی؟", chatAt(26));
  insChatMsg.run(convDm, uMgr, "text", "بله، امشب تمام می‌شود.", "بله، امشب تمام می‌شود.", chatAt(25));

  const t1Number = ((db.prepare("SELECT number FROM repair_tickets WHERE id = ?").get(t1) as any)?.number as string) ?? "";
  const convTicket = insConv.run("group", `پذیرش ${t1Number} — گفت‌وگوی عملیاتی`, null, null, "repair", t1, b1, uRec, day(0)).lastInsertRowid as number;
  insMember.run(convTicket, uRec, "owner", day(3), 0);
  insMember.run(convTicket, uTech1, "member", day(3), 0);
  insChatMsg.run(convTicket, uRec, "text", "دستگاه با پست رسیده؛ کارتن سالم و لوازم همراه کامل است.", "دستگاه با پست رسیده؛ کارتن سالم و لوازم همراه کامل است.", chatAt(20));
  insChatMsg.run(convTicket, uTech1, "text", "عیب‌یابی اولیه انجام شد؛ برآورد را تا پایان امروز ثبت می‌کنم.", "عیب‌یابی اولیه انجام شد؛ برآورد را تا پایان امروز ثبت می‌کنم.", chatAt(18));

  // همگام‌سازی شمارنده‌ها
  db.prepare("INSERT INTO counters(key, value) VALUES('ticket', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(ticketSeq);
  db.prepare("INSERT INTO bank_transactions(account_id, type, amount, description, date, user_id) VALUES(?,?,?,?,?,?)").run(
    bank1, "deposit", 850_000_000, "مانده اولیه حساب", day(30), uAcc
  );

  console.log("[repaid] seed فارسی کامل شد.");
}

function cryptoToken(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
