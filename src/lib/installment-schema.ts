import type { DatabaseSync } from 'node:sqlite';

export const INSTALLMENT_DDL=`
CREATE TABLE IF NOT EXISTS installment_schedules(
 id INTEGER PRIMARY KEY,invoice_id INTEGER NOT NULL REFERENCES invoices(id),branch_id INTEGER NOT NULL REFERENCES branches(id),customer_id INTEGER NOT NULL REFERENCES customers(id),
 version INTEGER NOT NULL,parent_id INTEGER REFERENCES installment_schedules(id),credit_note_id INTEGER REFERENCES credit_notes(id),
 purpose TEXT NOT NULL CHECK(purpose IN ('ordinary','credit','credit_reversal')),
 principal INTEGER NOT NULL CHECK(typeof(principal)='integer' AND principal>=0),
 source_json TEXT NOT NULL,source_hash TEXT NOT NULL,reason TEXT NOT NULL,evidence_reference TEXT NOT NULL,
 proposed_by INTEGER NOT NULL REFERENCES users(id),approved_by INTEGER REFERENCES users(id),approved_at TEXT,
 status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','active','superseded','cancelled','rejected')),
 created_at TEXT NOT NULL DEFAULT(datetime('now')),UNIQUE(invoice_id,version),CHECK(approved_by IS NULL OR approved_by!=proposed_by)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_installment_active ON installment_schedules(invoice_id) WHERE status='active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_installment_credit_revision ON installment_schedules(credit_note_id,purpose) WHERE credit_note_id IS NOT NULL AND status IN ('proposed','approved','active','superseded');
CREATE INDEX IF NOT EXISTS idx_installment_schedule_branch ON installment_schedules(branch_id,invoice_id,id);
CREATE TABLE IF NOT EXISTS installment_schedule_terms(
 id INTEGER PRIMARY KEY,schedule_id INTEGER NOT NULL REFERENCES installment_schedules(id),seq INTEGER NOT NULL,
 amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0),due_date TEXT NOT NULL,UNIQUE(schedule_id,seq)
);
CREATE TABLE IF NOT EXISTS installment_allocations(
 id INTEGER PRIMARY KEY,installment_id INTEGER NOT NULL REFERENCES installments(id),payment_id INTEGER NOT NULL REFERENCES payments(id),
 branch_id INTEGER NOT NULL REFERENCES branches(id),amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0),
 evidence_reference TEXT NOT NULL,created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_installment_alloc_receipt ON installment_allocations(payment_id,id);
CREATE INDEX IF NOT EXISTS idx_installment_alloc_line ON installment_allocations(installment_id,id);
CREATE TABLE IF NOT EXISTS installment_allocation_reversals(
 id INTEGER PRIMARY KEY,allocation_id INTEGER NOT NULL REFERENCES installment_allocations(id),amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0),
 reason TEXT NOT NULL,created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_installment_alloc_reversal ON installment_allocation_reversals(allocation_id);
CREATE TRIGGER IF NOT EXISTS installment_schedule_initial BEFORE INSERT ON installment_schedules WHEN NEW.status!='proposed' OR NEW.approved_by IS NOT NULL BEGIN SELECT RAISE(ABORT,'Schedule must begin as an independent proposal'); END;
CREATE TRIGGER IF NOT EXISTS installment_schedule_locked BEFORE UPDATE ON installment_schedules BEGIN
 SELECT CASE WHEN NEW.invoice_id!=OLD.invoice_id OR NEW.branch_id!=OLD.branch_id OR NEW.customer_id!=OLD.customer_id OR NEW.version!=OLD.version
 OR NEW.parent_id IS NOT OLD.parent_id OR NEW.credit_note_id IS NOT OLD.credit_note_id OR NEW.purpose!=OLD.purpose OR NEW.principal!=OLD.principal
 OR NEW.source_json!=OLD.source_json OR NEW.source_hash!=OLD.source_hash OR NEW.reason!=OLD.reason OR NEW.evidence_reference!=OLD.evidence_reference OR NEW.proposed_by!=OLD.proposed_by
 OR NOT ((OLD.status='proposed' AND NEW.status IN ('approved','active') AND NEW.approved_by IS NOT NULL AND NEW.approved_by!=OLD.proposed_by)
 OR (OLD.status='proposed' AND NEW.status IN ('cancelled','rejected') AND NEW.approved_by IS NULL)
 OR (OLD.status='approved' AND NEW.status IN ('active','cancelled') AND NEW.approved_by IS OLD.approved_by)
 OR (OLD.status='active' AND NEW.status='superseded' AND NEW.approved_by IS OLD.approved_by)) THEN RAISE(ABORT,'Immutable schedule or invalid transition') END;
END;
CREATE TRIGGER IF NOT EXISTS installment_schedule_no_delete BEFORE DELETE ON installment_schedules BEGIN SELECT RAISE(ABORT,'Schedule history is immutable'); END;
CREATE TRIGGER IF NOT EXISTS installment_schedule_evidence_locked BEFORE UPDATE ON installment_schedules
 WHEN NEW.created_at IS NOT OLD.created_at OR (OLD.status!='proposed' AND NEW.approved_at IS NOT OLD.approved_at)
 OR (OLD.status='proposed' AND NEW.status IN ('approved','active') AND NEW.approved_at IS NULL)
 BEGIN SELECT RAISE(ABORT,'Schedule approval evidence is immutable'); END;
CREATE TRIGGER IF NOT EXISTS installment_terms_initial BEFORE INSERT ON installment_schedule_terms WHEN (SELECT status FROM installment_schedules WHERE id=NEW.schedule_id)!='proposed' BEGIN SELECT RAISE(ABORT,'Accepted terms cannot be extended'); END;
CREATE TRIGGER IF NOT EXISTS installment_terms_no_update BEFORE UPDATE ON installment_schedule_terms BEGIN SELECT RAISE(ABORT,'Schedule terms are immutable'); END;
CREATE TRIGGER IF NOT EXISTS installment_terms_no_delete BEFORE DELETE ON installment_schedule_terms BEGIN SELECT RAISE(ABORT,'Schedule terms are immutable'); END;
CREATE TRIGGER IF NOT EXISTS installment_alloc_no_update BEFORE UPDATE ON installment_allocations BEGIN SELECT RAISE(ABORT,'Allocation evidence is immutable'); END;
CREATE TRIGGER IF NOT EXISTS installment_alloc_no_delete BEFORE DELETE ON installment_allocations BEGIN SELECT RAISE(ABORT,'Allocation evidence is immutable'); END;
CREATE TRIGGER IF NOT EXISTS installment_reversal_no_update BEFORE UPDATE ON installment_allocation_reversals BEGIN SELECT RAISE(ABORT,'Allocation reversal is immutable'); END;
CREATE TRIGGER IF NOT EXISTS installment_reversal_no_delete BEFORE DELETE ON installment_allocation_reversals BEGIN SELECT RAISE(ABORT,'Allocation reversal is immutable'); END;
`;

