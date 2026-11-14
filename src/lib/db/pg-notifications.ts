import {hasPerm} from '../perms-shared';
import {postgresNotificationVisibility} from './pg-notification-delivery';
import {createHash} from 'node:crypto';
import {HttpError} from '../http-error';
import {operationHash,operationKey} from '../operation-identity';
import {requirePostgresIdentity} from './pg-app-auth';
import {postgresRelation} from './postgres-auth';
import {safePostgresInteger,type PostgresDatabase} from './postgres';

/** Migration-owned extension: v4's manager-only INSERT guard stays installed. */
export function postgresNotificationStatements(schema:string){
 const t=(name:string)=>postgresRelation(schema,name);
 return [
  `CREATE TABLE ${t('pg_notification_operations')}(user_id bigint NOT NULL REFERENCES ${t('users')}(id),operation_key text NOT NULL,request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),branch_id bigint REFERENCES ${t('branches')}(id),result_json text NOT NULL,created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,operation_key),CHECK(operation_key ~ '^[A-Za-z0-9_-]{8,128}$'),CHECK(jsonb_typeof(result_json::jsonb)='object'))`,
  `CREATE FUNCTION ${t('pg_notification_read_guard')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $guard$BEGIN IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'Notification history cannot be deleted' USING ERRCODE='23514'; END IF; IF (to_jsonb(NEW)-'read') IS DISTINCT FROM (to_jsonb(OLD)-'read') OR NEW.read IS DISTINCT FROM 1::bigint OR (OLD.read IS NOT NULL AND OLD.read NOT IN (0,1)) THEN RAISE EXCEPTION 'Only marking an existing notification read is permitted' USING ERRCODE='23514'; END IF; RETURN NEW; END$guard$`,
  `DROP TRIGGER repaid_unported_write ON ${t('notifications')}`,
  `CREATE TRIGGER pg_notification_read_only BEFORE UPDATE OR DELETE ON ${t('notifications')} FOR EACH ROW EXECUTE FUNCTION ${t('pg_notification_read_guard')}()`,
  `CREATE TRIGGER repaid_unported_write BEFORE TRUNCATE ON ${t('notifications')} FOR EACH STATEMENT EXECUTE FUNCTION ${t('repaid_unported_write_fence')}()`,
  `CREATE FUNCTION ${t('pg_notification_operation_immutable')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $guard$BEGIN RAISE EXCEPTION 'Notification operation history is immutable' USING ERRCODE='23514'; END$guard$`,
  `CREATE TRIGGER pg_notification_operation_history BEFORE UPDATE OR DELETE OR TRUNCATE ON ${t('pg_notification_operations')} FOR EACH STATEMENT EXECUTE FUNCTION ${t('pg_notification_operation_immutable')}()`,
  `CREATE INDEX pg_notifications_recipient_page ON ${t('notifications')}(user_id,branch_id,created_at DESC NULLS LAST,id DESC)`,
 ];
}
export function postgresNotificationChecksum(){return createHash('sha256').update(JSON.stringify(postgresNotificationStatements('repaid'))).digest('hex');}
function pagination(page:unknown,limit:unknown){const p=Number(page??1),n=Number(limit??30);if(!Number.isSafeInteger(p)||p<1||p>100000||!Number.isSafeInteger(n)||n<1||n>100)throw new HttpError(400,'صفحه یا تعداد اعلان‌ها معتبر نیست.');return {page:p,limit:n};}

