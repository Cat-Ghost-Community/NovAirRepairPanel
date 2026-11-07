import {createHash,createHmac} from 'node:crypto';
import {HttpError} from '../http-error';
import {encryptCredential} from '../secrets';
import {DEFAULT_STATUSES} from '../repair-status-definitions';
import {requirePostgresIdentity} from './pg-app-auth';
import {postgresRelation} from './postgres-auth';
import {postgresDurableOperation} from './postgres-operations';
import {createPostgresReceiptInTransaction,lockPostgresCustomerFunds,nextPostgresNumber,pgDay,pgId,pgMoney,pgRecord,pgText,postgresFinancialAudit,scopeFor} from './pg-customer-finance';
import {safePostgresInteger,type PostgresDatabase} from './postgres';

function json(value:unknown,fallback:unknown){
 const input=value??fallback;let count=0;
 const visit=(v:unknown,depth:number):void=>{if(++count>5000||depth>12)throw new HttpError(400,'ساختار اطلاعات پذیرش بیش از حد بزرگ است.');if(typeof v==='string'&&v.includes('\0'))throw new HttpError(400,'متن پذیرش معتبر نیست.');if(Array.isArray(v))v.forEach(x=>visit(x,depth+1));else if(v&&typeof v==='object'){if(Object.keys(v).some(key=>key.includes('\0')||key.length>200))throw new HttpError(400,'کلید اطلاعات پذیرش معتبر نیست.');Object.values(v).forEach(x=>visit(x,depth+1));}};visit(input,0);
 const result=JSON.stringify(input);if(result.length>64000)throw new HttpError(400,'حجم اطلاعات پذیرش بیش از حد مجاز است.');return result;
}
function credential(value:unknown){
 if(value==null||value==='')return {encrypted:null,identity:null};
 if(typeof value!=='string'||value.length>1000||value.includes('\0'))throw new HttpError(400,'رمز دستگاه معتبر نیست.');
 const plain=value;
 const key=process.env.REPAID_ENCRYPTION_KEY;if(!key||!/^[a-f0-9]{64}$/i.test(key))throw new HttpError(503,'کلید رمزگذاری پایدار برای پذیرش تنظیم نشده است.');
 return {encrypted:encryptCredential(plain),identity:createHmac('sha256',Buffer.from(key,'hex')).update(plain).digest('hex')};
}

/** Actual intake is reused by appointment conversion inside the same native
 * transaction. Source rows, verified advance, history and audit commit together. */
