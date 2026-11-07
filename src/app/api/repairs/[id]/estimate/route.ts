import {atomicRepairMutation} from '@/lib/api';
import { requireRepairAccess } from "@/lib/repair-access";
import { NextRequest } from "next/server";
import { getDb, nextSeq } from "@/lib/db/schema";
import { requireSession, fail, ok, readJson, audit, requirePerm,HttpError } from "@/lib/api";
import { queueStatusNotification, addCustomerEvent } from "@/lib/repair";
import { lineTotal } from "@/lib/finance";
import { fmtMoney } from "@/lib/format";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = requireSession(req);
    requirePerm(session, "estimates.create");
    const { id } = await params;
    requireRepairAccess(session, Number(id), req.cookies.get("repaid_branch")?.value);
    const ticketId = Number(id);
    const b = req.body==null?{}:await readJson(req);
    const db = getDb();
    return atomicRepairMutation(db,req,session,Number(id),()=>{
    const ticket = db.prepare("SELECT * FROM repair_tickets WHERE id = ?").get(ticketId) as any;
    if (!ticket) return Response.json({ error: "پذیرش یافت نشد." }, { status: 404 });
    if(db.prepare("SELECT id FROM repair_statuses WHERE id=? AND name='Cancelled'").get(ticket.status_id))throw new HttpError(409,'برآورد تازه برای پذیرش لغوشده به بازبینی کنترل‌شده نیاز دارد.');

    // اقلام تعرفه که کاربر هنگام ساخت برآورد انتخاب کرده: ابتدا به اقلام پذیرش اضافه می‌شوند
    const extraTariffs: number[] = Array.isArray(b?.extra_tariffs)
      ? b.extra_tariffs.map((x: any) => Number(x)).filter((n: number) => Number.isInteger(n) && n > 0)
      : [];
    if (extraTariffs.length > 0) {
      const pickTariff = db.prepare("SELECT id, title, brand, labor_price, warranty_days FROM repair_tariffs WHERE id = ? AND is_active = 1");
      const addItem = db.prepare(
        "INSERT INTO ticket_items(ticket_id, kind, ref_id, name, qty, unit_price, cost, warranty_days, added_by) VALUES(?,?,?,?,?,?,?,?,?)"
      );
      for (const tariffId of extraTariffs) {
        const t = pickTariff.get(tariffId) as any;
        if (!t) continue;
        addItem.run(
          ticketId,
          "labor",
          t.id,
          `${t.title}${t.brand ? ` (${t.brand})` : ""}`,
          1,
          t.labor_price,
          0,
          Math.max(0, Math.round(Number(t.warranty_days ?? 0) || 0)),
          session.user.id
        );
        audit(session, "add", "ticket_item", ticketId, null, { from_tariff: t.id, name: t.title, price: t.labor_price });
      }
    }

    const items = db.prepare("SELECT * FROM ticket_items WHERE ticket_id = ?").all(ticketId) as any[];
    if (items.length === 0) return Response.json({ error: "قبل از ایجاد برآورد، قطعه یا خدمت اضافه کنید." }, { status: 400 });

    const subtotal = items.reduce((s: number, i: any) => s + i.qty * i.unit_price, 0) + (ticket.diagnostic_fee ?? 0);
    const taxRate = Number((db.prepare("SELECT value FROM settings WHERE key = 'tax_rate'").get() as any)?.value ?? 0);
    const tax = Math.round(subtotal * taxRate / 100);
    const total = subtotal + tax;
    const number = nextSeq("estimate", "EST-");
    const token = crypto.randomUUID().replace(/-/g, "");

    const estId = db.prepare(
      `INSERT INTO estimates(number, ticket_id, customer_id, device_id, status, subtotal, tax, total, deposit, valid_until, notes, terms, public_token, created_by)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      number, ticketId, ticket.customer_id, ticket.device_id, "sent", subtotal, tax, total, b.deposit ?? 0,
      new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      null, "اعتبار این برآورد ۷ روز است.", token, session.user.id
    ).lastInsertRowid as number;

    const insItem = db.prepare("INSERT INTO estimate_items(estimate_id, kind, ref_id, name, qty, unit_price, total) VALUES(?,?,?,?,?,?,?)");
    for (const i of items) insItem.run(estId, i.kind, i.ref_id, i.name, i.qty, i.unit_price, i.qty * i.unit_price);
    if (ticket.diagnostic_fee > 0) insItem.run(estId, "fee", null, "هزینه عیب‌یابی", 1, ticket.diagnostic_fee, ticket.diagnostic_fee);

    db.prepare("UPDATE repair_tickets SET estimate_id = ? WHERE id = ?").run(estId, ticketId);
    audit(session, "create", "estimate", estId, null, { number, total });
    addCustomerEvent(ticket.customer_id, "estimate", `برآورد ${number} ارسال شد`, `جمع ${fmtMoney(total)}`, session.user.id, ticketId);

    // queue customer message
    queueStatusNotification(ticketId, { id: 0, name: "در انتظار تأیید مشتری", category: "", color: "", allowed_next: [], is_open: 1, sla_hours: null, notify_customer: 1, customer_visible: 1, technician_visible: 1 }, session.user.id);

    return ok({ id: estId, number });
    });
  } catch (e) {
    return fail(e);
  }
}
