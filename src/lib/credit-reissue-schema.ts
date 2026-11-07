import type { DatabaseSync } from 'node:sqlite';
import { RETURNS_DDL } from '@/lib/returns-schema';

export function legacyCreditUniqueness(db:DatabaseSync){
 return db.prepare("PRAGMA index_list('credit_notes')").all().some(index=>Number(index.unique)===1&&(()=>{
  const columns=db.prepare(`PRAGMA index_info("${String(index.name).replaceAll('"','""')}")`).all();
  return columns.length===1&&columns[0].name==='return_id'&&!Number(index.partial);
 })());
}
/** Empty development/new-business schemas may change safely inside startup's
 * rollback boundary. Nonempty financial history is NEVER rebuilt automatically.
 * Existing V5 workflows continue; replacement alone awaits a separately approved
 * backed-up migration on those installations. */
export function prepareEmptyCreditReissues(db:DatabaseSync){
 if(!legacyCreditUniqueness(db))return true;
 if(!db.isTransaction)throw new Error('Credit schema upgrade requires a transaction');
 if(Number(db.prepare('SELECT COUNT(*) n FROM credit_notes').get()!.n)||Number(db.prepare('SELECT COUNT(*) n FROM credit_note_lines').get()!.n))return false;
 db.exec('DROP TABLE credit_note_lines; DROP TABLE credit_notes;');
 db.exec(RETURNS_DDL);
 return true;
}
