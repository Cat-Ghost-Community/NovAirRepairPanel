import type {PostgresDatabase} from './postgres';
import {postgresRelation} from './postgres-auth';
import {requirePostgresIdentity} from './pg-app-auth';
import {DEVICE_CATALOG_KEY,parseDeviceCatalog,reviseDeviceCatalog} from '../device-catalog';
import {HttpError} from '../http-error';
export async function readPostgresDeviceCatalog(db:PostgresDatabase,schema:string){return parseDeviceCatalog((await db.query(`SELECT value FROM ${postgresRelation(schema,'settings')} WHERE key=$1`,[DEVICE_CATALOG_KEY])).rows[0]?.value as string|undefined);}
export async function savePostgresDeviceCatalog(db:PostgresDatabase,schema:string,token:string|undefined,payload:unknown){return db.transaction(async()=>{
 const actor=await requirePostgresIdentity(db,schema,token,'settings.edit',null);if(actor.session.user.role!=='owner')throw new HttpError(403,'فقط مدیر اصلی شرکت می‌تواند انواع دستگاه را تغییر دهد.');
 await db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[schema,'device.catalog']);
 const before=await readPostgresDeviceCatalog(db,schema),after=reviseDeviceCatalog(before,payload);
 await db.query(`INSERT INTO ${postgresRelation(schema,'settings')}(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,[DEVICE_CATALOG_KEY,JSON.stringify(after)]);
 await db.query(`INSERT INTO ${postgresRelation(schema,'audit_logs')}(user_id,action,entity,entity_id,"before","after") VALUES($1,'update','device_catalog',0,$2,$3)`,[actor.session.user.id,JSON.stringify(before),JSON.stringify(after)]);return after;
});}
