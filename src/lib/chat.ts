/**
 * هستهٔ چت سازمانی — تمام منطق دامنه سمت سرور (SQLite).
 * کلاینت فقط می‌خواند؛ هر عملیات این‌جا مجوز و عضویت را دوباره بررسی می‌کند.
 */
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "@/lib/db/schema";
import { canForUser, flagEnabledFor, type Session } from "@/lib/auth";
import { HttpError,auditRecord,requirePerm } from "@/lib/api";
import { getSetting } from "@/lib/repair";
import { atomic } from "@/lib/db/transaction";
import {
  normalizeFa,
  normalizeFaWithMap,
  DEFAULT_ALLOWED_EXT,
  BLOCKED_EXT,
  fileExt,
  chatPreview,
  type ChatUserBrief,
  type ChatMessage,
  type ChatMemberInfo,
  type ChatConversationListItem,
  type ChatConversationDetails,
  type ChatEntityCard,
  type ChatType,
} from "@/lib/chat-shared";

export type ChatConfig = { maxFileMb: number; allowedExt: Set<string>; editWindowMin: number };

export function chatConfig(): ChatConfig {
  const maxFileMb = Math.min(50, Math.max(1, Number(getSetting("chat.max_file_mb", "10")) || 10));
  const raw = getSetting("chat.allowed_ext", DEFAULT_ALLOWED_EXT) || DEFAULT_ALLOWED_EXT;
  const allowedExt = new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase().replace(/^\./, ""))
      .filter((e) => e && !BLOCKED_EXT.includes(e))
  );
  const editWindowMin = Math.min(1440, Math.max(0, Number(getSetting("chat.edit_window_min", "15")) || 0));
  return { maxFileMb, allowedExt, editWindowMin };
}

/** آیا این پسوند/MIME قابل آپلود است؟ (سرور مرجع نهایی است) */
export function assertUploadAllowed(filename: string, mime: string, size: number) {
  const cfg = chatConfig();
  const ext = fileExt(filename);
  if (!ext) throw new HttpError(400, "فایل بدون پسوند مجاز نیست — نام فایل را با پسوند مناسب انتخاب کنید.");
  if (BLOCKED_EXT.includes(ext)) throw new HttpError(400, "این نوع فایل به دلایل امنیتی قابل ارسال نیست.");
  if (!cfg.allowedExt.has(ext)) {
    throw new HttpError(400, `پسوند «${ext}» مجاز نیست — یکی از پسوندهای مجاز: ${[...cfg.allowedExt].join("، ")}`);
  }
  if (mime && /^(text\/html|image\/svg)/i.test(mime)) throw new HttpError(400, "این نوع فایل به دلایل امنیتی قابل ارسال نیست.");
  if (size > cfg.maxFileMb * 1024 * 1024) throw new HttpError(400, `حجم فایل زیاد است (حداکثر ${cfg.maxFileMb} مگابایت).`);
}

// ---- محدودیت نرخ ساده در حافظه ----
const rateBuckets = new Map<string, number[]>();
export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const arr = (rateBuckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) throw new HttpError(429, "تعداد درخواست‌ها زیاد است — چند لحظه صبر کنید و دوباره تلاش کنید.");
  arr.push(now);
  rateBuckets.set(key, arr);
  if (rateBuckets.size > 2000) {
    for (const [k, v] of rateBuckets) if (!v.length || now - v[v.length - 1] > 10 * 60_000) rateBuckets.delete(k);
  }
}

// ---- حضور ----
export function touchPresence(userId: number) {
  try {
    getDb()
      .prepare(
        "INSERT INTO chat_presence(user_id, last_seen_at) VALUES(?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET last_seen_at = datetime('now')"
      )
      .run(userId);
  } catch {}
}

export function presenceVisible(session: Session): boolean {
  return canForUser(session.user.role, "chat.presence", session.user.id);
}

function presenceOf(db: DatabaseSync, userIds: number[]): Map<number, { online: boolean; last_seen_at: string | null }> {
  const map = new Map<number, { online: boolean; last_seen_at: string | null }>();
  if (userIds.length === 0) return map;
  const rows = db
    .prepare(
      `SELECT user_id, last_seen_at,
              CASE WHEN last_seen_at > datetime('now','-70 seconds') THEN 1 ELSE 0 END AS online
       FROM chat_presence WHERE user_id IN (${userIds.map(() => "?").join(",")})`
    )
    .all(...userIds) as any[];
  for (const r of rows) map.set(Number(r.user_id), { online: !!Number(r.online), last_seen_at: r.last_seen_at ?? null });
  return map;
}

function usersBrief(db: DatabaseSync, ids: number[], withPresence: boolean): Map<number, ChatUserBrief> {
  const map = new Map<number, ChatUserBrief>();
  if (ids.length === 0) return map;
  const rows = db
    .prepare(
      `SELECT u.id, u.name, u.role, u.branch_id, u.avatar_color, b.name branch_name
       FROM users u LEFT JOIN branches b ON b.id = u.branch_id
       WHERE u.id IN (${ids.map(() => "?").join(",")})`
    )
    .all(...ids) as any[];
  const pres = withPresence ? presenceOf(db, ids) : new Map();
  for (const r of rows) {
    const p = pres.get(Number(r.id));
    map.set(Number(r.id), {
      id: Number(r.id),
      name: String(r.name),
      role: String(r.role),
      branch_id: r.branch_id == null ? null : Number(r.branch_id),
      branch_name: r.branch_name ?? null,
      avatar_color: String(r.avatar_color ?? "#0ea5e9"),
      online: withPresence ? p?.online ?? false : undefined,
      last_seen_at: withPresence ? p?.last_seen_at ?? null : undefined,
    });
  }
  return map;
}

// ---- عضویت و دسترسی ----

export type ChatConversationRow = {
  id: number;
  type: ChatType;
  title: string | null;
  description: string | null;
  avatar_color: string | null;
  dm_key: string | null;
  entity_type: string | null;
  entity_id: number | null;
  branch_id: number | null;
  history_for_new_members: number;
  created_by: number | null;
  last_message_at: string | null;
  is_active: number;
  created_at: string;
};

export type ChatMemberRow = {
  conversation_id: number;
  user_id: number;
  role: string;
  joined_at: string;
  left_at: string | null;
  last_read_message_id: number;
  joined_msg_id: number;
  pinned: number;
  archived: number;
  muted_until: string | null;
};

export function requireConversation(db: DatabaseSync, convId: number, userId: number): { conv: ChatConversationRow; member: ChatMemberRow } {
  const access = internalChatAccess(userId);
  const conv = db.prepare(`SELECT c.* FROM chat_conversations c WHERE c.id = ? AND ${access.sql}`).get(convId, ...access.params) as any;
  if (!conv) throw new HttpError(404, "مکالمه یافت نشد.");
  const member = db.prepare("SELECT * FROM chat_members WHERE conversation_id = ? AND user_id = ?").get(convId, userId) as any;
  if (!member) throw new HttpError(403, "شما عضو این مکالمه نیستید.");
  if (member.left_at) throw new HttpError(403, "شما دیگر عضو این مکالمه نیستید.");
  const m: ChatMemberRow = {
    ...member,
    user_id: Number(member.user_id),
    last_read_message_id: Number(member.last_read_message_id ?? 0),
    joined_msg_id: Number(member.joined_msg_id ?? 0),
    pinned: Number(member.pinned ?? 0),
    archived: Number(member.archived ?? 0),
  };
  return { conv: conv as ChatConversationRow, member: m };
}

export function myRole(session: Session): string {
  return session.user.role;
}

export function canManageConversation(session: Session, member: ChatMemberRow, conv:ChatConversationRow): boolean {
  if (member.role === "owner" || member.role === "admin") return true;
  const scope=["owner","admin"].includes(session.user.role) || (conv.branch_id!=null && conv.branch_id===session.user.branch_id);
  return scope && canForUser(session.user.role, "chat.group.manage", session.user.id);
}

export function canPostIn(conv: ChatConversationRow, member: ChatMemberRow, session: Session,db:DatabaseSync): boolean {
  if(conv.type==='direct' && db.prepare(`SELECT 1 FROM chat_members m JOIN users u ON u.id=m.user_id
    WHERE m.conversation_id=? AND u.role NOT IN ('owner','admin') AND (u.is_active!=1 OR NOT EXISTS(SELECT 1 FROM branches b WHERE b.id=u.branch_id AND b.is_active=1)) LIMIT 1`).get(conv.id))return false;
  if (conv.type !== "channel") return true;
  if (member.role === "owner" || member.role === "admin") return true;
  return canForUser(session.user.role, "chat.channel.post", session.user.id);
}

