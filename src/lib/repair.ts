import {DEFAULT_STATUSES} from './repair-status-definitions';
import { getDb } from "@/lib/db/schema";
import { computeTechnicianCommission } from "@/lib/payroll";
import { encryptCredential, decryptCredential } from "./secrets";
import { atomic } from "./db/transaction";
import { statusFa } from "./status-fa";
import { cancellationPosition } from './repair-cancellation';
import { captureFinancialDocument } from './accounting-events';
import { requirePerm,HttpError,auditRecord } from './api';
import type {Session} from './auth';
import {requireRepairAccess} from './repair-access';
import {repairWorkflow,enforceRepairWorkflow} from './repair-workflow';

export { STATUS_FA, statusFa } from "@/lib/status-fa";


export type StatusDef = {
  id: number;
  name: string;
  category: string;
  color: string;
  allowed_next: string[];
  is_open: number;
  sla_hours: number | null;
  notify_customer: number;
  customer_visible: number;
  technician_visible: number;
};

export {DEFAULT_STATUSES} from './repair-status-definitions';

export function ensureDefaultStatuses() {
  const db = getDb();
  const count = (db.prepare("SELECT COUNT(*) c FROM repair_statuses").get() as any).c;
  if (count > 0) return;
  for (const s of DEFAULT_STATUSES) {
    db.prepare(
      `INSERT INTO repair_statuses(name, category, color, description, allowed_next, is_open, sort, sla_hours, notify_customer, customer_visible, technician_visible, is_system)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,1)`
    ).run(
      s.name, s.category, s.color, s.desc, JSON.stringify(s.next),
      s.category === "waiting" || s.category === "open" || s.category === "active" ? 1 : 0,
      0, s.sla, s.notify ? 1 : 0, 1, 1
    );
  }
  db.exec(`UPDATE repair_statuses SET sort = id`);
}

export function getStatuses(): StatusDef[] {
  const rows = getDb().prepare("SELECT * FROM repair_statuses ORDER BY sort, id").all() as any[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    color: r.color,
    allowed_next: JSON.parse(r.allowed_next || "[]"),
    is_open: r.is_open,
    sla_hours: r.sla_hours,
    notify_customer: r.notify_customer,
    customer_visible: r.customer_visible,
    technician_visible: r.technician_visible,
  }));
}

export function getStatusByName(name: string): StatusDef | undefined {
  return getStatuses().find((s) => s.name.toLowerCase() === name.toLowerCase());
}

export class StatusError extends Error {}

