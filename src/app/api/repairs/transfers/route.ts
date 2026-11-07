import { activeBranch, BRANCH_COOKIE } from "@/lib/branch";
import { assertBranchResource } from "@/lib/branch-access";
import { atomic } from "@/lib/db/transaction";
import { requireRepairAccess } from "@/lib/repair-access";
import {repairWorkflow} from '@/lib/repair-workflow';
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok, readJson, audit } from "@/lib/api";
import { notifyUser } from "@/lib/repair";

export const dynamic = "force-dynamic";

/* انتقال دستگاه بین تعمیرکاران با تایید دریافت */

export async function GET(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session,"repairs.view");
    const db = getDb();
    const branch=activeBranch(session,req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    // انتقال‌های در انتظار تایید من + تاریخچه انتقال‌های من
    const pending = db
      .prepare(
        `SELECT h.id, h.ticket_id, h.to_status, h.created_at, t.number, u.name from_name, d.brand, d.model
         FROM repair_status_history h
         JOIN repair_tickets t ON t.id = h.ticket_id
         LEFT JOIN users u ON u.id = h.user_id
         LEFT JOIN devices d ON d.id = t.device_id
         WHERE (h.note='PENDING_TRANSFER' OR substr(h.note,1,17)='PENDING_TRANSFER|') AND h.to_status = ? AND (? IS NULL OR t.branch_id=?) ORDER BY h.id DESC LIMIT 200`
      )
      .all(session.user.id,branch,branch) as any[];
    const history = db
      .prepare(
        `SELECT h.id, h.ticket_id, h.created_at, t.number, u.name from_name, u2.name to_name, h.note
         FROM repair_status_history h
         JOIN repair_tickets t ON t.id = h.ticket_id
         LEFT JOIN users u ON u.id = h.user_id
         LEFT JOIN users u2 ON u2.id = h.to_status
         WHERE h.note LIKE 'TRANSFER%' AND (? IS NULL OR t.branch_id=?) ORDER BY h.created_at DESC LIMIT 50`
      )
      .all(branch,branch) as any[];
    return ok({ pending, history });
  } catch (e) {
    return fail(e);
  }
}

/** ارسال دستگاه برای تعمیرکار دیگر */
export async function POST(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "repairs.edit");
    const b = await readJson(req);
    const db = getDb();
    return atomic(db,()=>{
    const ticketId = Number(b.ticket_id);
    requireRepairAccess(session,ticketId,req.cookies.get(BRANCH_COOKIE)?.value);
    const toUserId = Number(b.to_user_id);
    const ticket = db.prepare("SELECT * FROM repair_tickets WHERE id = ?").get(ticketId) as any;
    if(ticket&&repairWorkflow(db,Number(ticket.branch_id)).mode!=='legacy')return Response.json({error:'در این مسیر، تغییر تعمیرکار فقط از کارتابل ارجاع مدیر یا سرپرست انجام می‌شود.'},{status:409});
    if (!ticket) return Response.json({ error: "پذیرش یافت نشد." }, { status: 404 });
    const target = db.prepare("SELECT id, name,branch_id FROM users WHERE id = ? AND is_active = 1 AND role='technician' AND branch_id=?").get(toUserId,ticket.branch_id) as any;
    if (!target) return Response.json({ error: "کاربر مقصد یافت نشد." }, { status: 400 });
    if (toUserId === session.user.id) return Response.json({ error: "ارسال به خودتان مجاز نیست." }, { status: 400 });

    // رکورد انتقال در انتظار تایید (to_status = آی‌دی کاربر مقصد، note علامت پندینگ)
    db.prepare("INSERT INTO repair_status_history(ticket_id, from_status, to_status, user_id, note) VALUES(?,?,?,?,?)")
      .run(ticketId, ticket.status_id, toUserId, session.user.id, `PENDING_TRANSFER|${b.note ?? ""}`);
    notifyUser(toUserId, "دستگاه برای شما ارسال شد", `${session.user.name} پذیرش ${ticket.number} را به شما ارسال کرد.`, `/repairs/${ticketId}`);
    audit(session, "transfer", "repair_ticket", ticketId, null, { to: toUserId, note: b.note ?? null });
    return ok({ done: true });
    });
  } catch (e) {
    return fail(e);
  }
}

/** تایید یا رد دریافت توسط تعمیرکار مقصد */
export async function PATCH(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "repairs.edit");
    const b = await readJson(req);
    const db = getDb();
    return atomic(db,()=>{
    const row = db.prepare("SELECT * FROM repair_status_history WHERE id = ?").get(Number(b.id)) as any;
    if (!row || !(row.note === "PENDING_TRANSFER" || String(row.note).startsWith("PENDING_TRANSFER|")) || row.to_status !== session.user.id) {
      return Response.json({ error: "انتقال یافت نشد یا به شما مربوط نیست." }, { status: 404 });
    }
    const ticketId = row.ticket_id;
    const ticket=assertBranchResource(db,session,req.cookies.get(BRANCH_COOKIE)?.value,"ticket",ticketId);
    if(repairWorkflow(db,Number(ticket.branch_id)).mode!=='legacy')return Response.json({error:'این درخواست انتقال قدیمی، مجوز تغییر تعمیرکار نیست؛ از مدیر بخواهید ارجاع را ثبت کند.'},{status:409});
    if (b.approve) {
      db.prepare("UPDATE repair_status_history SET note = ? WHERE id = ?").run(`TRANSFER_APPROVED|${row.note.split("|")[1] ?? ""}`, row.id);
      db.prepare("UPDATE repair_tickets SET technician_id = ? WHERE id = ?").run(session.user.id, ticketId);
      notifyUser(row.user_id, "دریافت تایید شد", `پذیرش #${ticketId} توسط ${session.user.name} دریافت و تایید شد.`, `/repairs/${ticketId}`);
    } else {
      db.prepare("UPDATE repair_status_history SET note = ? WHERE id = ?").run(`TRANSFER_REJECTED|${b.reason ?? "بدون دلیل"}`, row.id);
      // هشدار به مدیران
      const managers = db.prepare("SELECT id FROM users WHERE is_active = 1 AND (role IN ('owner','admin') OR (role='manager' AND branch_id=?))").all(ticket.branch_id) as any[];
      for (const m of managers) {
        notifyUser(m.id, "⚠ رد دریافت دستگاه", `${session.user.name} دریافت پذیرش #${ticketId} را رد کرد: ${b.reason ?? "—"}`, `/repairs/${ticketId}`);
      }
    }
    audit(session, "transfer_reply", "repair_ticket", ticketId, null, { approve: !!b.approve, reason: b.reason ?? null });
    return ok({ done: true });
    });
  } catch (e) {
    return fail(e);
  }
}
