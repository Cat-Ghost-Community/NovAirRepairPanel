import type { DatabaseSync } from "node:sqlite";
import type { BranchScope } from "./branch";

/** Operational report, not certified accounting profit. Scope every source before aggregation. */
export function panelReport(db: DatabaseSync, scope: BranchScope, requestedDays: unknown) {
  const raw = Number(requestedDays);
  const days = [7,30,90,365].includes(raw) ? raw : 30;
  const args = { branch: scope.branchId, since: `-${days} days` };
  const all = (sql: string) => db.prepare(sql).all(args) as Record<string, any>[];
  const one = (sql: string) => db.prepare(sql).get(args) as Record<string, any>;
  const tickets = "t.created_at>=datetime('now',:since) AND (:branch IS NULL OR t.branch_id=:branch)";
  return {
    days,
    repairsByStatus: all(`SELECT s.name,s.color,COUNT(*) c FROM repair_tickets t JOIN repair_statuses s ON s.id=t.status_id WHERE ${tickets} GROUP BY s.id ORDER BY c DESC`),
    byBrand: all(`SELECT d.brand,COUNT(*) c FROM repair_tickets t JOIN devices d ON d.id=t.device_id WHERE ${tickets} GROUP BY d.brand ORDER BY c DESC LIMIT 10`),
    byTech: all(`SELECT u.name,u.avatar_color,COUNT(t.id) repairs,
      SUM(CASE WHEN s.category='closed' AND s.name IN ('تحویل‌شده','Delivered') THEN 1 ELSE 0 END) delivered,
      AVG(CASE WHEN t.completed_at IS NOT NULL THEN julianday(t.completed_at)-julianday(t.created_at) END) avg_days
      FROM repair_tickets t JOIN users u ON u.id=t.technician_id JOIN repair_statuses s ON s.id=t.status_id WHERE ${tickets} GROUP BY u.id ORDER BY repairs DESC`),
    topParts: all(`SELECT p.name,SUM(ABS(m.qty)) used FROM inventory_movements m JOIN parts p ON p.id=m.part_id
      WHERE m.type='repair_consumption' AND m.created_at>=datetime('now',:since) AND (:branch IS NULL OR m.branch_id=:branch) GROUP BY m.part_id ORDER BY used DESC LIMIT 8`),
    revenue: one(`SELECT COALESCE(SUM(amount),0) v FROM payments WHERE direction='in' AND created_at>=datetime('now',:since) AND (:branch IS NULL OR branch_id=:branch)`).v,
    expenses: one(`SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE date>=date('now',:since) AND (:branch IS NULL OR branch_id=:branch)`).v,
    repairCount: one(`SELECT COUNT(*) c FROM repair_tickets t WHERE ${tickets}`).c,
    avgTat: one(`SELECT AVG(julianday(t.completed_at)-julianday(t.created_at)) v FROM repair_tickets t WHERE t.completed_at IS NOT NULL AND ${tickets}`).v,
    estimates: one(`SELECT COUNT(*) total,SUM(CASE WHEN e.status='approved' THEN 1 ELSE 0 END) approved,SUM(CASE WHEN e.status='rejected' THEN 1 ELSE 0 END) rejected
      FROM estimates e LEFT JOIN repair_tickets t ON t.id=e.ticket_id LEFT JOIN customers c ON c.id=e.customer_id
      WHERE e.created_at>=datetime('now',:since) AND (:branch IS NULL OR COALESCE(t.branch_id,c.branch_id)=:branch)`),
    newCustomers: one(`SELECT COUNT(*) c FROM customers WHERE created_at>=datetime('now',:since) AND (:branch IS NULL OR id IN (SELECT customer_id FROM customer_branch_access WHERE branch_id=:branch))`).c,
    warrantyClaims: one(`SELECT COUNT(*) c FROM warranty_claims wc JOIN warranties w ON w.id=wc.warranty_id
      LEFT JOIN repair_tickets t ON t.id=w.ticket_id LEFT JOIN invoices i ON i.id=w.invoice_id LEFT JOIN sales s ON s.id=w.sale_id LEFT JOIN customers c ON c.id=w.customer_id
      WHERE wc.created_at>=datetime('now',:since) AND (:branch IS NULL OR COALESCE(w.branch_id,t.branch_id,i.branch_id,s.branch_id,c.branch_id,(SELECT MIN(a.branch_id) FROM customer_branch_access a WHERE a.customer_id=w.customer_id HAVING COUNT(*)=1))=:branch)`).c,
    unclaimed: one(`SELECT COUNT(*) c FROM repair_tickets WHERE status_id=(SELECT id FROM repair_statuses WHERE name='آماده تحویل')
      AND ready_at<datetime('now','-3 days') AND created_at>=datetime('now',:since) AND (:branch IS NULL OR branch_id=:branch)`).c,
  };
}
