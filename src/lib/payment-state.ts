import type { DatabaseSync } from "node:sqlite";
import { invoiceObligation } from '@/lib/invoice-obligation';
import {SETTLED_PAYMENT,invoicePaidExpression} from '@/lib/invoice-settlement-sql';
export {SETTLED_PAYMENT} from '@/lib/invoice-settlement-sql';

/** A cheque instrument is not settlement. Legacy instruments without a reliable
 * payment link are deliberately not inferred from matching amounts or dates. */

export const INVOICE_BALANCES_CTE = `WITH invoice_balances AS (SELECT i.*,i.paid settled_paid FROM effective_invoices i)`;

export function refreshInvoiceFinancialState(db:DatabaseSync,id:number){
 const inv=db.prepare('SELECT type,status,due_date FROM invoices WHERE id=?').get(id);if(!inv)return;
 const paid=netInvoicePaid(db,id,inv.type==='purchase'?'out':'in'),obligation=invoiceObligation(db,id).effective_total;
 let status=String(inv.status);
 if(!['draft','cancelled'].includes(status))status=paid>=obligation?'paid':paid>0?'partially_paid':inv.due_date&&String(inv.due_date)<new Date().toISOString().slice(0,10)?'overdue':'issued';
 db.prepare('UPDATE invoices SET paid=?,status=? WHERE id=?').run(paid,status,id);
}

/** Documentary movements, not earned revenue. A refund is dated on its own
 * event date; a cheque on its collection date. No duplicate bank transaction. */
export const CASH_EVENTS_CTE = `WITH cash_events AS (
  SELECT p.branch_id,CASE WHEN p.method IN ('check','cheque') THEN c.settled_at ELSE p.created_at END event_at,
    CASE WHEN p.direction='in' THEN p.amount ELSE 0 END inflow,
    CASE WHEN p.direction='out' THEN p.amount ELSE 0 END outflow
    FROM payments p LEFT JOIN checks c ON c.payment_id=p.id WHERE ${SETTLED_PAYMENT}
  UNION ALL SELECT r.branch_id,r.created_at,
    CASE WHEN p.direction='out' THEN r.amount ELSE 0 END,
    CASE WHEN p.direction='in' THEN r.amount ELSE 0 END FROM refunds r JOIN payments p ON p.id=r.payment_id
    WHERE ${SETTLED_PAYMENT})`;

export function settledCashTotals(db:DatabaseSync,branch:number|null,from:string,until:string){
 const row=db.prepare(`${CASH_EVENTS_CTE} SELECT COALESCE(SUM(inflow),0) inflow,COALESCE(SUM(outflow),0) outflow FROM cash_events WHERE (:branch IS NULL OR branch_id=:branch) AND event_at>=:from AND event_at<:until`).get({branch,from,until})!;
 if(!Number.isSafeInteger(row.inflow)||!Number.isSafeInteger(row.outflow))throw new Error('جمع وجوه از محدودهٔ صحیح پولی بیشتر است؛ بررسی اسناد لازم است.');
 return {inflow:Number(row.inflow),outflow:Number(row.outflow)};
}

export function netInvoicePaid(db: DatabaseSync, invoiceId: number, direction: "in" | "out"): number {
  const row = db.prepare(`SELECT ${invoicePaidExpression('@invoice','@direction')} amount`)
    .get({invoice:invoiceId,direction}) as { amount: number };
  return row.amount;
}

/** Reserve unsettled valid instruments too, so a cash request cannot overfund
 * an invoice while its cheque is still awaiting collection. */
export function pendingInvoiceAmount(db: DatabaseSync, invoiceId: number, direction: "in" | "out"): number {
  const row = db.prepare(`SELECT COALESCE(SUM(p.amount),0) amount FROM payments p
    WHERE p.invoice_id=? AND p.direction=? AND p.method IN ('check','cheque') AND EXISTS
    (SELECT 1 FROM checks c WHERE c.payment_id=p.id AND c.status IN ('in_hand','deposited','transferred_spend'))`)
    .get(invoiceId, direction) as { amount: number };
  return row.amount;
}

export function syncSalePaid(db: DatabaseSync, saleId: number) {
  const invoice=db.prepare("SELECT id FROM invoices WHERE sale_id=? AND status NOT IN ('draft','cancelled')").get(saleId);
  const row = db.prepare(`SELECT COALESCE(SUM(p.amount - COALESCE((SELECT SUM(r.amount) FROM refunds r WHERE r.payment_id=p.id),0)),0) amount
    FROM payments p WHERE p.sale_id=? AND p.direction='in' AND ${SETTLED_PAYMENT}`).get(saleId) as { amount: number };
  const paid=invoice?netInvoicePaid(db,Number(invoice.id),'in'):row.amount;
  db.prepare(`UPDATE sales SET paid=?,status=CASE WHEN status='cancelled' THEN status WHEN ? >= COALESCE((SELECT total FROM effective_invoices WHERE sale_id=sales.id AND status NOT IN ('draft','cancelled')),total) THEN 'completed' ELSE 'credit' END WHERE id=?`)
    .run(paid, paid, saleId);
}
