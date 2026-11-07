import type { DatabaseSync } from "node:sqlite";
import { SETTLED_PAYMENT } from "@/lib/payment-state";
import { quantityValue } from "@/lib/money";
import { verifyLedger } from "@/lib/accounting";

/** Inspection only: no DDL, updates, synthetic journals or balancing entries.
 * Returns counts and identities of checks, never customer names or bank details. */
export function financialReconciliation(db: DatabaseSync) {
  const count = (sql: string) => Number(Object.values(db.prepare(sql).get()!)[0]);
  const checks: Record<string, number> = {};
  const columns = (table: string) => db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
  const paymentLink = columns("checks").includes("payment_id");
  const bankLink = columns("bank_transactions").includes("check_id");
  checks.orphan_invoice_payments = count("SELECT COUNT(*) FROM payments p LEFT JOIN invoices i ON i.id=p.invoice_id WHERE p.invoice_id IS NOT NULL AND i.id IS NULL");
  checks.orphan_refunds = count("SELECT COUNT(*) FROM refunds r LEFT JOIN payments p ON p.id=r.payment_id WHERE p.id IS NULL");
  checks.over_refunded_payments = count("SELECT COUNT(*) FROM payments p WHERE (SELECT COALESCE(SUM(r.amount),0) FROM refunds r WHERE r.payment_id=p.id)>p.amount");
  checks.refund_reference_mismatch = count(`SELECT COUNT(*) FROM refunds r JOIN payments p ON p.id=r.payment_id
    WHERE r.invoice_id IS NOT p.invoice_id OR r.sale_id IS NOT p.sale_id OR r.customer_id IS NOT p.customer_id OR r.branch_id IS NOT p.branch_id`);
  checks.payment_invoice_reference_mismatch = count(`SELECT COUNT(*) FROM payments p JOIN invoices i ON i.id=p.invoice_id
    WHERE p.branch_id IS NOT i.branch_id OR (i.type!='purchase' AND p.customer_id IS NOT i.customer_id)
    OR p.direction != CASE WHEN i.type='purchase' THEN 'out' ELSE 'in' END`);
  for (const source of ["ticket_id", "sale_id", "purchase_order_id"]) {
    checks[`duplicate_active_invoice_${source}`] = count(`SELECT COUNT(*) FROM
      (SELECT ${source} FROM invoices WHERE ${source} IS NOT NULL AND status!='cancelled' GROUP BY ${source} HAVING COUNT(*)>1)`);
  }
  for (const [table, fields] of Object.entries({ invoices: ["subtotal", "discount", "tax", "total", "paid"], payments: ["amount"],
    refunds: ["amount"], expenses: ["amount"], sales: ["subtotal", "discount", "tax", "total", "paid"], checks: ["amount"],
    parts: ["price", "purchase_price", "avg_cost"] })) {
    checks[`invalid_${table}_money`] = count(`SELECT COUNT(*) FROM ${table} WHERE ${fields.map(field =>
      `(${field} IS NULL OR typeof(${field})!='integer' OR ${field}<0 OR ${field}>9007199254740991)`).join(" OR ")}`);
  }
  checks.negative_inventory = count("SELECT COUNT(*) FROM inventory_stock WHERE qty<0");
  checks.invalid_stock_precision = 0;
  for (const row of db.prepare("SELECT qty,reserved FROM inventory_stock").iterate()) {
    try { quantityValue(row.qty); quantityValue(row.reserved); } catch { checks.invalid_stock_precision++; }
  }
  checks.invalid_stock_reservations = count("SELECT COUNT(*) FROM inventory_stock WHERE reserved<0 OR reserved>qty");
  checks.zero_cost_stock_needs_review = count("SELECT COUNT(*) FROM parts p WHERE p.avg_cost=0 AND p.purchase_price>0 AND EXISTS(SELECT 1 FROM inventory_stock s WHERE s.part_id=p.id AND s.qty>0)");
  checks.unattributed_stock_locations = count("SELECT COUNT(*) FROM inventory_locations WHERE branch_id IS NULL");
  checks.cross_branch_stock_movements = count(`SELECT COUNT(*) FROM inventory_movements m JOIN inventory_locations l ON l.id=m.location_id
    WHERE m.branch_id IS NOT NULL AND m.branch_id IS NOT l.branch_id`);
  checks.legacy_unattributed_commissions = count("SELECT COUNT(*) FROM payroll_runs WHERE earned_commission!=0 AND source_ticket_id IS NULL");
  checks.legacy_unlinked_cheques = paymentLink ? count("SELECT COUNT(*) FROM checks WHERE payment_id IS NULL AND invoice_id IS NOT NULL") : count("SELECT COUNT(*) FROM checks WHERE invoice_id IS NOT NULL");
  checks.invoice_paid_cache_mismatch = 0;
  checks.overpaid_invoices = 0;
  checks.refunded_unsettled_cheques = 0;
  if (paymentLink) {
    const balances = db.prepare(`WITH refunded AS (SELECT payment_id,SUM(amount) amount FROM refunds GROUP BY payment_id),
      settled AS (SELECT p.invoice_id,SUM(p.amount-COALESCE(r.amount,0)) amount FROM payments p
        JOIN invoices i ON i.id=p.invoice_id LEFT JOIN refunded r ON r.payment_id=p.id
        WHERE p.direction=CASE WHEN i.type='purchase' THEN 'out' ELSE 'in' END AND ${SETTLED_PAYMENT} GROUP BY p.invoice_id)
      SELECT COALESCE(SUM(CASE WHEN i.paid!=COALESCE(s.amount,0) THEN 1 ELSE 0 END),0) mismatches,
        COALESCE(SUM(CASE WHEN COALESCE(s.amount,0)>i.total THEN 1 ELSE 0 END),0) overpaid
      FROM invoices i LEFT JOIN settled s ON s.invoice_id=i.id`).get() as { mismatches: number; overpaid: number };
    checks.invoice_paid_cache_mismatch = balances.mismatches;
    checks.overpaid_invoices = balances.overpaid;
    checks.refunded_unsettled_cheques = count(`SELECT COUNT(*) FROM payments p WHERE p.method IN ('check','cheque')
      AND NOT ${SETTLED_PAYMENT} AND EXISTS(SELECT 1 FROM refunds r WHERE r.payment_id=p.id)`);
  }
  checks.passed_cheques_without_bank_evidence = bankLink ? count(`SELECT COUNT(*) FROM checks c WHERE c.status='passed'
    AND NOT EXISTS(SELECT 1 FROM bank_transactions b WHERE b.check_id=c.id)`)
    : count("SELECT COUNT(*) FROM checks WHERE status='passed'");
  checks.bank_check_evidence_mismatch = bankLink ? count(`SELECT COUNT(*) FROM bank_transactions b JOIN checks c ON c.id=b.check_id
    WHERE c.status!='passed' OR b.amount!=c.amount OR b.account_id IS NOT c.bank_account_id
    OR b.type!=CASE WHEN c.kind='issued' THEN 'withdraw' ELSE 'deposit' END`) : 0;
  checks.pos_invoice_total_mismatch = count(`SELECT COUNT(*) FROM invoices i JOIN sales s ON s.id=i.sale_id
    WHERE i.status NOT IN ('draft','cancelled') AND (i.total!=s.total OR i.customer_id IS NOT s.customer_id OR i.branch_id IS NOT s.branch_id)`);
  checks.full_purchase_invoice_total_mismatch = count(`SELECT COUNT(*) FROM invoices i JOIN purchase_orders p ON p.id=i.purchase_order_id
    WHERE i.status NOT IN ('draft','cancelled') AND p.status='received' AND (i.total!=p.total OR i.supplier_id IS NOT p.supplier_id OR i.branch_id IS NOT p.branch_id)`);
  const transfersPresent = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='inventory_transfers'").get());
  checks.legacy_unpaired_transfer_movements = count("SELECT COUNT(*) FROM inventory_movements WHERE ref_type='transfer'");
  checks.transfer_pair_mismatch = transfersPresent ? count(`SELECT COUNT(*) FROM inventory_transfers t
    LEFT JOIN inventory_movements o ON o.ref_type='inventory_transfer' AND o.ref_id=t.id AND o.type='transfer_out'
    LEFT JOIN inventory_movements i ON i.ref_type='inventory_transfer' AND i.ref_id=t.id AND i.type='transfer_in'
    WHERE o.id IS NULL OR i.id IS NULL OR o.part_id!=t.part_id OR i.part_id!=t.part_id OR o.location_id!=t.from_location
      OR i.location_id!=t.to_location OR o.qty!=-t.qty OR i.qty!=t.qty OR o.branch_id IS NOT t.branch_id
      OR i.branch_id IS NOT t.to_branch_id OR o.unit_cost IS NOT i.unit_cost`) : 0;
  const ledgerPresent = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='accounting_journals'").get());
  const ledger=ledgerPresent?verifyLedger(db):null;
  const ledgerConfigured=ledgerPresent && count("SELECT COUNT(*) FROM accounting_accounts")>0 && count("SELECT COUNT(*) FROM accounting_periods")>0;
  checks.ledger_integrity_errors=ledger?.errors.length??0;
  const openingLinks=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='accounting_opening_event_links'").get());
  checks.pending_accounting_events=ledgerPresent?count(`SELECT COUNT(*) FROM accounting_events e LEFT JOIN accounting_event_reviews r ON r.event_id=e.id
    LEFT JOIN accounting_journals j ON j.id=r.journal_id WHERE json_extract(e.payload_json,'$.control_amount')>0
    ${openingLinks?'AND NOT EXISTS(SELECT 1 FROM accounting_opening_event_links ol WHERE ol.event_id=e.id)':''}
    AND (j.id IS NULL OR j.state NOT IN ('posted','reversed'))`):0;
  return { version: 1, currency: "IRR", minorUnit: "one rial", inspectionOnly: true, ledgerPresent,
    schema: { chequePaymentLink: paymentLink, chequeBankLink: bankLink, transfersPresent }, ledgerConfigured,ledger,
    openingBalancesVerified:false,policy:"review_required",checks,
    requiresReview:true };
}
