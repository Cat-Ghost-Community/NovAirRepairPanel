import {createHash} from 'node:crypto';
import {HttpError} from '../http-error';
import {operationHash,operationKey} from '../operation-identity';
import {authorizePostgresScope,postgresRelation,type Scope} from './postgres-auth';
import {safePostgresInteger,type PostgresDatabase} from './postgres';

const immutableBody="BEGIN RAISE EXCEPTION 'Operation receipt history is immutable' USING ERRCODE='23514'; END";
const check="actor_id>0 AND branch_id>0 AND scope IN ('branch','business') AND operation IS NOT NULL AND length(operation) BETWEEN 1 AND 100 AND operation_key ~ '^[A-Za-z0-9_-]{8,128}$' AND request_hash ~ '^[a-f0-9]{64}$' AND result_json IS NOT NULL AND jsonb_typeof(result_json::jsonb) IS NOT NULL";
const codeHash=createHash('sha256').update(JSON.stringify({immutableBody,check,version:1})).digest('hex');

async function constraintProof(db:PostgresDatabase,schema:string){
  return (await db.query(`SELECT conname,pg_get_constraintdef(c.oid) definition,convalidated FROM pg_constraint c
    JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=$1 AND t.relname='operation_receipts' AND c.conname='operation_receipt_identity'`,[schema])).rows;
}

/** Target-only additive port; imported documents are never edited or inferred. */
export async function installPostgresOperationGuards(db:PostgresDatabase,schema:string){
  const table=postgresRelation(schema,'operation_receipts'),fn=postgresRelation(schema,'operation_receipt_immutable');
  return db.transaction(async()=>{
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1),19204302)',[schema]);
    const present=await db.query('SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname=$2',[schema,'operation_receipt_immutable']);
    if(present.rowCount){await verifyPostgresOperationGuards(db,schema);return {installed:true,replayed:true,application_ready:false};}
    await db.query(`ALTER TABLE ${table} ADD CONSTRAINT operation_receipt_identity CHECK(${check})`);
    await db.query(`CREATE UNIQUE INDEX operation_receipt_branch_key ON ${table}(actor_id,branch_id,operation,operation_key) WHERE scope='branch'`);
    await db.query(`CREATE UNIQUE INDEX operation_receipt_business_key ON ${table}(actor_id,operation,operation_key) WHERE scope='business'`);
    await db.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $operation$${immutableBody}$operation$`);
    await db.query(`CREATE TRIGGER operation_receipt_history BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
    await db.query(`CREATE TRIGGER operation_receipt_truncate BEFORE TRUNCATE ON ${table} FOR EACH STATEMENT EXECUTE FUNCTION ${fn}()`);
    const proof=JSON.stringify({code:codeHash,constraints:await constraintProof(db,schema)});
    await db.query(`COMMENT ON FUNCTION ${fn}() IS '${proof.replaceAll("'","''")}'`);
    await verifyPostgresOperationGuards(db,schema);return {installed:true,replayed:false,application_ready:false};
  });
}

export async function verifyPostgresOperationGuards(db:PostgresDatabase,schema:string){
  postgresRelation(schema,'operation_receipts');
  const functions=await db.query(`SELECT p.prosrc,p.prosecdef,p.provolatile,p.prorettype::regtype::text return_type,p.proconfig,l.lanname,
    obj_description(p.oid,'pg_proc') evidence FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname=$1 AND p.proname='operation_receipt_immutable'`,[schema]);
  const f=functions.rows[0];if(functions.rowCount!==1||!f||f.prosrc!==immutableBody||f.prosecdef||f.provolatile!=='v'||f.return_type!=='trigger'||f.lanname!=='plpgsql'||JSON.stringify(f.proconfig)!==JSON.stringify(['search_path=pg_catalog']))throw new Error('PostgreSQL operation function missing or altered');
  const proof=JSON.stringify({code:codeHash,constraints:await constraintProof(db,schema)});
  if(f.evidence!==proof||JSON.parse(proof).constraints.length!==1||JSON.parse(proof).constraints[0].convalidated!==true)throw new Error('PostgreSQL operation constraint provenance mismatch');
  const indexes=(await db.query(`SELECT ci.relname name,i.indisunique,i.indisvalid,pg_get_expr(i.indpred,i.indrelid) predicate,pg_get_indexdef(i.indexrelid) definition,
    ARRAY(SELECT a.attname::text FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum,pos) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum ORDER BY k.pos) fields
    FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_class ci ON ci.oid=i.indexrelid
    WHERE n.nspname=$1 AND t.relname='operation_receipts'`,[schema])).rows;
  for(const [name,scope,fields] of [['operation_receipt_branch_key','branch',['actor_id','branch_id','operation','operation_key']],['operation_receipt_business_key','business',['actor_id','operation','operation_key']]] as const){
    const index=indexes.find(row=>row.name===name);
    const expected=`CREATE UNIQUE INDEX ${name} ON ${schema}.operation_receipts USING btree (${fields.join(', ')}) WHERE (scope = '${scope}'::text)`;
    if(!index?.indisunique||!index.indisvalid||index.predicate!==`(scope = '${scope}'::text)`||JSON.stringify(index.fields)!==JSON.stringify(fields)||index.definition!==expected)throw new Error('PostgreSQL operation uniqueness missing or altered: '+name);
  }
  const triggers=(await db.query(`SELECT t.tgname,t.tgtype,t.tgenabled,t.tgqual IS NOT NULL conditional,t.tgnargs,p.proname,pn.nspname
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
    WHERE n.nspname=$1 AND c.relname='operation_receipts' AND NOT t.tgisinternal`,[schema])).rows;
  for(const [name,mask] of [['operation_receipt_history',27],['operation_receipt_truncate',34]] as const){const trigger=triggers.find(row=>row.tgname===name);if(!trigger||trigger.tgtype!==mask||!['O','A'].includes(String(trigger.tgenabled))||trigger.conditional||trigger.tgnargs!==0||trigger.proname!=='operation_receipt_immutable'||trigger.nspname!==schema)throw new Error('PostgreSQL operation trigger missing or altered: '+name);}
  return {verified:true,application_ready:false};
}