/**
 * فیلتر دیده‌شدن پیام‌ها: عضو تازه فقط از مرز عضویت به بعد.
 * مرز = `joined_msg_id` (شناسهٔ آخرین پیام هنگام عضویت) — دقیق و بدون ابهام ثانیه‌ای.
 * برای ردیف‌های قدیمی که این ستون صفر است، به سیاست قبلی (مقایسهٔ زمان) برمی‌گردیم.
 */
function visibilitySql(conv: ChatConversationRow, member: ChatMemberRow, alias = "m"): { sql: string; params: any[] } {
  if (conv.type === "direct" || Number(conv.history_for_new_members) === 1) return { sql: "1=1", params: [] };
  const boundary = Number(member.joined_msg_id ?? 0);
  return {
    sql: `(${alias}.kind = 'system' OR ${alias}.id > ? OR (? = 0 AND ${alias}.created_at >= ?))`,
    params: [boundary, boundary, member.joined_at],
  };
}

export function requireVisibleChatMessage(db: DatabaseSync, userId: number, messageId: number) {
  const row=db.prepare("SELECT conversation_id FROM chat_messages WHERE id=? AND deleted_at IS NULL").get(messageId) as {conversation_id:number}|undefined;
  if(!row)throw new HttpError(404,"پیام یافت نشد.");
  const {conv,member}=requireConversation(db,row.conversation_id,userId);
  const visibility=visibilitySql(conv,member);
  if(!db.prepare(`SELECT m.id FROM chat_messages m WHERE m.id=? AND ${visibility.sql}`).get(messageId,...visibility.params))throw new HttpError(404,"پیام یافت نشد.");
  return {conv,member};
}

/** آیا کاربر جاری مجاز به دیدن این پذیرش است؟ (مبنای اتصال چت به عملیات) */
export function canAccessTicket(db: DatabaseSync, session: Session, ticketId: number): boolean {
  if (!canForUser(session.user.role, "repairs.view", session.user.id)) return false;
  const t = db.prepare("SELECT branch_id, technician_id, technician2_id FROM repair_tickets WHERE id = ?").get(ticketId) as any;
  if (!t) return false;
  const privileged = ["owner", "admin"].includes(session.user.role);
  if (!privileged) {
    if (session.user.branch_id == null || Number(t.branch_id) !== session.user.branch_id) return false;
    if (
      session.user.role === "technician" &&
      flagEnabledFor("technician", "repairs.only_assigned") &&
      Number(t.technician_id) !== session.user.id &&
      Number(t.technician2_id) !== session.user.id
    )
      return false;
  }
  return true;
}

/** محدودهٔ افزودن عضو: مدیران همه؛ بقیه فقط هم‌شعبه یا کاربران بدون شعبه */
export function userInScope(session: Session, target: { branch_id: number | null; id: number; role?: string }): boolean {
  const db=getDb();
  const actor=db.prepare('SELECT role,branch_id,is_active FROM users WHERE id=?').get(session.user.id);
  if(!actor||actor.is_active!==1||actor.role!==session.user.role||actor.branch_id!==session.user.branch_id)return false;
  return !!db.prepare("SELECT 1 FROM users u LEFT JOIN branches b ON b.id=u.branch_id WHERE u.id=? AND u.is_active=1 AND (u.role IN ('owner','admin') OR b.is_active=1)").get(target.id);
}

/** Internal employees only. Recheck current employment on every read/write, not just joining.
 * Explicit company-wide groups remain internal; branch groups and direct messages are scoped.
 * Linked customer/repair threads are retained as historical evidence, unavailable this release.
 */
function internalChatPredicate(actorIdExpression="?"):string {
  return `c.is_active=1 AND c.entity_type IS NULL AND c.entity_id IS NULL AND EXISTS(
    SELECT 1 FROM users actor WHERE actor.id=${actorIdExpression} AND actor.is_active=1
    AND (actor.role IN ('owner','admin') OR EXISTS(SELECT 1 FROM branches b WHERE b.id=actor.branch_id AND b.is_active=1)))`;
}

export function internalChatAccess(userId: number): { sql: string; params: number[] } {
  return {sql:internalChatPredicate(),params:[userId]};
}

function requireCurrentChatEmployee(db:DatabaseSync,session:Session){
  const actor=db.prepare("SELECT role,branch_id,is_active FROM users WHERE id=?").get(session.user.id);
  if(!actor || actor.is_active!==1)throw new HttpError(403,"حساب کاربری فعال نیست.");
  if(actor.role!==session.user.role || actor.branch_id!==session.user.branch_id)throw new HttpError(409,"شعبه یا نقش شما تغییر کرده است؛ صفحه را تازه‌سازی کنید.");
  if(!["owner","admin"].includes(session.user.role) && !db.prepare("SELECT 1 FROM branches WHERE id=? AND is_active=1").get(session.user.branch_id))throw new HttpError(403,"شعبهٔ محل اشتغال شما فعال نیست.");
}

export function activeMemberIds(db: DatabaseSync, convId: number): number[] {
  return (db.prepare("SELECT user_id FROM chat_members WHERE conversation_id = ? AND left_at IS NULL").all(convId) as any[]).map((r) =>
    Number(r.user_id)
  );
}

function maxMessageId(db: DatabaseSync, convId: number): number {
  const r = db.prepare("SELECT COALESCE(MAX(id),0) m FROM chat_messages WHERE conversation_id = ?").get(convId) as any;
  return Number(r?.m ?? 0);
}

// ---- رویدادها و اعلان‌ها ----

export function pushEvent(db: DatabaseSync, convId: number, type: string, payload: Record<string, unknown>, actorId: number | null) {
  db.prepare("INSERT INTO chat_events(conversation_id, actor_id, type, payload) VALUES(?,?,?,?)").run(
    convId,
    actorId,
    type,
    JSON.stringify(payload ?? {})
  );
}

export function notifyChat(db: DatabaseSync, userId: number, opts: { title: string; body: string; link: string; priority?: string;branchId:number|null;messageId:number }) {
  db.prepare("INSERT INTO notifications(user_id, title, body, priority, link,branch_id,chat_message_id) VALUES(?,?,?,?,?,?,?)").run(
    userId,
    opts.title,
    opts.body,
    opts.priority ?? "normal",
    opts.link,opts.branchId,opts.messageId
  );
}

// ---- سریال‌سازی پیام‌ها ----

function ph(n: number): string {
  return Array.from({ length: n }, () => "?").join(",");
}

export function serializeMessages(db: DatabaseSync, rows: any[], meId: number): ChatMessage[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => Number(r.id));
  const attachments = db
    .prepare(`SELECT id, message_id, filename, mime, size FROM chat_attachments WHERE message_id IN (${ph(ids.length)}) ORDER BY id`)
    .all(...ids) as any[];
  const reactions = db
    .prepare(`SELECT message_id, user_id, emoji FROM chat_reactions WHERE message_id IN (${ph(ids.length)})`)
    .all(...ids) as any[];
  const mentions = db
    .prepare(`SELECT message_id, user_id FROM chat_mentions WHERE message_id IN (${ph(ids.length)})`)
    .all(...ids) as any[];

  const replyIds = [...new Set(rows.map((r) => r.reply_to_id).filter((x) => x != null).map(Number))];
  const replyMap = new Map<number, any>();
  if (replyIds.length) {
    const rr = db
      .prepare(
        `SELECT m.id, m.body, m.kind, m.deleted_at, u.name sender_name,
                EXISTS(SELECT 1 FROM chat_attachments a WHERE a.message_id = m.id) has_attachment
         FROM chat_messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.id IN (${ph(replyIds.length)})`
      )
      .all(...replyIds) as any[];
    for (const r of rr) replyMap.set(Number(r.id), r);
  }

  const attMap = new Map<number, any[]>();
  for (const a of attachments) {
    const key = a.message_id == null ? -1 : Number(a.message_id);
    attMap.set(key, [...(attMap.get(key) ?? []), { id: Number(a.id), filename: String(a.filename), mime: String(a.mime), size: Number(a.size) }]);
  }
  const reMap = new Map<number, Map<string, { count: number; mine: boolean }>>();
  for (const r of reactions) {
    const mid = Number(r.message_id);
    const em = String(r.emoji);
    const inner = reMap.get(mid) ?? new Map();
    const cur = inner.get(em) ?? { count: 0, mine: false };
    cur.count += 1;
    if (Number(r.user_id) === meId) cur.mine = true;
    inner.set(em, cur);
    reMap.set(mid, inner);
  }
  const menMap = new Map<number, number[]>();
  for (const m of mentions) menMap.set(Number(m.message_id), [...(menMap.get(Number(m.message_id)) ?? []), Number(m.user_id)]);

  return rows.map((r) => {
    const id = Number(r.id);
    const reply = r.reply_to_id != null ? replyMap.get(Number(r.reply_to_id)) : null;
    const inner = reMap.get(id);
    return {
      id,
      conversation_id: Number(r.conversation_id),
      sender_id: r.sender_id == null ? null : Number(r.sender_id),
      sender_name: r.sender_name ?? null,
      sender_color: r.sender_color ?? null,
      kind: String(r.kind ?? "text"),
      body: String(r.body ?? ""),
      created_at: String(r.created_at ?? ""),
      edited_at: r.edited_at ?? null,
      deleted_at: r.deleted_at ?? null,
      pinned: !!Number(r.pinned ?? 0),
      reply_to: reply
        ? {
            id: Number(reply.id),
            sender_name: reply.sender_name ?? null,
            body: String(reply.deleted_at ? "" : reply.body ?? "").slice(0, 140),
            kind: String(reply.kind ?? "text"),
            deleted: !!reply.deleted_at,
            has_attachment: !!Number(reply.has_attachment),
          }
        : null,
      attachments: attMap.get(id) ?? [],
      reactions: inner ? [...inner.entries()].map(([emoji, v]) => ({ emoji, count: v.count, mine: v.mine })) : [],
      mentions: menMap.get(id) ?? [],
      client_key: r.client_key ?? null,
    };
  });
}

