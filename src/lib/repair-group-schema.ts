/** Additive evidence only: no reconstruction of historical group deposits. */
export const REPAIR_GROUP_RECEIPT_DDL=`
CREATE INDEX IF NOT EXISTS idx_repair_group_members ON repair_tickets(group_receipt_id,id);
CREATE INDEX IF NOT EXISTS idx_payments_ticket_receipt ON payments(ticket_id,direction,branch_id,id);
CREATE TABLE IF NOT EXISTS repair_group_receipts(
 group_id TEXT PRIMARY KEY NOT NULL,
 payment_id INTEGER NOT NULL UNIQUE REFERENCES payments(id),
 customer_id INTEGER NOT NULL REFERENCES customers(id),branch_id INTEGER NOT NULL REFERENCES branches(id),
 confirmed_by INTEGER NOT NULL REFERENCES users(id),confirmed_at TEXT NOT NULL,
 evidence_reference TEXT NOT NULL CHECK(length(trim(evidence_reference)) BETWEEN 5 AND 500),
 member_ids TEXT NOT NULL CHECK(json_valid(member_ids) AND json_type(member_ids)='array' AND json_array_length(member_ids) BETWEEN 1 AND 100)
);
CREATE INDEX IF NOT EXISTS idx_group_receipts_customer ON repair_group_receipts(customer_id,branch_id,payment_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_receipts_cash_reference ON repair_group_receipts(branch_id,evidence_reference);
CREATE TRIGGER IF NOT EXISTS repair_group_receipt_validate BEFORE INSERT ON repair_group_receipts BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM payments p WHERE p.id=NEW.payment_id AND p.customer_id=NEW.customer_id AND p.branch_id=NEW.branch_id
  AND p.method='cash' AND p.direction='in' AND p.invoice_id IS NULL AND p.ticket_id IS NULL AND p.sale_id IS NULL AND p.supplier_id IS NULL
  AND typeof(p.amount)='integer' AND p.amount>0 AND p.amount<=9007199254740991 AND p.user_id=NEW.confirmed_by AND p.reference=NEW.evidence_reference)
  THEN RAISE(ABORT,'Group receipt requires the original confirmed customer cash source') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM repair_tickets WHERE group_receipt_id=NEW.group_id)!=json_array_length(NEW.member_ids)
  OR EXISTS(SELECT 1 FROM json_each(NEW.member_ids) m LEFT JOIN repair_tickets t ON t.id=m.value WHERE m.type!='integer' OR t.id IS NULL OR t.group_receipt_id!=NEW.group_id OR t.branch_id!=NEW.branch_id OR t.customer_id!=NEW.customer_id)
  OR (SELECT COUNT(DISTINCT value) FROM json_each(NEW.member_ids))!=json_array_length(NEW.member_ids)
  THEN RAISE(ABORT,'Group receipt membership or financial ownership differs') END;
END;
CREATE TRIGGER IF NOT EXISTS repair_group_receipt_no_update BEFORE UPDATE ON repair_group_receipts BEGIN SELECT RAISE(ABORT,'Group receipt evidence is immutable'); END;
CREATE TRIGGER IF NOT EXISTS repair_group_receipt_no_delete BEFORE DELETE ON repair_group_receipts BEGIN SELECT RAISE(ABORT,'Group receipt evidence is immutable'); END;
CREATE TRIGGER IF NOT EXISTS group_payment_identity BEFORE UPDATE OF customer_id,branch_id,amount,method,direction,invoice_id,ticket_id,sale_id,supplier_id,user_id,reference ON payments
 WHEN EXISTS(SELECT 1 FROM repair_group_receipts WHERE payment_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Group receipt source identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS group_member_identity BEFORE UPDATE OF group_receipt_id,customer_id,branch_id ON repair_tickets
 WHEN EXISTS(SELECT 1 FROM repair_group_receipts WHERE group_id=OLD.group_receipt_id OR group_id=NEW.group_receipt_id)
 AND (NEW.group_receipt_id IS NOT OLD.group_receipt_id OR NEW.customer_id IS NOT OLD.customer_id OR NEW.branch_id IS NOT OLD.branch_id)
 BEGIN SELECT RAISE(ABORT,'Financial group ownership is immutable'); END;
CREATE TRIGGER IF NOT EXISTS group_member_insert BEFORE INSERT ON repair_tickets
 WHEN EXISTS(SELECT 1 FROM repair_group_receipts WHERE group_id=NEW.group_receipt_id) BEGIN SELECT RAISE(ABORT,'Financial group membership is immutable'); END;
CREATE TRIGGER IF NOT EXISTS group_member_delete BEFORE DELETE ON repair_tickets
 WHEN EXISTS(SELECT 1 FROM repair_group_receipts WHERE group_id=OLD.group_receipt_id) BEGIN SELECT RAISE(ABORT,'Financial group membership is immutable'); END;
`;
