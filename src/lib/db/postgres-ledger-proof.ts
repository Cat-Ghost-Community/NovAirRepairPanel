import {createHash} from 'node:crypto';
import {journalDigest,type LedgerProofHeader} from '../ledger-proof';
import {safePostgresInteger,type PostgresDatabase} from './postgres';
import {postgresRelation} from './postgres-auth';
const numeric=['id','branch_id','period_id','created_by','posted_by','posted_sequence','reversal_of'] as const;
const dimensions=['customer_id','supplier_id','employee_id','part_id','bank_account_id'] as const;
/** Read-only asynchronous port of verifyLedger; identical existing digest, bounded keyset batches, no guessed postings. */
export async function verifyPostgresLedgerEvidence(db:PostgresDatabase,schema:string){
 const table=(name:string)=>postgresRelation(schema,name);table('accounting_journals');
 return db.transaction(async()=>{
  let previous='',sequence=0,count=0,events=0,after=0;const errors:Array<{id:number;reason:string}>=[];
  const problem=(id:number,reason:string)=>{if(errors.length<1000)errors.push({id,reason});};let errorCount=0;
  const malformed=await db.query(`SELECT id FROM ${table('accounting_journals')} WHERE state IN ('posted','reversed') AND (posted_sequence IS NULL OR posted_sequence<=0) LIMIT 1001`);for(const row of malformed.rows){problem(safePostgresInteger(row.id),'digest_or_sequence');errorCount++;}
  for(;;){const batch=await db.query(`SELECT * FROM ${table('accounting_journals')} WHERE state IN ('posted','reversed') AND posted_sequence>$1 ORDER BY posted_sequence LIMIT 100`,[after]);if(!batch.rowCount)break;
   const ids=batch.rows.map(row=>row.id),allLines=await db.query(`SELECT journal_id,position,account_code,debit,credit,memo,customer_id,supplier_id,employee_id,part_id,bank_account_id FROM ${table('accounting_lines')} WHERE journal_id=ANY($1::bigint[]) ORDER BY journal_id,position LIMIT 100001`,[ids]);
   // An individual journal is already bounded by application input; refuse oversized legacy evidence explicitly.
   if(allLines.rows.length>100000)throw new Error('Ledger batch exceeds bounded line verification capacity');
   const byJournal=new Map<string,Record<string,unknown>[]>();for(const raw of allLines.rows){const key=String(raw.journal_id),lines=byJournal.get(key)??[];lines.push(raw);byJournal.set(key,lines);}
   const reversed=await db.query(`SELECT reversal_of FROM ${table('accounting_journals')} WHERE reversal_of=ANY($1::bigint[]) AND state='posted'`,[ids]),reversals=new Set(reversed.rows.map(row=>String(row.reversal_of)));
   for(const raw of batch.rows){const header={...raw} as unknown as LedgerProofHeader;for(const field of numeric)(header as unknown as Record<string,unknown>)[field]=raw[field]==null?null:safePostgresInteger(raw[field]);const id=header.id;
    if(header.posted_sequence==null){problem(id,'digest_or_sequence');errorCount++;throw new Error('Posted journal has no sequence; migration evidence is invalid');}
    const lines=(byJournal.get(String(id))??[]).map(raw=>{const line:Record<string,unknown>={position:safePostgresInteger(raw.position as string),account_code:String(raw.account_code),debit:safePostgresInteger(raw.debit as string),credit:safePostgresInteger(raw.credit as string),memo:String(raw.memo)};for(const dimension of dimensions)line[dimension]=raw[dimension]==null?null:safePostgresInteger(raw[dimension] as string);return line;});
    if(header.posted_sequence!==++sequence||header.previous_hash!==previous||journalDigest(header,lines)!==raw.digest){problem(id,'digest_or_sequence');errorCount++;}
    const totals=lines.reduce<{debit:bigint;credit:bigint}>((sum,line)=>({debit:sum.debit+BigInt(line.debit as number),credit:sum.credit+BigInt(line.credit as number)}),{debit:BigInt(0),credit:BigInt(0)});
    if(lines.length<2||totals.debit!==totals.credit||totals.debit>BigInt(Number.MAX_SAFE_INTEGER)){problem(id,'unbalanced');errorCount++;}
    if(raw.state==='reversed'&&!reversals.has(String(id))){problem(id,'missing_reversal');errorCount++;}previous=String(raw.digest??'');after=header.posted_sequence;count++;
   }
  }
  const total=await db.query(`SELECT count(*) count FROM ${table('accounting_journals')} WHERE state IN ('posted','reversed')`);if(BigInt(total.rows[0].count)!==BigInt(count)){problem(0,'unverified_or_duplicate_sequence');errorCount++;}
  after=0;for(;;){const batch=await db.query(`SELECT id,event_key,source_type,source_id,branch_id,event_type,payload_json,payload_hash FROM ${table('accounting_events')} WHERE id>$1 ORDER BY id LIMIT 100`,[after]);if(!batch.rowCount)break;
   for(const row of batch.rows){const id=safePostgresInteger(row.id);if(createHash('sha256').update(String(row.payload_json)).digest('hex')!==row.payload_hash||row.event_key!==`${row.source_type}:${row.source_id}:${row.event_type}`){problem(id,'source_event_digest');errorCount++;}
    try{const payload=JSON.parse(String(row.payload_json));if(String(payload.document.id)!==row.source_id||(payload.document.branch_id!=null&&payload.document.branch_id!==safePostgresInteger(row.branch_id))){problem(id,'source_event_reference');errorCount++;}}catch{problem(id,'source_event_payload');errorCount++;}after=id;events++;
   }
  }return {count,events,valid:errorCount===0,error_count:errorCount,errors,errors_truncated:errorCount>errors.length,application_ready:false};
 },{isolation:'repeatable read',readOnly:true});
}
