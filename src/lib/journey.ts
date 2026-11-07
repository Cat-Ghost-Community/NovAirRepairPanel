/**
 * «مسیر تعمیر» — خط زمانی کامل و فقط-خواندنی عمر یک پذیرش.
 *
 * این ماژول چیزی را ذخیره نمی‌کند؛ رویدادها را از جداول معتبر موجود تجمیع می‌کند
 * (پذیرش، ارجاع‌ها، وضعیت‌ها، انتقال‌ها، زمان‌سنج، شرح‌کار، قطعات/اجرت، پیوست‌ها،
 * برآورد، فاکتور و پرداخت، پیام‌های مشتری، گارانتی، تحویل/پست و audit_logs).
 * بنابراین هرگز «رویداد موفق الکی» نمی‌سازد و با حذف/تغییر دادهٔ اصلی، سابقه جعل نمی‌شود.
 */
import { getDb } from "@/lib/db/schema";

export type JourneyEvent = {
  key: string;
  kind:
    | "accept"
    | "assign"
    | "reassign"
    | "status"
    | "transfer"
    | "time"
    | "note"
    | "item"
    | "attachment"
    | "estimate"
    | "invoice"
    | "payment"
    | "message"
    | "warranty"
    | "delivery"
    | "audit";
  at: string;
  title: string;
  detail?: string | null;
  actor_name?: string | null;
  actor_color?: string | null;
  meta?: Record<string, any> | null;
};

export type JourneySummary = {
  accepted_at: string | null;
  assigned_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  delivered_at: string | null;
  status_name: string | null;
  status_color: string | null;
  technician_name: string | null;
  phase: string;
};

const PROGRESS_NAMES = new Set([
  "Diagnosing",
  "In Repair",
  "Waiting for Parts",
  "Parts Available",
  "Quality Control",
  "Returned for Rework",
  "Warranty",
]);

function push(list: JourneyEvent[], ev: JourneyEvent) {
  list.push(ev);
}

