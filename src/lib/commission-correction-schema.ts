export const COMMISSION_CORRECTION_DDL=`
CREATE TABLE IF NOT EXISTS commission_corrections(
 id INTEGER PRIMARY KEY,run_id INTEGER NOT NULL REFERENCES payroll_runs(id),branch_id INTEGER NOT NULL REFERENCES branches(id),
 user_id INTEGER NOT NULL REFERENCES users(id),kind TEXT NOT NULL CHECK(kind IN ('reduction','reinstatement','recovery')),
 reverses_id INTEGER REFERENCES commission_corrections(id),amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0 AND amount<=9007199254740991),
 expense_account TEXT NOT NULL,liability_amount INTEGER NOT NULL,recovery_amount INTEGER NOT NULL,posting_date TEXT NOT NULL,
 reason TEXT NOT NULL,evidence_reference TEXT NOT NULL,basis_hash TEXT NOT NULL,snapshot_json TEXT NOT NULL,snapshot_hash TEXT NOT NULL,
 proposed_by INTEGER NOT NULL REFERENCES users(id),approved_by INTEGER REFERENCES users(id),approved_at TEXT,
 state TEXT NOT NULL DEFAULT 'proposed' CHECK(state IN ('proposed','approved','posted','rejected')),
 settlement_reference TEXT,journal_id INTEGER UNIQUE REFERENCES accounting_journals(id),created_at TEXT NOT NULL DEFAULT(datetime('now')),
 CHECK(approved_by IS NULL OR (approved_by!=proposed_by AND approved_by!=user_id)),
 CHECK((kind='reinstatement' AND reverses_id IS NOT NULL) OR (kind!='reinstatement' AND reverses_id IS NULL)),
 CHECK(liability_amount>=0 AND recovery_amount>=0 AND liability_amount+recovery_amount=amount)
);
CREATE INDEX IF NOT EXISTS idx_commission_correction_run ON commission_corrections(run_id,state,id);
CREATE INDEX IF NOT EXISTS idx_commission_correction_branch ON commission_corrections(branch_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_commission_recovery_reference ON commission_corrections(run_id,settlement_reference) WHERE kind='recovery' AND state='posted';
CREATE VIEW IF NOT EXISTS commission_positions AS WITH totals AS(
 SELECT r.id run_id,r.user_id,r.earned_commission,r.net_payable,
 COALESCE((SELECT SUM(amount) FROM commission_payments WHERE run_id=r.id),0) paid,
 COALESCE((SELECT SUM(CASE WHEN kind='reduction' THEN amount WHEN kind='reinstatement' THEN -amount ELSE 0 END) FROM commission_corrections WHERE run_id=r.id AND state='posted'),0) reduction,
 COALESCE((SELECT SUM(amount) FROM commission_corrections WHERE run_id=r.id AND kind='recovery' AND state='posted'),0) recovered
 FROM payroll_runs r
 ) SELECT *,earned_commission-reduction effective_commission,net_payable-reduction effective_net,paid-recovered net_paid,
 MAX(0,net_payable-reduction-paid+recovered) payable,MAX(0,paid-recovered-net_payable+reduction) recoverable FROM totals;
CREATE TRIGGER IF NOT EXISTS commission_correction_initial BEFORE INSERT ON commission_corrections WHEN NEW.state!='proposed' OR NEW.approved_by IS NOT NULL OR NEW.journal_id IS NOT NULL OR NEW.settlement_reference IS NOT NULL BEGIN SELECT RAISE(ABORT,'Correction starts as an independent proposal'); END;
CREATE TRIGGER IF NOT EXISTS commission_correction_locked BEFORE UPDATE ON commission_corrections BEGIN
 SELECT CASE WHEN NEW.run_id!=OLD.run_id OR NEW.branch_id!=OLD.branch_id OR NEW.user_id!=OLD.user_id OR NEW.kind!=OLD.kind OR NEW.reverses_id IS NOT OLD.reverses_id
 OR NEW.amount!=OLD.amount OR NEW.expense_account!=OLD.expense_account OR NEW.liability_amount!=OLD.liability_amount OR NEW.recovery_amount!=OLD.recovery_amount OR NEW.posting_date!=OLD.posting_date
 OR NEW.reason!=OLD.reason OR NEW.evidence_reference!=OLD.evidence_reference OR NEW.basis_hash!=OLD.basis_hash OR NEW.snapshot_json!=OLD.snapshot_json OR NEW.snapshot_hash!=OLD.snapshot_hash
 OR NEW.proposed_by!=OLD.proposed_by OR NEW.created_at!=OLD.created_at
 OR NOT ((OLD.state='proposed' AND NEW.state='approved' AND NEW.approved_by!=OLD.proposed_by AND NEW.approved_by!=OLD.user_id AND NEW.approved_at IS NOT NULL AND NEW.journal_id IS NULL AND NEW.settlement_reference IS NULL)
 OR (OLD.state='proposed' AND NEW.state='rejected' AND NEW.approved_by IS NULL AND NEW.journal_id IS NULL AND NEW.settlement_reference IS NULL)
 OR (OLD.state='approved' AND NEW.state='posted' AND NEW.approved_by IS OLD.approved_by AND NEW.approved_at IS OLD.approved_at AND NEW.journal_id IS NOT NULL AND (NEW.kind='recovery' OR NEW.settlement_reference IS NULL)))
 THEN RAISE(ABORT,'Commission correction evidence is immutable') END;
END;
CREATE TRIGGER IF NOT EXISTS commission_correction_no_delete BEFORE DELETE ON commission_corrections BEGIN SELECT RAISE(ABORT,'Commission correction history cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS commission_correction_post BEFORE UPDATE OF state ON commission_corrections WHEN NEW.state='posted' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM accounting_events e JOIN accounting_event_reviews r ON r.event_id=e.id JOIN accounting_journals j ON j.id=r.journal_id
 WHERE e.source_type='commission_correction' AND e.source_id=CAST(NEW.id AS TEXT) AND j.id=NEW.journal_id AND j.state='posted' AND j.branch_id=NEW.branch_id)
 THEN RAISE(ABORT,'Correction requires its posted source journal') END;
 SELECT CASE WHEN NEW.kind='reduction' AND NEW.amount>(SELECT effective_commission FROM commission_positions WHERE run_id=NEW.run_id) THEN RAISE(ABORT,'Reduction exceeds earned commission') END;
 SELECT CASE WHEN NEW.kind='recovery' AND (NEW.amount>(SELECT recoverable FROM commission_positions WHERE run_id=NEW.run_id) OR length(trim(COALESCE(NEW.settlement_reference,'')))<5) THEN RAISE(ABORT,'Recovery exceeds approved claim or lacks settlement evidence') END;
 SELECT CASE WHEN NEW.kind='reinstatement' AND NOT EXISTS(SELECT 1 FROM commission_corrections c WHERE c.id=NEW.reverses_id AND c.run_id=NEW.run_id AND c.kind='reduction' AND c.state='posted'
 AND NEW.amount<=c.amount-COALESCE((SELECT SUM(amount) FROM commission_corrections WHERE reverses_id=c.id AND state='posted'),0)) THEN RAISE(ABORT,'Reinstatement exceeds corrected commission') END;
END;
DROP TRIGGER IF EXISTS commission_payment_valid;
CREATE TRIGGER commission_payment_valid BEFORE INSERT ON commission_payments BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM payroll_runs r LEFT JOIN commission_approvals a ON a.run_id=r.id WHERE r.id=NEW.run_id AND r.user_id=NEW.user_id AND COALESCE(r.branch_id,a.branch_id)=NEW.branch_id
 AND ((a.amount=r.net_payable AND r.status IN ('approved','partially_paid')) OR EXISTS(SELECT 1 FROM commission_corrections c WHERE c.run_id=r.id AND c.kind IN ('reduction','reinstatement') AND c.state='posted' AND c.branch_id=NEW.branch_id)))
 THEN RAISE(ABORT,'Valid commission approval required') END;
 SELECT CASE WHEN NEW.amount>(SELECT payable FROM commission_positions WHERE run_id=NEW.run_id) THEN RAISE(ABORT,'Commission payment exceeds approved capacity') END;
 SELECT CASE WHEN date(NEW.payment_date) IS NULL OR length(NEW.payment_date)!=10 OR date(NEW.payment_date)!=NEW.payment_date OR length(trim(NEW.document_reference))<3 THEN RAISE(ABORT,'Invalid commission settlement evidence') END;
END;
DROP TRIGGER IF EXISTS commission_paid_requires_documents;
CREATE TRIGGER commission_paid_requires_documents BEFORE UPDATE OF status ON payroll_runs WHEN NEW.status='paid' AND OLD.status!='paid' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM commission_positions p WHERE p.run_id=NEW.id AND p.payable=0 AND p.recoverable=0 AND p.net_paid=p.effective_net)
 OR (NOT EXISTS(SELECT 1 FROM commission_approvals WHERE run_id=NEW.id) AND NOT EXISTS(SELECT 1 FROM commission_corrections WHERE run_id=NEW.id AND state='posted'))
 THEN RAISE(ABORT,'Paid status requires actual settlement documents') END;
END;
CREATE TRIGGER IF NOT EXISTS commission_corrected_run_locked BEFORE UPDATE ON payroll_runs WHEN
 (NEW.user_id IS NOT OLD.user_id OR NEW.branch_id IS NOT OLD.branch_id OR NEW.base_salary IS NOT OLD.base_salary OR NEW.earned_commission IS NOT OLD.earned_commission OR NEW.deductions IS NOT OLD.deductions OR NEW.net_payable IS NOT OLD.net_payable OR NEW.source_ticket_id IS NOT OLD.source_ticket_id)
 AND EXISTS(SELECT 1 FROM commission_corrections WHERE run_id=OLD.id AND state IN ('approved','posted')) BEGIN SELECT RAISE(ABORT,'Corrected compensation source is immutable'); END;
`;
