import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresChatHttp} from '@/lib/db/pg-chat-http';
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok , assertRequestSession } from "@/lib/api";
import { assertUploadAllowed, chatConfig, rateLimit, touchPresence } from "@/lib/chat";
import {storeAttachmentObject} from '@/lib/attachment-storage';import {atomic} from '@/lib/db/transaction';import {audit} from '@/lib/api';

export const dynamic = "force-dynamic";

/** آپلود پیوست چت — اعتبارسنجی پسوند/نوع/حجم سمت سرور */
export async function POST(req: NextRequest) {
  if(postgresIntegration())return postgresChatHttp(req,'upload');
  try {
    const session = requireSession(req);
    requirePerm(session, "chat.files");
    rateLimit(`upload:${session.user.id}`, 20, 60_000);
    touchPresence(session.user.id);
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return Response.json({ error: "فایلی ارسال نشده است." }, { status: 400 });
    assertUploadAllowed(file.name, file.type, file.size);
    const buf = Buffer.from(await file.arrayBuffer());
    assertRequestSession(req);
    const object=await storeAttachmentObject(buf);assertRequestSession(req);
    const db = getDb();
    const id=atomic(db,()=>{const result=db
      .prepare("INSERT INTO chat_attachments(message_id, uploaded_by, filename, mime, size, data,object_key,object_sha256) VALUES(NULL, ?, ?, ?, ?, ?,?,?)")
      .run(session.user.id, file.name.slice(0, 180), file.type || "application/octet-stream", file.size, object?Buffer.alloc(0):buf,object?.object_key??null,object?.object_sha256??null);
      audit(session,'upload','chat_attachment',Number(result.lastInsertRowid),null,{size:file.size,mime:file.type});return Number(result.lastInsertRowid);});
    // پاکسازی آپلودهای بدون پیام قدیمی‌تر از یک روز (فایل‌هایی که ارسال نشدند)
    try {
      db.prepare("DELETE FROM chat_attachments WHERE message_id IS NULL AND uploaded_by = ? AND created_at < datetime('now','-1 day')").run(session.user.id);
    } catch {}
    const cfg = chatConfig();
    return ok({
      id,
      filename: file.name,
      mime: file.type || "application/octet-stream",
      size: file.size,
      max_file_mb: cfg.maxFileMb,
    });
  } catch (e) {
    return fail(e);
  }
}
