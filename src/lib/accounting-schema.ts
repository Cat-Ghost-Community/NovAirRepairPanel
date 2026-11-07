import { ACCOUNTING_V4_DDL } from "@/lib/accounting-v4-schema";
/** Additive structures only. No operational transaction is backfilled. */
export const ACCOUNTING_DDL = `
/* Refresh revised guards under getDb's encompassing migration transaction.
 * A failed migration rolls these replacements back with all other DDL. */
DROP TRIGGER IF EXISTS accounting_post_valid;
DROP TRIGGER IF EXISTS financial_correction_evidence_locked;
CREATE TABLE IF NOT EXISTS accounting_accounts (
  code TEXT PRIMARY KEY, name TEXT NOT NULL,
  classification TEXT NOT NULL CHECK(classification IN ('asset','liability','equity','revenue','expense','cogs')),
  normal_side TEXT NOT NULL CHECK(normal_side IN ('debit','credit')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE IF NOT EXISTS accounting_cutover (
  id INTEGER PRIMARY KEY CHECK(id=1), created_at TEXT NOT NULL DEFAULT (datetime('now')), watermarks_json TEXT NOT NULL,
  posting_mode TEXT NOT NULL DEFAULT 'review' CHECK(posting_mode='review')
);
INSERT INTO accounting_cutover(id,watermarks_json) SELECT 1,json_object(
  'invoice',COALESCE((SELECT MAX(id) FROM invoices),0),'payment',COALESCE((SELECT MAX(id) FROM payments),0),
  'refund',COALESCE((SELECT MAX(id) FROM refunds),0),'sale',COALESCE((SELECT MAX(id) FROM sales),0),
  'expense',COALESCE((SELECT MAX(id) FROM expenses),0),'stock',COALESCE((SELECT MAX(id) FROM inventory_movements),0),
  'cheque',COALESCE((SELECT MAX(id) FROM checks),0),'commission',COALESCE((SELECT MAX(id) FROM payroll_runs),0),
  'bank',COALESCE((SELECT MAX(id) FROM bank_transactions),0)) WHERE NOT EXISTS(SELECT 1 FROM accounting_cutover WHERE id=1);
CREATE TRIGGER IF NOT EXISTS accounting_cutover_immutable BEFORE UPDATE ON accounting_cutover BEGIN SELECT RAISE(ABORT,'Accounting cutover is immutable'); END;
CREATE TRIGGER IF NOT EXISTS accounting_cutover_no_delete BEFORE DELETE ON accounting_cutover BEGIN SELECT RAISE(ABORT,'Accounting cutover cannot be deleted'); END;
CREATE TABLE IF NOT EXISTS accounting_periods (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(length(start_date)=10 AND length(end_date)=10 AND start_date<=end_date)
);
CREATE TABLE IF NOT EXISTS accounting_journals (
  id INTEGER PRIMARY KEY, branch_id INTEGER NOT NULL REFERENCES branches(id),
  period_id INTEGER NOT NULL REFERENCES accounting_periods(id), posting_date TEXT NOT NULL,
  source_type TEXT NOT NULL, source_id TEXT NOT NULL, event_key TEXT NOT NULL UNIQUE,
  memo TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','posted','reversed')),
  request_hash TEXT NOT NULL, created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')), posted_by INTEGER REFERENCES users(id), posted_at TEXT,
  posted_sequence INTEGER UNIQUE, previous_hash TEXT, digest TEXT,
  reversal_of INTEGER UNIQUE REFERENCES accounting_journals(id)
);
CREATE TABLE IF NOT EXISTS accounting_lines (
  id INTEGER PRIMARY KEY, journal_id INTEGER NOT NULL REFERENCES accounting_journals(id),
  position INTEGER NOT NULL, account_code TEXT NOT NULL REFERENCES accounting_accounts(code),
  debit INTEGER NOT NULL DEFAULT 0, credit INTEGER NOT NULL DEFAULT 0, memo TEXT NOT NULL DEFAULT '',
  customer_id INTEGER REFERENCES customers(id), supplier_id INTEGER REFERENCES suppliers(id),
  employee_id INTEGER REFERENCES users(id), part_id INTEGER REFERENCES parts(id), bank_account_id INTEGER REFERENCES bank_accounts(id),
  UNIQUE(journal_id,position),
  CHECK(typeof(debit)='integer' AND typeof(credit)='integer' AND debit BETWEEN 0 AND 9007199254740991 AND credit BETWEEN 0 AND 9007199254740991),
  CHECK((debit>0 AND credit=0) OR (credit>0 AND debit=0))
);
CREATE TABLE IF NOT EXISTS accounting_journal_voids (
  journal_id INTEGER PRIMARY KEY REFERENCES accounting_journals(id), reason TEXT NOT NULL CHECK(length(trim(reason))>=5),
  actor_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TRIGGER IF NOT EXISTS accounting_void_valid BEFORE INSERT ON accounting_journal_voids BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM accounting_journals WHERE id=NEW.journal_id AND state='draft' AND source_type='manual')
    THEN RAISE(ABORT,'Only manual drafts may be voided') END;
END;
CREATE TRIGGER IF NOT EXISTS accounting_void_immutable BEFORE UPDATE ON accounting_journal_voids BEGIN SELECT RAISE(ABORT,'Draft cancellation is immutable'); END;
CREATE TRIGGER IF NOT EXISTS accounting_void_no_delete BEFORE DELETE ON accounting_journal_voids BEGIN SELECT RAISE(ABORT,'Draft cancellation cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS accounting_void_header_update BEFORE UPDATE ON accounting_journals WHEN EXISTS(SELECT 1 FROM accounting_journal_voids WHERE journal_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Voided draft is immutable'); END;
CREATE TRIGGER IF NOT EXISTS accounting_void_header_delete BEFORE DELETE ON accounting_journals WHEN EXISTS(SELECT 1 FROM accounting_journal_voids WHERE journal_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Voided draft cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS accounting_void_line_insert BEFORE INSERT ON accounting_lines WHEN EXISTS(SELECT 1 FROM accounting_journal_voids WHERE journal_id=NEW.journal_id) BEGIN SELECT RAISE(ABORT,'Voided draft is immutable'); END;
CREATE TRIGGER IF NOT EXISTS accounting_void_line_update BEFORE UPDATE ON accounting_lines WHEN EXISTS(SELECT 1 FROM accounting_journal_voids WHERE journal_id=OLD.journal_id OR journal_id=NEW.journal_id) BEGIN SELECT RAISE(ABORT,'Voided draft is immutable'); END;
CREATE TRIGGER IF NOT EXISTS accounting_void_line_delete BEFORE DELETE ON accounting_lines WHEN EXISTS(SELECT 1 FROM accounting_journal_voids WHERE journal_id=OLD.journal_id) BEGIN SELECT RAISE(ABORT,'Voided draft is immutable'); END;
CREATE TABLE IF NOT EXISTS accounting_events (
  id INTEGER PRIMARY KEY, event_key TEXT NOT NULL UNIQUE, source_type TEXT NOT NULL, source_id TEXT NOT NULL,
  branch_id INTEGER NOT NULL REFERENCES branches(id), event_type TEXT NOT NULL, payload_json TEXT NOT NULL, payload_hash TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS accounting_event_reviews (
  event_id INTEGER PRIMARY KEY REFERENCES accounting_events(id), journal_id INTEGER NOT NULL UNIQUE REFERENCES accounting_journals(id),
  reason TEXT NOT NULL, approved_by INTEGER NOT NULL REFERENCES users(id), approved_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS financial_corrections (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind='invoice_paid_cache'), invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  branch_id INTEGER NOT NULL REFERENCES branches(id), evidence_json TEXT NOT NULL, evidence_hash TEXT NOT NULL, expected_paid INTEGER NOT NULL,
  reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','rehearsed','applied','rejected')),
  proposed_by INTEGER NOT NULL REFERENCES users(id), approved_by INTEGER REFERENCES users(id),
  backup_path TEXT, backup_sha256 TEXT, rehearsal_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), applied_at TEXT,
  UNIQUE(kind,invoice_id,evidence_hash), CHECK(expected_paid>=0 AND typeof(expected_paid)='integer'),
  CHECK(approved_by IS NULL OR approved_by!=proposed_by)
);
CREATE TABLE IF NOT EXISTS commission_approvals (
  run_id INTEGER PRIMARY KEY REFERENCES payroll_runs(id), branch_id INTEGER NOT NULL REFERENCES branches(id),
  approved_by INTEGER NOT NULL REFERENCES users(id), amount INTEGER NOT NULL, evidence_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(typeof(amount)='integer' AND amount>0 AND amount<=9007199254740991)
);
CREATE TABLE IF NOT EXISTS commission_payments (
  id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL REFERENCES payroll_runs(id), branch_id INTEGER NOT NULL REFERENCES branches(id),
  user_id INTEGER NOT NULL REFERENCES users(id), amount INTEGER NOT NULL, method TEXT NOT NULL CHECK(method IN ('cash','card','transfer')),
  payment_date TEXT NOT NULL, document_reference TEXT NOT NULL, recorded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(typeof(amount)='integer' AND amount>0 AND amount<=9007199254740991)
);
CREATE INDEX IF NOT EXISTS idx_commission_payments_run ON commission_payments(run_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_commission_document ON commission_payments(run_id,method,document_reference);
CREATE TRIGGER IF NOT EXISTS commission_approval_immutable BEFORE UPDATE ON commission_approvals BEGIN SELECT RAISE(ABORT,'Commission approval is immutable'); END;
CREATE TRIGGER IF NOT EXISTS commission_approval_no_delete BEFORE DELETE ON commission_approvals BEGIN SELECT RAISE(ABORT,'Commission approval cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS commission_payment_immutable BEFORE UPDATE ON commission_payments BEGIN SELECT RAISE(ABORT,'Commission payment is immutable'); END;
CREATE TRIGGER IF NOT EXISTS commission_payment_no_delete BEFORE DELETE ON commission_payments BEGIN SELECT RAISE(ABORT,'Commission payment cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS commission_payment_valid BEFORE INSERT ON commission_payments BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM commission_approvals a JOIN payroll_runs r ON r.id=a.run_id WHERE a.run_id=NEW.run_id
    AND a.amount=r.net_payable AND a.branch_id=NEW.branch_id AND r.user_id=NEW.user_id AND r.status IN ('approved','partially_paid'))
    THEN RAISE(ABORT,'Valid commission approval required') END;
  SELECT CASE WHEN NEW.amount+(SELECT COALESCE(SUM(amount),0) FROM commission_payments WHERE run_id=NEW.run_id)>
    (SELECT amount FROM commission_approvals WHERE run_id=NEW.run_id) THEN RAISE(ABORT,'Commission payment exceeds approved capacity') END;
  SELECT CASE WHEN date(NEW.payment_date) IS NULL OR length(NEW.payment_date)!=10 OR date(NEW.payment_date)!=NEW.payment_date
    OR length(trim(NEW.document_reference))<3 THEN RAISE(ABORT,'Invalid commission settlement evidence') END;
END;
CREATE TRIGGER IF NOT EXISTS commission_paid_requires_documents BEFORE UPDATE OF status ON payroll_runs
WHEN NEW.status='paid' AND OLD.status!='paid' BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM commission_approvals WHERE run_id=NEW.id)
    OR NEW.net_payable!=(SELECT COALESCE(SUM(amount),0) FROM commission_payments WHERE run_id=NEW.id)
    THEN RAISE(ABORT,'Paid status requires actual settlement documents') END;
END;
CREATE TRIGGER IF NOT EXISTS commission_approved_amount_locked BEFORE UPDATE OF user_id,base_salary,earned_commission,deductions,net_payable,source_ticket_id ON payroll_runs
WHEN EXISTS(SELECT 1 FROM commission_approvals WHERE run_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Approved compensation requires an auditable adjustment'); END;
CREATE TRIGGER IF NOT EXISTS commission_financial_branch_locked BEFORE UPDATE OF branch_id ON payroll_runs
WHEN NEW.branch_id IS NOT OLD.branch_id AND (EXISTS(SELECT 1 FROM commission_approvals WHERE run_id=OLD.id)
  OR EXISTS(SELECT 1 FROM accounting_events WHERE event_key='commission:'||OLD.id||':accrual'))
BEGIN SELECT RAISE(ABORT,'Financial branch is immutable'); END;
CREATE TRIGGER IF NOT EXISTS commission_accrual_amount_locked BEFORE UPDATE OF user_id,base_salary,earned_commission,deductions,net_payable,source_ticket_id ON payroll_runs
WHEN EXISTS(SELECT 1 FROM accounting_events WHERE event_key='commission:'||OLD.id||':accrual')
BEGIN SELECT RAISE(ABORT,'Accrued compensation requires an auditable adjustment'); END;
CREATE TRIGGER IF NOT EXISTS financial_correction_evidence_locked BEFORE UPDATE ON financial_corrections
WHEN NEW.kind!=OLD.kind OR NEW.invoice_id!=OLD.invoice_id OR NEW.branch_id!=OLD.branch_id OR NEW.evidence_json!=OLD.evidence_json
  OR NEW.evidence_hash!=OLD.evidence_hash OR NEW.expected_paid!=OLD.expected_paid OR NEW.reason!=OLD.reason OR NEW.proposed_by!=OLD.proposed_by
  OR (OLD.approved_by IS NOT NULL AND NEW.approved_by IS NOT OLD.approved_by)
  OR (OLD.status='rehearsed' AND (NEW.backup_path IS NOT OLD.backup_path OR NEW.backup_sha256 IS NOT OLD.backup_sha256 OR NEW.rehearsal_json IS NOT OLD.rehearsal_json))
  OR OLD.status IN ('applied','rejected') BEGIN
  SELECT RAISE(ABORT,'Correction evidence is immutable');
END;
CREATE TRIGGER IF NOT EXISTS financial_correction_transition BEFORE UPDATE OF status ON financial_corrections BEGIN
  SELECT CASE WHEN NOT ((OLD.status='proposed' AND NEW.status='approved' AND NEW.approved_by IS NOT NULL AND NEW.approved_by!=OLD.proposed_by)
    OR (OLD.status='approved' AND NEW.status='rehearsed' AND NEW.backup_path IS NOT NULL AND length(NEW.backup_sha256)=64 AND json_valid(NEW.rehearsal_json))
    OR (OLD.status='rehearsed' AND NEW.status='applied' AND NEW.applied_at IS NOT NULL)
    OR (OLD.status IN ('proposed','approved') AND NEW.status='rejected')) THEN RAISE(ABORT,'Invalid correction transition') END;
END;
CREATE TRIGGER IF NOT EXISTS financial_correction_no_delete BEFORE DELETE ON financial_corrections BEGIN
  SELECT RAISE(ABORT,'Correction history cannot be deleted');
END;
CREATE INDEX IF NOT EXISTS idx_accounting_journal_branch_date ON accounting_journals(branch_id,posting_date,id);
CREATE INDEX IF NOT EXISTS idx_accounting_lines_account ON accounting_lines(account_code,journal_id);
CREATE INDEX IF NOT EXISTS idx_accounting_events_branch ON accounting_events(branch_id,id);
CREATE INDEX IF NOT EXISTS idx_accounting_event_source ON accounting_events(source_type,source_id);
CREATE TRIGGER IF NOT EXISTS accounting_period_overlap BEFORE INSERT ON accounting_periods BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM accounting_periods WHERE start_date<=NEW.end_date AND end_date>=NEW.start_date)
    THEN RAISE(ABORT,'Overlapping accounting period') END;
END;
CREATE TRIGGER IF NOT EXISTS accounting_period_dates_locked BEFORE UPDATE OF start_date,end_date ON accounting_periods BEGIN
  SELECT RAISE(ABORT,'Accounting period boundaries are immutable');
END;
CREATE TRIGGER IF NOT EXISTS accounting_period_no_delete BEFORE DELETE ON accounting_periods BEGIN
  SELECT RAISE(ABORT,'Accounting periods cannot be deleted');
END;
CREATE TRIGGER IF NOT EXISTS accounting_account_class_locked BEFORE UPDATE OF code,classification,normal_side ON accounting_accounts
WHEN EXISTS(SELECT 1 FROM accounting_lines WHERE account_code=OLD.code) BEGIN
  SELECT RAISE(ABORT,'Referenced account classification is immutable');
END;
CREATE TRIGGER IF NOT EXISTS accounting_journal_insert_draft BEFORE INSERT ON accounting_journals WHEN NEW.state!='draft' BEGIN
  SELECT RAISE(ABORT,'Journal must start as draft');
END;
CREATE TRIGGER IF NOT EXISTS accounting_reverse_transition BEFORE UPDATE OF state ON accounting_journals
WHEN NEW.state='reversed' AND OLD.state!='posted' BEGIN
  SELECT RAISE(ABORT,'Only posted journals may be reversed');
END;
CREATE TRIGGER IF NOT EXISTS accounting_post_valid BEFORE UPDATE OF state ON accounting_journals WHEN NEW.state='posted' BEGIN
  SELECT CASE WHEN length(NEW.posting_date)!=10 OR date(NEW.posting_date) IS NULL OR date(NEW.posting_date)!=NEW.posting_date
    THEN RAISE(ABORT,'Invalid accounting posting date') END;
  SELECT CASE WHEN OLD.state!='draft' OR NEW.posted_by IS NULL OR NEW.posted_at IS NULL OR length(COALESCE(NEW.digest,''))!=64
    THEN RAISE(ABORT,'Invalid posting transition') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM accounting_periods WHERE id=NEW.period_id AND status='open'
      AND NEW.posting_date BETWEEN start_date AND end_date) THEN RAISE(ABORT,'Accounting period is closed or outside posting date') END;
  SELECT CASE WHEN (SELECT COUNT(*) FROM accounting_lines WHERE journal_id=NEW.id)<2
    OR COALESCE((SELECT SUM(debit)-SUM(credit) FROM accounting_lines WHERE journal_id=NEW.id),1)!=0
    THEN RAISE(ABORT,'Journal is not balanced') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM accounting_lines l JOIN accounting_accounts a ON a.code=l.account_code WHERE l.journal_id=NEW.id AND a.active!=1)
    THEN RAISE(ABORT,'Inactive ledger account') END;
  SELECT CASE WHEN NEW.reversal_of IS NOT NULL AND (
    NOT EXISTS(SELECT 1 FROM accounting_journals o WHERE o.id=NEW.reversal_of AND o.state='posted' AND o.reversal_of IS NULL AND o.branch_id=NEW.branch_id)
    OR (SELECT COUNT(*) FROM accounting_lines WHERE journal_id=NEW.id)!=(SELECT COUNT(*) FROM accounting_lines WHERE journal_id=NEW.reversal_of)
    OR EXISTS(SELECT 1 FROM accounting_lines l LEFT JOIN accounting_lines o ON o.journal_id=NEW.reversal_of AND o.position=l.position
      WHERE l.journal_id=NEW.id AND (o.id IS NULL OR l.account_code!=o.account_code OR l.debit!=o.credit OR l.credit!=o.debit
        OR l.customer_id IS NOT o.customer_id OR l.supplier_id IS NOT o.supplier_id OR l.employee_id IS NOT o.employee_id
        OR l.part_id IS NOT o.part_id OR l.bank_account_id IS NOT o.bank_account_id))) THEN RAISE(ABORT,'Invalid reversing journal') END;
  SELECT CASE WHEN NEW.posted_sequence!=(SELECT COALESCE(MAX(posted_sequence),0)+1 FROM accounting_journals)
    OR NEW.previous_hash IS NOT COALESCE((SELECT digest FROM accounting_journals WHERE posted_sequence IS NOT NULL ORDER BY posted_sequence DESC LIMIT 1),'')
    THEN RAISE(ABORT,'Invalid journal chain') END;
END;
CREATE TRIGGER IF NOT EXISTS accounting_posted_immutable BEFORE UPDATE ON accounting_journals WHEN OLD.state IN ('posted','reversed') BEGIN
  SELECT CASE WHEN NOT (OLD.state='posted' AND NEW.state='reversed'
    AND NEW.id=OLD.id AND NEW.branch_id=OLD.branch_id AND NEW.period_id=OLD.period_id AND NEW.posting_date=OLD.posting_date
    AND NEW.source_type=OLD.source_type AND NEW.source_id=OLD.source_id AND NEW.event_key=OLD.event_key AND NEW.memo=OLD.memo
    AND NEW.request_hash=OLD.request_hash AND NEW.created_by=OLD.created_by AND NEW.created_at=OLD.created_at
    AND NEW.posted_by=OLD.posted_by AND NEW.posted_at=OLD.posted_at AND NEW.posted_sequence=OLD.posted_sequence
    AND NEW.previous_hash=OLD.previous_hash AND NEW.digest=OLD.digest AND NEW.reversal_of IS OLD.reversal_of
    AND EXISTS(SELECT 1 FROM accounting_journals WHERE reversal_of=OLD.id AND state='posted'))
    THEN RAISE(ABORT,'Posted journal is immutable') END;
END;
CREATE TRIGGER IF NOT EXISTS accounting_posted_no_delete BEFORE DELETE ON accounting_journals WHEN OLD.state!='draft' BEGIN
  SELECT RAISE(ABORT,'Posted journal cannot be deleted');
END;
CREATE TRIGGER IF NOT EXISTS accounting_lines_insert_guard BEFORE INSERT ON accounting_lines
WHEN COALESCE((SELECT state FROM accounting_journals WHERE id=NEW.journal_id),'')!='draft' BEGIN
  SELECT RAISE(ABORT,'Posted journal lines are immutable');
END;
CREATE TRIGGER IF NOT EXISTS accounting_lines_update_guard BEFORE UPDATE ON accounting_lines
WHEN COALESCE((SELECT state FROM accounting_journals WHERE id=OLD.journal_id),'')!='draft'
  OR COALESCE((SELECT state FROM accounting_journals WHERE id=NEW.journal_id),'')!='draft' BEGIN
  SELECT RAISE(ABORT,'Posted journal lines are immutable');
END;
CREATE TRIGGER IF NOT EXISTS accounting_lines_delete_guard BEFORE DELETE ON accounting_lines
WHEN COALESCE((SELECT state FROM accounting_journals WHERE id=OLD.journal_id),'')!='draft' BEGIN
  SELECT RAISE(ABORT,'Posted journal lines are immutable');
END;
CREATE TRIGGER IF NOT EXISTS accounting_event_immutable BEFORE UPDATE ON accounting_events BEGIN
  SELECT RAISE(ABORT,'Accounting source event is immutable');
END;
CREATE TRIGGER IF NOT EXISTS accounting_event_no_delete BEFORE DELETE ON accounting_events BEGIN
  SELECT RAISE(ABORT,'Accounting source event cannot be deleted');
END;
CREATE TRIGGER IF NOT EXISTS accounting_review_immutable BEFORE UPDATE ON accounting_event_reviews BEGIN
  SELECT RAISE(ABORT,'Accounting review is immutable');
END;
CREATE TRIGGER IF NOT EXISTS accounting_review_no_delete BEFORE DELETE ON accounting_event_reviews BEGIN
  SELECT RAISE(ABORT,'Accounting review cannot be deleted');
END;
${ACCOUNTING_V4_DDL}
`;