export function transitionTicket(
  ticketId: number,
  toStatusName: string,
  userId: number,
  note?: string,
  opts?: { bypassValidation?: boolean }
): { ok: true } {
  const db = getDb();
  return atomic<{ ok: true }>(db, () => {
  const ticket = db.prepare("SELECT * FROM repair_tickets WHERE id = ?").get(ticketId) as any;
  if (!ticket) throw new StatusError("Repair ticket not found.");
  if(repairWorkflow(db,Number(ticket.branch_id)).mode!=='legacy'){
    const user=db.prepare('SELECT id,name,email,role,branch_id,avatar_color FROM users WHERE id=? AND is_active=1').get(userId);
    if(!user)throw new HttpError(403,'عامل مجاز تعمیر مشخص نیست.');
    enforceRepairWorkflow({user} as Session,ticketId,true,db);
    if(['Diagnosing','In Repair','Quality Control'].includes(toStatusName)&&ticket.technician_id==null&&ticket.technician2_id==null)throw new HttpError(409,'پیش از شروع مراحل فنی، تعمیرکار باید مشخص شود.');
  }
  const statuses = getStatuses();
  const from = statuses.find((s) => s.id === ticket.status_id);
  const to = statuses.find((s) => s.name.toLowerCase() === toStatusName.toLowerCase() || statusFa(s.name) === toStatusName);
  if (!to) throw new StatusError(`Unknown status "${toStatusName}".`);
  if (from?.id === to.id) return { ok: true };
  const cancellation=to.name==='Cancelled';
  if(cancellation){
    const user=db.prepare('SELECT id,name,email,role,branch_id,avatar_color FROM users WHERE id=? AND is_active=1').get(userId);if(!user)throw new HttpError(403,'عامل مجاز لغو پذیرش مشخص نیست.');const actor={user} as Session;requirePerm(actor,'repairs.status');
    if(typeof note!=='string'||note.trim().length<5||note.length>1000)throw new HttpError(400,'دلیل مستند لغو پذیرش را وارد کنید.');
    if(ticket.delivered_at||from?.name==='Delivered')throw new HttpError(409,'دستگاه تحویل‌شده از مسیر مرجوعی/اصلاح مجاز بررسی می‌شود؛ لغو مستقیم مجاز نیست.');
    requireRepairAccess(actor,ticketId);const position=cancellationPosition(db,ticketId);if(position.time.some(t=>t.ended_at==null))throw new HttpError(409,'ابتدا زمان‌سنج‌های باز را پایان دهید تا کار واقعی حفظ شود؛ سپس لغو را ثبت کنید.');if(position.requiresReview||from&&!from.allowed_next.includes(to.name))requirePerm(actor,'finance.manage');
    auditRecord(db,actor,'cancel_review','repair_ticket',ticketId,{status:from?.name},{reason:note,branch_id:ticket.branch_id,flags:position.flags,parts_cost:position.parts_cost,wip_amount:position.wip_amount});
  }
  if (!cancellation&&!opts?.bypassValidation && from && !from.allowed_next.includes(to.name)) {
    throw new StatusError(`A ticket in "${from.name}" cannot move to "${to.name}".`);
  }

  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const sets: string[] = ["status_id = ?", "updated_at = datetime('now')"];
  const vals: any[] = [to.id];
  if(cancellation){sets.push('cancel_reason=?');vals.push(note!.trim());}
  if (to.name === "Ready for Pickup") { sets.push("ready_at = ?"); vals.push(now); }
  if (to.name === "Delivered") {
    sets.push("delivered_at = ?"); vals.push(now);
  }
  if (["Cancelled", "Unrepairable", "No Fault Found", "Delivered"].includes(to.name)) {
    sets.push("completed_at = ?"); vals.push(now);
  }
  vals.push(ticketId);
  db.prepare(`UPDATE repair_tickets SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  if (to.name === "Delivered") computeTechnicianCommission(ticketId,userId);
  if(cancellation)captureFinancialDocument(db,'repair',ticketId,'cancellation',userId,Number(ticket.branch_id));

  db.prepare(
    "INSERT INTO repair_status_history(ticket_id, from_status, to_status, user_id, note) VALUES(?,?,?,?,?)"
  ).run(ticketId, from?.id ?? null, to.id, userId, note ?? null);

  if (to.notify_customer) queueStatusNotification(ticketId, to, userId);

  // customer timeline
  if (ticket.customer_id) {
    db.prepare(
      "INSERT INTO customer_events(customer_id, ticket_id, type, title, detail, user_id) VALUES(?,?,?,?,?,?)"
    ).run(ticket.customer_id, ticketId, "status", `Repair ${ticket.number}: ${to.name}`, note ?? null, userId);
  }
  return { ok: true as const };
  });
}

export function queueStatusNotification(ticketId: number, status: StatusDef, userId: number) {
  const db = getDb();
  const t = db.prepare(
    `SELECT t.*, c.first_name, c.last_name, c.mobile, c.email, d.brand, d.model
     FROM repair_tickets t JOIN customers c ON c.id = t.customer_id JOIN devices d ON d.id = t.device_id
     WHERE t.id = ?`
  ).get(ticketId) as any;
  if (!t) return;
  const tpl = db.prepare("SELECT * FROM message_templates WHERE event = ? AND is_active = 1").get(status.name) as any;
  const shop = getSetting("business_name", "RePaird");
  const trackUrl = `${getSetting("public_base_url", "")}/track/${t.number}`;
  const body = renderTemplate(
    tpl?.body || `{{customer_name}} عزیز، وضعیت {{device}} شما (پذیرش {{ticket}}) به «{{status}}» تغییر کرد. پیگیری: {{link}} — {{shop}}`,
    {
      customer_name: `${t.first_name ?? ""} ${t.last_name ?? ""}`.trim(),
      ticket: t.number,
      device: `${t.brand ?? ""} ${t.model ?? ""}`.trim(),
      status: status.name,
      amount: "",
      link: trackUrl,
      shop,
    }
  );
  db.prepare(
    "INSERT INTO messages(ticket_id, customer_id, direction, channel, body, status, user_id) VALUES(?,?,?,?,?,?,?)"
  ).run(ticketId, t.customer_id, "out", tpl?.channel || "sms", body, "queued", userId);
}

export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

export function getSetting(key: string, fallback = ""): string {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as any;
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string) {
  getDb().prepare(
    "INSERT INTO settings(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

// ---- Sensitive credential encryption ----
export function encryptSecret(plain: string): string {
  return encryptCredential(plain);
}

export function decryptSecret(payload: string): string {
  return decryptCredential(payload);
}

export function addCustomerEvent(customerId: number, type: string, title: string, detail: string | null, userId: number | null, ticketId?: number | null, branchId?: number | null) {
  const db=getDb();
  const branch=branchId??(ticketId?db.prepare('SELECT branch_id FROM repair_tickets WHERE id=?').get(ticketId)?.branch_id:null)??null;
  db.prepare(
    "INSERT INTO customer_events(customer_id, ticket_id, type, title, detail, user_id,branch_id) VALUES(?,?,?,?,?,?,?)"
  ).run(customerId, ticketId ?? null, type, title, detail, userId,branch);
}

export function notifyUser(userId: number, title: string, body: string, link: string, priority = "normal") {
  const db=getDb();
  const recipient=db.prepare("SELECT u.role,u.branch_id,u.is_active,b.is_active branch_active FROM users u LEFT JOIN branches b ON b.id=u.branch_id WHERE u.id=?").get(userId);
  if(!recipient || recipient.is_active!==1)return false;
  const ticket=link.match(/^\/repairs\/(\d+)(?:[/?#]|$)/);
  const branch=ticket?db.prepare("SELECT branch_id FROM repair_tickets WHERE id=?").get(Number(ticket[1]))?.branch_id??null:null;
  const company=["owner","admin"].includes(String(recipient.role));
  if(!company && (recipient.branch_active!==1 || branch==null || recipient.branch_id!==branch))return false;
  db.prepare("INSERT INTO notifications(user_id,title,body,priority,link,branch_id) VALUES(?,?,?,?,?,?)").run(userId,title,body,priority,link,branch);
  return true;
}
