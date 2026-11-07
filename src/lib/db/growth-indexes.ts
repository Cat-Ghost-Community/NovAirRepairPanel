/** Composite indexes for actual branch-scoped list/history predicates. No balance rewrite. */
export const GROWTH_INDEXES=[
 'CREATE INDEX IF NOT EXISTS idx_tickets_branch_recent ON repair_tickets(branch_id,created_at DESC,id DESC)',
 'CREATE INDEX IF NOT EXISTS idx_tickets_branch_status_recent ON repair_tickets(branch_id,status_id,created_at DESC,id DESC)',
 'CREATE INDEX IF NOT EXISTS idx_payments_customer_branch_recent ON payments(customer_id,branch_id,id DESC)',
 'CREATE INDEX IF NOT EXISTS idx_payments_invoice_direction ON payments(invoice_id,direction,id DESC)',
 'CREATE INDEX IF NOT EXISTS idx_customer_credit_source_invoice ON customer_credit_operations(source_invoice_id,state,kind,id)',
 'CREATE INDEX IF NOT EXISTS idx_invoices_customer_branch_recent ON invoices(customer_id,branch_id,id DESC)',
 'CREATE INDEX IF NOT EXISTS idx_invoices_branch_recent ON invoices(branch_id,id DESC)',
 'CREATE INDEX IF NOT EXISTS idx_audit_branch_recent ON audit_logs(branch_id,id DESC)',
 'CREATE INDEX IF NOT EXISTS idx_audit_entity_history ON audit_logs(entity,entity_id,id DESC)',
 'CREATE INDEX IF NOT EXISTS idx_attachment_ticket_recent ON repair_attachments(ticket_id,id DESC)',
 'CREATE INDEX IF NOT EXISTS idx_movement_location_history ON inventory_movements(part_id,location_id,id DESC)',
] as const;
