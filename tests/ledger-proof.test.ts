import {describe,it} from 'node:test';import assert from 'node:assert/strict';
import {journalDigest,streamingJournalDigest,type LedgerProofHeader} from '../src/lib/ledger-proof';
const header:LedgerProofHeader={id:37,branch_id:2,period_id:4,posting_date:'2026-10-30',source_type:'manual',source_id:'proof-37',event_key:'manual:proof-37',memo:'preserved evidence',request_hash:'ab'.repeat(32),created_by:5,posted_by:6,posted_at:'2026-10-30T10:11:12.000Z',posted_sequence:11,previous_hash:'cd'.repeat(32),reversal_of:null};
const lines=[{position:0,account_code:'1000',debit:137,credit:0,memo:'cash',customer_id:7,supplier_id:null,employee_id:null,part_id:null,bank_account_id:null},{position:1,account_code:'4010',debit:0,credit:137,memo:'revenue',customer_id:7,supplier_id:null,employee_id:null,part_id:null,bank_account_id:null}];
describe('historical ledger proof format compatibility',()=>{
 it('streams the frozen historical bytes exactly, including empty, escaped and Persian evidence',()=>{
  for(const sample of [[],lines,[{...lines[0],memo:'فارسی \"متن\"\nخط بعدی'}]]){
   const proof=streamingJournalDigest(header);for(const line of sample)proof.line(line);
   assert.equal(proof.finish(),journalDigest(header,sample));assert.throws(()=>proof.finish(),/finished/);assert.throws(()=>proof.line(lines[0]),/finished/);
  }
  const proof=streamingJournalDigest(header);for(const line of lines)proof.line(line);
  assert.equal(proof.finish(),'f1c15c16269cc1968f490a07b89a9d6eea7b7222aaa46f794f95a070119e6d8e');
 });
 it('matches a frozen version-1 digest independently computed from canonical evidence bytes',()=>{assert.equal(journalDigest(header,lines),'f1c15c16269cc1968f490a07b89a9d6eea7b7222aaa46f794f95a070119e6d8e');});
 it('excludes mutable state but detects historical line and branch tampering',()=>{const original=journalDigest(header,lines);assert.equal(journalDigest({...header,state:'reversed'} as LedgerProofHeader,lines),original);assert.notEqual(journalDigest({...header,branch_id:1},lines),original);assert.notEqual(journalDigest(header,[{...lines[0],debit:138},lines[1]]),original);});
});
