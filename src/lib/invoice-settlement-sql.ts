/** A cheque instrument is not settlement. Missing historical links are never inferred. */
export const SETTLED_PAYMENT = `(p.method NOT IN ('check','cheque') OR EXISTS
  (SELECT 1 FROM checks c WHERE c.payment_id=p.id AND c.status='passed'))`;

/** Internal SQL expressions only, never request data. Each aggregate is scoped
 * before summation: wrapping the UNION view in a correlated SUM may materialize
 * the entire union once per invoice in SQLite. Reuse this expression in both
 * domain reads and the compatibility view to retain one allocation formula. */
export function invoicePaidExpression(invoice: string, direction: string): string {
  return `(COALESCE((SELECT SUM(p.amount-COALESCE((SELECT SUM(r.amount) FROM refunds r WHERE r.payment_id=p.id),0))
    FROM payments p WHERE p.invoice_id=${invoice} AND p.direction=${direction} AND ${SETTLED_PAYMENT}),0)
    + CASE WHEN ${direction}='in' THEN
      COALESCE((SELECT SUM(a.remaining) FROM active_customer_credit a WHERE a.invoice_id=${invoice}),0)
      - COALESCE((SELECT SUM(a.remaining) FROM active_customer_credit a WHERE a.source_invoice_id=${invoice}),0)
    ELSE 0 END)`;
}
