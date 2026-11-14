import {repairReadAssignedOnly} from '@/lib/repair-workflow';
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, fail, ok } from "@/lib/api";
import { canUser } from "@/lib/auth";
import { activeBranch, branchWhere } from "@/lib/branch";
import { fmtMoney } from "@/lib/format";
import { statusFa } from "@/lib/status-fa";

export async function GET(req: NextRequest) {
  try {
    const session = requireSession(req);
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    if (!q) return ok({});
    const db = getDb();
    const like = `%${q}%`;
    const scope = activeBranch(session, req.cookies.get("repaid_branch")?.value);
    const ticketScope = branchWhere(scope, "t");
    const invoiceScope = branchWhere(scope, "i");
    const assignedOnly = repairReadAssignedOnly(session);

    const tickets = canUser(session, "repairs.view") ? db
      .prepare(
        `SELECT t.id, t.number, t.problem, c.first_name, c.last_name, d.brand, d.model, s.name status_name
         FROM repair_tickets t
         JOIN customers c ON c.id = t.customer_id
         JOIN devices d ON d.id = t.device_id
         JOIN repair_statuses s ON s.id = t.status_id
         WHERE (${ticketScope.sql}) ${assignedOnly ? "AND (t.technician_id=? OR t.technician2_id=?)" : ""} AND (t.number LIKE ? OR c.mobile LIKE ? OR d.serial LIKE ? OR d.imei LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ?)
         ORDER BY t.created_at DESC LIMIT 8`
      )
      .all(...ticketScope.params, ...(assignedOnly ? [session.user.id, session.user.id] : []), like, like, like, like, like, like) as any[] : [];

    const customers = canUser(session, "customers.view") ? db
      .prepare(
        `SELECT id, first_name, last_name, company, mobile, email FROM customers
         WHERE (? IS NULL OR id IN (SELECT customer_id FROM customer_branch_access WHERE branch_id=?)) AND ((first_name || ' ' || last_name) LIKE ? OR company LIKE ? OR mobile LIKE ? OR email LIKE ? OR code LIKE ?)
         LIMIT 8`
      )
      .all(scope.branchId,scope.branchId,like, like, like, like, like) as any[] : [];

    const devices = canUser(session, "devices.view") ? db
      .prepare(
        `SELECT d.id, d.brand, d.model, d.type, d.serial, d.imei, c.first_name, c.last_name
         FROM devices d JOIN customers c ON c.id = d.customer_id
         WHERE (? IS NULL OR d.id IN (SELECT device_id FROM device_branch_access WHERE branch_id=?)) AND (d.model LIKE ? OR d.brand LIKE ? OR d.serial LIKE ? OR d.imei LIKE ? OR COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'') LIKE ?)
         LIMIT 8`
      )
      .all(scope.branchId,scope.branchId,like, like, like, like, like) as any[] : [];

    const parts = canUser(session, "inventory.view") ? db
      .prepare(
        `SELECT id, sku, name, category FROM parts
         WHERE name LIKE ? OR sku LIKE ? OR barcode LIKE ? OR compatibility LIKE ?
         LIMIT 8`
      )
      .all(like, like, like, like) as any[] : [];

    const invoices = canUser(session, "invoices.view") ? db
      .prepare(
        `SELECT i.id, i.number, i.total, i.status, c.first_name, c.last_name
         FROM effective_invoices i JOIN customers c ON c.id = i.customer_id
         WHERE (${invoiceScope.sql}) AND (i.number LIKE ? OR COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'') LIKE ?)
         LIMIT 8`
      )
      .all(...invoiceScope.params, like, like) as any[] : [];

    const suppliers = canUser(session, "suppliers.view") ? db
      .prepare(`SELECT id, name, company, phone FROM suppliers WHERE name LIKE ? OR company LIKE ? OR phone LIKE ? LIMIT 8`)
      .all(like, like, like) as any[] : [];

    return ok({
      tickets: tickets.map((t) => ({
        id: t.id,
        title: `${t.number} — ${t.first_name} ${t.last_name}`,
        subtitle: `${t.brand} ${t.model} · ${t.status_name}`,
        href: `/repairs/${t.id}`,
      })),
      customers: customers.map((c) => ({
        id: c.id,
        title: c.company ? `${c.company} (${c.first_name} ${c.last_name})` : `${c.first_name} ${c.last_name}`,
        subtitle: `${c.mobile ?? ""} ${c.email ?? ""}`.trim(),
        href: `/customers/${c.id}`,
      })),
      devices: devices.map((d) => ({
        id: d.id,
        title: `${d.brand} ${d.model}`,
        subtitle: `${d.type} · ${d.serial ?? d.imei ?? ""} · ${d.first_name} ${d.last_name}`,
        href: `/devices/${d.id}`,
      })),
      parts: parts.map((p) => ({
        id: p.id,
        title: p.name,
        subtitle: `${p.sku} · ${p.category}`,
        href: `/parts/${p.id}`,
      })),
      invoices: invoices.map((i) => ({
        id: i.id,
        title: i.number,
        subtitle: `${i.first_name} ${i.last_name} · ${fmtMoney(i.total)} · ${statusFa(i.status)}`,
        href: `/invoices/${i.id}`,
      })),
      suppliers: suppliers.map((s) => ({
        id: s.id,
        title: s.name,
        subtitle: s.phone ?? "",
        href: `/suppliers/${s.id}`,
      })),
    });
  } catch (e) {
    return fail(e);
  }
}