export async function listPostgresNotifications(db:PostgresDatabase,schema:string,token:string,branchId:number|null,page:unknown=1,limit:unknown=30){
 const paging=pagination(page,limit),t=postgresRelation(schema,'notifications');
 return db.transaction(async()=>{
  const scope=await requirePostgresIdentity(db,schema,token,undefined,branchId),user=scope.session.user.id;
  if((await db.query(`SELECT 1 FROM ${t} n WHERE ${postgresNotificationVisibility(schema,'$1','$2','n',hasPerm(scope.permissions,'chat.view'))} AND read IS NOT NULL AND read NOT IN (0,1) LIMIT 1`,[user,scope.branchId])).rowCount)throw new HttpError(409,'وضعیت اعلان‌های قدیمی نیازمند بررسی است.');
  const rows=(await db.query(`SELECT * FROM ${t} n WHERE ${postgresNotificationVisibility(schema,'$1','$2','n',hasPerm(scope.permissions,'chat.view'))} ORDER BY created_at DESC NULLS LAST,id DESC LIMIT $3 OFFSET $4`,[user,scope.branchId,paging.limit+1,(paging.page-1)*paging.limit])).rows;
  const count=(await db.query(`SELECT COUNT(*) unread FROM ${t} n WHERE ${postgresNotificationVisibility(schema,'$1','$2','n',hasPerm(scope.permissions,'chat.view'))} AND (read=0 OR read IS NULL)`,[user,scope.branchId])).rows[0];
  return {...paging,notifications:rows.slice(0,paging.limit).map(row=>({...row,id:safePostgresInteger(row.id),user_id:safePostgresInteger(row.user_id),branch_id:row.branch_id==null?null:safePostgresInteger(row.branch_id),read:row.read==null?0:safePostgresInteger(row.read)})),hasMore:rows.length>paging.limit,unread:safePostgresInteger(count.unread)};
 },{isolation:'repeatable read'});
}

export async function markPostgresNotifications(db:PostgresDatabase,schema:string,token:string,branchId:number|null,keyInput:unknown,input:{action:unknown;id?:unknown}){
 const key=operationKey(keyInput),action=input.action;
 if(action!=='mark_read'&&action!=='mark_all_read')throw new HttpError(400,'عملیات اعلان معتبر نیست.');
 if(Object.keys(input).some(name=>name!=='action'&&name!=='id')||(action==='mark_all_read'&&input.id!=null))throw new HttpError(400,'اطلاعات عملیات اعلان معتبر نیست.');
 const id=action==='mark_read'?Number(input.id):null;
 if(id!=null&&(!Number.isSafeInteger(id)||id<=0))throw new HttpError(400,'شناسهٔ اعلان معتبر نیست.');
 const table=(name:string)=>postgresRelation(schema,name);
 return db.transaction(async()=>{
  const scope=await requirePostgresIdentity(db,schema,token,undefined,branchId,true),user=scope.session.user.id;
  const hash=operationHash({action,id,branch_id:scope.branchId});
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[schema,'notification:'+user+':'+key]);
  const prior=(await db.query(`SELECT request_hash,result_json FROM ${table('pg_notification_operations')} WHERE user_id=$1 AND operation_key=$2`,[user,key])).rows[0];
  if(prior){if(prior.request_hash!==hash)throw new HttpError(409,'این شناسه قبلاً برای درخواست دیگری استفاده شده است.');return JSON.parse(String(prior.result_json)) as {ok:true;updated:number};}
  if((await db.query(`SELECT 1 FROM ${table('notifications')} n WHERE ${postgresNotificationVisibility(schema,'$1','$2','n',hasPerm(scope.permissions,'chat.view'))} AND ($3::bigint IS NULL OR id=$3) AND read IS NOT NULL AND read NOT IN (0,1) LIMIT 1`,[user,scope.branchId,id])).rowCount)throw new HttpError(409,'وضعیت اعلان قدیمی نیازمند بررسی است.');
  if(id!=null&&!(await db.query(`SELECT id FROM ${table('notifications')} n WHERE n.id=$1 AND ${postgresNotificationVisibility(schema,'$2','$3','n',hasPerm(scope.permissions,'chat.view'))} FOR UPDATE`,[id,user,scope.branchId])).rowCount)throw new HttpError(404,'اعلان یافت نشد.');
  const changed=await db.query(`UPDATE ${table('notifications')} n SET read=1 WHERE ${postgresNotificationVisibility(schema,'$1','$2','n',hasPerm(scope.permissions,'chat.view'))} AND ($3::bigint IS NULL OR id=$3) AND (read=0 OR read IS NULL) RETURNING id`,[user,scope.branchId,id]);
  const result={ok:true as const,updated:changed.rowCount??0};
  await db.query(`INSERT INTO ${table('audit_logs')}(user_id,action,entity,entity_id,"after",branch_id) VALUES($1,'update','notification',$2,$3,$4)`,[user,id,JSON.stringify({action,updated:result.updated,operation_key:key}),scope.branchId]);
  await db.query(`INSERT INTO ${table('pg_notification_operations')}(user_id,operation_key,request_hash,branch_id,result_json) VALUES($1,$2,$3,$4,$5)`,[user,key,hash,scope.branchId,JSON.stringify(result)]);
  return result;
 });
}
