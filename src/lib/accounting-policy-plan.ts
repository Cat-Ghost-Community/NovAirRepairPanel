import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { HttpError } from "@/lib/api";
import { rial,sumRial } from "@/lib/money";
import { cancellationPosition } from '@/lib/repair-cancellation';

/** Versioned, deliberately narrow alternatives. No policy is enabled by DDL. */
import {recognitionTemplates,type RecognitionKind} from './recognition-templates';
export {recognitionTemplates,type RecognitionKind} from './recognition-templates';

function recognizedSource(db:DatabaseSync,type:'invoice'|'commission',id:number,branch:unknown){
 if(type==='invoice'&&db.prepare("SELECT id FROM invoices WHERE id=? AND branch_id=? AND total=0 AND status NOT IN ('draft','cancelled')").get(id,Number(branch)))return true;
 if(type==='invoice'){
  const source=db.prepare("SELECT sale_id FROM invoices WHERE id=? AND branch_id=? AND status NOT IN ('draft','cancelled')").get(id,Number(branch));
  if(source?.sale_id&&db.prepare(`SELECT e.id FROM accounting_events e LEFT JOIN accounting_event_reviews r ON r.event_id=e.id LEFT JOIN accounting_journals j ON j.id=r.journal_id LEFT JOIN accounting_opening_event_links o ON o.event_id=e.id WHERE e.source_type='sale' AND e.source_id=? AND e.branch_id=? AND (j.state='posted' OR o.event_id IS NOT NULL) LIMIT 1`).get(String(source.sale_id),Number(branch)))return true;
 }
 if(db.prepare(`SELECT e.id FROM accounting_events e LEFT JOIN accounting_event_reviews r ON r.event_id=e.id
 LEFT JOIN accounting_journals j ON j.id=r.journal_id LEFT JOIN accounting_opening_event_links o ON o.event_id=e.id
 WHERE e.source_type=? AND e.source_id=? AND e.branch_id=? AND e.event_type=? AND (j.state='posted' OR o.event_id IS NOT NULL) LIMIT 1`)
 .get(type,String(id),Number(branch),type==='invoice'?'confirm':'accrual'))return true;
 // Only genuinely pre-registry sources can use the reviewed legacy opening.
 const cutoff=db.prepare('SELECT watermarks_json FROM accounting_cutover WHERE id=1').get();
 return id<=Number(JSON.parse(String(cutoff?.watermarks_json??'{}'))[type]??0)
   &&Boolean(db.prepare("SELECT id FROM accounting_opening_documents WHERE branch_id=? AND status='posted'").get(Number(branch)));
}
export function automaticPlan(db:DatabaseSync,eventId:number){
 const event=db.prepare("SELECT * FROM accounting_events WHERE id=?").get(eventId);
 if(!event)return null;
 if(createHash("sha256").update(String(event.payload_json)).digest("hex")!==event.payload_hash)throw new HttpError(409,"اثر انگشت رویداد مالی معتبر نیست.");
 const payload=JSON.parse(String(event.payload_json)),d=payload.document,amount=rial(payload.control_amount);
 if(!amount||event.actor_id==null)return null;
 const date=String(event.created_at).slice(0,10);
 // A late/backdated source must be reviewed, never silently shifted to today.
 const sourceDate=event.source_type==='invoice'?db.prepare('SELECT date FROM invoices WHERE id=?').get(d.id)?.date:d.date??d.payment_date;
 if(sourceDate!=null&&String(sourceDate).slice(0,10)!==date)return null;
 let kind:RecognitionKind|undefined;
 let debitOverride:string|undefined,creditOverride:string|undefined;
 if(event.source_type==='invoice'&&event.event_type==='advance_allocation'&&d.type==='repair'&&Array.isArray(payload.advance_allocations)&&payload.advance_allocations.length&&payload.advance_allocations.length<=1000&&recognizedSource(db,'invoice',d.id,event.branch_id)){
  const allocations=payload.advance_allocations as Array<{payment_id:number;amount:number;method:string;customer_id:number;branch_id:number;ticket_id:number;invoice_id:number;refunded:number;receipt_event_id:number}>;
  const eventIds=allocations.map(a=>a.receipt_event_id);
  const receipts=eventIds.every(Number.isSafeInteger)?db.prepare(`SELECT e.id,e.payload_json,e.payload_hash,SUM(CASE WHEN l.account_code='2010' THEN l.credit-l.debit ELSE 0 END) advance_amount
    FROM accounting_events e JOIN accounting_event_reviews r ON r.event_id=e.id JOIN accounting_journals j ON j.id=r.journal_id AND j.state='posted'
    JOIN accounting_lines l ON l.journal_id=j.id WHERE e.id IN (${eventIds.map(()=>'?').join(',')}) AND e.source_type='payment' AND e.branch_id=? GROUP BY e.id`).all(...eventIds,event.branch_id):[];
  const byId=new Map(receipts.map(r=>[Number(r.id),r]));
  if(new Set(allocations.map(a=>a.payment_id)).size===allocations.length&&sumRial(allocations.map(a=>rial(a.amount)))===amount&&allocations.every(a=>{
    const receipt=byId.get(a.receipt_event_id),source=receipt?JSON.parse(String(receipt.payload_json)).document:null;
    return a.method==='cash'&&a.refunded===0&&a.invoice_id===d.id&&a.branch_id===event.branch_id&&a.customer_id===d.customer_id&&a.ticket_id===d.ticket_id&&receipt?.advance_amount===a.amount&&createHash('sha256').update(String(receipt.payload_json)).digest('hex')===receipt.payload_hash&&source?.id===a.payment_id&&source.invoice_id==null&&source.sale_id==null&&source.ticket_id===d.ticket_id&&source.customer_id===d.customer_id&&source.method==='cash'&&source.direction==='in'&&source.amount===a.amount&&source.branch_id===event.branch_id;
  }))kind='advance_allocation_v1';
 }
 if(event.source_type==='credit_note'&&d.status==='approved'&&!d.service_correction){
  const original=db.prepare('SELECT * FROM invoices WHERE id=?').get(d.invoice_id);
  const bounds=db.prepare('SELECT COALESCE(SUM(total),0) total,COALESCE(SUM(line_discount),0) discount FROM invoice_items WHERE invoice_id=?').get(d.invoice_id)!;
  const returned=db.prepare('SELECT COALESCE(SUM(l.gross_limit),0) amount FROM business_return_lines l WHERE l.return_id=? AND l.disposition!=\'rejected\'').get(d.return_id)!;
  if(original&&original.tax===0&&original.discount===0&&d.tax_amount===0&&bounds.discount===0&&bounds.total===original.total&&d.net_amount===returned.amount&&recognizedSource(db,'invoice',d.invoice_id,event.branch_id)){
   if(d.customer_id){const accounts=db.prepare(`SELECT l.account_code,SUM(l.credit-l.debit) amount FROM accounting_events e JOIN accounting_event_reviews r ON r.event_id=e.id JOIN accounting_journals j ON j.id=r.journal_id JOIN accounting_lines l ON l.journal_id=j.id
     WHERE j.state='posted' AND l.account_code IN ('4000','4010') AND ((e.source_type='invoice' AND e.source_id=? AND e.event_type='confirm') OR (e.source_type='sale' AND e.source_id=?)) GROUP BY l.account_code HAVING amount>0`).all(String(original.id),String(original.sale_id??-1));
    if(accounts.length===1&&Number(accounts[0].amount)>=amount){kind='customer_return_credit_v1';debitOverride=String(accounts[0].account_code);}
   }else if(db.prepare(`SELECT l.id FROM accounting_events e JOIN accounting_event_reviews r ON r.event_id=e.id JOIN accounting_journals j ON j.id=r.journal_id JOIN accounting_lines l ON l.journal_id=j.id WHERE e.source_type='invoice' AND e.source_id=? AND e.event_type='confirm' AND j.state='posted' AND l.account_code='2000' AND l.credit>=? LIMIT 1`).get(String(original.id),amount))kind='supplier_return_credit_v1';
  }
 }
 if(event.source_type==='stock'&&d.ref_type==='business_return'||event.source_type==='return_cost'){
  const line=db.prepare(`SELECT l.*,r.kind,r.invoice_id,i.type,i.sale_id,i.supplier_id FROM business_return_lines l JOIN business_returns r ON r.id=l.return_id JOIN invoices i ON i.id=r.invoice_id WHERE l.id=?`).get(event.source_type==='stock'?d.ref_id:d.id);
  if(line&&recognizedSource(db,'invoice',Number(line.invoice_id),event.branch_id)){
   if(line.kind==='supplier'&&event.source_type==='stock'){kind=Number(line.qty_micro)%1000000?'supplier_return_stock_v2':'supplier_return_stock_v1';d.supplier_id=line.supplier_id;}
   else if(line.kind==='customer'&&(db.prepare("SELECT id FROM credit_notes WHERE return_id=? AND status='posted'").get(line.return_id)||db.prepare('SELECT id FROM business_returns WHERE id=? AND zero_credit_approved_by IS NOT NULL').get(line.return_id))){
    const cogs=line.type==='repair'?'5010':'5000';
    const knownCost=db.prepare(`SELECT m.id FROM inventory_movements m JOIN accounting_events e ON e.source_type='stock' AND e.source_id=CAST(m.id AS TEXT)
      JOIN accounting_event_reviews r ON r.event_id=e.id JOIN accounting_journals j ON j.id=r.journal_id JOIN accounting_lines l ON l.journal_id=j.id
      WHERE m.part_id=? AND m.qty<0 AND j.state='posted' AND l.account_code=? AND l.debit>=?
      AND ((m.ref_type='invoice' AND m.ref_id=?) OR (m.ref_type='sale' AND m.ref_id=?)) LIMIT 1`).get(line.part_id,cogs,amount,line.invoice_id,line.sale_id??-1);
    if(knownCost){creditOverride=cogs;
      const fractional=Number(line.qty_micro)%1000000!==0,basis=d.return_valuation;
      if(event.source_type==='return_cost')kind=fractional?'return_damage_cost_v2':'return_damage_cost_v1';
      else if(basis?.method==='original_cost_cumulative_v2'&&basis.after_value-basis.before_value===amount&&(fractional||basis.before_avg!==basis.after_avg||basis.after_avg!==line.unit_cost))kind='return_restock_cost_v2';
      else if(Number(db.prepare('SELECT avg_cost FROM parts WHERE id=?').get(line.part_id)!.avg_cost)===line.unit_cost)kind='return_restock_cost_v1';
    }
   }
  }
 }
 if(event.source_type==='refund'&&d.method==='cash'){
  const context=db.prepare("SELECT p.direction,p.supplier_id,p.customer_id,n.status FROM refunds f JOIN payments p ON p.id=f.payment_id JOIN credit_notes n ON n.return_id=f.return_id WHERE f.id=? AND n.status='posted'").get(d.id);
  if(context){kind=context.direction==='out'?'supplier_return_cash_v1':'return_cash_refund_v1';d.supplier_id=context.supplier_id;d.customer_id=context.customer_id;}
 }
 if(event.source_type==='payment'&&event.event_type==='receipt'&&d.direction==='in'&&d.method==='cash'&&d.customer_id){
   if(!d.invoice_id&&!d.sale_id)kind='cash_advance_v1';
   else if(d.invoice_id&&!d.sale_id){const i=db.prepare("SELECT type,status,customer_id FROM invoices WHERE id=?").get(d.invoice_id);
     if(i&&i.type!=='purchase'&&!['draft','cancelled'].includes(String(i.status))&&i.customer_id===d.customer_id&&recognizedSource(db,'invoice',d.invoice_id,event.branch_id))kind='cash_receivable_v1';}
 }
 if(event.source_type==='payment'&&d.direction==='out'&&d.method==='cash'&&d.invoice_id){const i=db.prepare("SELECT type,status,supplier_id FROM invoices WHERE id=?").get(d.invoice_id);
   if(i?.type==='purchase'&&!['draft','cancelled'].includes(String(i.status))&&i.supplier_id===d.supplier_id&&recognizedSource(db,'invoice',d.invoice_id,event.branch_id))kind='cash_payable_v1';}
 if(event.source_type==='commission_payment'&&d.method==='cash'&&recognizedSource(db,'commission',d.run_id,event.branch_id))kind='commission_cash_v1';
 if(event.source_type==='invoice'&&event.event_type==='confirm'&&d.type!=='purchase'&&!d.sale_id&&d.customer_id&&d.tax===0
   &&!['draft','cancelled'].includes(String(d.status))&&payload.lines.length>0&&payload.lines.every((l:{kind:string})=>l.kind==='labor'))kind='service_invoice_v1';
 if(event.source_type==='stock'&&d.carrying_valuation){
  const v=d.carrying_valuation;kind=undefined;debitOverride=undefined;creditOverride=undefined;
  if(v.method!=='location_carrying_v1'||v.amount!==amount||v.after_value-v.before_value!==(d.qty>0?amount:-amount))throw new HttpError(409,'مدرک ارزش‌گذاری گردش با مبلغ رویداد سازگار نیست.');
  if(d.type==='purchase'){kind='inventory_carrying_v1';debitOverride='1110';creditOverride='2100';}
  if(d.type==='sale'){kind='inventory_carrying_v1';debitOverride='5000';creditOverride='1110';}
  if(d.type==='repair_consumption'&&d.ref_type==='ticket_item'){kind='repair_parts_wip_v1';debitOverride='1120';creditOverride='1110';}
  if(['transfer_out','transfer_in'].includes(d.type)&&d.ref_type==='inventory_transfer'){
   kind='inventory_carrying_v1';debitOverride=d.type==='transfer_out'?'1300':'1110';creditOverride=d.type==='transfer_out'?'1110':'1300';
  }
  if(d.ref_type==='business_return'){
   const r=db.prepare('SELECT r.kind,r.id return_id,r.invoice_id FROM business_return_lines l JOIN business_returns r ON r.id=l.return_id WHERE l.id=?').get(d.ref_id);
   if(r&&recognizedSource(db,'invoice',Number(r.invoice_id),event.branch_id)){
    if(r.kind==='supplier'){kind='inventory_carrying_v1';debitOverride='1310';creditOverride='1110';}
    else if(db.prepare("SELECT n.id FROM credit_notes n JOIN invoices i ON i.id=n.invoice_id WHERE n.return_id=? AND n.status='posted' AND i.type!='repair'").get(r.return_id)
     &&db.prepare("SELECT m.id FROM inventory_movements m JOIN accounting_events e ON e.source_type='stock' AND e.source_id=CAST(m.id AS TEXT) JOIN accounting_event_reviews x ON x.event_id=e.id JOIN accounting_journals j ON j.id=x.journal_id JOIN accounting_lines l ON l.journal_id=j.id WHERE m.ref_type='invoice' AND m.ref_id=? AND m.part_id=? AND m.qty<0 AND j.state='posted' AND l.account_code='5000' AND l.debit>=? LIMIT 1").get(r.invoice_id,d.part_id,amount)){kind='inventory_carrying_v1';debitOverride='1110';creditOverride='5000';}
   }
  }
 }
 if(event.source_type==='repair'&&event.event_type==='cancellation'&&payload.cancellation?.wip_amount===amount&&amount>0&&!payload.cancellation.flags.some((f:string)=>['warranty_review','branch_cost_review','legacy_parts_evidence'].includes(f))&&cancellationPosition(db,Number(d.id)).wip_amount===amount){kind='repair_wip_cancel_v1';debitOverride='5010';creditOverride='1120';}
 if(event.source_type==='invoice'&&event.event_type==='repair_cost_recognition'&&payload.repair_carrying_cost_lines?.length){
  const movements=payload.repair_carrying_cost_lines as Array<{id:number;extended_cost:number}>;
  const recognized=movements.every(m=>db.prepare("SELECT l.id FROM accounting_lines l JOIN accounting_journals j ON j.id=l.journal_id JOIN accounting_event_reviews r ON r.journal_id=j.id JOIN accounting_events e ON e.id=r.event_id WHERE e.source_type='stock' AND e.source_id=? AND l.account_code='1120' AND l.debit=? AND j.state='posted' LIMIT 1").get(String(m.id),m.extended_cost));
  const actual=cancellationPosition(db,Number(d.ticket_id));
  if(recognized&&movements.reduce((n,m)=>n+BigInt(m.extended_cost),BigInt(0))===BigInt(amount)&&actual.wip_amount===amount&&!actual.flags.some(f=>['warranty_review','branch_cost_review','legacy_parts_evidence'].includes(f))){kind='repair_wip_complete_v1';debitOverride='5010';creditOverride='1120';}
 }
 if(!kind)return null;
 const policy=db.prepare("SELECT * FROM accounting_recognition_policies WHERE branch_id=? AND kind=? AND status='approved' AND min_event_id<? AND effective_date<=?").get(event.branch_id,kind,event.id,date);
 if(!policy)return null;
 if(d.carrying_valuation&&kind==='inventory_carrying_v1'&&policy.id!==d.carrying_valuation.policy_id)return null;
 const t=recognitionTemplates[kind],dims={customer_id:d.customer_id||null,supplier_id:d.supplier_id||null,employee_id:d.user_id||null};
 const line=(code:string,debit:number,credit:number)=>({account_code:code,debit,credit,
   customer_id:['1100','2010'].includes(code)?dims.customer_id:null,supplier_id:['2000','1310'].includes(code)?dims.supplier_id:null,employee_id:code==='2030'?dims.employee_id:null,
   part_id:['1110','1120'].includes(code)?d.part_id||null:null});
 return {event,policy,input:{branch_id:Number(event.branch_id),posting_date:date,memo:`ثبت خودکار طبق سیاست مصوب ${policy.id}: ${t.name}`,
   event_key:`financial-event:${event.id}`,source_type:'financial_event',source_id:String(event.id),lines:[line(debitOverride??t.debit,amount,0),line(creditOverride??t.credit,0,amount)]}};
}
