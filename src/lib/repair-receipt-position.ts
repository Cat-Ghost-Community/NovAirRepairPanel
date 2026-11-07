import type {DatabaseSync} from 'node:sqlite';
import {HttpError,validate} from '@/lib/api';
import {readSnapshot} from '@/lib/db/transaction';

export type RepairReceiptPosition={net:bigint;pending:bigint;review:boolean};
/** Caller authorizes repair rows first. Receipt printouts never read t.deposit. */
export function repairReceiptPositions(db:DatabaseSync,ticketIds:number[],branch:number){
 if(!ticketIds.length||ticketIds.length>100)throw new HttpError(400,'تعداد پذیرش‌های قبض معتبر نیست.');
 const ids=ticketIds.map(id=>validate.id(id)),positions=new Map(ids.map(id=>[id,{net:BigInt(0),pending:BigInt(0),review:false}]));
 return readSnapshot(db,()=>{
  const rows=db.prepare(`SELECT t.id ticket_id,t.customer_id owner_customer,t.branch_id owner_branch,p.branch_id,p.customer_id,p.amount,p.refunded,p.settled,p.method
   FROM repair_tickets t JOIN installment_receipt_funds p ON p.ticket_id=t.id AND p.direction='in'
   WHERE t.id IN (${ids.map(()=>'?').join(',')}) AND t.branch_id=? ORDER BY p.id`).all(...ids,validate.id(branch));
  for(const row of rows){const position=positions.get(Number(row.ticket_id))!;
   if(!['cash','card','pos','transfer','bank','check','cheque'].includes(String(row.method))||row.customer_id!==row.owner_customer||row.branch_id!==row.owner_branch||![row.amount,row.refunded].every(v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0)||Number(row.refunded)>Number(row.amount)){position.review=true;continue;}
   const amount=BigInt(row.amount as number)-BigInt(row.refunded as number);if(row.settled===1)position.net+=amount;else position.pending+=amount;
  }
  return positions;
 });
}

export function groupReceiptPosition(db:DatabaseSync,groupId:string,customer:number,branch:number){
 const row=db.prepare(`SELECT r.payment_id,p.number,p.amount,p.refunded,p.allocated,p.credit_used,r.evidence_reference,r.confirmed_at,
 EXISTS(SELECT 1 FROM accounting_events e JOIN accounting_event_reviews v ON v.event_id=e.id JOIN accounting_journals j ON j.id=v.journal_id AND j.state='posted'
 WHERE e.source_type='payment' AND e.source_id=CAST(p.id AS TEXT) AND e.event_type='receipt') recognized
 FROM repair_group_receipts r JOIN installment_receipt_funds p ON p.id=r.payment_id WHERE r.group_id=? AND r.customer_id=? AND r.branch_id=? AND p.customer_id=r.customer_id AND p.branch_id=r.branch_id`).get(groupId,customer,branch);
 if(!row)return null;
 const valid=[row.amount,row.refunded,row.allocated,row.credit_used].every(v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0);
 const available=valid?BigInt(row.amount as number)-BigInt(row.refunded as number)-BigInt(row.allocated as number)-BigInt(row.credit_used as number):null;
 return {payment_id:Number(row.payment_id),number:String(row.number),amount:Number(row.amount),refunded:Number(row.refunded),allocated:Number(row.allocated),credit_used:Number(row.credit_used),evidence_reference:String(row.evidence_reference),confirmed_at:String(row.confirmed_at),available:available!=null&&available>=BigInt(0)?available:null,accounting_state:row.recognized===1?'posted':'pending_review'};
}
