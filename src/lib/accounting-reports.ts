import type { DatabaseSync } from "node:sqlite";
import type { Session } from "@/lib/auth";
import { HttpError,requirePerm } from "@/lib/api";
import { activeBranch } from "@/lib/branch";
import { readSnapshot } from "@/lib/db/transaction";

import { multiplyRial } from "@/lib/money";
import { signedSafe } from "@/lib/accounting";
import { PAYROLL_SOURCE_JOINS,PAYROLL_BRANCH_SQL } from "@/lib/payroll-scope";

export function eventCoverage(db:DatabaseSync,branch:number|null) {
  const cutover=db.prepare("SELECT * FROM accounting_cutover WHERE id=1").get();
  if(!cutover)throw new HttpError(409,"نقطهٔ آغاز ثبت رویدادهای حسابداری موجود نیست.");
  const watermarks=JSON.parse(String(cutover.watermarks_json));
  const sources=[['invoice','invoices',"s.status NOT IN ('draft','cancelled')"],['payment','payments','1=1'],['refund','refunds','1=1'],['sale','sales','1=1'],['expense','expenses','1=1'],['stock','inventory_movements','1=1'],['cheque','checks',"s.status='passed'"],['commission_payment','commission_payments','1=1'],['credit_note','credit_notes',"s.status IN ('approved','posted','reversed')"],['customer_credit','customer_credit_operations',"s.state='posted'"],['commission_correction','commission_corrections',"s.state='posted'"]] as const;
  const missing:Array<{source:string;count:number;ids:number[]}>=sources.map(([type,table,condition])=>{
    const base=`FROM ${table} s WHERE s.id>? AND ${condition} ${branch==null?"":"AND s.branch_id=?"}
      AND NOT EXISTS(SELECT 1 FROM accounting_events e WHERE e.source_type=? AND e.source_id=CAST(s.id AS TEXT))`;
    const params=[Number(watermarks[type]??0),...(branch==null?[]:[branch]),type];
    return {source:type,count:Number(db.prepare(`SELECT COUNT(*) n ${base}`).get(...params)!.n),ids:db.prepare(`SELECT s.id ${base} ORDER BY s.id LIMIT 20`).all(...params).map(r=>Number(r.id))};
  });
  const commissionBase=`FROM payroll_runs r JOIN users u ON u.id=r.user_id ${PAYROLL_SOURCE_JOINS}
    WHERE r.id>? AND r.earned_commission>0 ${branch==null?"":`AND ${PAYROLL_BRANCH_SQL}=?`}
    AND NOT EXISTS(SELECT 1 FROM accounting_events e WHERE e.source_type='commission' AND e.source_id=CAST(r.id AS TEXT))`;
  const commissionParams=[Number(watermarks.commission??0),...(branch==null?[]:[branch])];
  const returnCostBase=`FROM business_return_lines l JOIN business_returns r ON r.id=l.return_id WHERE COALESCE(l.cost_amount,l.unit_cost)>0 AND l.movement_id IS NULL AND l.disposition IN ('damaged','disposed') AND r.state IN ('disposed','credit_pending','completed') ${branch==null?'':'AND r.branch_id=?'}
    AND NOT EXISTS(SELECT 1 FROM accounting_events e WHERE e.source_type='return_cost' AND e.source_id=CAST(l.id AS TEXT))`;
  missing.push({source:'return_cost',count:Number(db.prepare(`SELECT COUNT(*) n ${returnCostBase}`).get(...(branch==null?[]:[branch]))!.n),ids:db.prepare(`SELECT l.id ${returnCostBase} ORDER BY l.id LIMIT 20`).all(...(branch==null?[]:[branch])).map(r=>Number(r.id))});
  missing.push({source:"commission",count:Number(db.prepare(`SELECT COUNT(*) n ${commissionBase}`).get(...commissionParams)!.n),
    ids:db.prepare(`SELECT r.id ${commissionBase} ORDER BY r.id LIMIT 20`).all(...commissionParams).map(r=>Number(r.id))});
  if(branch==null){const bankBase=`FROM bank_transactions s WHERE s.id>? AND s.check_id IS NULL
    AND NOT EXISTS(SELECT 1 FROM accounting_events e WHERE e.source_type='bank' AND e.source_id=CAST(s.id AS TEXT))`;
    missing.push({source:"bank",count:Number(db.prepare(`SELECT COUNT(*) n ${bankBase}`).get(Number(watermarks.bank??0))!.n),
      ids:db.prepare(`SELECT s.id ${bankBase} ORDER BY s.id LIMIT 20`).all(Number(watermarks.bank??0)).map(r=>Number(r.id))});}
  return {created_at:cutover.created_at,posting_mode:cutover.posting_mode,missing,
    missingSourceCount:missing.reduce((n,s)=>n+s.count,0),bankScope:branch==null?"central":"not_assessed_in_branch_scope"};
}

