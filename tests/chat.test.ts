import { describe, it, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// دیتابیس موقت: DDL و مهاجرت‌های واقعی چت اجرا می‌شوند
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repaid-chat-"));
process.env.REPAID_DATA_DIR = dir;
before(async () => {
  const {getDb}=await import("@/lib/db/schema");
  getDb().prepare("INSERT INTO branches(id,name,code) VALUES(1,'Internal branch','CHAT1')").run();
});

const session = (id: number, name: string, role = "technician", branchId: number | null = 1) =>
  ({ user: { id, name, email: `${name}@x.local`, role, branch_id: branchId, avatar_color: "#0ea5e9" } }) as any;

describe("چت سازمانی — مدل داده و قواعد دسترسی", () => {
  it("جداول چت ساخته می‌شوند", async () => {
    const { getDb } = await import("@/lib/db/schema");
    const db = getDb();
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'chat_%'").all() as any[]).map((r) => r.name);
    for (const t of [
      "chat_conversations",
      "chat_members",
      "chat_messages",
      "chat_attachments",
      "chat_reactions",
      "chat_mentions",
      "chat_presence",
      "chat_typing",
      "chat_events",
    ]) {
      assert.ok((tables).includes(t));
    }
  });

  it("مکالمهٔ خصوصی تکراری ساخته نمی‌شود (dm_key یکتا)", async () => {
    const { getDb } = await import("@/lib/db/schema");
    const { ensureDirectConversation } = await import("@/lib/chat");
    const db = getDb();
    const a = db.prepare("INSERT INTO users(name, email, password_hash,branch_id) VALUES(?,?,?,1)").run("کاربر الف", "a@x.local", "h").lastInsertRowid as number;
    const b = db.prepare("INSERT INTO users(name, email, password_hash,branch_id) VALUES(?,?,?,1)").run("کاربر ب", "b@x.local", "h").lastInsertRowid as number;

    const id1 = ensureDirectConversation(db, session(a, "الف"), b);
    const id2 = ensureDirectConversation(db, session(b, "ب"), a);
    assert.strictEqual(id2, id1);

    const count = (db.prepare("SELECT COUNT(*) c FROM chat_conversations WHERE type='direct'").get() as any).c;
    assert.strictEqual(Number(count), 1);
    const members = db.prepare("SELECT COUNT(*) c FROM chat_members WHERE conversation_id = ?").get(id1) as any;
    assert.strictEqual(Number(members.c), 2);
  });

  it("کاربر غیرعضو به مکالمه دسترسی ندارد", async () => {
    const { getDb } = await import("@/lib/db/schema");
    const { ensureDirectConversation, requireConversation } = await import("@/lib/chat");
    const db = getDb();
    const a = db.prepare("SELECT id FROM users WHERE email='a@x.local'").get() as any;
    const c = db.prepare("INSERT INTO users(name, email, password_hash,branch_id) VALUES(?,?,?,1)").run("کاربر پ", "c@x.local", "h").lastInsertRowid as number;
    const convId = ensureDirectConversation(db, session(Number(a.id), "الف"), Number(c));
    const outsider = db.prepare("INSERT INTO users(name, email, password_hash,branch_id) VALUES(?,?,?,1)").run("کاربر ت", "d@x.local", "h").lastInsertRowid as number;
    assert.throws(() => requireConversation(db, convId, Number(outsider)), /عضو این مکالمه/);
  });

  it("ارسال پیام با client_key تکراری، پیام دوم نمی‌سازد", async () => {
    const { getDb } = await import("@/lib/db/schema");
    const { ensureDirectConversation, postMessage, requireConversation, serializeMessages } = await import("@/lib/chat");
    const db = getDb();
    const a = db.prepare("SELECT id, name FROM users WHERE email='a@x.local'").get() as any;
    const b = db.prepare("SELECT id, name FROM users WHERE email='b@x.local'").get() as any;
    const convId = ensureDirectConversation(db, session(Number(a.id), a.name), Number(b.id));
    const { conv, member } = requireConversation(db, convId, Number(a.id));

    const first = postMessage(db, session(Number(a.id), a.name), conv, member, { body: "سلام", client_key: "ck-1" });
    const second = postMessage(db, session(Number(a.id), a.name), conv, member, { body: "سلام دوباره", client_key: "ck-1" });
    assert.strictEqual(second.duplicate, true);
    assert.strictEqual(second.message.id, first.message.id);

    const rows = db.prepare("SELECT COUNT(*) c FROM chat_messages WHERE conversation_id = ?").get(convId) as any;
    assert.strictEqual(Number(rows.c), 1);
    const msgs = serializeMessages(db, db.prepare("SELECT * FROM chat_messages WHERE conversation_id = ?").all(convId) as any[], Number(a.id));
    assert.strictEqual(msgs[0].body, "سلام");
  });

  it("شمار ناخوانده درست محاسبه و با خواندن صفر می‌شود", async () => {
    const { getDb } = await import("@/lib/db/schema");
    const { ensureDirectConversation, postMessage, requireConversation, chatSummary, markRead } = await import("@/lib/chat");
    const db = getDb();
    const a = db.prepare("SELECT id, name FROM users WHERE email='a@x.local'").get() as any;
    const b = db.prepare("SELECT id, name FROM users WHERE email='b@x.local'").get() as any;
    const convId = ensureDirectConversation(db, session(Number(a.id), a.name), Number(b.id));

    const bm = requireConversation(db, convId, Number(b.id));
    postMessage(db, session(Number(b.id), b.name), bm.conv, bm.member, { body: "پیام یک" });
    postMessage(db, session(Number(b.id), b.name), bm.conv, bm.member, { body: "پیام دو" });

    const before = chatSummary(db, Number(a.id));
    assert.strictEqual(before.unread_total, 2);

    markRead(db, session(Number(a.id), a.name), convId);
    const after = chatSummary(db, Number(a.id));
    assert.strictEqual(after.unread_total, 0);

    // پیام‌های خود کاربر ناخوانده حساب نمی‌شوند
    const am = requireConversation(db, convId, Number(a.id));
    postMessage(db, session(Number(a.id), a.name), am.conv, am.member, { body: "پیام خودم" });
    assert.strictEqual(chatSummary(db, Number(a.id)).unread_total, 0);
  });

  it("جست‌وجوی فارسی نرمال‌سازی می‌شود (ي/ك عربی و نیم‌فاصله)", async () => {
    const { getDb } = await import("@/lib/db/schema");
    const { ensureDirectConversation, postMessage, requireConversation, searchChat } = await import("@/lib/chat");
    const db = getDb();
    const a = db.prepare("SELECT id, name FROM users WHERE email='a@x.local'").get() as any;
    const c = db.prepare("SELECT id, name FROM users WHERE email='c@x.local'").get() as any;
    const convId = ensureDirectConversation(db, session(Number(a.id), a.name), Number(c.id));
    const cm = requireConversation(db, convId, Number(c.id));
    postMessage(db, session(Number(c.id), c.name), cm.conv, cm.member, { body: "برد شارژر سریع يک می‌شود تست" });

    const res = searchChat(db, session(Number(a.id), a.name), { q: "یک میشود" });
    assert.strictEqual(res.results.length, 1);
    assert.strictEqual(res.results[0].conversation_id, convId);
    assert.ok((res.results[0].snippet).includes("برد"));

    // عبارت کوتاه نامعتبر است
    assert.throws(() => searchChat(db, session(Number(a.id), a.name), { q: "ب" }));
  });

  it("چت مرتبط با پذیرش و مشتری در این نسخه بسته است و سندی نمی‌سازد", async () => {
    const { getDb } = await import("@/lib/db/schema");
    const { ensureEntityConversation } = await import("@/lib/chat");
    const db = getDb();
    // حداقل داده برای پذیرش: شعبه، مشتری، دستگاه، وضعیت
    const branchId = db.prepare("INSERT INTO branches(name, code) VALUES(?,?)").run("شعبه تست", "TS").lastInsertRowid as number;
    const customerId = db.prepare("INSERT INTO customers(first_name, last_name) VALUES(?,?)").run("مشتری", "تست").lastInsertRowid as number;
    const deviceId = db.prepare("INSERT INTO devices(customer_id, type, brand, model) VALUES(?,?,?,?)").run(customerId, "mobile", "برند", "مدل").lastInsertRowid as number;
    const statusId = db.prepare("INSERT INTO repair_statuses(name, category, is_open) VALUES(?,?,1)").run("جدید تست", "new").lastInsertRowid as number;
    const recId = db.prepare("INSERT INTO users(name, email, password_hash, role, branch_id) VALUES(?,?,?,?,?)").run("پذیرش تست", "rec@x.local", "h", "reception", branchId).lastInsertRowid as number;
    const ticketId = db
      .prepare("INSERT INTO repair_tickets(number, branch_id, customer_id, device_id, status_id, created_by) VALUES(?,?,?,?,?,?)")
      .run("P9999", branchId, customerId, deviceId, statusId, recId).lastInsertRowid as number;

    for (const type of ["repair","customer","invoice"]) {
      assert.throws(() => ensureEntityConversation(db, session(Number(recId), "پذیرش تست", "reception", Number(branchId)), type, Number(ticketId)), {status:410});
    }
    assert.equal(db.prepare("SELECT COUNT(*) n FROM chat_conversations WHERE entity_type IS NOT NULL").get()!.n,0);
  });

  it("عضو جدید پیام‌های قبل از عضویت را نه می‌بیند و نه ناخوانده حساب می‌کند", async () => {
    const { getDb } = await import("@/lib/db/schema");
    const { createGroupConversation, postMessage, requireConversation, addMember, listConversations, fetchMessages } = await import("@/lib/chat");
    const db = getDb();
    const a = db.prepare("INSERT INTO users(name,email,password_hash,role,branch_id) VALUES('مدیر گروه','group-manager@x.local','h','manager',1) RETURNING id,name").get() as any;
    const b = db.prepare("SELECT id, name FROM users WHERE email='b@x.local'").get() as any;
    const c = db.prepare("SELECT id, name FROM users WHERE email='c@x.local'").get() as any;

    const groupId = createGroupConversation(db, session(Number(a.id), a.name, "manager"), {
      type: "group",
      title: "تیم تست",
      memberIds: [Number(b.id)],
    });
    const am = requireConversation(db, groupId, Number(a.id));
    postMessage(db, session(Number(a.id), a.name, "manager"), am.conv, am.member, { body: "پیام قدیمی یک" });
    postMessage(db, session(Number(a.id), a.name, "manager"), am.conv, am.member, { body: "پیام قدیمی دو" });

    // کاربر سوم بعد از دو پیام اضافه می‌شود (سیاست پیش‌فرض: تاریخچه از زمان عضویت)
    addMember(db, session(Number(a.id), a.name, "manager"), groupId, Number(c.id));
    assert.strictEqual(listConversations(db, session(Number(c.id), c.name, "technician"), { filter: "all", q: "", withPresence: false })[0].unread_count, 0);

    const am2 = requireConversation(db, groupId, Number(a.id));
    postMessage(db, session(Number(a.id), a.name, "manager"), am2.conv, am2.member, { body: "پیام بعد از عضویت" });

    const cList = listConversations(db, session(Number(c.id), c.name, "technician"), { filter: "all", q: "", withPresence: false });
    assert.strictEqual(cList.find((x) => x.id === groupId)?.unread_count, 1);

    const visible = fetchMessages(db, session(Number(c.id), c.name, "technician"), groupId, { limit: 20 });
    const bodies = visible.messages.map((m) => m.body);
    assert.strictEqual(bodies.some((t) => t.includes("پیام قدیمی")), false);
    assert.strictEqual(bodies.some((t) => t.includes("پیام بعد از عضویت")), true);
  });

  it("منشن به کاربر غیرعضو ثبت نمی‌شود", async () => {
    const { getDb } = await import("@/lib/db/schema");
    const { ensureDirectConversation, postMessage, requireConversation } = await import("@/lib/chat");
    const db = getDb();
    const a = db.prepare("SELECT id, name FROM users WHERE email='a@x.local'").get() as any;
    const b = db.prepare("SELECT id, name FROM users WHERE email='b@x.local'").get() as any;
    const outsider = db.prepare("SELECT id FROM users WHERE email='d@x.local'").get() as any;
    const convId = ensureDirectConversation(db, session(Number(a.id), a.name), Number(b.id));
    const { conv, member } = requireConversation(db, convId, Number(a.id));
    const res = postMessage(db, session(Number(a.id), a.name), conv, member, { body: "سلام", mentions: [Number(outsider.id)] });
    const mentions = db.prepare("SELECT COUNT(*) c FROM chat_mentions WHERE message_id = ?").get(res.message.id) as any;
    assert.strictEqual(Number(mentions.c), 0);
  });
});

afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});
