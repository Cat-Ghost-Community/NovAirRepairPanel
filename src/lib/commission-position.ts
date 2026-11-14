import type {DatabaseSync} from 'node:sqlite';
import {HttpError} from '@/lib/api';
export function commissionPosition(db:DatabaseSync,run:number){
 const row=db.prepare('SELECT p.*,r.status run_status FROM commission_positions p JOIN payroll_runs r ON r.id=p.run_id WHERE p.run_id=?').get(run);
 if(!row)throw new HttpError(404,'سند پورسانت یافت نشد.');
 if(row.run_status==='cancelled'){
  if(Number(row.paid)>Number(row.recovered))throw new HttpError(409,'سند لغوشده دارای پرداخت است؛ ابتدا اصلاح و تطبیق مستند لازم است.');
  return {...row,effective_commission:0,effective_net:0,payable:0,recoverable:0};
 }
 return row;
}
/** A later source change requires another independently reviewed correction. */
export function correctedCommissionApproval(db:DatabaseSync,run:number,basisHash:string){return db.prepare("SELECT id,approved_by,basis_hash FROM commission_corrections WHERE run_id=? AND kind IN ('reduction','reinstatement') AND state='posted' ORDER BY id DESC LIMIT 1").get(run)?.basis_hash===basisHash;}
