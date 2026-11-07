/** Durable allocations transfer existing funds; they never manufacture receipts. */
export const CUSTOMER_CREDIT_DDL=`
CREATE TABLE IF NOT EXISTS customer_credit_operations(
 id INTEGER PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('allocation','reversal')),
 reverses_id INTEGER REFERENCES customer_credit_operations(id),payment_id INTEGER NOT NULL REFERENCES payments(id),
 invoice_id INTEGER NOT NULL REFERENCES invoices(id),source_invoice_id INTEGER REFERENCES invoices(id),installment_id INTEGER REFERENCES installments(id),
 branch_id INTEGER NOT NULL REFERENCES branches(id),customer_id INTEGER NOT NULL REFERENCES customers(id),
 amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0 AND amount<=9007199254740991),
 source_account TEXT NOT NULL CHECK(source_account IN ('1100','2010')),posting_date TEXT NOT NULL,
 reason TEXT NOT NULL,evidence_reference TEXT NOT NULL,snapshot_json TEXT NOT NULL,snapshot_hash TEXT NOT NULL,
 proposed_by INTEGER NOT NULL REFERENCES users(id),approved_by INTEGER REFERENCES users(id),approved_at TEXT,
 state TEXT NOT NULL DEFAULT 'proposed' CHECK(state IN ('proposed','approved','posted','rejected')),
 journal_id INTEGER UNIQUE REFERENCES accounting_journals(id),created_at TEXT NOT NULL DEFAULT(datetime('now')),
 CHECK(approved_by IS NULL OR approved_by!=proposed_by),CHECK((kind='allocation' AND reverses_id IS NULL) OR (kind='reversal' AND reverses_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_customer_credit_source ON customer_credit_operations(payment_id,state,id);
CREATE INDEX IF NOT EXISTS idx_customer_credit_invoice ON customer_credit_operations(invoice_id,state,id);
CREATE INDEX IF NOT EXISTS idx_customer_credit_branch ON customer_credit_operations(branch_id,customer_id,id);
CREATE INDEX IF NOT EXISTS idx_customer_credit_reversal ON customer_credit_operations(reverses_id,state);
CREATE TABLE IF NOT EXISTS customer_credit_refunds(
 id INTEGER PRIMARY KEY,refund_id INTEGER NOT NULL UNIQUE REFERENCES refunds(id),payment_id INTEGER NOT NULL REFERENCES payments(id),
 branch_id INTEGER NOT NULL REFERENCES branches(id),customer_id INTEGER NOT NULL REFERENCES customers(id),amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0),
 source_account TEXT NOT NULL CHECK(source_account IN ('1100','2010')),document_reference TEXT NOT NULL,
 recorded_by INTEGER NOT NULL REFERENCES users(id),journal_id INTEGER NOT NULL UNIQUE REFERENCES accounting_journals(id),
 created_at TEXT NOT NULL DEFAULT(datetime('now')),UNIQUE(payment_id,document_reference)
);
CREATE TRIGGER IF NOT EXISTS customer_credit_refund_no_update BEFORE UPDATE ON customer_credit_refunds BEGIN SELECT RAISE(ABORT,'Credit refund evidence is immutable'); END;
CREATE TRIGGER IF NOT EXISTS customer_credit_refund_no_delete BEFORE DELETE ON customer_credit_refunds BEGIN SELECT RAISE(ABORT,'Credit refund evidence cannot be deleted'); END;
CREATE VIEW IF NOT EXISTS active_customer_credit AS SELECT a.*,
 a.amount-COALESCE((SELECT SUM(r.amount) FROM customer_credit_operations r WHERE r.reverses_id=a.id AND r.state='posted'),0) remaining
 FROM customer_credit_operations a WHERE a.kind='allocation' AND a.state='posted';
CREATE TRIGGER IF NOT EXISTS customer_credit_initial BEFORE INSERT ON customer_credit_operations
 WHEN NEW.state!='proposed' OR NEW.approved_by IS NOT NULL OR NEW.journal_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'Credit starts as an independent proposal'); END;
CREATE TRIGGER IF NOT EXISTS customer_credit_locked BEFORE UPDATE ON customer_credit_operations BEGIN
 SELECT CASE WHEN NEW.kind!=OLD.kind OR NEW.reverses_id IS NOT OLD.reverses_id OR NEW.payment_id!=OLD.payment_id OR NEW.invoice_id!=OLD.invoice_id
 OR NEW.source_invoice_id IS NOT OLD.source_invoice_id OR NEW.installment_id IS NOT OLD.installment_id OR NEW.branch_id!=OLD.branch_id OR NEW.customer_id!=OLD.customer_id
 OR NEW.amount!=OLD.amount OR NEW.source_account!=OLD.source_account OR NEW.posting_date!=OLD.posting_date OR NEW.reason!=OLD.reason OR NEW.evidence_reference!=OLD.evidence_reference
 OR NEW.snapshot_json!=OLD.snapshot_json OR NEW.snapshot_hash!=OLD.snapshot_hash OR NEW.proposed_by!=OLD.proposed_by OR NEW.created_at!=OLD.created_at
 OR NOT ((OLD.state='proposed' AND NEW.state='approved' AND NEW.approved_by!=OLD.proposed_by AND NEW.approved_at IS NOT NULL AND NEW.journal_id IS NULL)
 OR (OLD.state='proposed' AND NEW.state='rejected' AND NEW.approved_by IS NULL AND NEW.journal_id IS NULL)
 OR (OLD.state='approved' AND NEW.state='posted' AND NEW.approved_by IS OLD.approved_by AND NEW.approved_at IS OLD.approved_at AND NEW.journal_id IS NOT NULL))
 THEN RAISE(ABORT,'Credit history or approval is immutable') END;
END;
CREATE TRIGGER IF NOT EXISTS customer_credit_no_delete BEFORE DELETE ON customer_credit_operations BEGIN SELECT RAISE(ABORT,'Credit history cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS customer_credit_post_guard BEFORE UPDATE OF state ON customer_credit_operations WHEN NEW.state='posted' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM accounting_events e JOIN accounting_event_reviews r ON r.event_id=e.id JOIN accounting_journals j ON j.id=r.journal_id
 WHERE e.source_type='customer_credit' AND e.source_id=CAST(NEW.id AS TEXT) AND j.id=NEW.journal_id AND j.state='posted' AND j.branch_id=NEW.branch_id)
 THEN RAISE(ABORT,'Credit requires its posted source journal') END;
 SELECT CASE WHEN NEW.kind='allocation' AND NOT EXISTS(SELECT 1 FROM installment_receipt_funds p JOIN effective_invoices i ON i.id=NEW.invoice_id
 WHERE p.id=NEW.payment_id AND p.settled=1 AND p.direction='in' AND p.method!='other' AND p.branch_id=NEW.branch_id AND p.customer_id=NEW.customer_id
 AND i.branch_id=NEW.branch_id AND i.customer_id=NEW.customer_id AND i.type!='purchase' AND i.status NOT IN ('draft','cancelled') AND p.invoice_id IS NEW.source_invoice_id
 AND NEW.amount<=p.amount-p.refunded-p.allocated-p.credit_used
 AND NEW.amount<=i.total-i.paid-COALESCE((SELECT SUM(q.amount) FROM payments q JOIN checks c ON c.payment_id=q.id WHERE q.invoice_id=i.id AND q.direction='in' AND c.status IN ('in_hand','deposited','transferred_spend')),0)
 AND (NEW.source_invoice_id IS NULL OR NEW.amount<=(SELECT paid-total FROM effective_invoices WHERE id=NEW.source_invoice_id)))
 THEN RAISE(ABORT,'Credit exceeds available funds or invoice obligation') END;
 SELECT CASE WHEN NEW.kind='reversal' AND NOT EXISTS(SELECT 1 FROM active_customer_credit a WHERE a.id=NEW.reverses_id AND a.remaining>=NEW.amount
 AND a.payment_id=NEW.payment_id AND a.invoice_id=NEW.invoice_id AND a.branch_id=NEW.branch_id AND a.customer_id=NEW.customer_id AND a.source_account=NEW.source_account)
 THEN RAISE(ABORT,'Credit reversal exceeds eligible allocation') END;
END;
CREATE TRIGGER IF NOT EXISTS customer_credit_invoice_owner BEFORE UPDATE OF customer_id,branch_id ON invoices
 WHEN (NEW.customer_id IS NOT OLD.customer_id OR NEW.branch_id IS NOT OLD.branch_id) AND EXISTS(SELECT 1 FROM customer_credit_operations WHERE invoice_id=OLD.id OR source_invoice_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'Credit document ownership is immutable'); END;
CREATE TRIGGER IF NOT EXISTS customer_credit_receipt_link BEFORE UPDATE OF invoice_id,customer_id,branch_id,amount,direction,method ON payments
 WHEN (NEW.invoice_id IS NOT OLD.invoice_id OR NEW.customer_id IS NOT OLD.customer_id OR NEW.branch_id IS NOT OLD.branch_id OR NEW.amount IS NOT OLD.amount OR NEW.direction IS NOT OLD.direction OR NEW.method IS NOT OLD.method)
 AND EXISTS(SELECT 1 FROM active_customer_credit WHERE payment_id=OLD.id AND remaining>0)
 BEGIN SELECT RAISE(ABORT,'Allocated receipt identity cannot change'); END;
`;
