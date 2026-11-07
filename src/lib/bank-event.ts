import {createHash} from 'node:crypto';

export type BankEventDocument={id:number;account_id:number;type:string;amount:number;to_account_id:number|null;date:string|null;check_id:number|null};
/** Historical source snapshot ordering and shape. No recognition is inferred. */
export function bankEventPayload(document:BankEventDocument){
  const payload={document:{id:document.id,account_id:document.account_id,type:document.type,amount:document.amount,to_account_id:document.to_account_id,date:document.date,check_id:document.check_id},lines:[],bank_evidence:[],repair_cost_lines:[],control_amount:document.check_id==null?document.amount:0,currency:'IRR',policy:'review_required',branch_basis:document.check_id==null?'actor_branch_requires_accounting_review':'cheque_branch_verified'};
  const json=JSON.stringify(payload);return {json,hash:createHash('sha256').update(json).digest('hex')};
}
