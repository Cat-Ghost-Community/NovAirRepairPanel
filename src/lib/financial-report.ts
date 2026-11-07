import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { CASH_EVENTS_CTE, INVOICE_BALANCES_CTE, SETTLED_PAYMENT } from "@/lib/payment-state";
import { multiplyRial, sumRial } from "@/lib/money";
import { readSnapshot } from "@/lib/db/transaction";

/** Operational source report, distinct from the existing posted ledger.
 * Cash movements are never labelled certified revenue/profit. */
export function operationalFinance(db: DatabaseSync, branchId: number | null, from: string, until: string, flowFrom: string) {
  return readSnapshot(db, () => {
  const period = { branch: branchId, from, until };
  const get = (sql: string, params: Record<string, SQLInputValue>) => db.prepare(sql).get(params) as Record<string, number>;
  const operatingCash=`${CASH_EVENTS_CTE}, operating_cash AS (SELECT * FROM cash_events
    UNION ALL SELECT branch_id,payment_date,0,amount FROM commission_payments
    UNION ALL SELECT branch_id,posting_date,amount,0 FROM commission_corrections WHERE kind='recovery' AND state='posted')`;
  const cash = get(`${operatingCash} SELECT COALESCE(SUM(inflow),0) cashIn,COALESCE(SUM(outflow),0) cashOut
    FROM operating_cash WHERE (@branch IS NULL OR branch_id=@branch) AND event_at>=@from AND event_at<@until`, period);
  const expenses = get(`SELECT COALESCE(SUM(amount),0) amount FROM expenses WHERE (@branch IS NULL OR branch_id=@branch)
    AND date>=date(@from) AND date<date(@until)`, period).amount;
  const obligations = get(`${INVOICE_BALANCES_CTE} SELECT
    COALESCE(SUM(CASE WHEN type='purchase' THEN MAX(0,total-settled_paid) ELSE 0 END),0) payables,
    COALESCE(SUM(CASE WHEN type!='purchase' THEN MAX(0,total-settled_paid) ELSE 0 END),0) receivables
    FROM invoice_balances WHERE status NOT IN ('draft','cancelled') AND (@branch IS NULL OR branch_id=@branch)`, { branch: branchId });
  const unbilledSales = get(`SELECT COALESCE(SUM(MAX(0,s.total-COALESCE(p.amount,0))),0) amount FROM sales s LEFT JOIN
    (SELECT p.sale_id,SUM(p.amount-COALESCE((SELECT SUM(r.amount) FROM refunds r WHERE r.payment_id=p.id),0)) amount
      FROM payments p WHERE p.direction='in' AND ${SETTLED_PAYMENT} GROUP BY p.sale_id) p ON p.sale_id=s.id
    WHERE s.status!='cancelled' AND (@branch IS NULL OR s.branch_id=@branch)
      AND NOT EXISTS(SELECT 1 FROM invoices i WHERE i.sale_id=s.id AND i.status NOT IN ('draft','cancelled'))`, { branch: branchId }).amount;
  let inventoryValue = 0;
  let lastStock = 0;
  for (;;) {
    const stock = db.prepare(`SELECT s.id,s.qty,s.carrying_value,p.avg_cost,p.purchase_price FROM inventory_stock s JOIN parts p ON p.id=s.part_id
      JOIN inventory_locations l ON l.id=s.location_id WHERE (@branch IS NULL OR l.branch_id=@branch) AND s.id>@last ORDER BY s.id LIMIT 500`)
      .all({ branch: branchId, last: lastStock }) as { id: number; qty: number; carrying_value:number|null; avg_cost: number | null; purchase_price: number | null }[];
    if (!stock.length) break;
    inventoryValue = sumRial([inventoryValue, ...stock.map(row => row.carrying_value??multiplyRial(row.avg_cost ?? row.purchase_price ?? 0, row.qty))]);
    lastStock = stock[stock.length - 1].id;
  }
  const flow = db.prepare(`${operatingCash}, events AS (SELECT branch_id,date(event_at) d,inflow,outflow FROM operating_cash
    UNION ALL SELECT branch_id,date(date),0,amount FROM expenses)
    SELECT d,SUM(inflow) inflow,SUM(outflow) outflow FROM events WHERE (@branch IS NULL OR branch_id=@branch)
      AND d>=date(@from) AND d<date(@until) GROUP BY d ORDER BY d`)
    .all({ branch: branchId, from: flowFrom, until }) as { d: string; inflow: number; outflow: number }[];
  const agingRows = db.prepare(`${INVOICE_BALANCES_CTE}, aged AS (SELECT total-settled_paid balance,
    julianday(date(@until,'-1 day'))-julianday(COALESCE(due_date,date)) days FROM invoice_balances
    WHERE type!='purchase' AND status NOT IN ('draft','cancelled') AND total>settled_paid AND (@branch IS NULL OR branch_id=@branch))
    SELECT CASE WHEN days IS NULL THEN 'undated' WHEN days<=0 THEN 'current' WHEN days<=30 THEN 'd30'
      WHEN days<=60 THEN 'd60' WHEN days<=90 THEN 'd90' ELSE 'd90p' END bucket,SUM(balance) balance FROM aged GROUP BY bucket`)
    .all({ branch: branchId, until }) as { bucket: "current" | "d30" | "d60" | "d90" | "d90p" | "undated"; balance: number }[];
  const aging = { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0, undated: 0 };
  for (const row of agingRows) {
    aging[row.bucket] = row.balance;
  }
  return { cashIn: cash.cashIn, cashOut: cash.cashOut, expenses, netFlow: cash.cashIn - cash.cashOut - expenses,
    receivables: obligations.receivables + unbilledSales, payables: obligations.payables, inventoryValue, flow: flow.map(row => ({ ...row })), aging };
  });
}
