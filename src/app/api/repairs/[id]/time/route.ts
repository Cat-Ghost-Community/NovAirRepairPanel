import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresRepairWorkHttp} from '@/lib/db/pg-repair-work-http';
import {atomicRepairMutation} from '@/lib/api';
import {repairWorkflow,enforceRepairWorkflow} from '@/lib/repair-workflow';
import {startRepair} from '@/lib/repair-assign';
import { requireRepairAccess } from "@/lib/repair-access";
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok, readJson, audit,HttpError } from "@/lib/api";

export const dynamic = "force-dynamic";

/** ثبت زمان کار روی پذیرش — شروع/توقف/ادامه/پایان + ثبت دستی */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if(postgresIntegration())return postgresRepairWorkHttp(req,Number((await params).id),'time');
  try {
    const session = requireSession(req);
    requirePerm(session, "repairs.notes");
    const { id } = await params;
    requireRepairAccess(session, Number(id), req.cookies.get("repaid_branch")?.value);
    const ticketId = Number(id);
    const b = await readJson(req);
    const db = getDb();
    return atomicRepairMutation(db,req,session,Number(id),()=>{
    const policy=repairWorkflow(db,Number(enforceRepairWorkflow(session,ticketId,true,db).branch_id));
    const assignment=db.prepare('SELECT technician_id,technician2_id FROM repair_tickets WHERE id=?').get(ticketId)!;
    if(policy.mode!=='legacy'&&assignment.technician_id!==session.user.id&&assignment.technician2_id!==session.user.id)throw new HttpError(403,'ثبت زمان کار فقط برای تعمیرکار ارجاع‌شده مجاز است.');
    if(b.previous_entry_id!==undefined){const latest=Number(db.prepare('SELECT COALESCE(MAX(id),0) id FROM time_entries WHERE ticket_id=? AND user_id=?').get(ticketId,session.user.id)?.id??0);if(latest!==b.previous_entry_id)throw new HttpError(409,'زمان‌سنج تغییر کرده است؛ اطلاعات را دوباره بارگذاری کنید.');}
    if(!['stop','finish'].includes(b.action)&&db.prepare("SELECT t.id FROM repair_tickets t JOIN repair_statuses s ON s.id=t.status_id WHERE t.id=? AND s.name='Cancelled'").get(ticketId))throw new HttpError(409,'ثبت کار تازه برای پذیرش لغوشده به بازبینی کنترل‌شده نیاز دارد.');
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");

    const open = db.prepare(
      "SELECT * FROM time_entries WHERE ticket_id = ? AND user_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1"
    ).get(ticketId, session.user.id) as any;

    if (b.action === "start") {
      if(policy.mode!=='legacy'){const result=startRepair(session,ticketId,req.cookies.get('repaid_branch')?.value);return ok({...result,running:true});}
      if (open) return fail(new Error("زمان‌سنج این پذیرش برای شما باز است"));
      const id2 = db.prepare("INSERT INTO time_entries(ticket_id, user_id, started_at) VALUES(?,?,?)")
        .run(ticketId, session.user.id, now).lastInsertRowid as number;
      audit(session, "create", "time_entry", id2, null, { ticketId, action: "start" });
      return ok({ id: id2, running: true });
    }

    if (b.action === "stop" || b.action === "finish") {
      if (!open) return fail(new Error("زمان‌سنجی باز وجود ندارد"));
      const started = new Date(open.started_at.replace(" ", "T") + "Z").getTime();
      const mins = Math.max(1, Math.round((Date.now() - started) / 60000));
      db.prepare("UPDATE time_entries SET ended_at = ?, minutes_active = ? WHERE id = ?")
        .run(now, mins, open.id);
      audit(session, "edit", "time_entry", open.id, null, { minutes: mins });
      return ok({ done: true, minutes: mins });
    }

    // ثبت دستی
    if (b.action === "manual") {
      const mins = Number(b.minutes);
      if (!Number.isSafeInteger(mins)||mins<=0) throw new HttpError(400,"دقیقهٔ کار باید عدد صحیح مثبت باشد.");
      const id2 = db.prepare(
        "INSERT INTO time_entries(ticket_id, user_id, started_at, ended_at, minutes_active, is_manual, note) VALUES(?,?,?,?,?,1,?)"
      ).run(ticketId, session.user.id, now, now, mins, b.note ?? null).lastInsertRowid as number;
      audit(session, "create", "time_entry", id2, null, { manual: mins });
      return ok({ id: id2, minutes: mins });
    }

    return fail(new Error("عملیات نامعتبر"));
    });
  } catch (e) {
    return fail(e);
  }
}

/** خلاصه زمان‌های یک پذیرش */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if(postgresIntegration())return postgresRepairWorkHttp(req,Number((await params).id),'time');
  try {
    const session = requireSession(req);
    requirePerm(session, "repairs.view");
    const { id } = await params;
    requireRepairAccess(session, Number(id), req.cookies.get("repaid_branch")?.value);
    const db = getDb();
    const entries = db.prepare(
      `SELECT te.*, u.name user_name FROM time_entries te JOIN users u ON u.id = te.user_id
       WHERE te.ticket_id = ? ORDER BY te.id DESC LIMIT 50`
    ).all(Number(id)) as any[];
    const total=Number(db.prepare('SELECT COALESCE(SUM(minutes_active),0) total FROM time_entries WHERE ticket_id=?').get(Number(id))?.total??0);
    const running = entries.find((e) => e.user_id===session.user.id&&!e.ended_at) ?? null;
    const lastEntryId=Number(db.prepare('SELECT COALESCE(MAX(id),0) id FROM time_entries WHERE ticket_id=? AND user_id=?').get(Number(id),session.user.id)?.id??0);
    return ok({ entries, totalMinutes: total, running,lastEntryId });
  } catch (e) {
    return fail(e);
  }
}
