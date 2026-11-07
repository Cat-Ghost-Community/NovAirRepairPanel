import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresChatHttp} from '@/lib/db/pg-chat-http';
import { NextRequest } from "next/server";
import {atomic} from "@/lib/db/transaction";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok, readJson, audit } from "@/lib/api";
import { HttpError } from "@/lib/api";
import {
  addMember,
  conversationDetails,
  markRead,
  removeMember,
  requireConversation,
  setConversationPref,
  setMemberRole,
  setTyping,
  touchPresence,
  updateConversation,
} from "@/lib/chat";

export const dynamic = "force-dynamic";

/** جزئیات مکالمه: اعضا، کارت موجودیت، پیام‌های سنجاق‌شده */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if(postgresIntegration())return postgresChatHttp(req,'conversation',Number((await params).id));
  try {
    const session = requireSession(req);
    requirePerm(session, "chat.view");
    const { id } = await params;
    touchPresence(session.user.id);
    const data = conversationDetails(getDb(), session, Number(id));
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}

/** اکشن‌های مکالمه: خواندن، تایپ، سنجاق، بی‌صدا، آرشیو، اعضا، ویرایش مشخصات */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if(postgresIntegration())return postgresChatHttp(req,'conversation',Number((await params).id));
  try {
    const session = requireSession(req);
    requirePerm(session, "chat.view");
    const { id } = await params;
    const convId = Number(id);
    if (!Number.isFinite(convId)) throw new HttpError(400, "شناسهٔ مکالمه نامعتبر است.");
    const b = await readJson(req);
    const db = getDb();
    return atomic(db,()=>{

    switch (String(b.action ?? "")) {
      case "read": {
        const target = markRead(db, session, convId, b.last_message_id == null ? null : Number(b.last_message_id));
        return ok({ last_read_message_id: target });
      }
      case "typing": {
        requireConversation(db, convId, session.user.id);
        setTyping(db, session.user.id, convId, !!b.typing);
        return ok({ ok: true });
      }
      case "pin":
      case "unpin":
      case "archive":
      case "unarchive": {
        setConversationPref(db, session, convId, b.action);
        return ok({ ok: true });
      }
      case "mute":
      case "unmute": {
        setConversationPref(db, session, convId, b.action, b.minutes == null ? null : Number(b.minutes));
        return ok({ ok: true });
      }
      case "leave": {
        removeMember(db, session, convId, session.user.id);
        return ok({ ok: true });
      }
      case "add_member": {
        addMember(db, session, convId, Number(b.user_id));
        audit(session, "update", "chat_conversation", convId, null, { added: Number(b.user_id) });
        return ok({ ok: true });
      }
      case "remove_member": {
        removeMember(db, session, convId, Number(b.user_id));
        audit(session, "update", "chat_conversation", convId, null, { removed: Number(b.user_id) });
        return ok({ ok: true });
      }
      case "set_role": {
        const role = b.role === "admin" ? "admin" : "member";
        setMemberRole(db, session, convId, Number(b.user_id), role);
        return ok({ ok: true });
      }
      case "update": {
        updateConversation(db, session, convId, {
          title: b.title == null ? undefined : String(b.title),
          description: b.description == null ? undefined : String(b.description),
          avatar_color: b.avatar_color == null ? undefined : String(b.avatar_color),
          history_for_new_members: b.history_for_new_members == null ? undefined : !!b.history_for_new_members,
        });
        const {conv}=requireConversation(db,convId,session.user.id);
        audit(session,"update","chat_conversation",convId,null,{title:conv.title,description:conv.description},conv.branch_id);
        return ok({ ok: true });
      }
      default:
        throw new HttpError(400, "عملیات نامعتبر است.");
    }
    });
  } catch (e) {
    return fail(e);
  }
}