export function initializeInstallmentViews(db:DatabaseSync,settled:string){
 db.exec(`DROP VIEW IF EXISTS effective_installments;DROP VIEW IF EXISTS installment_allocation_balances;DROP VIEW IF EXISTS installment_receipt_funds;
 CREATE VIEW installment_receipt_funds AS SELECT p.*,${settled} settled,
 COALESCE((SELECT SUM(amount) FROM refunds WHERE payment_id=p.id),0) refunded,
 COALESCE((SELECT SUM(remaining) FROM active_customer_credit WHERE payment_id=p.id),0) credit_used,
 COALESCE((SELECT SUM(a.amount-COALESCE((SELECT SUM(r.amount) FROM installment_allocation_reversals r WHERE r.allocation_id=a.id),0)) FROM installment_allocations a WHERE a.payment_id=p.id),0) allocated
 FROM payments p;
 CREATE VIEW installment_allocation_balances AS SELECT a.*,a.amount-COALESCE((SELECT SUM(amount) FROM installment_allocation_reversals WHERE allocation_id=a.id),0) remaining,
 CASE WHEN p.settled AND p.direction='in' AND p.allocated+p.credit_used<=p.amount-p.refunded THEN a.amount-COALESCE((SELECT SUM(amount) FROM installment_allocation_reversals WHERE allocation_id=a.id),0) ELSE 0 END verified_amount
 FROM installment_allocations a JOIN installment_receipt_funds p ON p.id=a.payment_id;
 CREATE VIEW effective_installments AS SELECT i.id,i.customer_id,i.invoice_id,i.ticket_id,i.seq,i.amount,i.due_date,i.reminder_days_before,i.notes,i.user_id,i.created_at,i.schedule_id,i.schedule_term_id,
 COALESCE(s.branch_id,inv.branch_id) branch_id,s.status schedule_state,i.paid_amount stored_paid_amount,i.status stored_status,i.paid_at stored_paid_at,
 CASE WHEN i.schedule_id IS NULL THEN 1 ELSE 0 END legacy_review,
 COALESCE(a.paid,0) paid_amount,CASE WHEN i.schedule_id IS NULL THEN 'legacy_review' WHEN COALESCE(a.paid,0)>=i.amount THEN 'paid' WHEN COALESCE(a.paid,0)>0 THEN 'partially_paid' WHEN i.due_date<date('now') THEN 'overdue' ELSE 'pending' END status,
 a.paid_at paid_at
 FROM installments i LEFT JOIN installment_schedules s ON s.id=i.schedule_id LEFT JOIN invoices inv ON inv.id=i.invoice_id
 LEFT JOIN (SELECT installment_id,SUM(paid) paid,MAX(created_at) paid_at FROM (
 SELECT installment_id,verified_amount paid,created_at FROM installment_allocation_balances
 UNION ALL SELECT installment_id,remaining,created_at FROM active_customer_credit WHERE installment_id IS NOT NULL) GROUP BY installment_id) a ON a.installment_id=i.id
 WHERE s.status='active' OR (i.schedule_id IS NULL AND NOT EXISTS(SELECT 1 FROM installment_schedules accepted WHERE accepted.invoice_id=i.invoice_id AND accepted.status IN ('active','superseded')));`);
 db.exec(`CREATE TRIGGER IF NOT EXISTS installment_original_locked BEFORE UPDATE ON installments BEGIN SELECT RAISE(ABORT,'Installment history is immutable; use a schedule proposal or receipt allocation'); END;
 CREATE TRIGGER IF NOT EXISTS installment_original_no_delete BEFORE DELETE ON installments BEGIN SELECT RAISE(ABORT,'Installment history cannot be deleted'); END;
 CREATE TRIGGER IF NOT EXISTS installment_allocation_budget BEFORE INSERT ON installment_allocations BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM effective_installments i JOIN installment_schedules s ON s.id=i.schedule_id JOIN installment_receipt_funds p ON p.id=NEW.payment_id
 WHERE i.id=NEW.installment_id AND s.status='active' AND p.settled AND p.direction='in' AND p.branch_id=NEW.branch_id AND i.branch_id=NEW.branch_id AND p.invoice_id=i.invoice_id AND p.customer_id=i.customer_id
 AND NEW.amount<=i.amount-i.paid_amount
 AND NEW.amount<=p.amount-p.refunded-p.allocated-p.credit_used
 AND NOT EXISTS(SELECT 1 FROM json_each(s.source_json,'$.payments') prior WHERE json_extract(prior.value,'$.id')=p.id AND json_extract(prior.value,'$.settled')=1 AND json_extract(prior.value,'$.amount')>json_extract(prior.value,'$.refunded'))) THEN RAISE(ABORT,'Allocation exceeds verified funds or active installment scope') END;
 END;
 CREATE TRIGGER IF NOT EXISTS installment_reversal_budget BEFORE INSERT ON installment_allocation_reversals BEGIN SELECT CASE WHEN NEW.amount>COALESCE((SELECT remaining FROM installment_allocation_balances WHERE id=NEW.allocation_id),0) THEN RAISE(ABORT,'Allocation reversal exceeds remaining evidence') END; END;
 CREATE UNIQUE INDEX IF NOT EXISTS idx_installment_accepted_term ON installments(schedule_term_id) WHERE schedule_term_id IS NOT NULL;`);
 db.exec(`CREATE TRIGGER IF NOT EXISTS installment_invoice_owner_locked BEFORE UPDATE OF branch_id,customer_id ON invoices
 WHEN (NEW.branch_id IS NOT OLD.branch_id OR NEW.customer_id IS NOT OLD.customer_id) AND (EXISTS(SELECT 1 FROM installment_schedules WHERE invoice_id=OLD.id) OR EXISTS(SELECT 1 FROM installments WHERE invoice_id=OLD.id))
 BEGIN SELECT RAISE(ABORT,'انتساب فاکتور دارای سابقهٔ اقساط تغییرناپذیر است؛ بازبینی مالی مستقل لازم است.'); END;
 CREATE TRIGGER IF NOT EXISTS installment_invoice_cancel_locked BEFORE UPDATE OF status ON invoices WHEN NEW.status='cancelled' AND OLD.status!='cancelled' AND EXISTS(SELECT 1 FROM installment_schedules WHERE invoice_id=OLD.id AND status='active')
 BEGIN SELECT RAISE(ABORT,'لغو تعهد دارای برنامهٔ پذیرفته‌شده، اصلاح مالی و برنامهٔ مصوب جداگانه می‌خواهد.'); END;
 CREATE TRIGGER IF NOT EXISTS installment_accepted_line_initial BEFORE INSERT ON installments WHEN NEW.schedule_id IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM installment_schedule_terms t JOIN installment_schedules s ON s.id=t.schedule_id WHERE t.id=NEW.schedule_term_id AND s.id=NEW.schedule_id AND s.status='active' AND t.seq=NEW.seq AND t.amount=NEW.amount AND t.due_date=NEW.due_date AND s.invoice_id=NEW.invoice_id AND s.customer_id=NEW.customer_id AND COALESCE(NEW.paid_amount,0)=0) THEN RAISE(ABORT,'Accepted installment must match immutable terms') END; END;`);
}