export function ticketJourney(ticketId: number, viewer: { id: number; privileged: boolean }): { events: JourneyEvent[]; summary: JourneySummary } {
  const db = getDb();
  const t = db
    .prepare(
      `SELECT t.*, s.name status_name, s.color status_color, s.category status_category,
              u.name tech_name, u2.name creator_name, u3.name deliverer_name
       FROM repair_tickets t
       JOIN repair_statuses s ON s.id = t.status_id
       LEFT JOIN users u ON u.id = t.technician_id
       LEFT JOIN users u2 ON u2.id = t.created_by
       LEFT JOIN users u3 ON u3.id = t.delivered_by
       WHERE t.id = ?`
    )
    .get(ticketId) as any;
  if (!t) return { events: [], summary: emptySummary() };

  const events: JourneyEvent[] = [];
  const userName = (id: number | null | undefined) =>
    id == null
      ? null
      : ((db.prepare("SELECT name, avatar_color FROM users WHERE id = ?").get(Number(id)) as any) ?? null);

  // A) پذیرش
  push(events, {
    key: `accept-${t.id}`,
    kind: "accept",
    at: String(t.created_at ?? ""),
    title: `پذیرش ${t.number} ثبت شد`,
    detail: t.problem ?? null,
    actor_name: t.creator_name ?? null,
    meta: { source: t.source ?? null, priority: t.priority ?? null },
  });

  // B) ارجاع / ارجاع مجدد
  const assignments = db
    .prepare(
      `SELECT a.*, uf.name from_name, ut.name to_name, um.name by_name, um.avatar_color by_color
       FROM repair_assignments a
       LEFT JOIN users uf ON uf.id = a.from_user_id
       LEFT JOIN users ut ON ut.id = a.to_user_id
       LEFT JOIN users um ON um.id = a.user_id
       WHERE a.ticket_id = ? ORDER BY a.id`
    )
    .all(ticketId) as any[];
  for (const a of assignments) {
    const reassign = a.action === "reassign";
    push(events, {
      key: `assign-${a.id}`,
      kind: reassign ? "reassign" : "assign",
      at: String(a.created_at ?? ""),
      title: reassign
        ? `ارجاع مجدد از ${a.from_name ?? "—"} به ${a.to_name ?? "—"}`
        : `ارجاع به ${a.to_name ?? "—"}`,
      detail: a.reason ?? null,
      actor_name: a.actor_name ?? a.by_name ?? null,
      actor_color: a.by_color ?? null,
      meta: { from_user_id: a.from_user_id ?? null, to_user_id: a.to_user_id ?? null, reason: a.reason ?? null },
    });
  }

  // C/E) تاریخچهٔ وضعیت + انتقال‌های دستی بین تعمیرکاران
  const history = db
    .prepare(
      `SELECT h.*, sf.name from_name, st.name to_name, st.color to_color, u.name user_name, u2.name target_name
       FROM repair_status_history h
       LEFT JOIN repair_statuses sf ON sf.id = h.from_status
       LEFT JOIN repair_statuses st ON st.id = h.to_status
       LEFT JOIN users u ON u.id = h.user_id
       LEFT JOIN users u2 ON u2.id = h.to_status
       WHERE h.ticket_id = ? ORDER BY h.created_at, h.id`
    )
    .all(ticketId) as any[];
  for (const h of history) {
    const note = String(h.note ?? "");
    if (note.startsWith("PENDING_TRANSFER")) {
      push(events, {
        key: `transfer-${h.id}`,
        kind: "transfer",
        at: String(h.created_at ?? ""),
        title: `درخواست انتقال به ${h.target_name ?? "—"}`,
        detail: note.split("|")[1] || null,
        actor_name: h.user_name ?? null,
        meta: { state: "pending", to_user_id: h.to_status },
      });
      continue;
    }
    if (note.startsWith("TRANSFER_APPROVED")) {
      push(events, {
        key: `transfer-${h.id}`,
        kind: "transfer",
        at: String(h.created_at ?? ""),
        title: "انتقال تایید و دریافت شد",
        actor_name: h.user_name ?? null,
        meta: { state: "approved", to_user_id: h.to_status },
      });
      continue;
    }
    if (note.startsWith("TRANSFER_REJECTED")) {
      push(events, {
        key: `transfer-${h.id}`,
        kind: "transfer",
        at: String(h.created_at ?? ""),
        title: "انتقال رد شد",
        detail: note.split("|")[1] || null,
        actor_name: h.user_name ?? null,
        meta: { state: "rejected", to_user_id: h.to_status },
      });
      continue;
    }
    if (h.to_name == null) continue; // ردیف بدون وضعیت معتبر
    push(events, {
      key: `status-${h.id}`,
      kind: "status",
      at: String(h.created_at ?? ""),
      title: `تغییر وضعیت به «${h.to_name}»`,
      detail: h.note || null,
      actor_name: h.user_name ?? null,
      meta: { from: h.from_name ?? null, to: h.to_name, color: h.to_color ?? null },
    });
  }

  // D) زمان‌سنج کار
  const times = db
    .prepare(
      `SELECT te.*, u.name user_name FROM time_entries te LEFT JOIN users u ON u.id = te.user_id
       WHERE te.ticket_id = ? ORDER BY te.started_at, te.id`
    )
    .all(ticketId) as any[];
  for (const te of times) {
    const minutes = te.ended_at ? Number(te.minutes_active ?? 0) : null;
    push(events, {
      key: `time-${te.id}`,
      kind: "time",
      at: String(te.started_at ?? ""),
      title: te.is_manual ? "ثبت دستی زمان کار" : te.ended_at ? "پایان زمان کار" : "شروع زمان کار",
      detail: [minutes != null ? `${minutes} دقیقه` : "در حال اجرا", te.note].filter(Boolean).join(" — ") || null,
      actor_name: te.user_name ?? null,
      meta: { entry_id: te.id, minutes, manual: !!te.is_manual, running: !te.ended_at },
    });
  }

  // D) شرح کارها (خصوصی فقط برای نویسنده/مدیر)
  const notes = db
    .prepare(
      `SELECT n.*, u.name user_name FROM repair_notes n LEFT JOIN users u ON u.id = n.user_id
       WHERE n.ticket_id = ? AND (n.kind != 'private' OR n.user_id = ?${viewer.privileged ? " OR n.kind = 'private'" : ""})
       ORDER BY n.created_at, n.id`
    )
    .all(ticketId, viewer.id) as any[];
  const kindFa: Record<string, string> = { internal: "یادداشت داخلی", customer: "یادداشت مشتری", private: "یادداشت خصوصی" };
  for (const n of notes) {
    push(events, {
      key: `note-${n.id}`,
      kind: "note",
      at: String(n.created_at ?? ""),
      title: kindFa[n.kind] ?? "یادداشت",
      detail: n.body ?? null,
      actor_name: n.user_name ?? null,
      meta: { note_id: n.id, kind: n.kind },
    });
  }

  // E) قطعات/اجرت/خدمات + اتصال به تراکنش واقعی انبار
  const items = db
    .prepare(`SELECT i.*, u.name user_name FROM ticket_items i LEFT JOIN users u ON u.id = i.added_by WHERE i.ticket_id = ? ORDER BY i.id`)
    .all(ticketId) as any[];
  for (const it of items) {
    let movement: any = null;
    if (it.kind === "part" && it.ref_id != null) {
      movement = db
        .prepare(
          "SELECT id, qty, created_at FROM inventory_movements WHERE ref_type = 'ticket' AND ref_id = ? AND part_id = ? ORDER BY id LIMIT 1"
        )
        .get(ticketId, it.ref_id) as any;
    }
    push(events, {
      key: `item-${it.id}`,
      kind: "item",
      at: String(movement?.created_at ?? it.created_at ?? ""),
      title: it.kind === "part" ? `مصرف قطعه: ${it.name}` : it.kind === "service" ? `خدمت: ${it.name}` : `اجرت: ${it.name}`,
      detail: it.qty && Number(it.qty) !== 1 ? `تعداد ${it.qty}` : null,
      actor_name: it.user_name ?? null,
      meta: {
        item_id: it.id,
        kind: it.kind,
        qty: it.qty,
        unit_price: it.unit_price,
        warranty_days: it.warranty_days ?? 0,
        movement_id: movement?.id ?? null,
      },
    });
  }

  // پیوست‌ها (فقط فراداده — محتوا از مسیر امن خودش)
  const attachments = db
    .prepare(
      `SELECT a.id, a.filename, a.mime, a.size, a.phase, a.created_at, u.name user_name
       FROM repair_attachments a LEFT JOIN users u ON u.id = a.uploaded_by
       WHERE a.ticket_id = ? ORDER BY a.created_at, a.id`
    )
    .all(ticketId) as any[];
  for (const a of attachments) {
    push(events, {
      key: `attachment-${a.id}`,
      kind: "attachment",
      at: String(a.created_at ?? ""),
      title: `پیوست: ${a.filename ?? "فایل"}`,
      detail: a.phase ? `مرحله: ${a.phase}` : null,
      actor_name: a.user_name ?? null,
      meta: { attachment_id: a.id, mime: a.mime, size: a.size },
    });
  }

  // I) برآوردها
  const estimates = db.prepare("SELECT * FROM estimates WHERE ticket_id = ? ORDER BY id").all(ticketId) as any[];
  for (const es of estimates) {
    push(events, {
      key: `estimate-${es.id}`,
      kind: "estimate",
      at: String(es.created_at ?? ""),
      title: `برآورد ${es.number} نسخهٔ ${es.version} ساخته شد`,
      detail: es.total ? `مبلغ کل: ${es.total}` : null,
      actor_name: (userName(es.created_by) as any)?.name ?? null,
      meta: { estimate_id: es.id, status: es.status, total: es.total },
    });
    if (es.approved_at)
      push(events, {
        key: `estimate-${es.id}-approved`,
        kind: "estimate",
        at: String(es.approved_at),
        title: `برآورد ${es.number} توسط مشتری تایید شد`,
        meta: { estimate_id: es.id, approved: true },
      });
    if (es.rejected_at)
      push(events, {
        key: `estimate-${es.id}-rejected`,
        kind: "estimate",
        at: String(es.rejected_at),
        title: `برآورد ${es.number} رد شد`,
        detail: es.rejection_reason ?? null,
        meta: { estimate_id: es.id, rejected: true },
      });
  }

  // I) فاکتور و پرداخت‌ها
  const invoices = db.prepare("SELECT * FROM invoices WHERE ticket_id = ? ORDER BY id").all(ticketId) as any[];
  for (const inv of invoices) {
    push(events, {
      key: `invoice-${inv.id}`,
      kind: "invoice",
      at: String(inv.created_at ?? ""),
      title: `فاکتور ${inv.number} صادر شد`,
      detail: inv.total ? `مبلغ: ${inv.total}` : null,
      meta: { invoice_id: inv.id, status: inv.status, total: inv.total, paid: inv.paid },
    });
  }
  const payments = db
    .prepare(`SELECT p.*, u.name user_name FROM payments p LEFT JOIN users u ON u.id = p.user_id WHERE p.ticket_id = ? ORDER BY p.created_at, p.id`)
    .all(ticketId) as any[];
  for (const p of payments) {
    push(events, {
      key: `payment-${p.id}`,
      kind: "payment",
      at: String(p.created_at ?? ""),
      title: p.direction === "out" ? `بازپرداخت ${p.number}` : `دریافت ${p.number}`,
      detail: `${p.amount} — ${p.method ?? ""}`.trim(),
      actor_name: p.user_name ?? null,
      meta: { payment_id: p.id, amount: p.amount, direction: p.direction, method: p.method },
    });
  }

  // I) پیام‌های مشتری (صف ارتباطات)
  const messages = db.prepare("SELECT * FROM messages WHERE ticket_id = ? ORDER BY id").all(ticketId) as any[];
  for (const m of messages) {
    push(events, {
      key: `message-${m.id}`,
      kind: "message",
      at: String(m.created_at ?? ""),
      title: m.direction === "in" ? "پیام مشتری" : "اطلاع‌رسانی به مشتری",
      detail: String(m.body ?? "").slice(0, 160),
      actor_name: (userName(m.user_id) as any)?.name ?? null,
      meta: { message_id: m.id, channel: m.channel, status: m.status },
    });
  }

  // I) گارانتی
  const warranties = db.prepare("SELECT * FROM warranties WHERE ticket_id = ? ORDER BY id").all(ticketId) as any[];
  for (const w of warranties) {
    push(events, {
      key: `warranty-${w.id}`,
      kind: "warranty",
      at: String(w.created_at ?? ""),
      title: "گارانتی ثبت شد",
      detail: w.end_date ? `تا ${w.end_date}` : null,
      meta: { warranty_id: w.id, end_date: w.end_date, status: w.status },
    });
  }

  // H) ارسال پستی و تحویل نهایی
  if (t.postal_sent_at) {
    push(events, {
      key: `postal-${t.id}`,
      kind: "delivery",
      at: String(t.postal_sent_at),
      title: "ارسال پستی دستگاه",
      detail: t.postal_tracking ? `کد رهگیری: ${t.postal_tracking}` : null,
      meta: { postal_tracking: t.postal_tracking ?? null },
    });
  }
  if (t.delivered_at) {
    push(events, {
      key: `delivered-${t.id}`,
      kind: "delivery",
      at: String(t.delivered_at),
      title: "تحویل به مشتری",
      detail: t.delivery_signed_name ? `تحویل‌گیرنده: ${t.delivery_signed_name} (امضا ثبت شد)` : null,
      actor_name: t.deliverer_name ?? null,
      meta: { signed: !!t.delivery_signature, signed_name: t.delivery_signed_name ?? null },
    });
  }

  // I) رخدادهای مهم audit که جای دیگری پوشش داده نشده‌اند
  const covered = new Set(["create", "status_change", "transfer", "transfer_reply", "assign", "reassign", "add"]);
  const audits = db
    .prepare(
      `SELECT a.*, u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.entity = 'repair_ticket' AND a.entity_id = ? ORDER BY a.created_at, a.id LIMIT 300`
    )
    .all(ticketId) as any[];
  const actionFa: Record<string, string> = {
    update: "ویرایش اطلاعات پذیرش",
    delete: "حذف (ابطال) پذیرش",
    reveal_security: "مشاهدهٔ اطلاعات امنیتی دستگاه",
    reveal: "مشاهدهٔ اطلاعات امنیتی دستگاه",
  };
  for (const a of audits) {
    if (covered.has(a.action)) continue;
    push(events, {
      key: `audit-${a.id}`,
      kind: "audit",
      at: String(a.created_at ?? ""),
      title: actionFa[a.action] ?? `رخداد: ${a.action}`,
      detail: null,
      actor_name: a.user_name ?? null,
      meta: { audit_id: a.id, action: a.action },
    });
  }

  events.sort((a, b) => {
    const at = String(a.at ?? "");
    const bt = String(b.at ?? "");
    if (at !== bt) return at < bt ? -1 : 1;
    const ak = a.key.split("-");
    const bk = b.key.split("-");
    if (ak[0] !== bk[0]) return ak[0] < bk[0] ? -1 : 1;
    return Number(ak[1] ?? 0) - Number(bk[1] ?? 0);
  });

  const firstAssign = assignments[0]?.created_at ?? null;
  const started =
    times.find((x) => x.started_at)?.started_at ??
    history.find((h) => h.to_name && PROGRESS_NAMES.has(String(h.to_name)))?.created_at ??
    null;
  const readyRow = history.find((h) => h.to_name === "Ready for Pickup");
  const summary: JourneySummary = {
    accepted_at: t.created_at ?? null,
    assigned_at: firstAssign,
    started_at: started,
    completed_at: readyRow?.created_at ?? t.ready_at ?? null,
    delivered_at: t.delivered_at ?? null,
    status_name: t.status_name ?? null,
    status_color: t.status_color ?? null,
    technician_name: t.tech_name ?? null,
    phase: String(t.status_category ?? ""),
  };
  return { events, summary };
}

function emptySummary(): JourneySummary {
  return {
    accepted_at: null,
    assigned_at: null,
    started_at: null,
    completed_at: null,
    delivered_at: null,
    status_name: null,
    status_color: null,
    technician_name: null,
    phase: "",
  };
}
