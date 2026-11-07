import type {DatabaseSync} from 'node:sqlite';
import {DEVICE_CATALOG_KEY,parseDeviceCatalog,reviseDeviceCatalog} from './device-catalog';
import {HttpError} from './http-error';
import type {Session} from './auth';
import {atomic} from './db/transaction';
export function readDeviceCatalog(db:DatabaseSync){return parseDeviceCatalog((db.prepare('SELECT value FROM settings WHERE key=?').get(DEVICE_CATALOG_KEY) as {value:string}|undefined)?.value);}
export function deviceTypeFacets(db:DatabaseSync,branch:number|null){return (db.prepare('SELECT d.type,COUNT(*) n FROM devices d WHERE d.is_archived=0 AND (? IS NULL OR d.id IN (SELECT device_id FROM device_branch_access WHERE branch_id=?)) GROUP BY d.type ORDER BY d.type').all(branch,branch) as {type:string;n:number}[]).map(row=>({id:row.type,count:row.n}));}
export function saveDeviceCatalog(db:DatabaseSync,session:Session,payload:unknown){
 if(session.user.role!=='owner')throw new HttpError(403,'فقط مدیر اصلی شرکت می‌تواند انواع دستگاه را تغییر دهد.');
 return atomic(db,()=>{const before=readDeviceCatalog(db),after=reviseDeviceCatalog(before,payload);db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(DEVICE_CATALOG_KEY,JSON.stringify(after));
 db.prepare('INSERT INTO audit_logs(user_id,action,entity,entity_id,"before","after") VALUES(?,?,?,?,?,?)').run(session.user.id,'update','device_catalog',0,JSON.stringify(before),JSON.stringify(after));return after;});
}
