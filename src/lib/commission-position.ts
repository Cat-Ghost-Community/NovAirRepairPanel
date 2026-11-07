import type {DatabaseSync} from 'node:sqlite';
import {HttpError} from '@/lib/api';
export function commissionPosition(db:DatabaseSync,run:number){const row=db.prepare('SELECT * FROM commission_positions WHERE run_id=?').get(run);if(!row)throw new HttpError(404,'سند پورسانت یافت نشد.');return row;}
/** A later source change requires another independently reviewed correction. */
export function correctedCommissionApproval(db:DatabaseSync,run:number,basisHash:string){return db.prepare("SELECT id,approved_by,basis_hash FROM commission_corrections WHERE run_id=? AND kind IN ('reduction','reinstatement') AND state='posted' ORDER BY id DESC LIMIT 1").get(run)?.basis_hash===basisHash;}
