import fs from 'node:fs';import os from 'node:os';import {createHash,randomBytes} from 'node:crypto';import type {DatabaseSync} from 'node:sqlite';
import {atomic} from './db/transaction';import {HttpError} from './http-error';
import {cleanupFileSnapshot} from './backup';
type State={id:string;preparing:Set<string>;streaming:Set<string>};
const key=Symbol.for('repaid.backup.admission'),shared=globalThis as unknown as Record<symbol,State>;
const state=shared[key]??(shared[key]={id:randomBytes(24).toString('hex'),preparing:new Set(),streaming:new Set()});
const namespace=process.platform==='linux'?fs.readlinkSync('/proc/self/ns/pid'):process.platform;
const runtimeScope=createHash('sha256').update(os.hostname()+'|'+namespace).digest('hex');
type Owner={id:string;pid:number;instance_id:string;runtime_scope:string};
function abandoned(owner:Owner,phase:'preparing'|'streaming'){
 if(owner.runtime_scope!==runtimeScope)return false; // Another PID namespace is not evidence of a dead owner.
 if(owner.pid===process.pid)return owner.instance_id!==state.id||!state[phase].has(owner.id);
 try{process.kill(owner.pid,0);return false;}catch(error){return (error as NodeJS.ErrnoException).code==='ESRCH';}
}
/** Durable, cross-process admission BEFORE expensive snapshot allocation. No lease expiry can steal a live copy. */
export function reserveBackupPreparation(db:DatabaseSync,userId:number|null){
 cleanupExpiredBackupArtifacts(db);
 const id=randomBytes(24).toString('hex');atomic(db,()=>{
  for(const row of db.prepare("SELECT id,pid,instance_id,runtime_scope FROM backup_preparations WHERE state='preparing' LIMIT 100").all() as Owner[])if(abandoned(row,'preparing'))db.prepare("UPDATE backup_preparations SET state='abandoned' WHERE id=? AND state='preparing'").run(row.id);
  if(db.prepare("SELECT 1 FROM backup_preparations WHERE state='preparing' LIMIT 1").get())throw new HttpError(429,'پشتیبان‌گیری دیگری در حال آماده‌سازی است. پس از پایان آن دوباره تلاش کنید.');
  if(Number(db.prepare("SELECT count(*) n FROM backup_downloads WHERE state IN ('prepared','streaming')").get()?.n)>=2)throw new HttpError(429,'دو نسخه آماده یا در حال دریافت است. دریافت فعلی را تمام کنید یا پس از انقضا دوباره تلاش کنید.');
  db.prepare("INSERT INTO backup_preparations(id,user_id,pid,instance_id,runtime_scope,state,created_at) VALUES(?,?,?,?,?,'preparing',?)").run(id,userId,process.pid,state.id,runtimeScope,Date.now());
 });state.preparing.add(id);return id;
}
export function releaseBackupPreparation(db:DatabaseSync,id:string,failed=false){
 try{atomic(db,()=>{const result=db.prepare("UPDATE backup_preparations SET state=? WHERE id=? AND pid=? AND instance_id=? AND state='preparing'").run(failed?'failed':'released',id,process.pid,state.id);if(result.changes!==1)throw new Error('Backup preparation ownership changed');});}
 finally{state.preparing.delete(id);}
}
export async function withBackupPreparation<T>(db:DatabaseSync,userId:number|null,work:()=>Promise<T>){
 const id=reserveBackupPreparation(db,userId);try{const result=await work();releaseBackupPreparation(db,id);return result;}catch(error){if(state.preparing.has(id))try{releaseBackupPreparation(db,id,true);}catch{console.error(JSON.stringify({event:'backup_admission_cleanup_failed',id}));}throw error;}
}
/** Called in the same transaction as a one-use download claim. */
export function updateBackupStreamOwner(db:DatabaseSync,id:string,userId:number){
 db.prepare("INSERT INTO backup_preparations(id,user_id,pid,instance_id,runtime_scope,state,created_at) VALUES(?,?,?,?,?,'released',?) ON CONFLICT(id) DO UPDATE SET pid=excluded.pid,instance_id=excluded.instance_id,runtime_scope=excluded.runtime_scope").run(id,userId,process.pid,state.id,runtimeScope,Date.now());
}
export function trackBackupStream(id:string){state.streaming.add(id);}
export function untrackBackupStream(id:string){state.streaming.delete(id);}
/** Mark ownership loss transactionally before deleting any abandoned stream artifact. */
export function interruptedBackupStreams(db:DatabaseSync){return atomic(db,()=>{
 const rows=db.prepare("SELECT d.id,d.snapshot_path,d.backup_id,p.pid,p.instance_id,p.runtime_scope FROM backup_downloads d JOIN backup_preparations p ON p.id=d.id WHERE d.state='streaming' LIMIT 100").all(),expired=[];
 for(const row of rows)if(abandoned(row as unknown as Owner,'streaming')){db.prepare("UPDATE backup_downloads SET state='interrupted' WHERE id=? AND state='streaming'").run(row.id);db.prepare("UPDATE backups SET status='interrupted' WHERE id=?").run(row.backup_id);expired.push(row);}return expired;
});}
export function cleanupExpiredBackupArtifacts(db:DatabaseSync){
 const expired=atomic(db,()=>{const rows=db.prepare("SELECT id,snapshot_path,backup_id FROM backup_downloads WHERE state='prepared' AND expires_at<? LIMIT 100").all(Date.now());for(const row of rows){db.prepare("UPDATE backup_downloads SET state='expired' WHERE id=? AND state='prepared'").run(row.id);db.prepare("UPDATE backups SET status='expired' WHERE id=?").run(row.backup_id);}return rows;});
 for(const row of [...expired,...interruptedBackupStreams(db)])cleanupFileSnapshot(String(row.snapshot_path));
}
