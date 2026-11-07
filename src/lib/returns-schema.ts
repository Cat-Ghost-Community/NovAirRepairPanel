export const RETURNS_DDL = `
DROP TRIGGER IF EXISTS credit_locked;
DROP TRIGGER IF EXISTS credit_line_locked;
DROP TRIGGER IF EXISTS credit_line_no_delete;
DROP TRIGGER IF EXISTS credit_budget;
DROP TRIGGER IF EXISTS return_line_eligible;
DROP TRIGGER IF EXISTS return_line_identity;
DROP TRIGGER IF EXISTS return_state_transition;
CREATE TABLE IF NOT EXISTS business_returns (
 id INTEGER PRIMARY KEY, number TEXT NOT NULL UNIQUE, invoice_id INTEGER NOT NULL REFERENCES invoices(id),
 branch_id INTEGER NOT NULL REFERENCES branches(id), kind TEXT NOT NULL CHECK(kind IN ('customer','supplier')),
 reason TEXT NOT NULL, delivery_reference TEXT NOT NULL, requested_by INTEGER NOT NULL REFERENCES users(id),
 authorized_by INTEGER REFERENCES users(id), receipt_reference TEXT, inspection_reference TEXT,
 state TEXT NOT NULL DEFAULT 'requested' CHECK(state IN ('requested','authorized','received','inspected','disposed','dispatched','credit_pending','completed','rejected')),
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_returns_invoice ON business_returns(invoice_id,state);
CREATE INDEX IF NOT EXISTS idx_returns_branch ON business_returns(branch_id,id);
CREATE TABLE IF NOT EXISTS business_return_lines (
 id INTEGER PRIMARY KEY, return_id INTEGER NOT NULL REFERENCES business_returns(id), invoice_item_id INTEGER NOT NULL REFERENCES invoice_items(id),
 part_id INTEGER NOT NULL REFERENCES parts(id), qty_micro INTEGER NOT NULL CHECK(typeof(qty_micro)='integer' AND qty_micro>0 AND qty_micro<=9007199254740991),
 unit_price INTEGER NOT NULL, unit_cost INTEGER NOT NULL, gross_limit INTEGER NOT NULL,
 disposition TEXT CHECK(disposition IN ('restock','damaged','disposed','quarantined','rejected','supplier')),
 inspection_note TEXT, location_id INTEGER REFERENCES inventory_locations(id), movement_id INTEGER UNIQUE REFERENCES inventory_movements(id),
 UNIQUE(return_id,invoice_item_id)
);
CREATE INDEX IF NOT EXISTS idx_return_line_source ON business_return_lines(invoice_item_id,return_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_return_stock_identity ON inventory_movements(ref_id) WHERE ref_type='business_return';
CREATE TABLE IF NOT EXISTS credit_notes (
 id INTEGER PRIMARY KEY, number TEXT NOT NULL UNIQUE, return_id INTEGER NOT NULL REFERENCES business_returns(id),
 replaces_note_id INTEGER REFERENCES credit_notes(id),
 invoice_id INTEGER NOT NULL REFERENCES invoices(id), branch_id INTEGER NOT NULL REFERENCES branches(id),
 customer_id INTEGER REFERENCES customers(id), supplier_id INTEGER REFERENCES suppliers(id),
 amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0 AND amount<=9007199254740991),
 net_amount INTEGER NOT NULL CHECK(typeof(net_amount)='integer' AND net_amount>=0), tax_amount INTEGER NOT NULL DEFAULT 0 CHECK(typeof(tax_amount)='integer' AND tax_amount>=0),
 reason TEXT NOT NULL, evidence_reference TEXT NOT NULL, requested_by INTEGER NOT NULL REFERENCES users(id), approved_by INTEGER REFERENCES users(id),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','posted','reversed','void')),
 journal_id INTEGER UNIQUE REFERENCES accounting_journals(id), reversal_id INTEGER UNIQUE REFERENCES accounting_journals(id),
 created_at TEXT NOT NULL DEFAULT (datetime('now')), CHECK(amount=net_amount+tax_amount), CHECK(approved_by IS NULL OR approved_by!=requested_by)
);
CREATE INDEX IF NOT EXISTS idx_credit_invoice ON credit_notes(invoice_id,status);
CREATE TABLE IF NOT EXISTS credit_note_lines (
 id INTEGER PRIMARY KEY, note_id INTEGER NOT NULL REFERENCES credit_notes(id), return_line_id INTEGER NOT NULL REFERENCES business_return_lines(id),
 net_amount INTEGER NOT NULL CHECK(typeof(net_amount)='integer' AND net_amount>=0), UNIQUE(note_id,return_line_id)
);
CREATE TABLE IF NOT EXISTS return_settlements (
 id INTEGER PRIMARY KEY, return_id INTEGER NOT NULL REFERENCES business_returns(id), refund_id INTEGER NOT NULL UNIQUE REFERENCES refunds(id),
 amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0), recorded_by INTEGER NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS service_credit_documents (
 return_id INTEGER PRIMARY KEY REFERENCES business_returns(id),original_journal_id INTEGER NOT NULL REFERENCES accounting_journals(id),
 revenue_account TEXT NOT NULL REFERENCES accounting_accounts(code),source_json TEXT NOT NULL,source_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS service_credit_lines (
 id INTEGER PRIMARY KEY,note_id INTEGER NOT NULL REFERENCES credit_notes(id),invoice_item_id INTEGER NOT NULL REFERENCES invoice_items(id),
 net_amount INTEGER NOT NULL CHECK(typeof(net_amount)='integer' AND net_amount>0 AND net_amount<=9007199254740991),UNIQUE(note_id,invoice_item_id)
);
CREATE INDEX IF NOT EXISTS idx_service_credit_item ON service_credit_lines(invoice_item_id,note_id);
CREATE TRIGGER IF NOT EXISTS service_credit_source_update BEFORE UPDATE ON service_credit_documents BEGIN SELECT RAISE(ABORT,'Service correction source is immutable'); END;
CREATE TRIGGER IF NOT EXISTS service_credit_source_delete BEFORE DELETE ON service_credit_documents BEGIN SELECT RAISE(ABORT,'Service correction evidence cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS service_credit_no_physical BEFORE INSERT ON business_return_lines WHEN EXISTS(SELECT 1 FROM service_credit_documents WHERE return_id=NEW.return_id) BEGIN SELECT RAISE(ABORT,'Service corrections cannot create physical return lines'); END;
CREATE TRIGGER IF NOT EXISTS service_credit_state BEFORE UPDATE OF state ON business_returns WHEN EXISTS(SELECT 1 FROM service_credit_documents WHERE return_id=OLD.id) AND NEW.state IN ('received','inspected','disposed','dispatched') BEGIN SELECT RAISE(ABORT,'Service corrections have no physical receipt or disposition'); END;
CREATE TRIGGER IF NOT EXISTS service_credit_line_insert BEFORE INSERT ON service_credit_lines BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM credit_notes n JOIN service_credit_documents d ON d.return_id=n.return_id JOIN invoice_items i ON i.invoice_id=n.invoice_id
 WHERE n.id=NEW.note_id AND n.status='draft' AND i.id=NEW.invoice_item_id AND i.kind IN ('service','labor','fee') AND NEW.net_amount<=i.total)
 THEN RAISE(ABORT,'Service credit must reference an eligible original service line') END;
END;
CREATE TRIGGER IF NOT EXISTS service_credit_line_update BEFORE UPDATE ON service_credit_lines BEGIN SELECT RAISE(ABORT,'Service correction line must be replaced in draft'); END;
CREATE TRIGGER IF NOT EXISTS service_credit_line_delete BEFORE DELETE ON service_credit_lines WHEN (SELECT status FROM credit_notes WHERE id=OLD.note_id)!='draft' BEGIN SELECT RAISE(ABORT,'Posted service credit is immutable'); END;
CREATE INDEX IF NOT EXISTS idx_return_settlement ON return_settlements(return_id);
CREATE TRIGGER IF NOT EXISTS return_line_eligible BEFORE INSERT ON business_return_lines BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM invoice_items i JOIN business_returns r ON r.id=NEW.return_id
 WHERE i.id=NEW.invoice_item_id AND i.invoice_id=r.invoice_id AND i.kind='part' AND i.ref_id=NEW.part_id AND r.state='requested'
 AND NEW.qty_micro+COALESCE((SELECT SUM(l.qty_micro) FROM business_return_lines l JOIN business_returns prior ON prior.id=l.return_id
 WHERE l.invoice_item_id=i.id AND prior.state!='rejected' AND l.rejection_release_reference IS NULL),0)<=ROUND(i.qty*1000000)) THEN RAISE(ABORT,'Return quantity exceeds original eligible quantity') END;
END;
CREATE TRIGGER IF NOT EXISTS return_line_identity BEFORE UPDATE ON business_return_lines BEGIN
 SELECT CASE WHEN NEW.return_id!=OLD.return_id OR NEW.invoice_item_id!=OLD.invoice_item_id OR NEW.part_id!=OLD.part_id OR NEW.qty_micro!=OLD.qty_micro
 OR NEW.unit_price!=OLD.unit_price OR NEW.unit_cost!=OLD.unit_cost OR NEW.gross_limit!=OLD.gross_limit
 OR OLD.movement_id IS NOT NULL OR OLD.rejection_release_reference IS NOT NULL OR (SELECT state FROM business_returns WHERE id=OLD.return_id) NOT IN ('authorized','received','inspected') THEN RAISE(ABORT,'Return source or disposed line is immutable') END;
END;
CREATE TRIGGER IF NOT EXISTS return_line_no_delete BEFORE DELETE ON business_return_lines BEGIN SELECT RAISE(ABORT,'Return evidence cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS return_header_identity BEFORE UPDATE ON business_returns BEGIN
 SELECT CASE WHEN NEW.invoice_id!=OLD.invoice_id OR NEW.branch_id!=OLD.branch_id OR NEW.kind!=OLD.kind OR NEW.reason!=OLD.reason
 OR NEW.delivery_reference!=OLD.delivery_reference OR NEW.requested_by!=OLD.requested_by OR NEW.number!=OLD.number
 THEN RAISE(ABORT,'Return source is immutable') END;
END;
CREATE TRIGGER IF NOT EXISTS return_state_transition BEFORE UPDATE OF state ON business_returns WHEN OLD.state!=NEW.state BEGIN
 SELECT CASE WHEN NOT ((OLD.state='requested' AND NEW.state IN ('authorized','rejected')) OR (OLD.state='authorized' AND NEW.state IN ('received','inspected'))
 OR (OLD.state='received' AND NEW.state IN ('inspected','credit_pending')) OR (OLD.state='inspected' AND NEW.state IN ('disposed','dispatched'))
 OR (OLD.state='dispatched' AND NEW.state='received') OR (OLD.state='disposed' AND NEW.state='credit_pending')
 OR (OLD.state='authorized' AND NEW.state='credit_pending' AND EXISTS(SELECT 1 FROM service_credit_documents WHERE return_id=OLD.id))
 OR (OLD.state='inspected' AND NEW.state='rejected' AND NOT EXISTS(SELECT 1 FROM business_return_lines WHERE return_id=OLD.id AND (disposition!='rejected' OR rejection_release_reference IS NULL))) OR (OLD.state='credit_pending' AND NEW.state='completed') OR (OLD.state='completed' AND NEW.state='credit_pending')) THEN RAISE(ABORT,'Invalid return state transition') END;
END;
CREATE TRIGGER IF NOT EXISTS return_no_delete BEFORE DELETE ON business_returns BEGIN SELECT RAISE(ABORT,'Return history cannot be deleted'); END;
DROP TRIGGER IF EXISTS credit_initial;
CREATE TRIGGER IF NOT EXISTS credit_initial BEFORE INSERT ON credit_notes WHEN NEW.status!='draft' OR NEW.approved_by IS NOT NULL OR NEW.journal_id IS NOT NULL OR NEW.reversal_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'Credit starts as an unapproved draft'); END;
CREATE TRIGGER IF NOT EXISTS credit_replacement_initial BEFORE INSERT ON credit_notes WHEN NEW.replaces_note_id IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM credit_notes n WHERE n.id=NEW.replaces_note_id AND n.status='reversed' AND n.reversal_id IS NOT NULL AND n.return_id=NEW.return_id AND n.invoice_id=NEW.invoice_id AND n.branch_id=NEW.branch_id)
 THEN RAISE(ABORT,'Replacement requires a reversed original credit') END;
END;
CREATE TRIGGER IF NOT EXISTS credit_budget BEFORE UPDATE OF status ON credit_notes WHEN NEW.status IN ('approved','posted') BEGIN
 SELECT CASE WHEN NEW.net_amount!=(SELECT COALESCE(SUM(net_amount),0) FROM credit_note_lines WHERE note_id=NEW.id)+(SELECT COALESCE(SUM(net_amount),0) FROM service_credit_lines WHERE note_id=NEW.id)
 THEN RAISE(ABORT,'Credit line totals disagree with note') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM service_credit_lines c JOIN invoice_items i ON i.id=c.invoice_item_id WHERE c.note_id=NEW.id
 AND c.net_amount+COALESCE((SELECT SUM(c2.net_amount) FROM service_credit_lines c2 JOIN credit_notes n2 ON n2.id=c2.note_id
 WHERE c2.invoice_item_id=i.id AND n2.id!=NEW.id AND n2.status IN ('approved','posted')),0)>i.total) THEN RAISE(ABORT,'Service credits exceed original line net amount') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM credit_note_lines c JOIN business_return_lines r ON r.id=c.return_line_id JOIN invoice_items i ON i.id=r.invoice_item_id
 WHERE c.note_id=NEW.id AND c.net_amount+COALESCE((SELECT SUM(c2.net_amount) FROM credit_note_lines c2 JOIN credit_notes n2 ON n2.id=c2.note_id JOIN business_return_lines r2 ON r2.id=c2.return_line_id
 WHERE n2.id!=NEW.id AND n2.status IN ('approved','posted') AND r2.invoice_item_id=i.id),0)>i.total) THEN RAISE(ABORT,'Credits exceed original line net amount') END;
 SELECT CASE WHEN NEW.amount+COALESCE((SELECT SUM(amount) FROM credit_notes WHERE invoice_id=NEW.invoice_id AND id!=NEW.id AND status IN ('approved','posted')),0)>
 (SELECT total FROM invoices WHERE id=NEW.invoice_id) THEN RAISE(ABORT,'Credits exceed original invoice') END;
 SELECT CASE WHEN NEW.tax_amount+COALESCE((SELECT SUM(tax_amount) FROM credit_notes WHERE invoice_id=NEW.invoice_id AND id!=NEW.id AND status IN ('approved','posted')),0)>
 (SELECT tax FROM invoices WHERE id=NEW.invoice_id) THEN RAISE(ABORT,'Tax credits exceed original tax') END;
END;
CREATE TRIGGER IF NOT EXISTS credit_locked BEFORE UPDATE ON credit_notes BEGIN
 SELECT CASE WHEN NEW.return_id!=OLD.return_id OR NEW.invoice_id!=OLD.invoice_id OR NEW.branch_id!=OLD.branch_id OR NEW.requested_by!=OLD.requested_by OR NEW.number!=OLD.number
 OR (OLD.status!='draft' AND (NEW.amount!=OLD.amount OR NEW.net_amount!=OLD.net_amount OR NEW.tax_amount!=OLD.tax_amount OR NEW.reason!=OLD.reason OR NEW.evidence_reference!=OLD.evidence_reference))
 OR NEW.customer_id IS NOT OLD.customer_id OR NEW.supplier_id IS NOT OLD.supplier_id OR NEW.replaces_note_id IS NOT OLD.replaces_note_id
 OR (OLD.status!='draft' AND NEW.approved_by IS NOT OLD.approved_by)
 OR NOT ((OLD.status='draft' AND NEW.status='draft' AND NEW.approved_by IS NULL AND NEW.journal_id IS NULL)
 OR (OLD.status='draft' AND NEW.status IN ('approved','void') AND NEW.approved_by!=OLD.requested_by)
 OR (OLD.status='approved' AND NEW.status='posted' AND NEW.approved_by IS OLD.approved_by AND NEW.journal_id IS NOT NULL)
 OR (OLD.status='posted' AND NEW.status='reversed' AND NEW.reversal_id IS NOT NULL AND NEW.journal_id IS OLD.journal_id))
 THEN RAISE(ABORT,'Invalid credit transition or immutable credit history') END;
END;
CREATE TRIGGER IF NOT EXISTS credit_no_delete BEFORE DELETE ON credit_notes BEGIN SELECT RAISE(ABORT,'Credit history cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS credit_line_locked BEFORE UPDATE ON credit_note_lines WHEN (SELECT status FROM credit_notes WHERE id=OLD.note_id)!='draft' BEGIN SELECT RAISE(ABORT,'Credit lines are immutable'); END;
CREATE TRIGGER IF NOT EXISTS credit_line_initial BEFORE INSERT ON credit_note_lines BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM credit_notes n JOIN business_return_lines r ON r.id=NEW.return_line_id WHERE n.id=NEW.note_id AND n.status='draft' AND n.return_id=r.return_id AND NEW.net_amount<=r.gross_limit)
 THEN RAISE(ABORT,'Invalid credit source line') END;
END;
CREATE TRIGGER IF NOT EXISTS credit_line_no_delete BEFORE DELETE ON credit_note_lines WHEN (SELECT status FROM credit_notes WHERE id=OLD.note_id)!='draft' BEGIN SELECT RAISE(ABORT,'Credit lines cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS return_settlement_locked BEFORE UPDATE ON return_settlements BEGIN SELECT RAISE(ABORT,'Refund evidence is immutable'); END;
CREATE TRIGGER IF NOT EXISTS return_settlement_no_delete BEFORE DELETE ON return_settlements BEGIN SELECT RAISE(ABORT,'Refund evidence cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS return_original_invoice BEFORE UPDATE ON invoices
WHEN EXISTS(SELECT 1 FROM business_returns WHERE invoice_id=OLD.id) BEGIN
 SELECT CASE WHEN NEW.total IS NOT OLD.total OR NEW.subtotal IS NOT OLD.subtotal OR NEW.tax IS NOT OLD.tax OR NEW.discount IS NOT OLD.discount
 OR NEW.customer_id IS NOT OLD.customer_id OR NEW.supplier_id IS NOT OLD.supplier_id OR NEW.type IS NOT OLD.type OR NEW.branch_id IS NOT OLD.branch_id
 OR NEW.sale_id IS NOT OLD.sale_id OR NEW.ticket_id IS NOT OLD.ticket_id OR NEW.purchase_order_id IS NOT OLD.purchase_order_id
 THEN RAISE(ABORT,'Original return invoice is immutable') END;
END;
CREATE TRIGGER IF NOT EXISTS return_original_lines_update BEFORE UPDATE ON invoice_items WHEN EXISTS(SELECT 1 FROM business_returns WHERE invoice_id=OLD.invoice_id) BEGIN SELECT RAISE(ABORT,'Original return lines are immutable'); END;
CREATE TRIGGER IF NOT EXISTS return_original_lines_delete BEFORE DELETE ON invoice_items WHEN EXISTS(SELECT 1 FROM business_returns WHERE invoice_id=OLD.invoice_id) BEGIN SELECT RAISE(ABORT,'Original return lines cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS return_original_lines_insert BEFORE INSERT ON invoice_items WHEN EXISTS(SELECT 1 FROM business_returns WHERE invoice_id=NEW.invoice_id) BEGIN SELECT RAISE(ABORT,'Original return lines cannot be extended'); END;
`;
