/** Additive reviewable policies and opening documents; no data backfill. */
export const ACCOUNTING_V4_DDL = `
CREATE TABLE IF NOT EXISTS accounting_recognition_policies (
 id INTEGER PRIMARY KEY, branch_id INTEGER NOT NULL REFERENCES branches(id), kind TEXT NOT NULL,
 reason TEXT NOT NULL, effective_date TEXT NOT NULL, proposed_by INTEGER NOT NULL REFERENCES users(id),
 approved_by INTEGER REFERENCES users(id), approved_at TEXT, min_event_id INTEGER,
 status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','disabled')),
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 CHECK(approved_by IS NULL OR approved_by!=proposed_by)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounting_policy_active ON accounting_recognition_policies(branch_id,kind) WHERE status='approved';
CREATE TRIGGER IF NOT EXISTS accounting_policy_initial BEFORE INSERT ON accounting_recognition_policies
WHEN NEW.status!='proposed' OR NEW.approved_by IS NOT NULL OR NEW.min_event_id IS NOT NULL
BEGIN SELECT RAISE(ABORT,'Policy must start as an unapproved proposal'); END;
CREATE TABLE IF NOT EXISTS accounting_automatic_postings (
 event_id INTEGER PRIMARY KEY REFERENCES accounting_events(id), policy_id INTEGER NOT NULL REFERENCES accounting_recognition_policies(id),
 journal_id INTEGER NOT NULL UNIQUE REFERENCES accounting_journals(id), executed_by INTEGER NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TRIGGER IF NOT EXISTS accounting_policy_locked BEFORE UPDATE ON accounting_recognition_policies BEGIN
 SELECT CASE WHEN NEW.branch_id!=OLD.branch_id OR NEW.kind!=OLD.kind OR NEW.reason!=OLD.reason OR NEW.effective_date!=OLD.effective_date
 OR NEW.proposed_by!=OLD.proposed_by OR NEW.created_at!=OLD.created_at
 OR NOT ((OLD.status='proposed' AND NEW.status='approved' AND NEW.approved_by!=OLD.proposed_by AND NEW.approved_at IS NOT NULL
 AND NEW.min_event_id=(SELECT COALESCE(MAX(id),0) FROM accounting_events))
 OR (OLD.status='approved' AND NEW.status='disabled' AND NEW.approved_by IS OLD.approved_by AND NEW.approved_at IS OLD.approved_at AND NEW.min_event_id IS OLD.min_event_id))
 THEN RAISE(ABORT,'Invalid recognition policy transition') END;
END;
CREATE TRIGGER IF NOT EXISTS accounting_policy_no_delete BEFORE DELETE ON accounting_recognition_policies BEGIN SELECT RAISE(ABORT,'Recognition policy is immutable'); END;
CREATE TRIGGER IF NOT EXISTS accounting_automatic_no_update BEFORE UPDATE ON accounting_automatic_postings BEGIN SELECT RAISE(ABORT,'Automatic posting is immutable'); END;
CREATE TRIGGER IF NOT EXISTS accounting_automatic_no_delete BEFORE DELETE ON accounting_automatic_postings BEGIN SELECT RAISE(ABORT,'Automatic posting cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS accounting_automatic_valid BEFORE INSERT ON accounting_automatic_postings BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM accounting_events e JOIN accounting_recognition_policies p ON p.id=NEW.policy_id
 JOIN accounting_journals j ON j.id=NEW.journal_id JOIN accounting_event_reviews r ON r.event_id=e.id AND r.journal_id=j.id
 WHERE e.id=NEW.event_id AND p.status='approved' AND p.branch_id=e.branch_id AND e.id>p.min_event_id AND e.actor_id=NEW.executed_by
 AND j.state='posted' AND j.branch_id=e.branch_id AND j.source_type='financial_event' AND j.source_id=CAST(e.id AS TEXT))
 THEN RAISE(ABORT,'Invalid automatic posting provenance') END;
END;
CREATE TABLE IF NOT EXISTS accounting_opening_documents (
 id INTEGER PRIMARY KEY, branch_id INTEGER NOT NULL REFERENCES branches(id), mode TEXT NOT NULL CHECK(mode IN ('legacy','new_business')),
 cutover_date TEXT NOT NULL, memo TEXT NOT NULL, lines_json TEXT NOT NULL, controls_json TEXT NOT NULL, evidence_json TEXT NOT NULL,
 source_hash TEXT NOT NULL, document_hash TEXT NOT NULL, proposed_by INTEGER NOT NULL REFERENCES users(id),
 approved_by INTEGER REFERENCES users(id), status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','rehearsed','posted','rejected')),
 backup_path TEXT, backup_hash TEXT, rehearsal_json TEXT, journal_id INTEGER UNIQUE REFERENCES accounting_journals(id),
 created_at TEXT NOT NULL DEFAULT (datetime('now')), CHECK(approved_by IS NULL OR approved_by!=proposed_by)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounting_opening_branch ON accounting_opening_documents(branch_id) WHERE status!='rejected';
CREATE TRIGGER IF NOT EXISTS accounting_opening_initial BEFORE INSERT ON accounting_opening_documents
WHEN NEW.status!='proposed' OR NEW.approved_by IS NOT NULL OR NEW.journal_id IS NOT NULL OR NEW.backup_hash IS NOT NULL
BEGIN SELECT RAISE(ABORT,'Opening must start as an unapproved proposal'); END;
CREATE TABLE IF NOT EXISTS accounting_opening_event_links (
 event_id INTEGER PRIMARY KEY REFERENCES accounting_events(id), opening_id INTEGER NOT NULL REFERENCES accounting_opening_documents(id)
);
CREATE TRIGGER IF NOT EXISTS accounting_opening_link_update BEFORE UPDATE ON accounting_opening_event_links BEGIN SELECT RAISE(ABORT,'Opening source link is immutable'); END;
CREATE TRIGGER IF NOT EXISTS accounting_opening_link_delete BEFORE DELETE ON accounting_opening_event_links BEGIN SELECT RAISE(ABORT,'Opening source link cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS accounting_opening_link_valid BEFORE INSERT ON accounting_opening_event_links BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM accounting_opening_documents o JOIN accounting_events e ON e.id=NEW.event_id
 WHERE o.id=NEW.opening_id AND o.status='posted' AND o.branch_id=e.branch_id AND NOT EXISTS(SELECT 1 FROM accounting_event_reviews r WHERE r.event_id=e.id))
 THEN RAISE(ABORT,'Invalid opening source coverage') END;
END;
CREATE TRIGGER IF NOT EXISTS accounting_opening_locked BEFORE UPDATE ON accounting_opening_documents BEGIN
 SELECT CASE WHEN NEW.branch_id!=OLD.branch_id OR NEW.mode!=OLD.mode OR NEW.cutover_date!=OLD.cutover_date OR NEW.memo!=OLD.memo
 OR NEW.lines_json!=OLD.lines_json OR NEW.controls_json!=OLD.controls_json OR NEW.evidence_json!=OLD.evidence_json
 OR NEW.source_hash!=OLD.source_hash OR NEW.document_hash!=OLD.document_hash OR NEW.proposed_by!=OLD.proposed_by OR NEW.created_at!=OLD.created_at
 OR NOT ((OLD.status='proposed' AND NEW.status IN ('approved','rejected') AND NEW.approved_by!=OLD.proposed_by AND NEW.backup_path IS NULL AND NEW.journal_id IS NULL)
 OR (OLD.status='approved' AND NEW.status='rehearsed' AND NEW.approved_by IS OLD.approved_by AND NEW.backup_hash IS NOT NULL AND NEW.rehearsal_json IS NOT NULL AND NEW.journal_id IS NULL)
 OR (OLD.status='rehearsed' AND NEW.status='posted' AND NEW.approved_by IS OLD.approved_by AND NEW.backup_path IS OLD.backup_path
 AND NEW.backup_hash IS OLD.backup_hash AND NEW.rehearsal_json IS OLD.rehearsal_json AND (NEW.journal_id IS NOT NULL OR (NEW.mode='new_business' AND NEW.lines_json='[]'))))
 THEN RAISE(ABORT,'Invalid opening document transition') END;
END;
CREATE TRIGGER IF NOT EXISTS accounting_opening_no_delete BEFORE DELETE ON accounting_opening_documents BEGIN SELECT RAISE(ABORT,'Opening document cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS accounting_opening_cutoff BEFORE INSERT ON accounting_journals
WHEN EXISTS(SELECT 1 FROM accounting_opening_documents WHERE branch_id=NEW.branch_id AND status='posted' AND cutover_date>NEW.posting_date)
BEGIN SELECT RAISE(ABORT,'Posting precedes approved accounting cutover'); END;
CREATE TRIGGER IF NOT EXISTS accounting_opening_cutoff_update BEFORE UPDATE OF posting_date ON accounting_journals
WHEN EXISTS(SELECT 1 FROM accounting_opening_documents WHERE branch_id=NEW.branch_id AND status='posted' AND cutover_date>NEW.posting_date)
BEGIN SELECT RAISE(ABORT,'Posting precedes approved accounting cutover'); END;
CREATE TRIGGER IF NOT EXISTS accounting_opening_no_reverse BEFORE INSERT ON accounting_journals
WHEN EXISTS(SELECT 1 FROM accounting_opening_documents WHERE journal_id=NEW.reversal_of AND status='posted')
BEGIN SELECT RAISE(ABORT,'Opening correction requires a separately reviewed cutover procedure'); END;
`;
