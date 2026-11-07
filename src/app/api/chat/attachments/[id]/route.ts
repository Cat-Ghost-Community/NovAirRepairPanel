import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresChatHttp} from '@/lib/db/pg-chat-http';
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail } from "@/lib/api";
import { HttpError } from "@/lib/api";
import { isImageMime } from "@/lib/chat-shared";
import { requireVisibleChatMessage } from "@/lib/chat";
import {attachmentBody} from '@/lib/attachment-storage';import {matchesContentType} from '@/lib/upload-content';

export const dynamic = "force-dynamic";

/** دریافت امن پیوست — فقط اعضای مکالمه (یا آپلودکننده برای فایل هنوز ارسال‌نشده) */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if(postgresIntegration())return postgresChatHttp(req,'attachment',Number((await params).id));
  try {
    const session = requireSession(req);
    requirePerm(session, "chat.view");
    const { id } = await params;
    const db = getDb();
    const att = db.prepare("SELECT * FROM chat_attachments WHERE id = ?").get(Number(id)) as any;
    if (!att) throw new HttpError(404, "فایل یافت نشد.");
    if (att.message_id == null) {
      if (Number(att.uploaded_by) !== session.user.id) throw new HttpError(403, "دسترسی به این فایل مجاز نیست.");
    } else {
      requireVisibleChatMessage(db,session.user.id,Number(att.message_id));
    }
    const stored=await attachmentBody(att,req.signal);
    const mime = String(att.mime || "application/octet-stream");
    const inline = (isImageMime(mime) || mime === "application/pdf")&&matchesContentType(stored.prefix,mime);
    const safeName = String(att.filename ?? "file").replace(/[\r\n"\\]/g, "_");
    return new Response(stored.body, {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(stored.bytes),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(safeName)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return fail(e);
  }
}