export function getMemberList(db: DatabaseSync, convId: number, withPresence: boolean, excludeLeft = true): ChatMemberInfo[] {
  const rows = db
    .prepare(
      `SELECT m.user_id, m.role conv_role, m.joined_at, m.last_read_message_id,
              u.name, u.role, u.avatar_color
       FROM chat_members m JOIN users u ON u.id = m.user_id
       JOIN chat_conversations c ON c.id=m.conversation_id
       WHERE m.conversation_id = ? AND ${internalChatPredicate("m.user_id")}${excludeLeft ? " AND m.left_at IS NULL" : ""}
       ORDER BY m.joined_at, m.user_id`
    )
    .all(convId) as any[];
  const pres = withPresence ? presenceOf(db, rows.map((r) => Number(r.user_id))) : new Map();
  return rows.map((r) => {
    const p = pres.get(Number(r.user_id));
    return {
      user_id: Number(r.user_id),
      name: String(r.name),
      role: String(r.role),
      conv_role: String(r.conv_role),
      avatar_color: String(r.avatar_color ?? "#0ea5e9"),
      joined_at: String(r.joined_at),
      last_read_message_id: Number(r.last_read_message_id ?? 0),
      online: withPresence ? p?.online ?? false : undefined,
      last_seen_at: withPresence ? p?.last_seen_at ?? null : undefined,
    };
  });
}

// ---- عنوان و کارت موجودیت ----

function entityInfo(db: DatabaseSync, entityType: string | null, entityId: number | null): { title: string | null } {
  if (!entityType || entityId == null) return { title: null };
  if (entityType === "repair") {
    const t = db.prepare("SELECT number FROM repair_tickets WHERE id = ?").get(entityId) as any;
    return { title: t?.number ?? null };
  }
  return { title: null };
}

export function conversationTitle(db: DatabaseSync, conv: ChatConversationRow, meId: number): string {
  if (conv.title?.trim()) return conv.title.trim();
  if (conv.type === "direct") {
    const other = db
      .prepare("SELECT u.name FROM chat_members m JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ? AND m.user_id != ? LIMIT 1")
      .get(conv.id, meId) as any;
    return other?.name ?? "گفت‌وگوی خصوصی";
  }
  const e = entityInfo(db, conv.entity_type, conv.entity_id);
  return e.title ?? "گفت‌وگو";
}

export function entityCard(db: DatabaseSync, session: Session, conv: ChatConversationRow): ChatEntityCard | null {
  if (!conv.entity_type || conv.entity_id == null) return null;
  const db2 = db;
  if (conv.entity_type === "repair") {
    const t = db2
      .prepare(
        `SELECT t.id, t.number, t.updated_at, t.technician_id, t.branch_id, t.device_id,
                s.name status_name, s.color status_color, u.name tech_name, b.name branch_name,
                d.brand, d.model, d.type
         FROM repair_tickets t
         LEFT JOIN repair_statuses s ON s.id = t.status_id
         LEFT JOIN users u ON u.id = t.technician_id
         LEFT JOIN branches b ON b.id = t.branch_id
         LEFT JOIN devices d ON d.id = t.device_id
         WHERE t.id = ?`
      )
      .get(conv.entity_id) as any;
    if (!t) {
      return {
        entity_type: "repair",
        entity_id: conv.entity_id,
        title: "پذیرش حذف شده",
        subtitle: "این پذیرش دیگر در سامانه وجود ندارد.",
        href: null,
        missing: true,
      };
    }
    const canView = canAccessTicket(db2, session, Number(t.id));
    return {
      entity_type: "repair",
      entity_id: Number(t.id),
      title: `پذیرش ${t.number}`,
      subtitle: `${t.brand ?? ""} ${t.model ?? ""}`.trim() || "دستگاه",
      status: t.status_name ?? null,
      status_color: t.status_color ?? null,
      tech_name: t.tech_name ?? null,
      branch_name: t.branch_name ?? null,
      updated_at: t.updated_at ?? null,
      href: canView ? `/repairs/${t.id}` : null,
    };
  }
  return {
    entity_type: conv.entity_type,
    entity_id: conv.entity_id,
    title: conv.entity_type,
    subtitle: "",
    href: null,
  };
}

// ---- فهرست مکالمه‌ها ----