export async function createPostgresRepairIntake(db:PostgresDatabase,schema:string,token:string|undefined,branch:number|null,payload:unknown,key:string|null):Promise<{id:number;number:string}>{
 const b=pgRecord(payload),customer=pgId(b.customer_id),device=pgId(b.device_id),priority=b.priority??'normal',deposit=pgMoney(b.deposit??0),secret=credential(b.security_value),target=await scopeFor(db,schema,token,'repairs.create',branch),t=(name:string)=>postgresRelation(schema,name);
 const allowed=['customer_id','device_id','repair_type','priority','source','technician_id','problem','condition_notes','accessories','security_type','security_value','security_hint','estimated_completion','diagnostic_fee','tags','inspection','checklist','custom_answers','group_receipt_id','branch_id','deposit'];
 if(Object.keys(b).some(field=>!allowed.includes(field)))throw new HttpError(400,'فیلد درخواست پذیرش معتبر نیست.');
 if(typeof priority!=='string'||!['low','normal','high','urgent'].includes(priority))throw new HttpError(400,'اولویت پذیرش معتبر نیست.');
 if(deposit<0)throw new HttpError(400,'بیعانه نمی‌تواند منفی باشد.');
 if(b.branch_id!=null&&pgId(b.branch_id)!==target)throw new HttpError(403,'شعبهٔ پذیرش باید با شعبهٔ فعال یکسان باشد.');
 if(b.group_receipt_id!=null)throw new HttpError(409,'پذیرش گروهی باید از گردش مستقل و کنترل‌شدهٔ همان رسید ثبت شود.');
 if(b.technician_id!=null)throw new HttpError(409,'ارجاع پذیرش باید پس از ثبت از مسیر کنترل‌شدهٔ ارجاع انجام شود.');
 const tags=b.tags??[];if(!Array.isArray(tags)||tags.length>50||tags.some(value=>typeof value!=='string'||value.length>100))throw new HttpError(400,'برچسب‌های پذیرش معتبر نیستند.');
 if(b.inspection!=null)pgRecord(b.inspection);if(b.checklist!=null&&!Array.isArray(b.checklist))throw new HttpError(400,'چک‌لیست پذیرش معتبر نیست.');if(b.custom_answers!=null)pgRecord(b.custom_answers);
 const input={...b,security_value:secret.identity};
 return postgresDurableOperation(db,schema,token??'',{permission:'repairs.create',branchId:target,operation:'repair.intake',key,payload:input},async scope=>{
  if(deposit)await requirePostgresIdentity(db,schema,token,'payments.create',target);
  await lockPostgresCustomerFunds(db,schema,customer);
  const party=(await db.query(`SELECT c.id FROM ${t('customers')} c WHERE c.id=$1 AND c.is_archived=0 AND EXISTS(SELECT 1 FROM ${t('customer_branch_access')} a WHERE a.customer_id=c.id AND a.branch_id=$2) FOR UPDATE OF c`,[customer,target])).rows[0];
  const source=(await db.query(`SELECT d.id FROM ${t('devices')} d WHERE d.id=$1 AND d.customer_id=$2 AND d.is_archived=0 AND EXISTS(SELECT 1 FROM ${t('device_branch_access')} a WHERE a.device_id=d.id AND a.branch_id=$3) FOR UPDATE OF d`,[device,customer,target])).rows[0];
  if(!party||!source)throw new HttpError(404,'مشتری و دستگاه فعال این شعبه با یکدیگر تطبیق ندارند.');
  const status=(await db.query(`SELECT id FROM ${t('repair_statuses')} WHERE name IN ('New','Received') ORDER BY CASE name WHEN 'New' THEN 0 ELSE 1 END,id LIMIT 1 FOR SHARE`)).rows[0];if(!status)throw new HttpError(503,'وضعیت‌های پذیرش تنظیم نشده‌اند.');
  const setting=b.diagnostic_fee==null||b.diagnostic_fee===''?(await db.query(`SELECT value FROM ${t('settings')} WHERE key='diagnostic_fee'`)).rows[0]?.value??0:b.diagnostic_fee,fee=pgMoney(setting);
  if(fee<0)throw new HttpError(400,'هزینهٔ عیب‌یابی نمی‌تواند منفی باشد.');
  let number=await nextPostgresNumber(db,schema,'ticket','R');
  let attempts=0;while((await db.query(`SELECT 1 FROM ${t('repair_tickets')} WHERE number=$1`,[number])).rowCount){if(++attempts>=64)throw new HttpError(409,'شمارندهٔ شمارهٔ پذیرش نیازمند بررسی مستقل است؛ سندی ثبت نشد.');number=await nextPostgresNumber(db,schema,'ticket','R');}
  const completion=pgText(b.estimated_completion,40);if(completion){if(!/^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?)?$/.test(completion))throw new HttpError(400,'زمان پیش‌بینی‌شدهٔ پذیرش معتبر نیست.');pgDay(completion.slice(0,10));}
  await db.query(`SELECT set_config('repaid.repair_actor',$1,true)`,[String(scope.session.user.id)]);
  const row=(await db.query(`INSERT INTO ${t('repair_tickets')}(number,branch_id,customer_id,device_id,repair_type,priority,source,status_id,problem,condition_notes,accessories,security_type,security_value_enc,security_hint,estimated_completion,diagnostic_fee,tags,inspection,checklist,custom_answers,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,[number,target,customer,device,pgText(b.repair_type,200),priority,pgText(b.source,100)??'حضوری',status.id,pgText(b.problem,10000),pgText(b.condition_notes,10000),pgText(b.accessories,2000),pgText(b.security_type,40),secret.encrypted,pgText(b.security_hint,500),completion,fee,json(tags,[]),json(b.inspection,{}),json(b.checklist,[]),b.custom_answers==null?null:json(b.custom_answers,{}),scope.session.user.id])).rows[0],id=safePostgresInteger(row.id);
  await db.query(`INSERT INTO ${t('repair_status_history')}(ticket_id,from_status,to_status,user_id,note) VALUES($1,NULL,$2,$3,'پذیرش ثبت شد')`,[id,status.id,scope.session.user.id]);
  if(deposit)await createPostgresReceiptInTransaction(db,schema,scope,{customer_id:customer,ticket_id:id,amount:deposit,method:'cash',notes:'بیعانه هنگام پذیرش'});
  await db.query(`INSERT INTO ${t('customer_events')}(customer_id,type,title,detail,user_id,branch_id,ticket_id) VALUES($1,'repair',$2,$3,$4,$5,$6)`,[customer,'پذیرش '+number+' ثبت شد',pgText(b.problem,10000),scope.session.user.id,target,id]);
  await postgresFinancialAudit(db,schema,scope,'create','repair_ticket',id,{number,customer_id:customer,device_id:device,diagnostic_fee:fee,branch_id:target});return {id,number};
 });
}

/** Administrative migration contribution. Existing status configuration and all
 * historical rows are retained; only an empty new deployment receives defaults. */
export function postgresRepairIntakeStatements(schema:string){
 const t=(name:string)=>postgresRelation(schema,name),literal=(value:string)=>"'"+value.replaceAll("'","''")+"'";
 const defaults=DEFAULT_STATUSES.map((s,index)=>`INSERT INTO ${t('repair_statuses')}(name,category,color,description,allowed_next,is_open,sort,sla_hours,notify_customer,customer_visible,technician_visible,is_system) VALUES(${[s.name,s.category,s.color,s.desc,JSON.stringify(s.next)].map(literal).join(',')},${['waiting','open','active'].includes(s.category)?1:0},${index+1},${s.sla??'NULL'},${s.notify?1:0},1,1,1);`).join('\n');
 return [
  `DROP TRIGGER repaid_unported_write ON ${t('repair_statuses')}`,
  `DO $statuses$ BEGIN IF NOT EXISTS(SELECT 1 FROM ${t('repair_statuses')}) THEN ${defaults} END IF; END $statuses$`,
  `CREATE TRIGGER repaid_unported_write BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON ${t('repair_statuses')} FOR EACH STATEMENT EXECUTE FUNCTION ${t('repaid_unported_write_fence')}()`,
  `CREATE FUNCTION ${t('pg_repair_intake_guard')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $intake$
   DECLARE actor bigint; ticket record;
   BEGIN
    IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Repair history/state requires its controlled native workflow' USING ERRCODE='55000'; END IF;
    actor:=NULLIF(current_setting('repaid.repair_actor',true),'')::bigint;
    IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM ${t('users')} u WHERE u.id=actor AND u.is_active=1 AND (u.role IN ('owner','admin') OR EXISTS(SELECT 1 FROM ${t('branches')} b WHERE b.id=u.branch_id AND b.is_active=1))) THEN RAISE EXCEPTION 'Active intake actor required' USING ERRCODE='23514'; END IF;
    IF TG_TABLE_NAME='repair_tickets' THEN
     IF NEW.created_by IS DISTINCT FROM actor OR NEW.branch_id IS NULL OR NEW.technician_id IS NOT NULL OR NEW.technician2_id IS NOT NULL OR NEW.assignment_version IS DISTINCT FROM 0::bigint OR NEW.diagnostic_fee IS NULL OR NEW.diagnostic_fee<0 OR NEW.diagnostic_fee>9007199254740991 OR NEW.priority NOT IN ('low','normal','high','urgent') OR COALESCE(NEW.is_warranty,0)<>0 OR NEW.original_ticket_id IS NOT NULL OR NEW.estimate_id IS NOT NULL OR NEW.group_receipt_id IS NOT NULL OR NEW.delivered_at IS NOT NULL OR NEW.ready_at IS NOT NULL OR NEW.completed_at IS NOT NULL OR NEW.cancel_reason IS NOT NULL THEN RAISE EXCEPTION 'Invalid initial intake state' USING ERRCODE='23514'; END IF;
     IF NOT EXISTS(SELECT 1 FROM ${t('branches')} WHERE id=NEW.branch_id AND is_active=1) OR NOT EXISTS(SELECT 1 FROM ${t('users')} WHERE id=actor AND (role IN ('owner','admin') OR branch_id=NEW.branch_id)) OR NOT EXISTS(SELECT 1 FROM ${t('devices')} d JOIN ${t('customers')} c ON c.id=d.customer_id WHERE d.id=NEW.device_id AND c.id=NEW.customer_id AND c.is_archived=0 AND d.is_archived=0 AND EXISTS(SELECT 1 FROM ${t('device_branch_access')} a WHERE a.device_id=d.id AND a.branch_id=NEW.branch_id) AND EXISTS(SELECT 1 FROM ${t('customer_branch_access')} a WHERE a.customer_id=c.id AND a.branch_id=NEW.branch_id)) OR NOT EXISTS(SELECT 1 FROM ${t('repair_statuses')} WHERE id=NEW.status_id AND name IN ('New','Received')) THEN RAISE EXCEPTION 'Intake source ownership/status mismatch' USING ERRCODE='23514'; END IF;
     IF jsonb_typeof(NEW.tags::jsonb)<>'array' OR jsonb_typeof(NEW.inspection::jsonb)<>'object' OR jsonb_typeof(NEW.checklist::jsonb)<>'array' OR (NEW.custom_answers IS NOT NULL AND jsonb_typeof(NEW.custom_answers::jsonb)<>'object') THEN RAISE EXCEPTION 'Invalid intake structured evidence' USING ERRCODE='23514'; END IF;
    ELSE
     SELECT * INTO ticket FROM ${t('repair_tickets')} WHERE id=NEW.ticket_id FOR UPDATE;
     IF ticket.id IS NULL OR ticket.created_by IS DISTINCT FROM actor OR NEW.user_id IS DISTINCT FROM actor OR NEW.from_status IS NOT NULL OR NEW.to_status IS DISTINCT FROM ticket.status_id OR NEW.note IS DISTINCT FROM 'پذیرش ثبت شد' OR EXISTS(SELECT 1 FROM ${t('repair_status_history')} WHERE ticket_id=NEW.ticket_id AND from_status IS NULL AND note='پذیرش ثبت شد') THEN RAISE EXCEPTION 'Initial history must match its actual intake' USING ERRCODE='23514'; END IF;
    END IF;
    RETURN NEW;
   END $intake$`,
  ...['repair_tickets','repair_status_history'].flatMap(name=>[
   `CREATE TRIGGER pg_repair_intake_source BEFORE INSERT OR UPDATE OR DELETE ON ${t(name)} FOR EACH ROW EXECUTE FUNCTION ${t('pg_repair_intake_guard')}()`,
   `CREATE TRIGGER pg_repair_intake_truncate BEFORE TRUNCATE ON ${t(name)} FOR EACH STATEMENT EXECUTE FUNCTION ${t('pg_repair_intake_guard')}()`,
   `DROP TRIGGER repaid_unported_write ON ${t(name)}`,
  ]),
  `CREATE FUNCTION ${t('pg_repair_intake_commit')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $intake$
   BEGIN
    IF (SELECT COUNT(*) FROM ${t('repair_status_history')} h WHERE h.ticket_id=NEW.id AND h.from_status IS NULL AND h.to_status=NEW.status_id AND h.user_id=NEW.created_by AND h.note='پذیرش ثبت شد')<>1 OR NOT EXISTS(SELECT 1 FROM ${t('audit_logs')} a WHERE a.entity='repair_ticket' AND a.entity_id=NEW.id AND a.action='create' AND a.user_id=NEW.created_by AND a.branch_id=NEW.branch_id) OR NOT EXISTS(SELECT 1 FROM ${t('operation_receipts')} o WHERE o.operation='repair.intake' AND o.actor_id=NEW.created_by AND o.branch_id=NEW.branch_id AND o.result_json::jsonb->>'id'=NEW.id::text AND o.result_json::jsonb->>'number'=NEW.number) OR NOT EXISTS(SELECT 1 FROM ${t('customer_events')} e WHERE e.customer_id=NEW.customer_id AND e.ticket_id=NEW.id AND e.type='repair' AND e.user_id=NEW.created_by AND e.branch_id=NEW.branch_id) THEN RAISE EXCEPTION 'Intake history/audit/operation/customer event missing' USING ERRCODE='23514'; END IF;
    RETURN NULL;
   END $intake$`,
  `CREATE CONSTRAINT TRIGGER pg_repair_intake_commit AFTER INSERT ON ${t('repair_tickets')} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${t('pg_repair_intake_commit')}()`,
 ];
}
export function postgresRepairIntakeChecksum(){return createHash('sha256').update(postgresRepairIntakeStatements('repaid').join('\n')).digest('hex');}
export async function installPostgresRepairIntakeGuards(db:PostgresDatabase,schema:string){for(const statement of postgresRepairIntakeStatements(schema))await db.query(statement);}

/** Native startup verification uses actual function bodies and trigger metadata,
 * independently of migration registry presence. It never weakens the write fence. */
export async function verifyPostgresRepairIntakeGuards(db:PostgresDatabase,schema:string){
 postgresRelation(schema,'repair_tickets');
 const definitions=postgresRepairIntakeStatements(schema).filter(sql=>sql.startsWith('CREATE FUNCTION '));
 for(const sql of definitions){
  const name=/CREATE FUNCTION [^.]+\."([a-z_]+)"/.exec(sql)?.[1],body=/AS \$intake\$([\s\S]*)\$intake\$/.exec(sql)?.[1];
  if(!name||body==null)throw new Error('Unrecognized intake guard definition');
  const rows=(await db.query(`SELECT p.prosrc,p.prosecdef,p.provolatile,p.proconfig,p.pronargs,p.prokind,p.prorettype::regtype::text return_type,l.lanname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname=$1 AND p.proname=$2`,[schema,name])).rows,row=rows[0];
  if(rows.length!==1||row.prosrc!==body||row.prosecdef||row.provolatile!=='v'||row.pronargs!==0||row.prokind!=='f'||row.return_type!=='trigger'||row.lanname!=='plpgsql'||JSON.stringify(row.proconfig)!==JSON.stringify(['search_path=pg_catalog']))throw new Error('PostgreSQL intake guard function missing or altered: '+name);
 }
 const rows=(await db.query(`SELECT c.relname table_name,t.tgname,t.tgtype,t.tgenabled,t.tgqual IS NOT NULL conditional,t.tgnargs,t.tgdeferrable,t.tginitdeferred,p.proname,pn.nspname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace WHERE n.nspname=$1 AND c.relname=ANY($2::text[]) AND NOT t.tgisinternal`,[schema,['repair_tickets','repair_status_history','repair_statuses']])).rows;
 const assignmentInstalled=!!(await db.query('SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname=$2',[schema,'pg_repair_assignment_update'])).rowCount;
 if(assignmentInstalled)await (await import('./pg-repair-workflow-guards')).verifyPostgresRepairWorkflowGuards(db,schema);
 const workInstalled=!!(await db.query('SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname=$2',[schema,'pg_repair_work_status_router'])).rowCount;
 if(workInstalled)await (await import('./pg-repair-work-guards')).verifyPostgresRepairWorkGuards(db,schema);
 const expected:[string,string,number,string,boolean][]=[['repair_statuses','repaid_unported_write',62,'repaid_unported_write_fence',false],['repair_tickets','pg_repair_intake_commit',5,'pg_repair_intake_commit',true],...['repair_tickets','repair_status_history'].flatMap(table=>[[table,'pg_repair_intake_source',table==='repair_tickets'&&assignmentInstalled?15:31,table==='repair_status_history'&&workInstalled?'pg_repair_work_status_router':'pg_repair_intake_guard',false],[table,'pg_repair_intake_truncate',34,'pg_repair_intake_guard',false]] as [string,string,number,string,boolean][])];
 for(const [table,name,mask,fn,deferred] of expected){const row=rows.find(r=>r.table_name===table&&r.tgname===name);if(!row||row.tgtype!==mask||!['O','A'].includes(String(row.tgenabled))||row.conditional||row.tgnargs!==0||row.tgdeferrable!==deferred||row.tginitdeferred!==deferred||row.proname!==fn||row.nspname!==schema)throw new Error('PostgreSQL intake trigger missing or altered: '+table+'.'+name);}
 if(rows.some(r=>['repair_tickets','repair_status_history'].includes(String(r.table_name))&&r.tgname==='repaid_unported_write'))throw new Error('PostgreSQL intake remained fenced after native installation');
 return {verified:true,application_ready:false};
}
