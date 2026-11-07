import type {DatabaseSync} from 'node:sqlite';
import {multiplyRial,sumRial,rial} from '@/lib/money';
/** Source evidence only. Performed labor is never inferred from a quoted price. */
export function cancellationPosition(db:DatabaseSync,ticket:number){
 const parts=db.prepare("SELECT i.id,i.ref_id,i.qty,i.cost,i.consumed,m.id movement_id,m.extended_cost,m.branch_id movement_branch FROM ticket_items i LEFT JOIN inventory_movements m ON m.ref_type='ticket_item' AND m.ref_id=i.id AND m.type='repair_consumption' WHERE i.ticket_id=? AND i.kind='part' ORDER BY i.id LIMIT 1001").all(ticket);
 const legacy=db.prepare("SELECT id,part_id,qty,unit_cost,extended_cost,branch_id FROM inventory_movements WHERE ref_type='ticket' AND ref_id=? AND qty<0 ORDER BY id LIMIT 1001").all(ticket);
 const labor=db.prepare("SELECT id,kind,qty,cost,unit_price,consumed FROM ticket_items WHERE ticket_id=? AND kind IN ('labor','service') ORDER BY id LIMIT 1001").all(ticket);
 const time=db.prepare('SELECT id,user_id,started_at,ended_at,minutes_active FROM time_entries WHERE ticket_id=? ORDER BY id LIMIT 1001').all(ticket);
 const invoices=db.prepare("SELECT id,total,paid,status FROM effective_invoices WHERE ticket_id=? AND status!='draft' ORDER BY id LIMIT 1001").all(ticket);
 const receipts=db.prepare("SELECT p.id,p.amount,p.refunded,p.method,p.settled,p.invoice_id FROM installment_receipt_funds p WHERE (p.ticket_id=? OR p.invoice_id IN(SELECT id FROM invoices WHERE ticket_id=?)) AND p.direction='in' ORDER BY p.id LIMIT 1001").all(ticket,ticket);
 const commissions=db.prepare('SELECT r.id,r.user_id,r.branch_id,r.earned_commission,r.status,p.effective_commission,p.payable,p.recoverable FROM payroll_runs r JOIN commission_positions p ON p.run_id=r.id WHERE r.source_ticket_id=? ORDER BY r.id LIMIT 1001').all(ticket);
 const bounded=[parts,legacy,labor,time,invoices,receipts,commissions].every(rows=>rows.length<=1000);
 const amounts=db.prepare(`WITH sources AS(SELECT r.journal_id FROM accounting_event_reviews r JOIN accounting_events e ON e.id=r.event_id WHERE
  (e.source_type='stock' AND e.source_id IN (SELECT CAST(m.id AS TEXT) FROM inventory_movements m WHERE (m.ref_type='ticket' AND m.ref_id=?) OR (m.ref_type='ticket_item' AND m.ref_id IN(SELECT id FROM ticket_items WHERE ticket_id=?))))
  OR (e.source_type='repair' AND e.source_id=?) OR (e.source_type='invoice' AND e.event_type='repair_cost_recognition' AND e.source_id IN(SELECT CAST(id AS TEXT) FROM invoices WHERE ticket_id=?)))
  SELECT l.debit,l.credit FROM accounting_lines l JOIN accounting_journals j ON j.id=l.journal_id WHERE l.account_code='1120' AND j.state IN ('posted','reversed') AND (j.id IN(SELECT journal_id FROM sources) OR j.reversal_of IN(SELECT journal_id FROM sources))`).all(ticket,ticket,String(ticket),ticket);
 const wip=amounts.reduce((n,l)=>n+BigInt(Number(l.debit))-BigInt(Number(l.credit)),BigInt(0));
 if(wip<BigInt(0)||wip>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('ماندهٔ WIP پذیرش نیازمند تطبیق است.');
 const flags:string[]=[];
 if(!bounded)flags.push('large_history_review');if(invoices.some(i=>i.status!=='cancelled'&&Number(i.total)>0))flags.push('billing_decision');
 if(receipts.some(p=>Number(p.amount)>Number(p.refunded)))flags.push('receipt_or_pending_cheque');
 if(commissions.some(c=>Number(c.effective_commission)>0||Number(c.payable)>0||Number(c.recoverable)>0))flags.push('commission_correction');
 if(labor.length||time.length)flags.push('performed_labor_review');
 if(parts.some(p=>p.consumed&&!p.movement_id))flags.push('legacy_parts_evidence');
 const branch=db.prepare('SELECT branch_id FROM repair_tickets WHERE id=?').get(ticket)?.branch_id;
 if(parts.some(p=>p.movement_id&&p.movement_branch!==branch)||legacy.some(m=>m.branch_id!==branch))flags.push('branch_cost_review');
 if(legacy.length)flags.push('legacy_parts_evidence');
 if(db.prepare('SELECT i.id FROM ticket_items i JOIN repair_tickets t ON t.id=i.ticket_id JOIN inventory_stock s ON s.part_id=i.ref_id JOIN inventory_locations l ON l.id=s.location_id AND l.branch_id=t.branch_id WHERE i.ticket_id=? AND i.kind=\'part\' AND i.consumed=0 AND s.reserved>0 LIMIT 1').get(ticket))flags.push('reservation_ownership_review');
 const diagnostic=db.prepare('SELECT diagnosis,diagnostic_fee,is_warranty,original_ticket_id FROM repair_tickets WHERE id=?').get(ticket);if(diagnostic&&(diagnostic.diagnosis||Number(diagnostic.diagnostic_fee)>0))flags.push('diagnostic_fee_review');if(diagnostic&&(diagnostic.is_warranty||diagnostic.original_ticket_id))flags.push('warranty_review');
 if(wip>BigInt(0))flags.push('wip_settlement');
 return {parts,legacy_movements:legacy,labor,time,invoices,receipts,commissions,wip_amount:Number(wip),parts_cost:sumRial([...parts.filter(p=>p.consumed&&p.movement_id).map(p=>p.extended_cost==null?multiplyRial(rial(p.cost??0),Number(p.qty)):rial(p.extended_cost)),...legacy.map(m=>m.extended_cost==null?multiplyRial(rial(m.unit_cost??0),Math.abs(Number(m.qty))):rial(m.extended_cost))]),flags,requiresReview:flags.length>0};
}
