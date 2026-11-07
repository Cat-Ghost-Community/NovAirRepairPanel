import { requireRepairAccess } from "@/lib/repair-access";
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, fail, ok, audit, requirePerm , assertRequestSession } from "@/lib/api";
import { matchesContentType } from "@/lib/upload-content";
import { atomic } from "@/lib/db/transaction";
import {storeAttachmentObject} from '@/lib/attachment-storage';

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm", "application/pdf"];
const MAX_SIZE = 10 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = requireSession(req);
    requirePerm(session, "repairs.edit");
    const { id } = await params;
    requireRepairAccess(session, Number(id), req.cookies.get("repaid_branch")?.value);
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return Response.json({ error: "فایلی ارسال نشده است." }, { status: 400 });
    if (!ALLOWED_MIME.includes(file.type)) {
      return Response.json({ error: "این نوع فایل مجاز نیست — عکس، ویدیو MP4/WebM یا PDF استفاده کنید." }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return Response.json({ error: "حجم فایل زیاد است (حداکثر ۱۰ مگابایت)." }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    assertRequestSession(req);
    requireRepairAccess(session,Number(id),req.cookies.get("repaid_branch")?.value);
    if (!matchesContentType(buf, file.type)) return Response.json({ error: "محتوای فایل با نوع اعلام‌شده مطابقت ندارد." }, { status: 400 });
    const object=await storeAttachmentObject(buf);assertRequestSession(req);requireRepairAccess(session,Number(id),req.cookies.get('repaid_branch')?.value);
    const db = getDb();
    return atomic(db, () => {
    db.prepare(
      "INSERT INTO repair_attachments(ticket_id, filename, mime, size, phase, data, uploaded_by,object_key,object_sha256) VALUES(?,?,?,?,?,?,?,?,?)"
    ).run(Number(id), file.name.slice(0,200), file.type, file.size, String(form.get("phase") ?? "document"), object?Buffer.alloc(0):buf, session.user.id,object?.object_key??null,object?.object_sha256??null);
    audit(session, "upload", "repair_attachment", Number(id), null, { filename: file.name, phase: form.get("phase") });
    return ok({ ok: true });
    });
  } catch (e) {
    return fail(e);
  }
}