export function listConversations(
  db: DatabaseSync,
  session: Session,
  opts: { filter: string; q: string; withPresence: boolean }
): ChatConversationListItem[] {
  const me = session.user.id;
  const access = internalChatAccess(me);
  const rows = db
    .prepare(
      `SELECT c.*, m.pinned, m.archived, m.muted_until, m.last_read_message_id, m.joined_at, m.joined_msg_id,
              m.role AS member_role,
              (SELECT COUNT(*) FROM chat_members cm WHERE cm.conversation_id = c.id AND cm.left_at IS NULL AND ${internalChatPredicate("cm.user_id")}) member_count
       FROM chat_conversations c
       JOIN chat_members m ON m.conversation_id = c.id AND m.user_id = ? AND m.left_at IS NULL
       WHERE ${access.sql}
       ORDER BY c.last_message_at DESC NULLS LAST, c.id DESC
       LIMIT 200`
    )
    .all(me, ...access.params) as any[];

  const items: ChatConversationListItem[] = [];
  const unreadStmt = db.prepare(
    `SELECT COUNT(*) c FROM chat_messages m
     WHERE m.conversation_id = ? AND m.id > ? AND m.sender_id IS NOT ? AND m.deleted_at IS NULL AND m.kind = 'text'
       AND (? = 1 OR m.id > ? OR (? = 0 AND m.created_at >= ?))`
  );
  const mentionStmt = db.prepare(
    `SELECT COUNT(*) c FROM chat_messages m
     JOIN chat_mentions mm ON mm.message_id = m.id AND mm.user_id = ?
     WHERE m.conversation_id = ? AND m.id > ? AND m.deleted_at IS NULL AND m.kind = 'text'`
  );
  const lastStmt = db.prepare(
    `SELECT m.id, m.body, m.kind, m.sender_id, m.created_at, m.deleted_at, u.name sender_name,
            (SELECT COUNT(*) FROM chat_attachments a WHERE a.message_id = m.id) att_count
     FROM chat_messages m LEFT JOIN users u ON u.id = m.sender_id
     WHERE m.conversation_id = ? ORDER BY m.id DESC LIMIT 1`
  );

  const dmOtherIds: number[] = [];
  const prepared: Array<{ row: any; conv: ChatConversationRow; member: ChatMemberRow; last: any; unread: number; mentions: number; otherId: number | null }> = [];

  for (const row of rows) {
    const conv = row as ChatConversationRow;
    const member: ChatMemberRow = {
      conversation_id: Number(row.id),
      user_id: me,
      role: String(row.member_role ?? "member"),
      joined_at: String(row.joined_at ?? ""),
      left_at: null,
      last_read_message_id: Number(row.last_read_message_id ?? 0),
      joined_msg_id: Number(row.joined_msg_id ?? 0),
      pinned: Number(row.pinned ?? 0),
      archived: Number(row.archived ?? 0),
      muted_until: row.muted_until ?? null,
    };
    const unread = Number(
      (unreadStmt.get(
        conv.id,
        member.last_read_message_id,
        me,
        Number(conv.history_for_new_members) === 1 || conv.type === "direct" ? 1 : 0,
        member.joined_msg_id,
        member.joined_msg_id,
        member.joined_at
      ) as any).c ?? 0
    );
    const mentions = Number((mentionStmt.get(me, conv.id, member.last_read_message_id) as any).c ?? 0);
    const last = lastStmt.get(conv.id) as any;
    let otherId: number | null = null;
    if (conv.type === "direct") {
      const o = db
        .prepare("SELECT user_id FROM chat_members WHERE conversation_id = ? AND user_id != ? LIMIT 1")
        .get(conv.id, me) as any;
      otherId = o?.user_id == null ? null : Number(o.user_id);
      if (otherId != null) dmOtherIds.push(otherId);
    }
    prepared.push({ row, conv, member, last, unread, mentions, otherId });
  }

  const others = usersBrief(db, dmOtherIds, opts.withPresence);

  for (const p of prepared) {
    const { conv, member, last, unread, mentions, otherId } = p;
    const muted = member.muted_until != null && member.muted_until > new Date().toISOString().slice(0, 19).replace("T", " ");
    const item: ChatConversationListItem = {
      id: conv.id,
      type: conv.type,
      title: conversationTitle(db, conv, me),
      description: conv.description ?? null,
      avatar_color: conv.avatar_color ?? null,
      entity_type: conv.entity_type ?? null,
      entity_id: conv.entity_id ?? null,
      entity_title: entityInfo(db, conv.entity_type, conv.entity_id).title,
      branch_id: conv.branch_id ?? null,
      last_message_at: conv.last_message_at ?? null,
      last_message:
        last && !last.deleted_at
          ? {
              sender_name: last.sender_name ?? null,
              body: chatPreview(last.body, last.kind, Number(last.att_count ?? 0)),
              kind: String(last.kind ?? "text"),
              created_at: String(last.created_at ?? ""),
              mine: Number(last.sender_id) === me,
            }
          : null,
      unread_count: unread,
      mention_count: mentions,
      pinned: !!member.pinned,
      archived: !!member.archived,
      muted,
      member_count: Number(p.row.member_count ?? 0),
      dm_user: otherId != null ? others.get(otherId) ?? null : null,
      last_read_message_id: member.last_read_message_id,
    };
    items.push(item);
  }

  const q = normalizeFa(opts.q.trim());
  let filtered = items;
  switch (opts.filter) {
    case "unread":
      filtered = items.filter((i) => i.unread_count > 0 && !i.archived);
      break;
    case "direct":
    case "group":
    case "channel":
      filtered = items.filter((i) => i.type === opts.filter && !i.archived);
      break;
    case "pinned":
      filtered = items.filter((i) => i.pinned);
      break;
    case "archived":
      filtered = items.filter((i) => i.archived);
      break;
    case "entity":
      filtered = items.filter((i) => i.entity_type != null && !i.archived);
      break;
    case "mentions":
      filtered = items.filter((i) => i.mention_count > 0);
      break;
    default:
      filtered = items.filter((i) => !i.archived);
  }
  if (q) {
    filtered = filtered.filter((i) => {
      const hay = normalizeFa(`${i.title} ${i.dm_user?.name ?? ""} ${i.entity_title ?? ""} ${i.description ?? ""}`);
      return hay.includes(q);
    });
  }
  // سنجاق‌شده‌ها بالای فهرست؛ ترتیب طبیعی برای بقیه حفظ می‌شود
  return filtered.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const at = a.last_message_at ?? "";
    const bt = b.last_message_at ?? "";
    if (at !== bt) return at < bt ? 1 : -1;
    return b.id - a.id;
  });
}

export function conversationDetails(db: DatabaseSync, session: Session, convId: number): ChatConversationDetails {
  const { conv, member } = requireConversation(db, convId, session.user.id);
  const me = session.user.id;
  const withPresence = presenceVisible(session);
  const list = listConversations(db, session, { filter: "all", q: "", withPresence });
  const base = list.find((i) => i.id === convId);
  const members = getMemberList(db, convId, withPresence);
  const pinnedRows = db
    .prepare("SELECT m.*, u.name sender_name, u.avatar_color sender_color FROM chat_messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.conversation_id = ? AND m.pinned = 1 AND m.deleted_at IS NULL ORDER BY m.id DESC LIMIT 30")
    .all(convId) as any[];
  const pinBoundary = Number(member.joined_msg_id ?? 0);
  const fullHistory = Number(conv.history_for_new_members) === 1 || conv.type === "direct";
  const visiblePinned = pinnedRows.filter(
    (r) => fullHistory || r.kind === "system" || Number(r.id) > pinBoundary || (pinBoundary === 0 && String(r.created_at) >= member.joined_at)
  );
  return {
    conversation: {
      ...(base ?? {
        id: conv.id,
        type: conv.type,
        title: conversationTitle(db, conv, me),
        description: conv.description,
        avatar_color: conv.avatar_color,
        entity_type: conv.entity_type,
        entity_id: conv.entity_id,
        entity_title: entityInfo(db, conv.entity_type, conv.entity_id).title,
        branch_id: conv.branch_id,
        last_message_at: conv.last_message_at,
        last_message: null,
        unread_count: 0,
        mention_count: 0,
        pinned: !!member.pinned,
        archived: !!member.archived,
        muted: false,
        member_count: members.length,
        dm_user: null,
        last_read_message_id: member.last_read_message_id,
      }),
      history_for_new_members: Number(conv.history_for_new_members) === 1,
      created_by: conv.created_by == null ? null : Number(conv.created_by),
    },
    members,
    my_role: member.role,
    entity_card: entityCard(db, session, conv),
    pinned_messages: serializeMessages(db, visiblePinned, me),
    files: (
      db
        .prepare(
          `SELECT a.id, a.filename, a.mime, a.size, a.created_at, u.name sender_name
           FROM chat_attachments a
           JOIN chat_messages m ON m.id = a.message_id AND m.deleted_at IS NULL
           LEFT JOIN users u ON u.id = m.sender_id
           WHERE m.conversation_id = ? AND ${visibilitySql(conv,member).sql}
           ORDER BY a.id DESC LIMIT 40`
        )
        .all(convId,...visibilitySql(conv,member).params) as any[]
    ).map((f) => ({
      id: Number(f.id),
      filename: String(f.filename),
      mime: String(f.mime),
      size: Number(f.size),
      created_at: String(f.created_at ?? ""),
      sender_name: f.sender_name ?? null,
    })),
    can_post: canPostIn(conv, member, session,db),
    can_manage: canManageConversation(session,member,conv),
  };
}

// ---- ساخت مکالمه ----

export function ensureDirectConversation(db: DatabaseSync, session: Session, otherUserId: number): number {
  return atomic(db, () => {
  requireCurrentChatEmployee(db,session);
  requirePerm(session,"chat.dm");
  const me = session.user.id;
  if (otherUserId === me) throw new HttpError(400, "گفت‌وگو با خودتان ممکن نیست.");
  const other = db.prepare("SELECT id, name, role, branch_id, is_active FROM users WHERE id = ?").get(otherUserId) as any;
  if (!other || !Number(other.is_active)) throw new HttpError(404, "کاربر موردنظر یافت نشد.");
  const companyPeer=["owner","admin"].includes(other.role);
  if(!companyPeer && !db.prepare("SELECT 1 FROM branches WHERE id=? AND is_active=1").get(other.branch_id))throw new HttpError(404,"کاربر در شعبهٔ فعال شاغل نیست.");
  if (!userInScope(session, other)) throw new HttpError(403, "امکان شروع گفت‌وگو با کاربر شعبهٔ دیگر برای شما وجود ندارد.");
  const branch=null;
  const dmKey=`d:${branch??"company"}:${Math.min(me,otherUserId)}:${Math.max(me,otherUserId)}`;
  const existing = (db.prepare("SELECT id FROM chat_conversations WHERE dm_key = ?").get(dmKey)
    ??db.prepare("SELECT c.id FROM chat_conversations c WHERE c.type='direct' AND c.entity_type IS NULL AND c.is_active=1 AND EXISTS(SELECT 1 FROM chat_members WHERE conversation_id=c.id AND user_id=?) AND EXISTS(SELECT 1 FROM chat_members WHERE conversation_id=c.id AND user_id=?) AND (SELECT COUNT(*) FROM chat_members WHERE conversation_id=c.id)=2 ORDER BY c.id LIMIT 1").get(me,otherUserId)) as {id:number}|undefined;
  if (existing) {
    const id = Number(existing.id);
    const access = internalChatAccess(me);
    if (!db.prepare(`SELECT c.id FROM chat_conversations c WHERE c.id=? AND ${access.sql}`).get(id, ...access.params)) throw new HttpError(403, "این گفت‌وگو در محدودهٔ فعلی شما نیست.");
    const maxId = maxMessageId(db, id);
    const mem = db.prepare("SELECT left_at FROM chat_members WHERE conversation_id = ? AND user_id = ?").get(id, me) as any;
    if (mem?.left_at)
      db.prepare("UPDATE chat_members SET left_at = NULL, joined_at = datetime('now'), joined_msg_id = ? WHERE conversation_id = ? AND user_id = ?").run(
        maxId,
        id,
        me
      );
    const mem2 = db.prepare("SELECT left_at FROM chat_members WHERE conversation_id = ? AND user_id = ?").get(id, otherUserId) as any;
    if (mem2?.left_at)
      db.prepare("UPDATE chat_members SET left_at = NULL, joined_at = datetime('now'), joined_msg_id = ? WHERE conversation_id = ? AND user_id = ?").run(
        maxId,
        id,
        otherUserId
      );
    return id;
  }
  const res = db
    .prepare("INSERT INTO chat_conversations(type, dm_key, created_by, branch_id, last_message_at) VALUES('direct',?,?,?,datetime('now'))")
    .run(dmKey, me, branch);
  const convId = Number(res.lastInsertRowid);
  db.prepare("INSERT INTO chat_members(conversation_id, user_id, role, last_read_message_id) VALUES(?,?,'member',0)").run(convId, me);
  db.prepare("INSERT INTO chat_members(conversation_id, user_id, role, last_read_message_id) VALUES(?,?,'member',0)").run(convId, otherUserId);
  pushEvent(db, convId, "conversation_created", { type: "direct" }, me);
  auditRecord(db,session,"create","chat_conversation",convId,null,{type:"direct"},branch);
  return convId;
  });
}