/** Current-state comparison. Never manufactures opening entries to hide the
 * difference between the source documents and reviewed journals. */
export function reconcileSubledgers(db:DatabaseSync,session:Session,branchId?:number|null,cookie?:string|null,after=0,supplierAfter=after,employeeAfter=after) {
  requirePerm(session,"finance.view");
  const scope=activeBranch(session,cookie),branch=scope.all?branchId??null:scope.branchId;
  if(!scope.all&&branchId!=null&&branchId!==branch)throw new HttpError(403,"تطبیق شعبهٔ دیگر مجاز نیست.");
  if([after,supplierAfter,employeeAfter].some(value=>!Number.isSafeInteger(value)||value<0))throw new HttpError(400,"صفحه‌بندی معتبر نیست.");
  return readSnapshot(db,()=>{
    const customerRows=db.prepare(`WITH operational AS (SELECT party_id,SUM(amount) amount FROM party_balance_events WHERE kind='customer' AND (:branch IS NULL OR branch_id=:branch) GROUP BY party_id),
      ledger AS (SELECT l.customer_id party_id,SUM(l.debit-l.credit) amount FROM accounting_lines l JOIN accounting_journals j ON j.id=l.journal_id WHERE j.state IN ('posted','reversed') AND l.account_code IN ('1100','2010') AND (:branch IS NULL OR j.branch_id=:branch) GROUP BY l.customer_id)
      SELECT c.id,COALESCE(o.amount,0) operational,COALESCE(g.amount,0) ledger FROM customers c LEFT JOIN operational o ON o.party_id=c.id LEFT JOIN ledger g ON g.party_id=c.id
      WHERE c.id>:after AND (o.party_id IS NOT NULL OR g.party_id IS NOT NULL) ORDER BY c.id LIMIT 101`).all({branch,after});
    const supplierRows=db.prepare(`WITH operational AS (SELECT party_id,SUM(amount) amount FROM party_balance_events WHERE kind='supplier' AND (:branch IS NULL OR branch_id=:branch) GROUP BY party_id),
      ledger AS (SELECT l.supplier_id party_id,SUM(l.credit-l.debit) amount FROM accounting_lines l JOIN accounting_journals j ON j.id=l.journal_id WHERE j.state IN ('posted','reversed') AND l.account_code='2000' AND (:branch IS NULL OR j.branch_id=:branch) GROUP BY l.supplier_id)
      SELECT s.id,COALESCE(o.amount,0) operational,COALESCE(g.amount,0) ledger FROM suppliers s LEFT JOIN operational o ON o.party_id=s.id LEFT JOIN ledger g ON g.party_id=s.id
      WHERE s.id>:after AND (o.party_id IS NOT NULL OR g.party_id IS NOT NULL) ORDER BY s.id LIMIT 101`).all({branch,after:supplierAfter});
    const rows=(values:typeof customerRows)=>values.slice(0,100).map(row=>({id:Number(row.id),operational:Number(row.operational),ledger:Number(row.ledger),
      difference:signedSafe(BigInt(Number(row.operational))-BigInt(Number(row.ledger)))}));
    let operationalInventory=BigInt(0),ledgerInventory=BigInt(0);
    for(const stock of db.prepare(`SELECT s.qty,s.carrying_value,p.avg_cost FROM inventory_stock s JOIN inventory_locations l ON l.id=s.location_id JOIN parts p ON p.id=s.part_id
      WHERE (:branch IS NULL OR l.branch_id=:branch)`).iterate({branch}))operationalInventory+=stock.carrying_value==null?BigInt(multiplyRial(Number(stock.avg_cost),Math.abs(Number(stock.qty))))*(Number(stock.qty)<0?BigInt(-1):BigInt(1)):BigInt(Number(stock.carrying_value));
    for(const line of db.prepare(`SELECT l.debit,l.credit FROM accounting_lines l JOIN accounting_journals j ON j.id=l.journal_id
      WHERE l.account_code='1110' AND j.state IN ('posted','reversed') AND (:branch IS NULL OR j.branch_id=:branch)`).iterate({branch}))ledgerInventory+=BigInt(Number(line.debit))-BigInt(Number(line.credit));
    const unattributed=db.prepare(`SELECT COUNT(*) n FROM accounting_lines l JOIN accounting_journals j ON j.id=l.journal_id WHERE j.state IN ('posted','reversed')
      AND ((l.account_code IN ('1100','2010') AND l.customer_id IS NULL) OR (l.account_code='2000' AND l.supplier_id IS NULL)
        OR (l.account_code='1110' AND l.part_id IS NULL) OR (l.account_code IN ('2030','1320') AND l.employee_id IS NULL) OR (l.account_code='1020' AND l.bank_account_id IS NULL))
      AND (:branch IS NULL OR j.branch_id=:branch)`).get({branch})!.n;
    const employeeRows=db.prepare(`WITH source AS (
      SELECT r.user_id,SUM(p.payable) payable,SUM(p.recoverable) recoverable
      FROM payroll_runs r JOIN users u ON u.id=r.user_id ${PAYROLL_SOURCE_JOINS} JOIN commission_positions p ON p.run_id=r.id
      WHERE r.base_salary=0 AND r.deductions=0 AND r.earned_commission>0 AND (:branch IS NULL OR ${PAYROLL_BRANCH_SQL}=:branch) GROUP BY r.user_id
    ), book AS (
      SELECT l.employee_id user_id,SUM(CASE WHEN l.account_code='2030' THEN l.credit-l.debit ELSE 0 END) payable,
      SUM(CASE WHEN l.account_code='1320' THEN l.debit-l.credit ELSE 0 END) recoverable
      FROM accounting_lines l JOIN accounting_journals j ON j.id=l.journal_id WHERE j.state IN ('posted','reversed')
      AND l.account_code IN ('2030','1320') AND (:branch IS NULL OR j.branch_id=:branch) GROUP BY l.employee_id
    ) SELECT u.id,COALESCE(s.payable,0) payable,COALESCE(s.recoverable,0) recoverable,
      COALESCE(b.payable,0) ledger_payable,COALESCE(b.recoverable,0) ledger_recoverable
      FROM users u LEFT JOIN source s ON s.user_id=u.id LEFT JOIN book b ON b.user_id=u.id
      WHERE u.id>:after AND (s.user_id IS NOT NULL OR b.user_id IS NOT NULL) ORDER BY u.id LIMIT 101`).all({branch,after:employeeAfter});
    const employees=employeeRows.slice(0,100).map(row=>({id:Number(row.id),payable:Number(row.payable),recoverable:Number(row.recoverable),
      ledger_payable:Number(row.ledger_payable),ledger_recoverable:Number(row.ledger_recoverable),
      payable_difference:signedSafe(BigInt(Number(row.payable))-BigInt(Number(row.ledger_payable))),
      recoverable_difference:signedSafe(BigInt(Number(row.recoverable))-BigInt(Number(row.ledger_recoverable)))}));
    const customers=rows(customerRows),suppliers=rows(supplierRows),inventoryDifference=operationalInventory-ledgerInventory;
    let pendingInventory=BigInt(0),reversedInventory=BigInt(0);
    for(const m of db.prepare(`SELECT m.qty,m.extended_cost,j.state,ol.event_id opening_id FROM inventory_movements m
      JOIN accounting_events e ON e.source_type='stock' AND e.source_id=CAST(m.id AS TEXT)
      LEFT JOIN accounting_event_reviews r ON r.event_id=e.id LEFT JOIN accounting_journals j ON j.id=r.journal_id
      LEFT JOIN accounting_opening_event_links ol ON ol.event_id=e.id WHERE m.valuation_json IS NOT NULL AND (:branch IS NULL OR m.branch_id=:branch) AND (j.id IS NULL OR j.state='reversed')`).iterate({branch})){
      if(m.opening_id!=null)continue;const amount=BigInt(Number(m.extended_cost))*(Number(m.qty)<0?BigInt(-1):BigInt(1));if(m.state==='reversed')reversedInventory+=amount;else pendingInventory+=amount;
    }
    const coverage=eventCoverage(db,branch);
    return {currency:"IRR",basis:"current_source_records_vs_posted_control_accounts",branch_id:branch,customers,suppliers,employees,coverage,
      nextEmployee:employeeRows.length>100?Number(employeeRows[99].id):null,
      nextCustomer:customerRows.length>100?Number(customerRows[99].id):null,nextSupplier:supplierRows.length>100?Number(supplierRows[99].id):null,
      inventory:{operational:signedSafe(operationalInventory),ledger:signedSafe(ledgerInventory),difference:signedSafe(inventoryDifference)},
      inventoryTiming:{pending_posting_value:signedSafe(pendingInventory),reversed_posting_value:signedSafe(reversedInventory),unexplained_difference:signedSafe(inventoryDifference-pendingInventory-reversedInventory)},
      unattributedControlLines:Number(unattributed),requiresReview:coverage.missingSourceCount>0||customerRows.length>100||supplierRows.length>100||employeeRows.length>100||employees.some(r=>r.payable_difference!==0||r.recoverable_difference!==0)||customers.some(r=>r.difference!==0)||suppliers.some(r=>r.difference!==0)||inventoryDifference!==BigInt(0)||Number(unattributed)>0,
      limitations:["Opening balances and recognition policy require approval","Historical bank statements and WIP recognition are not certified","Employee source covers separate commission runs; mixed salary/deduction documents require review","Control accounts: 1100/2010, 2000, 1110, 2030, 1320, 1020"]};
  });
}
