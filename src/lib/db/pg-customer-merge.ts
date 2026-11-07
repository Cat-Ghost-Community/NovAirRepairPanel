import {readPostgresDeviceCatalog} from './pg-device-catalog';
import {createHash} from 'node:crypto';
import model from './pg-production-schema.json';
import {HttpError} from '../http-error';
import {postgresRelation} from './postgres-auth';
import {postgresDurableOperation} from './postgres-operations';
import {requirePostgresIdentity} from './pg-app-auth';
import {pgId,pgRecord,lockPostgresCustomerFunds,postgresFinancialAudit} from './pg-customer-finance';
import {postgresOperationalProfileStatements} from './pg-operational-profiles';
import {safePostgresInteger,type PostgresDatabase} from './postgres';

const referenceTables=model.tables.filter(table=>table.columns.some(column=>column.name==='customer_id')&&!['devices','customer_events'].includes(table.name)).map(table=>table.name);
const deviceReferences=model.tables.filter(table=>table.columns.some(column=>column.name==='device_id')).map(table=>table.name);
function conflictQuery(schema:string,source:string){
 const t=(name:string)=>postgresRelation(schema,name),ids=`(${source})`;
 const checks=referenceTables.map(name=>`EXISTS(SELECT 1 FROM ${t(name)} WHERE customer_id IN ${ids})`);
 checks.push(`EXISTS(SELECT 1 FROM ${t('customers')} WHERE referrer_customer_id IN ${ids})`);
 checks.push(`EXISTS(SELECT 1 FROM ${t('accounting_events')} WHERE (payload_json::jsonb #>> '{document,customer_id}')=${source}::text)`);
 for(const name of deviceReferences)checks.push(`EXISTS(SELECT 1 FROM ${t(name)} r JOIN ${t('devices')} d ON d.id=r.device_id WHERE d.customer_id IN ${ids})`);
 return checks.join(' OR ');
}
/** Forward-only migration6 contribution. Existing v1-v5 checksums stay intact. */
export function postgresCustomerMergeStatements(schema:string){
 const t=(name:string)=>postgresRelation(schema,name);
 const original=postgresOperationalProfileStatements(schema)[0];
 const ownership='NEW.id IS DISTINCT FROM OLD.id OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.branch_id IS DISTINCT FROM OLD.branch_id OR NEW.created_at IS DISTINCT FROM OLD.created_at';
 if(!original.includes(ownership))throw Error('Reviewed device guard changed; merge integration requires review');
 const replacement=original.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION').replace(ownership,'NEW.id IS DISTINCT FROM OLD.id OR NEW.branch_id IS DISTINCT FROM OLD.branch_id OR NEW.created_at IS DISTINCT FROM OLD.created_at').replace("IF NEW.type NOT IN",`IF TG_OP='UPDATE' AND NEW.customer_id IS DISTINCT FROM OLD.customer_id AND NOT (
   (to_jsonb(NEW)-'customer_id')=(to_jsonb(OLD)-'customer_id') AND EXISTS(SELECT 1 FROM ${t('merge_log')} m WHERE m.merged_id=OLD.customer_id AND m.master_id=NEW.customer_id AND (m.moved_counts::jsonb->'device_ids') @> jsonb_build_array(OLD.id))
  ) THEN RAISE EXCEPTION 'Device reassignment requires exact immutable merge evidence' USING ERRCODE='23514'; END IF;
  IF NEW.type NOT IN`);
 return [
  `DO $merge$BEGIN IF EXISTS(SELECT 1 FROM ${t('merge_log')}) THEN RAISE EXCEPTION 'Populated legacy merge evidence requires reviewed migration; original rows remain unchanged'; END IF;END$merge$`,
  `CREATE UNIQUE INDEX pg_customer_merge_source ON ${t('merge_log')}(merged_id)`,
  `CREATE FUNCTION ${t('pg_customer_merge_guard')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $merge$
   DECLARE source record; target record; expected jsonb;
   BEGIN
    IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Merge evidence is immutable' USING ERRCODE='23514'; END IF;
    PERFORM id FROM ${t('customers')} WHERE id IN (NEW.merged_id,NEW.master_id) ORDER BY id FOR UPDATE;
    SELECT * INTO source FROM ${t('customers')} WHERE id=NEW.merged_id;
    SELECT * INTO target FROM ${t('customers')} WHERE id=NEW.master_id;
    IF source.id IS NULL OR target.id IS NULL OR source.id=target.id OR source.branch_id IS NULL OR source.branch_id IS DISTINCT FROM target.branch_id OR source.is_archived IS DISTINCT FROM 0::bigint OR target.is_archived IS DISTINCT FROM 0::bigint THEN RAISE EXCEPTION 'Merge requires active same-branch original profiles' USING ERRCODE='23514'; END IF;
    IF source.is_blacklisted=1 AND target.is_blacklisted IS DISTINCT FROM 1::bigint THEN RAISE EXCEPTION 'Merge cannot remove an existing customer safety warning' USING ERRCODE='23514'; END IF;
    IF EXISTS(SELECT 1 FROM ${t('merge_log')} WHERE merged_id IN (source.id,target.id) OR master_id=source.id) OR ${conflictQuery(schema,'source.id')} THEN RAISE EXCEPTION 'Referenced customer requires reviewed correction, not profile merge' USING ERRCODE='23514'; END IF;
    IF EXISTS(SELECT 1 FROM ${t('devices')} WHERE customer_id=source.id AND branch_id IS DISTINCT FROM source.branch_id) THEN RAISE EXCEPTION 'Legacy or cross-branch device ownership cannot be guessed' USING ERRCODE='23514'; END IF;
    IF NOT EXISTS(SELECT 1 FROM ${t('users')} WHERE id=NEW.user_id AND is_active=1 AND (role IN ('owner','admin') OR branch_id=source.branch_id)) THEN RAISE EXCEPTION 'Merge actor outside source employment scope' USING ERRCODE='23514'; END IF;
    SELECT COALESCE(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO expected FROM ${t('devices')} WHERE customer_id=source.id;
    IF NEW.moved_counts IS NULL OR NEW.moved_counts::jsonb IS DISTINCT FROM jsonb_build_object('version',1,'source',to_jsonb(source),'target',to_jsonb(target),'device_ids',expected) THEN RAISE EXCEPTION 'Merge source snapshots or device evidence changed' USING ERRCODE='23514'; END IF;
    RETURN NEW;
   END$merge$`,
  `CREATE TRIGGER pg_customer_merge_history BEFORE INSERT OR UPDATE OR DELETE ON ${t('merge_log')} FOR EACH ROW EXECUTE FUNCTION ${t('pg_customer_merge_guard')}()`,
  `CREATE TRIGGER pg_customer_merge_truncate BEFORE TRUNCATE ON ${t('merge_log')} FOR EACH STATEMENT EXECUTE FUNCTION ${t('repaid_audit_immutable')}()`,
  `DROP TRIGGER repaid_unported_write ON ${t('merge_log')}`,
  replacement,
  `CREATE FUNCTION ${t('pg_customer_merge_complete')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $merge$
   DECLARE snapshot jsonb;
   BEGIN
    snapshot:=NEW.moved_counts::jsonb;
    IF NOT EXISTS(SELECT 1 FROM ${t('customers')} c WHERE c.id=NEW.merged_id AND c.is_archived=1 AND (to_jsonb(c)-'is_archived')=((snapshot->'source')-'is_archived')) OR NOT EXISTS(SELECT 1 FROM ${t('customers')} c WHERE c.id=NEW.master_id AND to_jsonb(c)=snapshot->'target') OR EXISTS(SELECT 1 FROM ${t('devices')} WHERE customer_id=NEW.merged_id) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(snapshot->'device_ids') AS entries(value) WHERE NOT EXISTS(SELECT 1 FROM ${t('devices')} d WHERE d.id=entries.value::bigint AND d.customer_id=NEW.master_id)) THEN RAISE EXCEPTION 'Merge archive and device reassignment must commit atomically' USING ERRCODE='23514'; END IF;
    RETURN NULL;
   END$merge$`,
  `CREATE CONSTRAINT TRIGGER pg_customer_merge_complete AFTER INSERT ON ${t('merge_log')} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${t('pg_customer_merge_complete')}()`,
  `CREATE FUNCTION ${t('pg_active_customer_reference')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $merge$
   DECLARE party bigint;
   BEGIN
    party:=(to_jsonb(NEW)->>'customer_id')::bigint;
    IF party IS NULL THEN RETURN NEW; END IF;
    IF TG_OP='UPDATE' AND (to_jsonb(OLD)->>'customer_id') IS NOT DISTINCT FROM (to_jsonb(NEW)->>'customer_id') THEN RETURN NEW; END IF;
    PERFORM id FROM ${t('customers')} WHERE id=party FOR KEY SHARE;
    IF EXISTS(SELECT 1 FROM ${t('merge_log')} WHERE merged_id=party) THEN RAISE EXCEPTION 'Merged customer cannot receive new operational references' USING ERRCODE='23514'; END IF;
    RETURN NEW;
   END$merge$`,
  ...[...referenceTables,'devices'].map(name=>`CREATE TRIGGER pg_active_customer_reference BEFORE INSERT OR UPDATE ON ${t(name)} FOR EACH ROW EXECUTE FUNCTION ${t('pg_active_customer_reference')}()`),
  `CREATE FUNCTION ${t('pg_merged_referrer_guard')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $merge$BEGIN IF NEW.referrer_customer_id IS NULL THEN RETURN NEW; END IF; IF TG_OP='UPDATE' AND NEW.referrer_customer_id IS NOT DISTINCT FROM OLD.referrer_customer_id THEN RETURN NEW; END IF; PERFORM id FROM ${t('customers')} WHERE id=NEW.referrer_customer_id FOR KEY SHARE; IF EXISTS(SELECT 1 FROM ${t('merge_log')} WHERE merged_id=NEW.referrer_customer_id) THEN RAISE EXCEPTION 'Merged identity cannot receive a new referral relationship' USING ERRCODE='23514'; END IF; RETURN NEW; END$merge$`,
  `CREATE TRIGGER pg_merged_referrer_guard BEFORE INSERT OR UPDATE ON ${t('customers')} FOR EACH ROW EXECUTE FUNCTION ${t('pg_merged_referrer_guard')}()`,
  `CREATE FUNCTION ${t('pg_merged_customer_immutable')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $merge$
   DECLARE evidence record;
   BEGIN
    SELECT * INTO evidence FROM ${t('merge_log')} WHERE merged_id=OLD.id;
    IF evidence.id IS NOT NULL AND NOT (NEW.is_archived=1 AND (to_jsonb(NEW)-'is_archived')=((evidence.moved_counts::jsonb->'source')-'is_archived')) THEN RAISE EXCEPTION 'Merged original profile evidence is immutable' USING ERRCODE='23514'; END IF;
    RETURN NEW;
   END$merge$`,
  `CREATE TRIGGER pg_merged_customer_immutable BEFORE UPDATE ON ${t('customers')} FOR EACH ROW EXECUTE FUNCTION ${t('pg_merged_customer_immutable')}()`,
 ];
}
export const postgresCustomerMergeChecksum=()=>createHash('sha256').update(JSON.stringify(postgresCustomerMergeStatements('repaid'))).digest('hex');

export async function mergePostgresCustomer(db:PostgresDatabase,schema:string,token:string|undefined,branch:number|null,sourceInput:unknown,targetInput:unknown,key:string|null){
 const source=pgId(sourceInput),target=pgId(targetInput);if(source===target)throw new HttpError(400,'مشتری مبدأ و مقصد نباید یکسان باشند.');
 const identity=await requirePostgresIdentity(db,schema,token,'customers.edit',branch),t=(name:string)=>postgresRelation(schema,name);
 const reference=(await db.query(`SELECT branch_id FROM ${t('customers')} WHERE id=$1 AND ($2::bigint IS NULL OR branch_id=$2)`,[source,identity.branchId])).rows[0];if(!reference)throw new HttpError(404,'مشتری در شعبهٔ مجاز یافت نشد.');
 if(reference.branch_id==null)throw new HttpError(409,'مالکیت قدیمی بدون شعبه نیازمند بررسی مستقل است؛ ادغام انجام نشد.');
 const ownedBranch=safePostgresInteger(reference.branch_id);
 return postgresDurableOperation(db,schema,token??'',{permission:'customers.edit',branchId:ownedBranch,operation:'customer.merge',key,payload:{source_id:source,target_id:target}},async scope=>{
  for(const id of [source,target].sort((a,b)=>a-b))await lockPostgresCustomerFunds(db,schema,id);
  const parties=(await db.query(`SELECT * FROM ${t('customers')} WHERE id IN ($1,$2) ORDER BY id FOR UPDATE`,[source,target])).rows;
  const original=parties.find(row=>safePostgresInteger(row.id)===source),destination=parties.find(row=>safePostgresInteger(row.id)===target);
  if(!original||!destination||Number(original.branch_id)!==ownedBranch||Number(destination.branch_id)!==ownedBranch)throw new HttpError(404,'هر دو مشتری باید در شعبهٔ مجاز باشند.');
  if(original.is_archived==null||destination.is_archived==null||Number(original.is_archived)!==0||Number(destination.is_archived)!==0)throw new HttpError(409,'ادغام مشتری بایگانی‌شده یا دارای وضعیت نامشخص مجاز نیست.');
  if(Number(original.is_blacklisted)===1&&Number(destination.is_blacklisted)!==1)throw new HttpError(409,'هشدار فهرست سیاه نباید با ادغام حذف شود؛ وضعیت مشتری مقصد را ابتدا بررسی کنید.');
  if((await db.query(`SELECT 1 WHERE ${conflictQuery(schema,'$1')}`,[source])).rowCount)throw new HttpError(409,'سوابق مالی، پیش‌نویس، تعمیر یا ارتباط عملیاتی نیازمند اصلاح مستقل هستند؛ هیچ سابقه‌ای جابه‌جا نشد.');
  if((await db.query(`SELECT 1 FROM ${t('devices')} WHERE customer_id=$1 AND branch_id IS DISTINCT FROM $2 LIMIT 1`,[source,ownedBranch])).rowCount)throw new HttpError(409,'مالکیت دستگاه قدیمی یا بین‌شعبه‌ای نیازمند بررسی است.');
  if((await db.query(`SELECT 1 FROM ${t('devices')} WHERE customer_id=$1 AND (NOT(type=ANY($2::text[])) OR (battery_health IS NOT NULL AND battery_health NOT BETWEEN 0 AND 100)) LIMIT 1`,[source,(await readPostgresDeviceCatalog(db,schema)).types.map(type=>type.id)])).rowCount)throw new HttpError(409,'مشخصات قدیمی دستگاه نیازمند اصلاح معتبر و مستقل است؛ ادغام انجام نشد.');
  if((await db.query(`SELECT 1 FROM ${t('merge_log')} WHERE merged_id IN ($1,$2) OR master_id=$1 LIMIT 1`,[source,target])).rowCount)throw new HttpError(409,'زنجیرهٔ ادغام یا تکرار ادغام مجاز نیست.');
  const deviceIds=(await db.query(`SELECT id FROM ${t('devices')} WHERE customer_id=$1 ORDER BY id FOR UPDATE`,[source])).rows.map(row=>safePostgresInteger(row.id));
  const id=safePostgresInteger((await db.query(`INSERT INTO ${t('merge_log')}(master_id,merged_id,moved_counts,user_id) SELECT $1,$2,jsonb_build_object('version',1,'source',to_jsonb(s),'target',to_jsonb(d),'device_ids',(SELECT COALESCE(jsonb_agg(id ORDER BY id),'[]'::jsonb) FROM ${t('devices')} WHERE customer_id=$2))::text,$3 FROM ${t('customers')} s JOIN ${t('customers')} d ON d.id=$1 WHERE s.id=$2 RETURNING id`,[target,source,scope.session.user.id])).rows[0].id);
  await db.query(`UPDATE ${t('devices')} SET customer_id=$1 WHERE customer_id=$2`,[target,source]);
  await db.query(`UPDATE ${t('customers')} SET is_archived=1 WHERE id=$1`,[source]);
  await db.query(`INSERT INTO ${t('customer_events')}(customer_id,type,title,detail,user_id,branch_id) VALUES($1,'note','ادغام کنترل‌شدهٔ مشخصات مشتری',$2,$3,$4)`,[target,JSON.stringify({merge_id:id,source_id:source,history_retained:true}),scope.session.user.id,ownedBranch]);
  await postgresFinancialAudit(db,schema,scope,'merge','customer',source,{merge_id:id,target_id:target,devices:deviceIds.length,original_events_preserved:true});
  return {ok:true,target,merge_id:id,moved_devices:deviceIds.length};
 });
}

/** Explicit alias evidence; never relabel immutable source events as target-authored. */
export async function postgresCustomerMergeHistory(db:PostgresDatabase,schema:string,token:string|undefined,branch:number|null,idInput:unknown,page=1){
 const id=pgId(idInput);if(!Number.isSafeInteger(page)||page<1||page>100000)throw new HttpError(400,'صفحه معتبر نیست.');
 const t=(name:string)=>postgresRelation(schema,name);return db.transaction(async()=>{
  const scope=await requirePostgresIdentity(db,schema,token,'customers.view',branch);
  if(!(await db.query(`SELECT 1 FROM ${t('customers')} c WHERE c.id=$1 AND ($2::bigint IS NULL OR EXISTS(SELECT 1 FROM ${t('customer_branch_access')} access WHERE access.customer_id=c.id AND access.branch_id=$2))`,[id,scope.branchId])).rowCount)throw new HttpError(404,'مشتری یافت نشد.');
  const rows=(await db.query(`SELECT id,master_id,merged_id,user_id,created_at,moved_counts FROM ${t('merge_log')} WHERE master_id=$1 OR merged_id=$1 ORDER BY id DESC LIMIT 21 OFFSET $2`,[id,(page-1)*20])).rows;
  const events=(await db.query(`SELECT e.* FROM ${t('customer_events')} e WHERE (e.customer_id=$1 OR e.customer_id IN (SELECT merged_id FROM ${t('merge_log')} WHERE master_id=$1)) AND ($2::bigint IS NULL OR e.branch_id=$2) ORDER BY e.id DESC LIMIT 51 OFFSET $3`,[id,scope.branchId,(page-1)*50])).rows;
  return {page,hasMore:rows.length>20,events:events.slice(0,50),eventsHasMore:events.length>50,merges:rows.slice(0,20).map(row=>({id:safePostgresInteger(row.id),master_id:safePostgresInteger(row.master_id),merged_id:safePostgresInteger(row.merged_id),user_id:row.user_id==null?null:safePostgresInteger(row.user_id),created_at:String(row.created_at),evidence:pgRecord(JSON.parse(String(row.moved_counts)))}))};
 },{isolation:'repeatable read'});
}