export function createGroupConversation(
  db: DatabaseSync,
  session: Session,
  input: { type: "group" | "channel"; title: string; description?: string; memberIds: number[]; avatar_color?: string }
): number {
  return atomic(db, () => {
  requireCurrentChatEmployee(db,session);
  requirePerm(session,input.type==='channel'?'chat.channel.create':'chat.group.create');
  const me = session.user.id;
  const title = String(input.title ?? "").trim();
  if (!title) throw new HttpError(400, input.type === "channel" ? "نام کانال الزامی است." : "نام گروه الزامی است.");
  if (title.length > 80) throw new HttpError(400, "نام گروه حداکثر ۸۰ نویسه است.");
  const ids = [...new Set((input.memberIds ?? []).map(Number).filter((n) => Number.isFinite(n) && n !== me))];
  if (input.type === "group" && ids.length === 0) throw new HttpError(400, "حداقل یک عضو دیگر برای گروه انتخاب کنید.");
  if (ids.length > 100) throw new HttpError(400, "تعداد اعضا زیاد است (حداکثر ۱۰۰ عضو).");
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    const users = db.prepare(`SELECT id, role, branch_id, is_active FROM users WHERE id IN (${placeholders})`).all(...ids) as any[];
    if (users.length !== ids.length) throw new HttpError(400, "یکی از کاربران انتخاب‌شده معتبر نیست.");
    for (const u of users) {
      if (!Number(u.is_active)) throw new HttpError(400, "یکی از کاربران انتخاب‌شده غیرفعال است.");
      if (!userInScope(session, { id: Number(u.id), role: u.role, branch_id: u.branch_id == null ? null : Number(u.branch_id) })) {
        throw new HttpError(403, "افزودن کاربر شعبهٔ دیگر برای شما مجاز نیست.");
      }
    }
  }
  const res = db
    .prepare("INSERT INTO chat_conversations(type, title, description, avatar_color, created_by, branch_id, last_message_at) VALUES(?,?,?,?,?,?,datetime('now'))")
    .run(input.type, title, (input.description ?? "").trim() || null, input.avatar_color ?? null, me, null);
  const convId = Number(res.lastInsertRowid);
  db.prepare("INSERT INTO chat_members(conversation_id, user_id, role, last_read_message_id) VALUES(?,?,'owner',0)").run(convId, me);
  for (const uid of ids) {
    db.prepare("INSERT INTO chat_members(conversation_id, user_id, role, last_read_message_id) VALUES(?,?,'member',0)").run(convId, uid);
  }
  addSystemMessage(db, convId, `${input.type === "channel" ? "کانال" : "گروه"} «${title}» ایجاد شد.`, me);
  pushEvent(db, convId, "conversation_created", { type: input.type, title }, me);
  auditRecord(db,session,"create","chat_conversation",convId,null,{type:input.type,title},["owner","admin"].includes(session.user.role)?null:session.user.branch_id);
  return convId;
  });
}

/** مکالمهٔ مرتبط با پذیرش — ورود خودکار برای کاربران مجاز به دیدن همان پذیرش */
export function ensureEntityConversation(db: DatabaseSync, session: Session, entityType: string, entityId: number): { id: number; created: boolean };
export function ensureEntityConversation():never {
  throw new HttpError(410, "چت در این نسخه فقط برای گفت‌وگوی داخلی مستقل کارکنان فعال است.");
}

export type PostMessageInput = {
  body: string;
  client_key?: string | null;
  reply_to_id?: number | null;
  attachment_ids?: number[];
  mentions?: number[];
  system?: boolean;
};

export function postMessage(
  db: DatabaseSync,
  session: Session,
  conv: ChatConversationRow,
  member: ChatMemberRow,
  input: PostMessageInput
): { message: ChatMessage; duplicate: boolean } {
  return atomic(db, () => {
  const current = requireConversation(db, conv.id, session.user.id);
  conv = current.conv;
  member = current.member;
  requireCurrentChatEmployee(db,session);
  requirePerm(session,"chat.view");
  const me = session.user.id;
  const body = String(input.body ?? "").slice(0, 4000);
  const clientKey = input.client_key ? String(input.client_key).slice(0, 64) : null;

  if (!input.system) {
    if (!canPostIn(conv, member, session,db)) throw new HttpError(403, conv.type==='direct'?"شعبهٔ همکار تغییر کرده است؛ گفت‌وگوی جدیدی با او آغاز کنید.":"شما اجازهٔ ارسال پیام در این کانال را ندارید.");
    rateLimit(`msg:${me}`, 30, 30_000);
  }

  if (clientKey) {
    const dup = db.prepare("SELECT * FROM chat_messages WHERE conversation_id = ? AND client_key = ?").get(conv.id, clientKey) as any;
    if (dup) {
      if(Number(dup.sender_id)!==me)throw new HttpError(409,"شناسهٔ ارسال قبلاً برای پیام دیگری استفاده شده است؛ دوباره ارسال کنید.");
      const [msg] = serializeMessages(db, [{ ...dup, sender_name: session.user.name, sender_color: session.user.avatar_color }], me);
      return { message: msg, duplicate: true };
    }
  }

  const attachmentIds = [...new Set((input.attachment_ids ?? []).map(Number).filter(Number.isFinite))].slice(0, 6);
  if (!body.trim() && attachmentIds.length === 0) throw new HttpError(400, "متن پیام خالی است.");
  if (attachmentIds.length) {
    const rows = db
      .prepare(
        `SELECT id FROM chat_attachments WHERE id IN (${ph(attachmentIds.length)}) AND uploaded_by = ? AND message_id IS NULL`
      )
      .all(...attachmentIds, me) as any[];
    if (rows.length !== attachmentIds.length) throw new HttpError(400, "پیوست معتبر نیست — دوباره آپلود کنید.");
  }
  if (input.reply_to_id != null) {
    const reference=requireVisibleChatMessage(db,me,input.reply_to_id);
    if(reference.conv.id!==conv.id)throw new HttpError(400,"پیام مرجع در این مکالمه پیدا نشد.");
    const r = db.prepare("SELECT id FROM chat_messages WHERE id = ? AND conversation_id = ?").get(input.reply_to_id, conv.id) as any;
    if (!r) throw new HttpError(400, "پیام مرجع در این مکالمه پیدا نشد.");
  }

  const mentionIds = [...new Set((input.mentions ?? []).map(Number).filter(Number.isFinite))];
  let validMentions: number[] = [];
  if (mentionIds.length && !input.system) {
    const members = db
      .prepare(`SELECT user_id FROM chat_members WHERE conversation_id = ? AND left_at IS NULL AND user_id IN (${ph(mentionIds.length)})`)
      .all(conv.id, ...mentionIds) as any[];
    validMentions = members.map((r) => Number(r.user_id)).filter((id) => id !== me);
  }

  const senderId = input.system ? null : me;
  const kind = input.system ? "system" : "text";
  const created = db
    .prepare(
      `INSERT INTO chat_messages(conversation_id, sender_id, kind, body, search_text, reply_to_id, client_key)
       VALUES(?,?,?,?,?,?,?)`
    )
    .run(conv.id, senderId, kind, body, normalizeFa(body), input.reply_to_id ?? null, clientKey);
  const messageId = Number(created.lastInsertRowid);

  if (attachmentIds.length) {
    db.prepare(
      `UPDATE chat_attachments SET message_id = ? WHERE id IN (${ph(attachmentIds.length)}) AND uploaded_by = ? AND message_id IS NULL`
    ).run(messageId, ...attachmentIds, me);
  }
  for (const uid of validMentions) {
    db.prepare("INSERT OR IGNORE INTO chat_mentions(message_id, user_id) VALUES(?,?)").run(messageId, uid);
  }
  db.prepare("UPDATE chat_conversations SET last_message_at = datetime('now') WHERE id = ?").run(conv.id);
  pushEvent(db, conv.id, "message_new", { message_id: messageId }, me);

  // اعلان‌ها: خصوصی → همه؛ گروه → فقط منشن؛ کانال → همه اعضا
  if (!input.system) {
    const members = db
      .prepare(`SELECT m.user_id,m.muted_until FROM chat_members m JOIN chat_conversations c ON c.id=m.conversation_id
        WHERE m.conversation_id=? AND m.left_at IS NULL AND m.user_id!=? AND ${internalChatPredicate("m.user_id")}`)
      .all(conv.id, me) as any[];
    const title = conversationTitle(db, conv, me);
    const preview = chatPreview(body, kind, attachmentIds.length);
    for (const m of members) {
      const uid = Number(m.user_id);
      const muted = m.muted_until != null && String(m.muted_until) > new Date().toISOString().slice(0, 19).replace("T", " ");
      const mentioned = validMentions.includes(uid);
      if (conv.type === "group" && !mentioned) continue;
      if (muted && !mentioned) continue;
      const notifTitle =
        conv.type === "direct" ? `پیام جدید از ${session.user.name}` : mentioned ? `منشن در «${title}»` : `پیام جدید در «${title}»`;
      notifyChat(db, uid, {
        title: notifTitle,
        body: preview,
        link: `/chat?c=${conv.id}`,
        priority: mentioned ? "high" : "normal",
        branchId:conv.branch_id,
        messageId,
      });
    }
  }

  const full = db
    .prepare(
      `SELECT m.*, u.name sender_name, u.avatar_color sender_color FROM chat_messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.id = ?`
    )
    .get(messageId) as any;
  const [msg] = serializeMessages(db, [full], me);
  auditRecord(db,session,"create","chat_message",messageId,null,{conversation_id:conv.id},conv.branch_id);
  return { message: msg, duplicate: false };
  });
}

