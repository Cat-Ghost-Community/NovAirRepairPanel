/** Financial ownership freezes at accrual or approval; moving an employee or
 * ticket must not reattribute an existing payable. Null legacy ownership is
 * left unchanged and uses the documented source fallback for review. */
export const PAYROLL_SOURCE_JOINS=`LEFT JOIN repair_tickets t ON t.id=r.source_ticket_id
  LEFT JOIN commission_approvals a ON a.run_id=r.id`;
export const PAYROLL_BRANCH_SQL="COALESCE(r.branch_id,a.branch_id,t.branch_id)";
