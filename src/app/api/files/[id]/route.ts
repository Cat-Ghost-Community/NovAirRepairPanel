import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail } from "@/lib/api";
import { requireRepairAccess } from "@/lib/repair-access";
import { matchesContentType } from "@/lib/upload-content";
import {attachmentBody} from '@/lib/attachment-storage';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = requireSession(req);
    requirePerm(session, "repairs.view");
    const { id } = await params;
    const row = getDb().prepare("SELECT ticket_id, filename, mime, data,size,object_key,object_sha256 FROM repair_attachments WHERE id = ?").get(Number(id)) as any;
    if (!row) return new Response("یافت نشد", { status: 404 });
    requireRepairAccess(session, Number(row.ticket_id), req.cookies.get("repaid_branch")?.value);
    const stored=await attachmentBody(row,req.signal);
    return new Response(stored.body, {
      headers: {
        "Content-Type": row.mime ?? "application/octet-stream",
        "Content-Disposition": `${(row.mime?.startsWith("image/") || row.mime?.startsWith("video/")) && matchesContentType(stored.prefix, row.mime) ? "inline" : "attachment"}; filename="${encodeURIComponent(row.filename)}"`,
        "Content-Length":String(stored.bytes),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return fail(e);
  }
}