export function addSystemMessage(db: DatabaseSync, convId: number, body: string, actorId: number | null) {
  const res = db
    .prepare("INSERT INTO chat_messages(conversation_id, sender_id, kind, body, search_text) VALUES(?, NULL, 'system', ?, ?)")
    .run(convId, body, normalizeFa(body));
  db.prepare("UPDATE chat_conversations SET last_message_at = datetime('now') WHERE id = ?").run(convId);
  pushEvent(db, convId, "message_new", { message_id: Number(res.lastInsertRowid) }, actorId);
}

/** دریافت پیام‌های یک محدوده از مکالمه (قبل/بعد/حول یک پیام) */
export function fetchMessages(
  db: DatabaseSync,
  session: Session,
  convId: number,
  opts: { beforeId?: number | null; afterId?: number | null; aroundId?: number | null; limit?: number }
): { messages: ChatMessage[]; has_more: boolean; members: ChatMemberInfo[] } {
  const me = session.user.id;
  const { conv, member } = requireConversation(db, convId, me);
  const withPresence = presenceVisible(session);
  const limit = Math.min(80, Math.max(10, opts.limit ?? 40));
  const vis = visibilitySql(conv, member, "m");
  const where: string[] = ["m.conversation_id = ?", vis.sql];
  const params: any[] = [convId, ...vis.params];

  let order = "DESC";
  if (opts.afterId != null) {
    where.push("m.id > ?");
    params.push(opts.afterId);
    order = "ASC";
  } else if (opts.beforeId != null) {
    where.push("m.id < ?");
    params.push(opts.beforeId);
  } else if (opts.aroundId != null) {
    where.push("m.id <= ?");
    params.push(opts.aroundId);
  }

  const rows = db
    .prepare(
      `SELECT m.*, u.name sender_name, u.avatar_color sender_color
       FROM chat_messages m LEFT JOIN users u ON u.id = m.sender_id
       WHERE ${where.join(" AND ")} ORDER BY m.id ${order} LIMIT ${limit + 1}`
    )
    .all(...params) as any[];

  let slice = rows.slice(0, limit);
  const has_more = rows.length > limit;
  if (order === "DESC") slice = slice.reverse();
  const messages = serializeMessages(db, slice, me);
  return { messages, has_more, members: getMemberList(db, convId, withPresence) };
}

// ---- وضعیت خوانده‌شدن ----

export function markRead(db: DatabaseSync, session: Session, convId: number, lastMessageId?: number | null): number {
  const { member } = requireConversation(db, convId, session.user.id);
  const maxRow = db.prepare("SELECT COALESCE(MAX(id),0) m FROM chat_messages WHERE conversation_id = ?").get(convId) as any;
  const target = Math.max(member.last_read_message_id, Math.min(lastMessageId ?? Number(maxRow.m ?? 0), Number(maxRow.m ?? 0)));
  if (target > member.last_read_message_id) {
    db.prepare("UPDATE chat_members SET last_read_message_id = ? WHERE conversation_id = ? AND user_id = ?").run(
      target,
      convId,
      session.user.id
    );
    pushEvent(db, convId, "read", { user_id: session.user.id, last_read_message_id: target }, session.user.id);
    db.prepare("UPDATE notifications SET read = 1 WHERE user_id = ? AND link = ? AND (chat_message_id IS NULL OR chat_message_id<=?)").run(session.user.id, `/chat?c=${convId}`,target);
  }
  return target;
}

// ---- خلاصه برای نشان ناخوانده ----

export function chatSummary(db: DatabaseSync, userId: number): { unread_total: number; conversations: Array<{ id: number; unread: number; mentions: number }> } {
  const access = internalChatAccess(userId);
  const rows = db
    .prepare(
      `SELECT c.id, c.type, c.history_for_new_members, m.last_read_message_id, m.joined_at, m.joined_msg_id
       FROM chat_members m JOIN chat_conversations c ON c.id = m.conversation_id
       WHERE m.user_id = ? AND m.left_at IS NULL AND ${access.sql}`
    )
    .all(userId, ...access.params) as any[];
  const unreadStmt = db.prepare(
    `SELECT COUNT(*) c FROM chat_messages m
     WHERE m.conversation_id = ? AND m.id > ? AND m.sender_id IS NOT ? AND m.deleted_at IS NULL AND m.kind = 'text'
       AND (? = 1 OR m.id > ? OR (? = 0 AND m.created_at >= ?))`
  );
  const mentionStmt = db.prepare(
    `SELECT COUNT(*) c FROM chat_messages m JOIN chat_mentions mm ON mm.message_id = m.id AND mm.user_id = ?
     WHERE m.conversation_id = ? AND m.id > ? AND m.deleted_at IS NULL AND m.kind = 'text'`
  );
  let total = 0;
  const conversations: Array<{ id: number; unread: number; mentions: number }> = [];
  for (const r of rows) {
    const full = r.type === "direct" || Number(r.history_for_new_members) === 1 ? 1 : 0;
    const boundary = Number(r.joined_msg_id ?? 0);
    const unread = Number(
      (unreadStmt.get(Number(r.id), Number(r.last_read_message_id ?? 0), userId, full, boundary, boundary, String(r.joined_at)) as any).c ?? 0
    );
    const mentions = Number((mentionStmt.get(userId, Number(r.id), Number(r.last_read_message_id ?? 0)) as any).c ?? 0);
    if (unread > 0) total += unread;
    conversations.push({ id: Number(r.id), unread, mentions });
  }
  return { unread_total: total, conversations };
}

// ---- رویدادها (همگام‌سازی بلادرنگ سبک با polling) ----

