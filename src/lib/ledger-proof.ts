import {createHash} from 'node:crypto';
export type LedgerProofHeader={id:number;branch_id:number;period_id:number;posting_date:string;source_type:string;source_id:string;event_key:string;memo:string;request_hash:string;created_by:number;posted_by:number|null;posted_at:string|null;posted_sequence:number|null;previous_hash:string|null;reversal_of:number|null};
/** Existing version-1 evidence format. Property order is intentional; do not silently change historical digests. */
export function journalDigest(header:LedgerProofHeader,lines:unknown[]):string{
 return createHash('sha256').update(JSON.stringify(evidence(header,lines))).digest('hex');
}
function evidence(header:LedgerProofHeader,lines:unknown[]){
 return {id:header.id,branch_id:header.branch_id,period_id:header.period_id,posting_date:header.posting_date,
  source_type:header.source_type,source_id:header.source_id,event_key:header.event_key,memo:header.memo,request_hash:header.request_hash,
  created_by:header.created_by,posted_by:header.posted_by,posted_at:header.posted_at,posted_sequence:header.posted_sequence,
  previous_hash:header.previous_hash,reversal_of:header.reversal_of,lines};
}
/** Same historical version-1 bytes with constant-memory line consumption. */
export function streamingJournalDigest(header:LedgerProofHeader){
 const hash=createHash('sha256').update(JSON.stringify(evidence(header,[])).slice(0,-2));let first=true,finished=false;
 return {
  line(line:unknown){if(finished)throw Error('Journal digest already finished');if(!first)hash.update(',');hash.update(JSON.stringify(line));first=false;},
  finish(){if(finished)throw Error('Journal digest already finished');finished=true;return hash.update(']}').digest('hex');},
 };
}