/** Current authorization is checked even on a replay. The callback must perform
 * only local transactional work; external/provider calls require durable states.
 * An exception or connection loss rolls both work and receipt back together. */
export async function postgresDurableOperation<T>(db:PostgresDatabase,schema:string,token:string,options:{permission:string;branchId:number;operation:string;key:unknown;payload:unknown;scope?:'branch'|'business';legacyJsonResponse?:boolean;authorizeReplay?:(scope:Scope,result:T)=>Promise<void>},work:(scope:Scope)=>Promise<T>):Promise<T>{
  const key=operationKey(options.key),hash=operationHash(options.payload),scope=options.scope??'branch',table=postgresRelation(schema,'operation_receipts');
  if(!/^[a-z][a-z0-9_.:-]{0,99}$/.test(options.operation)||!['branch','business'].includes(scope))throw new HttpError(400,'نوع عملیات معتبر نیست.');
  return db.transaction(async()=>{
    const actor=await authorizePostgresScope(db,schema,token,options.permission,options.branchId,true);
    const identity=JSON.stringify([actor.session.user.id,options.operation,key,scope,scope==='branch'?options.branchId:null]);
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[schema,identity]);
    const prior=(await db.query(`SELECT branch_id,request_hash,result_json FROM ${table} WHERE actor_id=$1 AND operation=$2 AND operation_key=$3 AND scope=$4${scope==='branch'?' AND branch_id=$5':''}`,[actor.session.user.id,options.operation,key,scope,...(scope==='branch'?[options.branchId]:[])])).rows[0];
    if(prior){
      if(safePostgresInteger(prior.branch_id)!==options.branchId&&!['owner','admin'].includes(actor.session.user.role))throw new HttpError(409,'شناسهٔ عملیات متعلق به شعبهٔ دیگری است؛ سابقهٔ اصلی را در شعبهٔ مجاز بررسی کنید.');
      if(prior.request_hash!==hash)throw new HttpError(409,'این شناسه قبلاً برای درخواست دیگری استفاده شده است.');
      const stored=JSON.parse(String(prior.result_json));
      if(options.legacyJsonResponse&&stored&&typeof stored==='object'&&!Array.isArray(stored)&&typeof stored.status==='number'&&Object.keys(stored).length===2&&Object.hasOwn(stored,'body')){
        if(!Number.isInteger(stored.status)||stored.status<200||stored.status>=300)throw new HttpError(409,'نتیجهٔ تاریخی درخواست به بررسی نیاز دارد.');
        await options.authorizeReplay?.(actor,stored.body as T);
        return stored.body as T;
      }
      // Mutable object membership may have changed since a successful command.
      // Domain authorization must run before exposing a cached private result.
      await options.authorizeReplay?.(actor,stored as T);
      return stored as T;
    }
    if(scope==='branch'&&!['owner','admin'].includes(actor.session.user.role)&&(await db.query(`SELECT 1 FROM ${table} WHERE actor_id=$1 AND operation=$2 AND operation_key=$3 AND scope='branch' AND branch_id<>$4 LIMIT 1`,[actor.session.user.id,options.operation,key,options.branchId])).rowCount)throw new HttpError(409,'این شناسه قبلاً در شعبهٔ دیگری استفاده شده است؛ برای کار تازه شناسهٔ تازه بسازید.');
    const result=await work(actor),json=JSON.stringify(result);if(json===undefined)throw new Error('Operation result must be JSON serializable');
    await db.query(`INSERT INTO ${table}(actor_id,branch_id,operation,operation_key,request_hash,result_json,scope,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[actor.session.user.id,options.branchId,options.operation,key,hash,json,scope,new Date().toISOString()]);
    return result;
  });
}