let lastCleanup = 0;
function cleanupEphemeral(db: DatabaseSync) {
  const now = Date.now();
  if (now - lastCleanup < 10 * 60_000) return;
  lastCleanup = now;
  try {
    db.prepare("DELETE FROM chat_typing WHERE updated_at < datetime('now','-1 minute')").run();
    db.prepare("DELETE FROM chat_events WHERE created_at < datetime('now','-2 day')").run();
    db.prepare("DELETE FROM chat_attachments WHERE message_id IS NULL AND created_at < datetime('now','-1 day')").run();
  } catch {}
}

export function fetchEvents(
  db: DatabaseSync,
  session: Session,
  cursor: number,
  activeConvId: number | null,
  bootstrap=false
): { cursor: number; events: any[]; typing: any[]; presence: any[]; unread_total: number } {
  const me = session.user.id;
  const access = internalChatAccess(me);
  if (activeConvId != null) requireConversation(db, activeConvId, me);
  touchPresence(me);
  cleanupEphemeral(db);
  if(bootstrap)cursor=Number(db.prepare(`SELECT COALESCE(MAX(e.id),0) id FROM chat_events e JOIN chat_members m ON m.conversation_id=e.conversation_id AND m.user_id=? AND m.left_at IS NULL JOIN chat_conversations c ON c.id=e.conversation_id WHERE ${access.sql}`).get(me,...access.params)!.id);
  if (activeConvId != null) {
    try {
      db.prepare("DELETE FROM chat_typing WHERE conversation_id = ? AND user_id = ?").run(activeConvId, me);
    } catch {}
  }
  const events = (
    db
      .prepare(
        `SELECT e.id, e.conversation_id, e.type, e.payload, e.actor_id
         FROM chat_events e
         JOIN chat_members m ON m.conversation_id = e.conversation_id AND m.user_id = ? AND m.left_at IS NULL
         JOIN chat_conversations c ON c.id=e.conversation_id
         WHERE e.id > ? AND ${access.sql} ORDER BY e.id ASC LIMIT 300`
      )
      .all(me, cursor, ...access.params) as any[]
  ).map((e) => ({ ...e, payload: safeParse(e.payload) }));
  const newCursor = events.length ? Number(events[events.length - 1].id) : cursor;

  const typing = db
    .prepare(
      `SELECT t.conversation_id, t.user_id, u.name
       FROM chat_typing t
       JOIN users u ON u.id = t.user_id
       JOIN chat_members m ON m.conversation_id = t.conversation_id AND m.user_id = ? AND m.left_at IS NULL
       JOIN chat_conversations c ON c.id=t.conversation_id
       WHERE t.user_id != ? AND t.updated_at > datetime('now','-8 seconds') AND ${access.sql} AND ${internalChatPredicate("t.user_id")}`
    )
    .all(me, me, ...access.params) as any[];

  let presence: any[] = [];
  if (presenceVisible(session)) {
    presence = db
      .prepare(
        `SELECT p.user_id,
                CASE WHEN p.last_seen_at > datetime('now','-70 seconds') THEN 1 ELSE 0 END AS online,
                p.last_seen_at
         FROM chat_presence p
         WHERE p.user_id != ? AND p.user_id IN (
           SELECT DISTINCT m2.user_id FROM chat_members m1
           JOIN chat_members m2 ON m2.conversation_id = m1.conversation_id AND m2.left_at IS NULL
           JOIN chat_conversations c ON c.id=m1.conversation_id
           WHERE m1.user_id = ? AND m1.left_at IS NULL AND ${access.sql} AND ${internalChatPredicate("m2.user_id")}
         )`
      )
      .all(me, me, ...access.params) as any[];
  }
  const unread = chatSummary(db, me);
  return {
    cursor: newCursor,
    events,
    typing: typing.map((t) => ({ conversation_id: Number(t.conversation_id), user_id: Number(t.user_id), name: String(t.name) })),
    presence: presence.map((p) => ({
      user_id: Number(p.user_id),
      online: !!Number(p.online),
      last_seen_at: p.last_seen_at ?? null,
    })),
    unread_total: unread.unread_total,
  };
}

function safeParse(s: any): any {
  try {
    return JSON.parse(String(s ?? "{}"));
  } catch {
    return {};
  }
}

export function setTyping(db: DatabaseSync, userId: number, convId: number, typing: boolean) {
  if (typing) {
    db.prepare(
      "INSERT INTO chat_typing(conversation_id, user_id, updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(conversation_id, user_id) DO UPDATE SET updated_at = datetime('now')"
    ).run(convId, userId);
  } else {
    db.prepare("DELETE FROM chat_typing WHERE conversation_id = ? AND user_id = ?").run(convId, userId);
  }
}

// ---- جست‌وجو ----

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
}

export function searchChat(
  db: DatabaseSync,
  session: Session,
  opts: { q: string; conversationId?: number | null; fromUserId?: number | null; hasFile?: boolean; hasMention?: boolean; limit?: number }
): { results: any[]; has_more: boolean } {
  const me = session.user.id;
  const nq = normalizeFa(String(opts.q ?? "").trim());
  if (nq.length < 2) throw new HttpError(400, "عبارت جست‌وجو حداقل ۲ نویسه باشد.");
  if (opts.conversationId != null) requireConversation(db, opts.conversationId, me);

  const where: string[] = [
    internalChatAccess(me).sql,
    "m.deleted_at IS NULL",
    "m.kind = 'text'",
    "m.search_text LIKE ? ESCAPE '\\'",
    "(c.type = 'direct' OR c.history_for_new_members = 1 OR m.id > mem.joined_msg_id OR (mem.joined_msg_id = 0 AND m.created_at >= mem.joined_at))",
  ];
  const params: any[] = [...internalChatAccess(me).params, likePattern(nq)];
  if (opts.conversationId != null) {
    where.push("m.conversation_id = ?");
    params.push(opts.conversationId);
  }
  if (opts.fromUserId != null) {
    where.push("m.sender_id = ?");
    params.push(opts.fromUserId);
  }
  if (opts.hasFile) where.push("EXISTS(SELECT 1 FROM chat_attachments a WHERE a.message_id = m.id)");
  if (opts.hasMention) where.push(`EXISTS(SELECT 1 FROM chat_mentions mm WHERE mm.message_id = m.id AND mm.user_id = ${me})`);

  const limit = Math.min(50, Math.max(5, opts.limit ?? 25));
  const rows = db
    .prepare(
      `SELECT m.id, m.conversation_id, m.body, m.created_at, m.sender_id, m.search_text,
              u.name sender_name, c.type conv_type, c.title conv_title, c.dm_key,
              (SELECT COUNT(*) FROM chat_attachments a WHERE a.message_id = m.id) att_count,
              EXISTS(SELECT 1 FROM chat_mentions mm WHERE mm.message_id = m.id AND mm.user_id = ?) mention_me
       FROM chat_messages m
       JOIN chat_members mem ON mem.conversation_id = m.conversation_id AND mem.user_id = ? AND mem.left_at IS NULL
       JOIN chat_conversations c ON c.id = m.conversation_id
       LEFT JOIN users u ON u.id = m.sender_id
       WHERE ${where.join(" AND ")}
       ORDER BY m.id DESC LIMIT ${limit + 1}`
    )
    .all(me, me, ...params) as any[];

  const has_more = rows.length > limit;
  const slice = rows.slice(0, limit);
  const convIds = [...new Set(slice.map((r) => Number(r.conversation_id)))];
  const convMap = new Map<number, { id: number; title: string; type: string }>();
  for (const cid of convIds) {
    const c = db.prepare("SELECT * FROM chat_conversations WHERE id = ?").get(cid) as any;
    if (c) convMap.set(cid, { id: cid, title: conversationTitle(db, c as ChatConversationRow, me), type: c.type });
  }
  const results = slice.map((r) => {
    const body = String(r.body ?? "");
    const { text: normBody, map } = normalizeFaWithMap(body);
    const npos = normBody.indexOf(nq);
    const origPos = npos >= 0 ? map[npos] ?? 0 : 0;
    const start = Math.max(0, origPos - 45);
    const snippet = body.slice(start, start + 140);
    return {
      id: Number(r.id),
      conversation_id: Number(r.conversation_id),
      conversation_title: convMap.get(Number(r.conversation_id))?.title ?? "گفت‌وگو",
      conversation_type: convMap.get(Number(r.conversation_id))?.type ?? "group",
      sender_name: r.sender_name ?? null,
      snippet,
      highlight_start: npos >= 0 ? origPos - start : 0,
      highlight_len: npos >= 0 ? Math.max(1, Math.min(body.length - (origPos - start), nq.length)) : 0,
      created_at: String(r.created_at ?? ""),
      has_attachment: Number(r.att_count ?? 0) > 0,
      mentions_me: !!Number(r.mention_me),
    };
  });
  return { results, has_more };
}

