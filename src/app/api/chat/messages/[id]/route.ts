import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresChatHttp} from '@/lib/db/pg-chat-http';
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok, readJson, audit } from "@/lib/api";
import { HttpError } from "@/lib/api";
import { canForUser } from "@/lib/auth";
import { canManageConversation, pushEvent, requireConversation, serializeMessages, getMemberList, presenceVisible } from "@/lib/chat";
import { REACTION_SET, normalizeFa } from "@/lib/chat-shared";
import { getSetting } from "@/lib/repair";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** اکشن‌های یک پیام: ویرایش، حذف، واکنش، سنجاق */
export async function POST(req: NextRequest, { params }: Ctx) {
  if(postgresIntegration())return postgresChatHttp(req,'message',Number((await params).id));
  try {
    const session = requireSession(req);
    requirePerm(session, "chat.view");
    const { id } = await params;
    const messageId = Number(id);
    if (!Number.isFinite(messageId)) throw new HttpError(400, "شناسهٔ پیام نامعتبر است.");
    const b = await readJson(req);
    const db = getDb();
    const me = session.user.id;

    const msg = db.prepare("SELECT * FROM chat_messages WHERE id = ?").get(messageId) as any;
    if (!msg) throw new HttpError(404, "پیام یافت نشد.");
    const { conv, member } = requireConversation(db, Number(msg.conversation_id), me);

    const action = String(b.action ?? "");
    const isAuthor = Number(msg.sender_id) === me;
    const moderationScope=["owner","admin"].includes(session.user.role) || (conv.branch_id!=null && conv.branch_id===session.user.branch_id);
    const canModerate = (moderationScope && canForUser(session.user.role, "chat.moderate", me)) || canManageConversation(session, member,conv);

    if (action === "edit") {
      if (msg.kind !== "text") throw new HttpError(400, "فقط پیام متنی قابل ویرایش است.");
      if (msg.deleted_at) throw new HttpError(400, "پیام حذف‌شده قابل ویرایش نیست.");
      if (!isAuthor) throw new HttpError(403, "فقط نویسندهٔ پیام می‌تواند آن را ویرایش کند.");
      const windowMin = Number(getSetting("chat.edit_window_min", "15")) || 0;
      if (windowMin > 0) {
        const created = new Date(String(msg.created_at).replace(" ", "T") + "Z");
        if (Date.now() - created.getTime() > windowMin * 60_000) {
          throw new HttpError(400, `مهلت ویرایش (${windowMin} دقیقه) گذشته است.`);
        }
      }
      const body = String(b.body ?? "").slice(0, 4000);
      if (!body.trim()) throw new HttpError(400, "متن پیام خالی است.");
      db.prepare("UPDATE chat_messages SET body = ?, search_text = ?, edited_at = datetime('now') WHERE id = ?").run(
        body,
        normalizeFa(body),
        messageId
      );
      pushEvent(db, conv.id, "message_edit", { message_id: messageId }, me);
      return ok({ ok: true });
    }

    if (action === "delete") {
      if (!isAuthor && !canModerate) throw new HttpError(403, "حذف پیام دیگران نیازمند دسترسی مدیریت پیام است.");
      if (msg.deleted_at) return ok({ ok: true });
      db.prepare("UPDATE chat_messages SET deleted_at = datetime('now'), body = '', search_text = '', pinned = 0 WHERE id = ?").run(messageId);
      db.prepare("DELETE FROM chat_attachments WHERE message_id = ?").run(messageId);
      db.prepare("DELETE FROM chat_reactions WHERE message_id = ?").run(messageId);
      pushEvent(db, conv.id, "message_delete", { message_id: messageId }, me);
      if (!isAuthor) audit(session, "delete", "chat_message", messageId, { conversation_id: conv.id }, null);
      return ok({ ok: true });
    }

    if (action === "react") {
      const emoji = String(b.emoji ?? "");
      if (!(REACTION_SET as readonly string[]).includes(emoji)) throw new HttpError(400, "واکنش نامعتبر است.");
      if (msg.deleted_at) throw new HttpError(400, "به پیام حذف‌شده واکنش نمی‌توان داد.");
      const existing = db.prepare("SELECT 1 FROM chat_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?").get(messageId, me, emoji) as any;
      if (existing) db.prepare("DELETE FROM chat_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?").run(messageId, me, emoji);
      else db.prepare("INSERT INTO chat_reactions(message_id, user_id, emoji) VALUES(?,?,?)").run(messageId, me, emoji);
      pushEvent(db, conv.id, "reaction", { message_id: messageId }, me);
      return ok({ ok: true, removed: !!existing });
    }

    if (action === "pin" || action === "unpin") {
      if (!canForUser(session.user.role, "chat.pin", me) && !canManageConversation(session, member,conv)) {
        throw new HttpError(403, "سنجاق پیام نیازمند دسترسی سنجاق است.");
      }
      if (msg.deleted_at) throw new HttpError(400, "پیام حذف‌شده قابل سنجاق نیست.");
      db.prepare("UPDATE chat_messages SET pinned = ? WHERE id = ?").run(action === "pin" ? 1 : 0, messageId);
      pushEvent(db, conv.id, "message_pin", { message_id: messageId, pinned: action === "pin" }, me);
      return ok({ ok: true });
    }

    throw new HttpError(400, "عملیات نامعتبر است.");
  } catch (e) {
    return fail(e);
  }
}

/** یک پیام کامل (برای پرش از جست‌وجو و نمایش متنوع) */
export async function GET(req: NextRequest, { params }: Ctx) {
  if(postgresIntegration())return postgresChatHttp(req,'message',Number((await params).id));
  try {
    const session = requireSession(req);
    requirePerm(session, "chat.view");
    const { id } = await params;
    const db = getDb();
    const row = db
      .prepare(
        `SELECT m.*, u.name sender_name, u.avatar_color sender_color
         FROM chat_messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.id = ?`
      )
      .get(Number(id)) as any;
    if (!row) throw new HttpError(404, "پیام یافت نشد.");
    requireConversation(db, Number(row.conversation_id), session.user.id);
    const [message] = serializeMessages(db, [row], session.user.id);
    const members = getMemberList(db, Number(row.conversation_id), presenceVisible(session));
    return ok({ message, members });
  } catch (e) {
    return fail(e);
  }
}
