import type { DatabaseSync } from 'node:sqlite';
import { rial,sumRial } from '@/lib/money';
import { SETTLED_PAYMENT,invoicePaidExpression } from '@/lib/invoice-settlement-sql';
/** Original immutable invoice amount stays on invoices.total. Only posted,
 * unreversed adjustments reduce the authoritative obligation. */
export function invoiceObligation(db:DatabaseSync,id:number){
 const original=db.prepare('SELECT total FROM invoices WHERE id=?').get(id);
 if(!original)throw new Error('فاکتور یافت نشد.');
 const credits=sumRial(db.prepare("SELECT amount FROM credit_notes WHERE invoice_id=? AND status='posted'").all(id).map(row=>rial(row.amount)));
 const total=rial(original.total);if(credits>total)throw new Error('اعتبارنامه‌ها از اصل فاکتور بیشترند.');
 return {original_total:total,credit_total:credits,effective_total:total-credits};
}
/** Read-side compatibility view: explicit original_total and credit_total,
 * total is the effective obligation. Never use this view to rewrite sources. */
export function initializeEffectiveInvoiceView(db:DatabaseSync){
 const fields=db.prepare('PRAGMA table_info(invoices)').all().map(c=>String(c.name));
 const columns=fields.filter(c=>c!=='total'&&c!=='paid').map(c=>`i."${c.replaceAll('"','""')}"`).join(',');
 // Keep each lookup correlated to its invoice/payment. Aggregated LEFT JOINs
 // materialize unrelated financial history even for WHERE id=?, prolonging
 // the writer lock during settlement. All consumers still share these views.
 const credits="COALESCE((SELECT SUM(c.amount) FROM credit_notes c WHERE c.invoice_id=i.id AND c.status='posted'),0)";
 db.exec(`DROP VIEW IF EXISTS invoice_settlements; CREATE VIEW invoice_settlements AS
 SELECT p.invoice_id,p.direction,p.amount-COALESCE((SELECT SUM(r.amount) FROM refunds r WHERE r.payment_id=p.id),0) amount FROM payments p WHERE ${SETTLED_PAYMENT}
 UNION ALL SELECT source_invoice_id,'in',-remaining FROM active_customer_credit WHERE source_invoice_id IS NOT NULL
 UNION ALL SELECT invoice_id,'in',remaining FROM active_customer_credit;
 DROP VIEW IF EXISTS effective_invoices; CREATE VIEW effective_invoices AS SELECT ${columns},i.total original_total,i.paid stored_paid,
 ${invoicePaidExpression('i.id',"CASE WHEN i.type='purchase' THEN 'out' ELSE 'in' END")} paid,
 ${credits} credit_total,i.total-${credits} total FROM invoices i`);
 db.exec(`DROP VIEW IF EXISTS party_balance_events; CREATE VIEW party_balance_events AS
 SELECT CASE WHEN type='purchase' THEN 'supplier' ELSE 'customer' END kind,CASE WHEN type='purchase' THEN supplier_id ELSE customer_id END party_id,branch_id,total amount
 FROM effective_invoices WHERE status NOT IN ('draft','cancelled')
 UNION ALL SELECT 'customer',s.customer_id,s.branch_id,s.total FROM sales s WHERE s.status!='cancelled'
 AND NOT EXISTS(SELECT 1 FROM invoices i WHERE i.sale_id=s.id AND i.status NOT IN ('draft','cancelled'))
 UNION ALL SELECT CASE WHEN p.direction='out' THEN 'supplier' ELSE 'customer' END,CASE WHEN p.direction='out' THEN p.supplier_id ELSE p.customer_id END,p.branch_id,-p.amount
 FROM payments p WHERE p.direction IN ('in','out') AND ${SETTLED_PAYMENT}
 UNION ALL SELECT CASE WHEN p.direction='out' THEN 'supplier' ELSE 'customer' END,CASE WHEN p.direction='out' THEN p.supplier_id ELSE p.customer_id END,r.branch_id,r.amount
 FROM refunds r JOIN payments p ON p.id=r.payment_id WHERE p.direction IN ('in','out') AND ${SETTLED_PAYMENT}`);
}