// ---- مدیریت اعضا/تنظیمات مکالمه (اکشن‌های POST) ----

export function updateConversation(
  db: DatabaseSync,
  session: Session,
  convId: number,
  input: { title?: string; description?: string; avatar_color?: string; history_for_new_members?: boolean }
): void {
  const { conv, member } = requireConversation(db, convId, session.user.id);
  if (!canManageConversation(session, member,conv)) throw new HttpError(403, "فقط مدیران گروه می‌توانند مشخصات را تغییر دهند.");
  if (conv.type === "direct") throw new HttpError(400, "مکالمهٔ خصوصی مشخصات قابل ویرایش ندارد.");
  const title = input.title == null ? conv.title : String(input.title).trim().slice(0, 80);
  if (input.title != null && !title) throw new HttpError(400, "نام نمی‌تواند خالی باشد.");
  const description = input.description == null ? conv.description : String(input.description).trim().slice(0, 500) || null;
  const color = input.avatar_color == null ? conv.avatar_color : String(input.avatar_color).slice(0, 20) || null;
  const history = input.history_for_new_members == null ? Number(conv.history_for_new_members) : input.history_for_new_members ? 1 : 0;
  db.prepare("UPDATE chat_conversations SET title = ?, description = ?, avatar_color = ?, history_for_new_members = ? WHERE id = ?").run(
    title,
    description,
    color,
    history,
    convId
  );
  pushEvent(db, convId, "conversation_update", { title, description, avatar_color: color }, session.user.id);
  if (input.title != null && title !== conv.title) addSystemMessage(db, convId, `${session.user.name} نام را به «${title}» تغییر داد.`, session.user.id);
}

export function addMember(db: DatabaseSync, session: Session, convId: number, userId: number): void {
  const { conv, member } = requireConversation(db, convId, session.user.id);
  if (conv.type === "direct") throw new HttpError(400, "به مکالمهٔ خصوصی نمی‌توان عضو اضافه کرد.");
  if (!canManageConversation(session, member,conv)) throw new HttpError(403, "افزودن عضو نیازمند دسترسی مدیر گروه است.");
  const u = db.prepare("SELECT id, name, role, branch_id, is_active FROM users WHERE id = ?").get(userId) as any;
  if (!u || !Number(u.is_active)) throw new HttpError(404, "کاربر یافت نشد.");
  if (!userInScope(session, { id: Number(u.id), role: u.role, branch_id: u.branch_id == null ? null : Number(u.branch_id) })) {
    throw new HttpError(403, "افزودن کاربر شعبهٔ دیگر برای شما مجاز نیست.");
  }
  const existing = db.prepare("SELECT left_at FROM chat_members WHERE conversation_id = ? AND user_id = ?").get(convId, userId) as any;
  if (existing && !existing.left_at) throw new HttpError(400, "این کاربر از قبل عضو گروه است.");
  if (existing) {
    db.prepare("UPDATE chat_members SET left_at = NULL, joined_at = datetime('now'), joined_msg_id = ? WHERE conversation_id = ? AND user_id = ?").run(
      maxMessageId(db, convId),
      convId,
      userId
    );
  } else {
    const maxId = maxMessageId(db, convId);
    db.prepare("INSERT INTO chat_members(conversation_id, user_id, role, last_read_message_id, joined_msg_id) VALUES(?,?,'member',?,?)").run(
      convId,
      userId,
      maxId,
      maxId
    );
  }
  addSystemMessage(db, convId, `${session.user.name}، ${u.name} را به گروه افزود.`, session.user.id);
  pushEvent(db, convId, "member_update", { action: "add", user_id: userId }, session.user.id);
}

export function removeMember(db: DatabaseSync, session: Session, convId: number, userId: number): void {
  const { conv, member } = requireConversation(db, convId, session.user.id);
  if (conv.type === "direct") throw new HttpError(400, "مکالمهٔ خصوصی عضو قابل حذف ندارد.");
  const isSelf = userId === session.user.id;
  if (!isSelf && !canManageConversation(session, member,conv)) throw new HttpError(403, "حذف عضو نیازمند دسترسی مدیر گروه است.");
  const target = db.prepare("SELECT role, user_id FROM chat_members WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL").get(convId, userId) as any;
  if (!target) throw new HttpError(404, "این کاربر عضو گروه نیست.");
  if (target.role === "owner" && !isSelf && member.role !== "owner") throw new HttpError(403, "حذف مالک گروه فقط توسط خودش ممکن است.");
  db.prepare("UPDATE chat_members SET left_at = datetime('now') WHERE conversation_id = ? AND user_id = ?").run(convId, userId);
  const u = db.prepare("SELECT name FROM users WHERE id = ?").get(userId) as any;
  addSystemMessage(db, convId, isSelf ? `${u?.name ?? "کاربر"} گروه را ترک کرد.` : `${session.user.name}، ${u?.name ?? "کاربر"} را از گروه حذف کرد.`, session.user.id);
  // اگر مالک رفته، قدیمی‌ترین عضو به مالکی می‌رسد تا گروه بی‌مدیر نماند
  if (target.role === "owner") {
    const next = db
      .prepare("SELECT user_id FROM chat_members WHERE conversation_id = ? AND left_at IS NULL ORDER BY joined_at, user_id LIMIT 1")
      .get(convId) as any;
    if (next) db.prepare("UPDATE chat_members SET role = 'owner' WHERE conversation_id = ? AND user_id = ?").run(convId, Number(next.user_id));
  }
  pushEvent(db, convId, "member_update", { action: isSelf ? "leave" : "remove", user_id: userId }, session.user.id);
}

export function setMemberRole(db: DatabaseSync, session: Session, convId: number, userId: number, role: "admin" | "member"): void {
  const { conv, member } = requireConversation(db, convId, session.user.id);
  if (conv.type === "direct") throw new HttpError(400, "مکالمهٔ خصوصی نقش‌دهی ندارد.");
  if (!canManageConversation(session, member,conv)) throw new HttpError(403, "تغییر نقش نیازمند دسترسی مدیر گروه است.");
  const target = db.prepare("SELECT role FROM chat_members WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL").get(convId, userId) as any;
  if (!target) throw new HttpError(404, "این کاربر عضو گروه نیست.");
  if (target.role === "owner") throw new HttpError(400, "نقش مالک گروه قابل تغییر نیست.");
  if (role === "admin" && member.role !== "owner" && !["owner", "admin"].includes(session.user.role)) {
    throw new HttpError(403, "ارتقا به مدیر گروه فقط توسط مالک گروه یا مدیر سیستم ممکن است.");
  }
  db.prepare("UPDATE chat_members SET role = ? WHERE conversation_id = ? AND user_id = ?").run(role, convId, userId);
  const u = db.prepare("SELECT name FROM users WHERE id = ?").get(userId) as any;
  addSystemMessage(db, convId, role === "admin" ? `${u?.name ?? "کاربر"} به مدیر گروه ارتقا یافت.` : `${u?.name ?? "کاربر"} به عضو عادی تغییر یافت.`, session.user.id);
  pushEvent(db, convId, "member_update", { action: "role", user_id: userId, role }, session.user.id);
}

export function setConversationPref(
  db: DatabaseSync,
  session: Session,
  convId: number,
  action: "pin" | "unpin" | "archive" | "unarchive" | "mute" | "unmute",
  minutes?: number | null
): void {
  requireConversation(db, convId, session.user.id);
  const me = session.user.id;
  if (action === "pin") db.prepare("UPDATE chat_members SET pinned = 1 WHERE conversation_id = ? AND user_id = ?").run(convId, me);
  else if (action === "unpin") db.prepare("UPDATE chat_members SET pinned = 0 WHERE conversation_id = ? AND user_id = ?").run(convId, me);
  else if (action === "archive") {
    db.prepare("UPDATE chat_members SET archived = 1, pinned = 0 WHERE conversation_id = ? AND user_id = ?").run(convId, me);
    pushEvent(db, convId, "conversation_update", { archived: true, by: me }, me);
  } else if (action === "unarchive") db.prepare("UPDATE chat_members SET archived = 0 WHERE conversation_id = ? AND user_id = ?").run(convId, me);
  else if (action === "mute") {
    const until =
      minutes == null || minutes <= 0
        ? null
        : new Date(Date.now() + minutes * 60_000).toISOString().slice(0, 19).replace("T", " ");
    db.prepare("UPDATE chat_members SET muted_until = ? WHERE conversation_id = ? AND user_id = ?").run(until, convId, me);
  } else if (action === "unmute") db.prepare("UPDATE chat_members SET muted_until = NULL WHERE conversation_id = ? AND user_id = ?").run(convId, me);
}
