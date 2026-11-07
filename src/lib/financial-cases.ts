import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { netInvoicePaid, pendingInvoiceAmount, INVOICE_BALANCES_CTE } from "@/lib/payment-state";
import { readSnapshot } from "@/lib/db/transaction";
import { HttpError } from "@/lib/api";

export type FinancialCase = {kind:string;entity_type:string;entity_id:number;branch_id:number;original:unknown;expected:unknown;
  evidence:unknown;root_cause:string;proposed_correction:string;financial_consequence:string;approval:string;verification:string;fingerprint:string};
function fingerprint(value:unknown) {return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
export function invoiceEvidence(db:DatabaseSync,id:number) {
  const invoice=db.prepare("SELECT id,number,type,customer_id,supplier_id,ticket_id,sale_id,purchase_order_id,branch_id,status,total,paid,due_date FROM invoices WHERE id=?").get(id);
  if(!invoice) return null;
  const payments=db.prepare(`SELECT p.id,p.invoice_id,p.customer_id,p.supplier_id,p.sale_id,p.ticket_id,p.amount,p.method,p.direction,p.branch_id,
    c.id cheque_id,c.status cheque_status,c.amount cheque_amount FROM payments p LEFT JOIN checks c ON c.payment_id=p.id WHERE p.invoice_id=? ORDER BY p.id LIMIT 2001`).all(id);
  const refunds=db.prepare("SELECT r.id,r.payment_id,r.invoice_id,r.amount,r.branch_id FROM refunds r JOIN payments p ON p.id=r.payment_id WHERE p.invoice_id=? ORDER BY r.id LIMIT 2001").all(id);
  if(payments.length>2000||refunds.length>2000)throw new HttpError(409,"مدارک این فاکتور بیش از ظرفیت بررسی یک‌مرحله‌ای است؛ بازبینی دسته‌ای مالی لازم است.");
  const direction=invoice.type==="purchase"?"out":"in";
  return {invoice,payments,refunds,settled:netInvoicePaid(db,id,direction),pending:pendingInvoiceAmount(db,id,direction)};
}
/** Explicit identities/values, no customer names, phone numbers or bank identifiers. */
export function financialCases(db:DatabaseSync,branchId?:number|null) {
  return readSnapshot(db,()=>{
    const cases:FinancialCase[]=[];
    const add=(value:Omit<FinancialCase,"fingerprint">)=>cases.push({...value,fingerprint:fingerprint(value)});
    let scanned=0;
    for(const invoice of db.prepare(`${INVOICE_BALANCES_CTE} SELECT id,branch_id,original_total total,stored_paid paid,settled_paid FROM invoice_balances
      WHERE (stored_paid!=settled_paid OR settled_paid>original_total) ${branchId==null?"":"AND branch_id=?"} ORDER BY id LIMIT 101`).iterate(...(branchId==null?[]:[branchId]))) {
      scanned++;
      const settled=Number(invoice.settled_paid);
      if(invoice.paid===settled && settled<=Number(invoice.total)) continue;
      const evidence=invoiceEvidence(db,Number(invoice.id))!;
      if(cases.length>=100) return {cases,truncated:true,scanned};
      if(invoice.paid!==settled) add({kind:"invoice_paid_cache",entity_type:"invoice",entity_id:Number(invoice.id),branch_id:Number(invoice.branch_id),original:{paid:invoice.paid,status:evidence.invoice.status},expected:{paid:settled},evidence,
        root_cause:"Stored paid cache does not apply the current settled-payment/refund predicate; exact historical write path is not proven.",
        proposed_correction:"Recompute only derived paid/status caches after separate approval, verified backup and isolated rehearsal; keep obligations and evidence unchanged.",
        financial_consequence:"No cash movement or revenue change; statuses and displayed receivable caches may change.",approval:"Distinct proposer and approving owner/admin; unchanged evidence hash at application.",verification:"Recalculate from payments/refunds/linked cheque status; integrity/FK and traceability checks."});
      if(settled>Number(invoice.total)) add({kind:"invoice_overpayment",entity_type:"invoice",entity_id:Number(invoice.id),branch_id:Number(invoice.branch_id),original:{total:invoice.total,settled},expected:{excess:settled-Number(invoice.total)},evidence,
        root_cause:"Settled source receipts exceed the invoiced obligation. Whether the excess is a valid advance or a mistaken receipt requires business evidence.",
        proposed_correction:"Review original receipt evidence; authorize an explicit customer credit allocation, refund or correcting document. Never clamp/delete receipts.",
        financial_consequence:"May reclassify receivable into customer liability; does not establish money actually returned.",approval:"Business owner/accountant approval of each disposition; no automatic correction supported.",verification:"Original receipts remain traceable, net customer position and any approved journal reconcile."});
    }
    const cheques=db.prepare(`SELECT id,kind,invoice_id,branch_id,amount,status FROM checks WHERE invoice_id IS NOT NULL AND payment_id IS NULL ${branchId==null?"":"AND branch_id=?"} ORDER BY id LIMIT 101`).all(...(branchId==null?[]:[branchId]));
    for(const cheque of cheques.slice(0,100)) {
      const candidates=db.prepare(`SELECT id,amount,method,direction,branch_id,customer_id,supplier_id FROM payments
        WHERE invoice_id=? AND amount=? AND branch_id=? AND method IN ('check','cheque') ORDER BY id LIMIT 21`).all(cheque.invoice_id,cheque.amount,cheque.branch_id);
      add({kind:"ambiguous_cheque",entity_type:"cheque",entity_id:Number(cheque.id),branch_id:Number(cheque.branch_id),original:cheque,expected:{payment_id:null,unambiguous:false},evidence:{candidates,invoice:invoiceEvidence(db,Number(cheque.invoice_id))},
        root_cause:"Legacy cheque references an invoice but has no persistent payment identity. Matching amounts alone do not prove settlement or ownership.",
        proposed_correction:"Inspect original instrument and bank evidence. Approve a specific identity link only when provenance is established; otherwise keep disputed status.",financial_consequence:"A valid link may change settlement eligibility and net invoice balance; no synthetic payment or bank credit is permitted.",approval:"Case-specific accounting/business approval; no automatic linking.",verification:"Instrument, payment, branch, party, direction, collection and bank evidence must agree."});
    }
    const purchases=db.prepare(`SELECT i.id,i.branch_id,i.number,i.total invoice_total,i.purchase_order_id,p.total purchase_total,p.items_total,p.tax,p.discount,p.shipping
      FROM invoices i JOIN purchase_orders p ON p.id=i.purchase_order_id WHERE i.status!='cancelled' AND p.status='received' AND i.total!=p.total
      ${branchId==null?"":"AND i.branch_id=?"} ORDER BY i.id LIMIT 101`).all(...(branchId==null?[]:[branchId]));
    for(const row of purchases.slice(0,100)) add({kind:"full_purchase_total",entity_type:"invoice",entity_id:Number(row.id),branch_id:Number(row.branch_id),original:{total:row.invoice_total},expected:{source_total:row.purchase_total},
      evidence:{source:row,invoice:invoiceEvidence(db,Number(row.id)),purchase_lines:db.prepare("SELECT id,part_id,qty,received_qty,unit_cost,total FROM purchase_order_items WHERE po_id=? ORDER BY id").all(row.purchase_order_id),
        invoice_lines:db.prepare("SELECT id,ref_id,qty,unit_price,total FROM invoice_items WHERE invoice_id=? ORDER BY id").all(row.id)},
      root_cause:"Finalized invoice differs from its fully received PO snapshot. Compare freight/discount/tax and source-line snapshots; original historical intention is not assumed.",
      proposed_correction:"Review supplier evidence and approve a debit/credit correction referencing original documents; retain the issued invoice unchanged.",financial_consequence:"May change supplier payable, tax or inventory/expense allocation according to the approved correction.",approval:"Supplier-document and accountant approval; no silent invoice rewrite.",verification:"Corrected supplier position and source documents reconcile without a second stock receipt."});
    return {cases,truncated:cheques.length>100||purchases.length>100,scanned};
  });
}
