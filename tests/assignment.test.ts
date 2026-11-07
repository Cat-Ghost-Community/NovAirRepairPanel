import { describe, it, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repaid-assign-"));
process.env.REPAID_DATA_DIR = dir;

const branchByUser = new Map<number,number>();
const session = (id: number, name: string, role = "manager", branchId: number | null = branchByUser.get(id) ?? 1) =>
  ({ user: { id, name, email: `${name}@x.local`, role, branch_id: branchId, avatar_color: "#0ea5e9" } }) as any;

let seq = 0;

async function setup() {
  const { getDb } = await import("@/lib/db/schema");
  const { ensureDefaultStatuses } = await import("@/lib/repair");
  const db = getDb();
  ensureDefaultStatuses();
  seq += 1;
  const b1 = db.prepare("INSERT INTO branches(name, code) VALUES(?,?)").run(`شعبه ۱-${seq}`, `B1-${seq}`).lastInsertRowid as number;
  const b2 = db.prepare("INSERT INTO branches(name, code) VALUES(?,?)").run(`شعبه ۲-${seq}`, `B2-${seq}`).lastInsertRowid as number;
  const uMgr = db.prepare("INSERT INTO users(name, email, password_hash, role, branch_id) VALUES('مدیر تست',?,'h','manager',?)").run(`mgr${seq}@x.local`, b1).lastInsertRowid as number;
  const uT1 = db.prepare("INSERT INTO users(name, email, password_hash, role, branch_id) VALUES('تعمیرکار ۱',?,'h','technician',?)").run(`t1-${seq}@x.local`, b1).lastInsertRowid as number;
  const uT2 = db.prepare("INSERT INTO users(name, email, password_hash, role, branch_id) VALUES('تعمیرکار ۲',?,'h','technician',?)").run(`t2-${seq}@x.local`, b2).lastInsertRowid as number;
  const uRec = db.prepare("INSERT INTO users(name, email, password_hash, role, branch_id) VALUES('پذیرش',?,'h','reception',?)").run(`rec${seq}@x.local`, b1).lastInsertRowid as number;
  const uTLocal = Number(db.prepare("INSERT INTO users(name,email,password_hash,role,branch_id) VALUES(?,?,'h','technician',?)").run("Local technician",`local-${seq}@x.local`,b1).lastInsertRowid);
  const uMgr2 = Number(db.prepare("INSERT INTO users(name,email,password_hash,role,branch_id) VALUES(?,?,'h','manager',?)").run("Other manager",`mgr2-${seq}@x.local`,b2).lastInsertRowid);
  for(const [id,branch] of [[uMgr,b1],[uT1,b1],[uT2,b2],[uRec,b1],[uTLocal,b1],[uMgr2,b2]]) branchByUser.set(id,branch);
  const cust = db.prepare("INSERT INTO customers(first_name, last_name, mobile) VALUES('مشتری','تست','09120000000')").run().lastInsertRowid as number;
  const dev = db.prepare("INSERT INTO devices(customer_id, type, brand, model, serial) VALUES(?,?,?,?,?)").run(cust, "mobile", "سامسونگ", "Galaxy A52", "SN-1").lastInsertRowid as number;
  const stReceived = (db.prepare("SELECT id FROM repair_statuses WHERE name='Received'").get() as any).id;
  const mkTicket = (branch: number) =>
    db
      .prepare("INSERT INTO repair_tickets(number, branch_id, customer_id, device_id, status_id, problem, created_by) VALUES(?,?,?,?,?,?,?)")
      .run(`R-TEST-${Math.floor(Math.random() * 1e9)}`, branch, cust, dev, stReceived, "ایراد تست", uRec).lastInsertRowid as number;
  const t1 = mkTicket(b1);
  return { db, b1, b2, uMgr, uMgr2, uT1, uT2, uTLocal, uRec, cust, dev, t1 };
}

describe("ارجاع تعمیرکار — کارتابل، اتمیک و مسیر تعمیر", () => {
  it("دستگاه تازه در «در انتظار ارجاع» است و پس از ارجاع به ستون ارجاع‌شده می‌رود", async () => {
    const { db, b1, uMgr, uT1, uRec, t1 } = await setup();
    const { assignmentDashboard, assignTickets, requireAssignAccess } = await import("@/lib/repair-assign");
    const { repairPhase } = await import("@/lib/assign-shared");

    const dash1 = assignmentDashboard(session(uMgr, "مدیر تست"), {}, String(b1));
    assert.strictEqual(dash1.awaiting.some((c) => c.id === t1), true);
    assert.strictEqual(dash1.assigned.some((c) => c.id === t1), false);
    assert.strictEqual(repairPhase({ status_name: "Received", status_category: "open", technician_id: null }), "awaiting");

    const res = assignTickets(session(uMgr, "مدیر تست"), { items: [{ id: t1, expect: null }], technician_id: uT1 }, String(b1));
    assert.strictEqual(res.summary.ok, 1);
    assert.strictEqual(res.summary.failed, 0);

    const dash2 = assignmentDashboard(session(uMgr, "مدیر تست"), {}, String(b1));
    assert.strictEqual(dash2.awaiting.some((c) => c.id === t1), false);
    const card = dash2.assigned.find((c) => c.id === t1);
    assert.ok((card));
    assert.strictEqual(card!.technician_id, uT1);
    assert.strictEqual(card!.phase, "assigned"); // قرمز: ارجاع‌شده و شروع‌نشده

    const assigns = db.prepare("SELECT * FROM repair_assignments WHERE ticket_id = ?").all(t1) as any[];
    assert.strictEqual(assigns.length, 1);
    assert.strictEqual(assigns[0].action, "assign");
    assert.strictEqual(assigns[0].from_user_id, null);
    assert.strictEqual(Number(assigns[0].to_user_id), uT1);

    // تعمیرکار غیرمجاز (پذیرش) حق ارجاع ندارد
    assert.throws(() => requireAssignAccess(session(uRec, "پذیرش", "reception")));
    assert.throws(() =>
      assignTickets(session(uRec, "پذیرش", "reception"), { items: [{ id: t1, expect: null }], technician_id: uT1 }, String(b1)));
  });

  it("ارسال تکراری دوباره تاریخچه نمی‌سازد و تضاد هم‌زمانی تشخیص داده می‌شود", async () => {
    const { db, b1, uMgr, uT1, t1 } = await setup();
    const { assignTickets } = await import("@/lib/repair-assign");

    assignTickets(session(uMgr, "مدیر تست"), { items: [{ id: t1, expect: null }], technician_id: uT1 }, String(b1));
    // همان درخواست دوباره (retry): expect همان تعمیرکار فعلی → skipped بدون رکورد جدید
    const again = assignTickets(session(uMgr, "مدیر تست"), { items: [{ id: t1, expect: uT1 }], technician_id: uT1 }, String(b1));
    assert.strictEqual(again.summary.skipped, 1);
    assert.strictEqual(again.summary.ok, 0);
    assert.strictEqual((db.prepare("SELECT COUNT(*) c FROM repair_assignments WHERE ticket_id = ?").get(t1) as any).c, 1);
    assert.strictEqual((db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE entity='repair_ticket' AND entity_id=? AND action='assign'").get(t1) as any).c, 1);

    // یک مدیر دیگر هم‌زمان با expect اشتباه → تضاد، بدون بازنویسی
    const conflict = assignTickets(session(uMgr, "مدیر تست"), { items: [{ id: t1, expect: null }], technician_id: uT1 }, String(b1));
    assert.strictEqual(conflict.summary.failed, 1);
    assert.strictEqual(conflict.results[0].ok, false);
    const tech = (db.prepare("SELECT technician_id FROM repair_tickets WHERE id = ?").get(t1) as any).technician_id;
    assert.strictEqual(Number(tech), uT1);
  });

  it("ارجاع مجدد تاریخچه را حفظ می‌کند و بعد از شروع تعمیر دلیل الزامی است", async () => {
    const { db, b1, uMgr, uT1, uTLocal:uT2, t1 } = await setup();
    const { assignTickets } = await import("@/lib/repair-assign");
    const { transitionTicket } = await import("@/lib/repair");

    assignTickets(session(uMgr, "مدیر تست"), { items: [{ id: t1, expect: null }], technician_id: uT1 }, String(b1));
    // قبل از شروع تعمیر: ارجاع مجدد بدون دلیل مجاز است
    const beforeStart = assignTickets(session(uMgr, "مدیر تست"), { items: [{ id: t1, expect: uT1 }], technician_id: uT2 }, "all");
    assert.strictEqual(beforeStart.summary.ok, 1);

    // شروع تعمیر توسط تعمیرکار ۲
    transitionTicket(t1, "Diagnosing", uT2, undefined);
    transitionTicket(t1, "In Repair", uT2, undefined);

    // حالا ارجاع مجدد بدون دلیل رد می‌شود
    const noReason = assignTickets(session(uMgr, "مدیر تست"), { items: [{ id: t1, expect: uT2 }], technician_id: uT1 }, String(b1));
    assert.strictEqual(noReason.summary.failed, 1);
    assert.ok(noReason.results[0].reason?.includes("دلیل"));

    // با دلیل: ثبت می‌شود و ارجاع قبلی در تاریخچه می‌ماند
    const ok = assignTickets(session(uMgr, "مدیر تست"), { items: [{ id: t1, expect: uT2 }], technician_id: uT1, reason: "تخصص متفاوت" }, String(b1));
    assert.strictEqual(ok.summary.ok, 1);
    const rows = db.prepare("SELECT * FROM repair_assignments WHERE ticket_id = ? ORDER BY id").all(t1) as any[];
    assert.strictEqual(rows.length, 3);
    assert.strictEqual(rows[1].action, "reassign");
    assert.strictEqual(Number(rows[1].from_user_id), uT1);
    assert.strictEqual(Number(rows[1].to_user_id), uT2);
    assert.strictEqual(rows[2].reason, "تخصص متفاوت");
  });

  it("محدودهٔ شعبه: مدیرِ محدود به شعبهٔ دیگر دستگاه را نمی‌بیند و ارجاع نمی‌تواند بدهد", async () => {
    const { b2, uMgr2:uMgr, uT1, uT2, t1 } = await setup();
    const { assignmentDashboard, assignTickets } = await import("@/lib/repair-assign");

    const dashB2 = assignmentDashboard(session(uMgr, "مدیر تست"), {}, String(b2));
    assert.strictEqual(dashB2.awaiting.some((c) => c.id === t1), false);

    // تعمیرکار شعبهٔ ۱ برای مدیرِ محدود به شعبهٔ ۲ قابل انتخاب نیست
    assert.throws(() => assignTickets(session(uMgr, "مدیر تست"), { items: [{ id: t1, expect: null }], technician_id: uT1 }, String(b2)));

    // تعمیرکار مجاز شعبهٔ ۲، اما پذیرش متعلق به شعبهٔ ۱ → ردِ موردی با پیام شعبه
    const res = assignTickets(session(uMgr, "مدیر تست"), { items: [{ id: t1, expect: null }], technician_id: uT2 }, String(b2));
    assert.strictEqual(res.summary.failed, 1);
    assert.ok(res.results[0].reason?.includes("شعبه"));
  });

  it("کارتابل تعمیرکار فقط دستگاه‌های خودش را گروه‌بندی می‌کند و شروع تعمیر زمان‌سنج می‌سازد", async () => {
    const { db, b1, uMgr, uT1, t1 } = await setup();
    const { assignTickets, myQueue, startRepair } = await import("@/lib/repair-assign");
    const { transitionTicket } = await import("@/lib/repair");

    const { ensureDefaultStatuses } = await import("@/lib/repair");
    ensureDefaultStatuses();

    assignTickets(session(uMgr, "مدیر تست"), { items: [{ id: t1, expect: null }], technician_id: uT1 }, String(b1));
    const q1 = myQueue(session(uT1, "تعمیرکار ۱", "technician", b1), String(b1));
    assert.strictEqual(q1.not_started.some((c) => c.id === t1), true);
    assert.strictEqual(q1.in_progress.length, 0);

    // شروع از Received مجاز نیست (وضعیت میانی لازم است)
    assert.throws(() => startRepair(session(uT1, "تعمیرکار ۱", "technician", b1), t1, String(b1)));

    transitionTicket(t1, "Diagnosing", uT1, undefined);
    const started = startRepair(session(uT1, "تعمیرکار ۱", "technician", b1), t1, String(b1));
    assert.strictEqual(started.status, "In Repair");
    assert.strictEqual(started.timer_started, true);
    const t = db.prepare("SELECT s.name FROM repair_tickets t JOIN repair_statuses s ON s.id=t.status_id WHERE t.id=?").get(t1) as any;
    assert.strictEqual(t.name, "In Repair");
    assert.strictEqual((db.prepare("SELECT COUNT(*) c FROM time_entries WHERE ticket_id=? AND ended_at IS NULL").get(t1) as any).c, 1);

    const q2 = myQueue(session(uT1, "تعمیرکار ۱", "technician", b1), String(b1));
    assert.strictEqual(q2.in_progress.some((c) => c.id === t1), true);
    assert.strictEqual(q2.not_started.some((c) => c.id === t1), false);
  });

  it("«مسیر تعمیر» همهٔ رویدادها را به ترتیب و با ارجاع‌های واقعی برمی‌گرداند", async () => {
    const { db, b1, uMgr, uT1, t1 } = await setup();
    const { assignTickets } = await import("@/lib/repair-assign");
    const { transitionTicket } = await import("@/lib/repair");
    const { ticketJourney } = await import("@/lib/journey");

    assignTickets(session(uMgr, "مدیر تست"), { items: [{ id: t1, expect: null }], technician_id: uT1 }, String(b1));
    transitionTicket(t1, "Diagnosing", uT1, "شروع عیب‌یابی");

    // قطعه با تراکنش واقعی انبار
    const part = db.prepare("INSERT INTO parts(name, sku, price, avg_cost) VALUES('باتری تست','PT-1',100000,80000)").run().lastInsertRowid as number;
    db.prepare("INSERT INTO ticket_items(ticket_id, kind, ref_id, name, qty, unit_price, cost, added_by) VALUES(?,?,?,?,?,?,?,?)").run(
      t1, "part", part, "باتری تست", 1, 100000, 80000, uT1
    );
    const mv = db
      .prepare("INSERT INTO inventory_movements(part_id, qty, type, ref_type, ref_id, user_id) VALUES(?,?,?,?,?,?)")
      .run(part, -1, "repair_consumption", "ticket", t1, uT1).lastInsertRowid as number;
    db.prepare("INSERT INTO repair_notes(ticket_id, user_id, body, kind) VALUES(?,?,?,'internal')").run(t1, uT1, "برد اصلی سالم است");

    const journey = ticketJourney(t1, { id: uMgr, privileged: true });
    const kinds = journey.events.map((e) => e.kind);
    assert.ok((kinds).includes("accept"));
    assert.ok((kinds).includes("assign"));
    assert.ok((kinds).includes("status"));
    assert.ok((kinds).includes("item"));
    assert.ok((kinds).includes("note"));

    // ترتیب زمانی صعودی
    for (let i = 1; i < journey.events.length; i++) {
      assert.strictEqual(String(journey.events[i].at) >= String(journey.events[i - 1].at), true);
    }
    const itemEv = journey.events.find((e) => e.kind === "item")!;
    assert.strictEqual(Number(itemEv.meta?.movement_id), Number(mv));
    assert.ok((journey.summary.assigned_at));
  });

  it("متن خصوصی در مسیر تعمیر برای دیگران پنهان می‌ماند", async () => {
    const { db, uMgr, uT1, t1 } = await setup();
    const { ticketJourney } = await import("@/lib/journey");
    db.prepare("INSERT INTO repair_notes(ticket_id, user_id, body, kind) VALUES(?,?,?,'private')").run(t1, uT1, "یادداشت محرمانه");
    const asOther = ticketJourney(t1, { id: uMgr, privileged: false });
    assert.strictEqual(asOther.events.some((e) => String(e.detail ?? "").includes("محرمانه")), false);
    const asAuthor = ticketJourney(t1, { id: uT1, privileged: false });
    assert.strictEqual(asAuthor.events.some((e) => String(e.detail ?? "").includes("محرمانه")), true);
  });
});

afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});
