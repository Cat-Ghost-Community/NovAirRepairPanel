import {createHash} from 'node:crypto';
import {HttpError} from '../http-error';
import {postgresRelation} from './postgres-auth';
import {requirePostgresIdentity} from './pg-app-auth';
import {postgresDurableOperation} from './postgres-operations';
import {pgDay,pgId,pgMoney,pgRecord,pgText,postgresFinancialAudit,scopeFor} from './pg-customer-finance';
import {safePostgresInteger,type PostgresDatabase} from './postgres';
import {CUSTOMER_TYPES,customerTypeValue} from '../customer-type';
import {customerSalutation} from '../customer-identity';
import {requireReceptionCustomerName} from '../reception-validation';
import {toEnDigits} from '../format';
import {deviceRegistrationSpecs} from '../device-catalog';
import {readPostgresDeviceCatalog} from './pg-device-catalog';

export const DEVICE_TYPES=['mobile','laptop','desktop','tablet','console','smartwatch','printer','network','other'] as const;
const legacyTypes:Record<string,string>={'موبایل':'mobile','لپ‌تاپ':'laptop','دسکتاپ':'desktop','تبلت':'tablet','کنسول بازی':'console','ساعت هوشمند':'smartwatch','پرینتر':'printer','تجهیزات شبکه':'network','سایر':'other'};
export function operationalRow(row:Record<string,unknown>){
 const numeric=new Set(['id','customer_id','branch_id','created_by','is_archived','is_blacklisted','battery_health','service_interval_days','repair_count','cid','credit_limit','is_vip','is_colleague']);
 return Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value!=null&&numeric.has(key)?safePostgresInteger(value as string|number|bigint):value]));
}
function paging(query:{page?:number;perPage?:number;q?:string}){
 const page=query.page??1,perPage=query.perPage??50,q=(query.q??'').trim();
 if(!Number.isSafeInteger(page)||page<1||page>100000||!Number.isSafeInteger(perPage)||perPage<1||perPage>200||q.length>200||q.includes('\0'))throw new HttpError(400,'صفحه یا جست‌وجو معتبر نیست.');
 return {page,perPage,q};
}
export class PostgresDevicesRepository{
 private table:(name:string)=>string;
 constructor(private db:PostgresDatabase,private schema:string){this.table=name=>postgresRelation(schema,name);}
 async list(token:string|undefined,branch:number|null,query:{page?:number;perPage?:number;q?:string;type?:string;customer_id?:number}={}){
  const {page,perPage,q}=paging(query),t=this.table;
  if(query.type&&(typeof query.type!=='string'||query.type.length>80||query.type.includes('\0')))throw new HttpError(400,'نوع دستگاه معتبر نیست.');
  return this.db.transaction(async()=>{
   const scope=await requirePostgresIdentity(this.db,this.schema,token,'devices.view',branch),values:unknown[]=[scope.branchId,q],where=[`d.is_archived=0`,`($1::bigint IS NULL OR EXISTS(SELECT 1 FROM ${t('device_branch_access')} access WHERE access.device_id=d.id AND access.branch_id=$1))`,`($2='' OR d.model ILIKE '%'||$2||'%' OR d.brand ILIKE '%'||$2||'%' OR d.serial ILIKE '%'||$2||'%' OR d.imei ILIKE '%'||$2||'%' OR (COALESCE(c.first_name,'')||' '||COALESCE(c.last_name,'')) ILIKE '%'||$2||'%')`];
   if(query.type){values.push(query.type);where.push(`d.type=$${values.length}`);}
   if(query.customer_id!=null){values.push(pgId(query.customer_id));where.push(`d.customer_id=$${values.length}`);}
   const from=`${t('devices')} d JOIN ${t('customers')} c ON c.id=d.customer_id`,predicate=where.join(' AND '),total=safePostgresInteger((await this.db.query(`SELECT COUNT(*) n FROM ${from} WHERE ${predicate}`,values)).rows[0].n);
   const rows=(await this.db.query(`SELECT d.*,c.first_name,c.last_name,c.id cid,COALESCE(history.repair_count,0) repair_count FROM ${from} LEFT JOIN (SELECT device_id,COUNT(*) repair_count FROM ${t('repair_tickets')} WHERE ($1::bigint IS NULL OR branch_id=$1) GROUP BY device_id) history ON history.device_id=d.id WHERE ${predicate} ORDER BY d.created_at DESC,d.id DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,perPage,(page-1)*perPage])).rows;
   const facets=(await this.db.query(`SELECT d.type,COUNT(*) n FROM ${t('devices')} d WHERE d.is_archived=0 AND ($1::bigint IS NULL OR EXISTS(SELECT 1 FROM ${t('device_branch_access')} access WHERE access.device_id=d.id AND access.branch_id=$1)) GROUP BY d.type ORDER BY d.type`,[scope.branchId])).rows.map(row=>({id:String(row.type),count:safePostgresInteger(row.n)}));
   return {devices:rows.map(operationalRow),catalog:await readPostgresDeviceCatalog(this.db,this.schema),facets,total,page,perPage,totalPages:Math.max(1,Math.ceil(total/perPage)),hasMore:page*perPage<total};
  },{isolation:'repeatable read'});
 }
 async detail(token:string|undefined,branch:number|null,id:number,page=1){
  pgId(id);paging({page});const t=this.table;
  return this.db.transaction(async()=>{
   const scope=await requirePostgresIdentity(this.db,this.schema,token,'devices.view',branch),row=(await this.db.query(`SELECT d.*,c.first_name,c.last_name,c.id cid,c.mobile FROM ${t('devices')} d JOIN ${t('customers')} c ON c.id=d.customer_id WHERE d.id=$1 AND ($2::bigint IS NULL OR EXISTS(SELECT 1 FROM ${t('device_branch_access')} access WHERE access.device_id=d.id AND access.branch_id=$2))`,[id,scope.branchId])).rows[0];
   if(!row)throw new HttpError(404,'دستگاه یافت نشد.');
   // Technical roles never gain unassigned repair data through device history.
   let assigned=false;
   if(scope.session.user.role==='technician'){
    const policy=(await this.db.query(`SELECT mode FROM ${t('branch_repair_workflows')} WHERE branch_id=$1`,[scope.session.user.branch_id])).rows[0];
    if(!policy||policy.mode==='legacy')assigned=(await this.db.query(`SELECT value FROM ${t('settings')} WHERE key='flag:repairs.only_assigned'`)).rows[0]?.value==='1';
    else assigned=!(await this.db.query(`SELECT 1 FROM ${t('repair_workflow_supervisors')} WHERE branch_id=$1 AND user_id=$2`,[scope.session.user.branch_id,scope.session.user.id])).rowCount;
   }
   const parameters=[id,scope.branchId,assigned,scope.session.user.id];
   const predicate='t.device_id=$1 AND ($2::bigint IS NULL OR t.branch_id=$2) AND (NOT $3::boolean OR t.technician_id=$4 OR t.technician2_id=$4)';
   const total=safePostgresInteger((await this.db.query(`SELECT COUNT(*) n FROM ${t('repair_tickets')} t WHERE ${predicate}`,parameters)).rows[0].n);
   const repairs=(await this.db.query(`SELECT t.*,s.name status_name,s.color status_color FROM ${t('repair_tickets')} t JOIN ${t('repair_statuses')} s ON s.id=t.status_id WHERE ${predicate} ORDER BY t.created_at DESC,t.id DESC LIMIT 50 OFFSET $5`,[...parameters,(page-1)*50])).rows;
   const warranties=(await this.db.query(`SELECT w.* FROM ${t('warranties')} w JOIN ${t('repair_tickets')} t ON t.id=w.ticket_id WHERE ${predicate} AND w.status='active' ORDER BY w.id DESC LIMIT 200`,parameters)).rows;
   return {device:operationalRow(row),catalog:await readPostgresDeviceCatalog(this.db,this.schema),repairs:repairs.map(operationalRow),warranties:warranties.map(operationalRow),page,total,totalPages:Math.max(1,Math.ceil(total/50))};
  },{isolation:'repeatable read'});
 }
 async create(token:string|undefined,branch:number|null,payload:unknown,key:string|null){
  const body=pgRecord(payload),customer=pgId(body.customer_id),target=await scopeFor(this.db,this.schema,token,'devices.create',branch),t=this.table;
  if(body.branch_id!=null&&pgId(body.branch_id)!==target)throw new HttpError(403,'شعبهٔ دستگاه با محدودهٔ انتخاب‌شده تطبیق ندارد.');
  const type=typeof body.type==='string'?(legacyTypes[body.type.trim()]??body.type.trim()):'';
  if(body.force!=null&&typeof body.force!=='boolean')throw new HttpError(400,'گزینهٔ ثبت تکراری معتبر نیست.');
  const fields:Record<string,unknown>={customer_id:customer,type,branch_id:target};
  for(const field of ['brand','model','model_number','sku','serial','imei','imei2','mac','asset_tag','color','ram','storage','cpu','gpu','os','os_version','carrier','condition'])fields[field]=pgText(body[field],160);
  fields.notes=pgText(body.notes,4000);
  for(const field of ['purchase_date','warranty_until'])fields[field]=body[field]==null||body[field]===''?null:pgDay(body[field]);
  if(body.battery_health==='')body.battery_health=null;
  if(typeof body.battery_health==='string'&&/^\d+$/.test(body.battery_health))body.battery_health=Number(body.battery_health);
  if(body.battery_health!=null&&(!Number.isSafeInteger(body.battery_health)||Number(body.battery_health)<0||Number(body.battery_health)>100))throw new HttpError(400,'سلامت باتری باید بین صفر و صد باشد.');
  fields.battery_health=body.battery_health??null;
  const specs=body.specs==null?{}:pgRecord(body.specs);if(Object.keys(specs).length>50||Object.entries(specs).some(([k,v])=>k.length>100||typeof v!=='string'||v.length>1000||v.includes('\0')))throw new HttpError(400,'مشخصات تکمیلی معتبر نیست.');fields.specs=JSON.stringify(specs);
  return postgresDurableOperation(this.db,this.schema,token??'',{permission:'devices.create',branchId:target,operation:'device.create',key,payload},async scope=>{
   await this.db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[this.schema,'device.create']);
   await this.db.query('SELECT pg_advisory_xact_lock_shared(hashtext($1),hashtext($2))',[this.schema,'device.catalog']);
   fields.specs=JSON.stringify(deviceRegistrationSpecs(await readPostgresDeviceCatalog(this.db,this.schema),type,body));
   const party=(await this.db.query(`SELECT c.id FROM ${t('customers')} c WHERE c.id=$1 AND c.is_archived=0 AND EXISTS(SELECT 1 FROM ${t('customer_branch_access')} access WHERE access.customer_id=c.id AND access.branch_id=$2) FOR UPDATE`,[customer,target])).rows[0];
   if(!party)throw new HttpError(404,'مشتری در شعبهٔ مجاز یافت نشد.');
   const duplicates=(await this.db.query(`SELECT d.id,d.brand,d.model FROM ${t('devices')} d WHERE EXISTS(SELECT 1 FROM ${t('device_branch_access')} access WHERE access.device_id=d.id AND access.branch_id=$1) AND (($2::text IS NOT NULL AND d.imei=$2) OR ($3::text IS NOT NULL AND d.serial=$3)) ORDER BY d.id LIMIT 20`,[target,fields.imei,fields.serial])).rows;
   if(duplicates.length&&body.force!==true)throw new DuplicatePostgresDevice(duplicates.map(operationalRow));
   const keys=Object.keys(fields),id=safePostgresInteger((await this.db.query(`INSERT INTO ${t('devices')}(${keys.map(key=>'"'+key+'"').join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING id`,Object.values(fields))).rows[0].id);
   await postgresFinancialAudit(this.db,this.schema,scope,'create','device',id,{customer_id:customer,type,branch_id:target});
   await this.db.query(`INSERT INTO ${t('customer_events')}(customer_id,type,title,detail,user_id,branch_id) VALUES($1,'device','دستگاه ثبت شد',$2,$3,$4)`,[customer,[fields.brand,fields.model].filter(Boolean).join(' '),scope.session.user.id,target]);return {id};
  });
 }
}
export class DuplicatePostgresDevice extends HttpError{constructor(public readonly duplicates:Record<string,unknown>[]){super(409,'دستگاهی با این شناسه قبلاً ثبت شده است.');}}

/** Profile mutation cannot reassign financial ownership or silently relink history. */
export async function mutatePostgresCustomer(db:PostgresDatabase,schema:string,token:string|undefined,branch:number|null,id:number,payload:unknown,key:string|null){
 const body=pgRecord(payload),action=body.action,t=(name:string)=>postgresRelation(schema,name),scope=await requirePostgresIdentity(db,schema,token,'customers.edit',branch);
 const source=(await db.query(`SELECT c.branch_id,(SELECT COUNT(*) FROM ${t('customer_branch_access')} access WHERE access.customer_id=c.id) branches,(SELECT MIN(branch_id) FROM ${t('customer_branch_access')} access WHERE access.customer_id=c.id) only_branch FROM ${t('customers')} c WHERE c.id=$1 AND ($2::bigint IS NULL OR EXISTS(SELECT 1 FROM ${t('customer_branch_access')} access WHERE access.customer_id=c.id AND access.branch_id=$2))`,[pgId(id),scope.branchId])).rows[0];
 if(!source)throw new HttpError(404,'مشتری در شعبهٔ مجاز یافت نشد.');
 if(source.branch_id==null&&!['owner','admin'].includes(scope.session.user.role)&&safePostgresInteger(source.branches)!==1)throw new HttpError(403,'این نمایهٔ قدیمی مشترک است؛ ویرایش آن فقط برای مدیر شرکت مجاز است.');
 const target=source.branch_id==null?scope.branchId??(safePostgresInteger(source.branches)===1?safePostgresInteger(source.only_branch):null):safePostgresInteger(source.branch_id);
 if(target==null)throw new HttpError(409,'برای ویرایش نمایهٔ قدیمی، شعبهٔ دارای سابقه را مشخص کنید؛ مالکیت اصلی تغییر نمی‌کند.');
 if(!['update','archive','blacklist','unblacklist'].includes(String(action)))throw new HttpError(409,'این تغییر مالکیت یا ادغام هنوز به مسیر کنترل‌شدهٔ PostgreSQL متصل نشده است.');
 for(const field of ['branch_id','customer_id','code','created_at','created_by','credit_limit','referrer_customer_id','referrer_commission_type','referrer_commission_value'])if(Object.hasOwn(body,field))throw new HttpError(409,'مالکیت و مدارک مالی از فرم مشخصات قابل تغییر نیستند.');
 const editable=['salutation','national_id','job','nickname','referral_source','first_name','last_name','company','mobile','phone','email','address','city','tax_id','notes','postal_code','organization_name','customer_type','is_colleague'];
 const allowed=['action','expected_updated_at',...(action==='update'?editable:action==='blacklist'?['reason']:[])];
 if(Object.keys(body).some(key=>!allowed.includes(key)))throw new HttpError(400,'فیلد درخواست برای این عملیات معتبر نیست.');
 return postgresDurableOperation(db,schema,token??'',{permission:'customers.edit',branchId:target,operation:'customer.profile',key,payload},async scope=>{
  const before=(await db.query(`SELECT * FROM ${t('customers')} WHERE id=$1 AND is_archived=0 FOR UPDATE`,[id])).rows[0];if(!before)throw new HttpError(404,'مشتری یافت نشد.');
  const access=(await db.query(`SELECT COUNT(*) n,BOOL_OR(branch_id=$2) allowed FROM ${t('customer_branch_access')} WHERE customer_id=$1`,[id,target])).rows[0];
  if(!access.allowed||before.branch_id!=null&&safePostgresInteger(before.branch_id)!==target)throw new HttpError(409,'مالکیت یا سابقهٔ شعبه تغییر کرده است؛ دوباره بررسی کنید.');
  if(before.branch_id==null&&!['owner','admin'].includes(scope.session.user.role)&&safePostgresInteger(access.n)!==1)throw new HttpError(403,'نمایهٔ مشترک باید توسط مدیر شرکت ویرایش شود.');
  if(Object.hasOwn(body,'expected_updated_at')&&body.expected_updated_at!==before.updated_at)throw new HttpError(409,'اطلاعات تغییر کرده است؛ صفحه را تازه کنید.');
  const changes:Record<string,unknown>={};
  if(action==='archive')changes.is_archived=1;
  else if(action==='blacklist'||action==='unblacklist'){changes.is_blacklisted=action==='blacklist'?1:0;changes.blacklist_reason=action==='blacklist'?pgText(body.reason,1000):null;}
  else{
   for(const field of ['national_id','job','nickname','referral_source','first_name','last_name','company','mobile','phone','email','address','city','tax_id','notes','postal_code','organization_name'])if(Object.hasOwn(body,field))changes[field]=pgText(body[field],field==='notes'?2000:field==='address'?1000:field==='email'?254:160);
   if(changes.mobile){const mobile=toEnDigits(String(changes.mobile)).replace(/[ +()-]/g,'').replace(/^98/,'0').replace(/^9(?=\d{9}$)/,'09');if(!/^09\d{9}$/.test(mobile))throw new HttpError(400,'شماره موبایل معتبر نیست.');changes.mobile=mobile;}
   if(changes.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(changes.email)))throw new HttpError(400,'ایمیل معتبر نیست.');
   if(Object.hasOwn(body,'customer_type')){body.customer_type=customerTypeValue(body.customer_type);if(typeof body.customer_type!=='string'||!CUSTOMER_TYPES.includes(body.customer_type as typeof CUSTOMER_TYPES[number]))throw new HttpError(400,'نوع مشتری معتبر نیست.');changes.customer_type=body.customer_type;changes.is_colleague=body.customer_type==='colleague'?1:0;}
   if(Object.hasOwn(body,'is_colleague')){if(typeof body.is_colleague!=='boolean')throw new HttpError(400,'گزینهٔ همکار معتبر نیست.');changes.is_colleague=body.is_colleague?1:0;}
   if(body.customer_type==='colleague')changes.is_colleague=1;
   if(Object.hasOwn(body,'salutation'))changes.salutation=customerSalutation(body.salutation);
   requireReceptionCustomerName({...before,...changes});
   if(Object.hasOwn(changes,'company'))changes.is_company=changes.company?1:0;
  }
  changes.updated_at=new Date().toISOString();const keys=Object.keys(changes);
  await db.query(`UPDATE ${t('customers')} SET ${keys.map((key,i)=>'"'+key+'"=$'+(i+1)).join(',')} WHERE id=$${keys.length+1}`,[...Object.values(changes),id]);
  const changedFields=keys.filter(key=>key!=='updated_at'),beforeEvidence=Object.fromEntries(changedFields.map(key=>[key,before[key]??null])),afterEvidence=Object.fromEntries(changedFields.map(key=>[key,changes[key]]));
  await db.query(`INSERT INTO ${t('audit_logs')}(user_id,action,entity,entity_id,"before","after",branch_id) VALUES($1,$2,'customer',$3,$4,$5,$6)`,[scope.session.user.id,action,id,JSON.stringify(beforeEvidence),JSON.stringify(afterEvidence),target]);
  await db.query(`INSERT INTO ${t('customer_events')}(customer_id,type,title,user_id,branch_id) VALUES($1,'note',$2,$3,$4)`,[id,action==='archive'?'مشتری بایگانی شد':action==='blacklist'?'مشتری به فهرست سیاه افزوده شد':action==='unblacklist'?'مشتری از فهرست سیاه خارج شد':'مشخصات مشتری به‌روز شد',scope.session.user.id,target]);return {ok:true,updated_at:changes.updated_at};
 });
}

export class PostgresSuppliersRepository{
 constructor(private db:PostgresDatabase,private schema:string){}
 async list(token:string|undefined,branch:number|null,query:{page?:number;perPage?:number;q?:string}={}){
  const {page,perPage,q}=paging(query);return this.db.transaction(async()=>{await requirePostgresIdentity(this.db,this.schema,token,'suppliers.view',branch);const t=postgresRelation(this.schema,'suppliers'),where="is_archived=0 AND ($1='' OR name ILIKE '%'||$1||'%' OR company ILIKE '%'||$1||'%')",total=safePostgresInteger((await this.db.query(`SELECT COUNT(*) n FROM ${t} WHERE ${where}`,[q])).rows[0].n);return {suppliers:(await this.db.query(`SELECT * FROM ${t} WHERE ${where} ORDER BY name,id LIMIT $2 OFFSET $3`,[q,perPage,(page-1)*perPage])).rows.map(operationalRow),page,total,totalPages:Math.max(1,Math.ceil(total/perPage)),hasMore:page*perPage<total};},{isolation:'repeatable read'});
 }
 async create(token:string|undefined,branch:number|null,payload:unknown,key:string|null){
  const b=pgRecord(payload),fields:Record<string,unknown>={name:pgText(b.name,160)};if(!fields.name)throw new HttpError(400,'نام تأمین‌کننده الزامی است.');
  for(const field of ['company','phone','email','address','tax_id','payment_terms','bank_info','contact_person','notes'])fields[field]=pgText(b[field],['notes','bank_info','address'].includes(field)?2000:254);
  if(fields.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(fields.email)))throw new HttpError(400,'ایمیل معتبر نیست.');fields.credit_limit=pgMoney(b.credit_limit??0);
  const target=await scopeFor(this.db,this.schema,token,'suppliers.manage',branch);
  return postgresDurableOperation(this.db,this.schema,token??'',{permission:'suppliers.manage',branchId:target,operation:'supplier.create',key,payload},async scope=>{const keys=Object.keys(fields),id=safePostgresInteger((await this.db.query(`INSERT INTO ${postgresRelation(this.schema,'suppliers')}(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING id`,Object.values(fields))).rows[0].id);await postgresFinancialAudit(this.db,this.schema,scope,'create','supplier',id,{name:fields.name});return {id};});
 }
}

export function postgresOperationalProfileStatements(schema:string){
 const t=(name:string)=>postgresRelation(schema,name);
 return [
  `CREATE FUNCTION ${t('pg_operational_profile_guard')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $guard$
   BEGIN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Profile history cannot be deleted' USING ERRCODE='23514'; END IF;
    IF TG_TABLE_NAME='devices' THEN
     IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.branch_id IS DISTINCT FROM OLD.branch_id OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN RAISE EXCEPTION 'Device ownership is immutable without a reviewed transfer' USING ERRCODE='23514'; END IF;
     IF TG_OP='INSERT' AND (NEW.branch_id IS NULL OR NOT EXISTS(SELECT 1 FROM ${t('customers')} c JOIN ${t('customer_branch_access')} a ON a.customer_id=c.id WHERE c.id=NEW.customer_id AND c.is_archived=0 AND a.branch_id=NEW.branch_id)) THEN RAISE EXCEPTION 'Device requires an active scoped customer' USING ERRCODE='23514'; END IF;
     IF NEW.type NOT IN ('mobile','laptop','desktop','tablet','console','smartwatch','printer','network','other') OR (NEW.battery_health IS NOT NULL AND NEW.battery_health NOT BETWEEN 0 AND 100) THEN RAISE EXCEPTION 'Invalid device attributes' USING ERRCODE='23514'; END IF;
    ELSIF TG_TABLE_NAME='suppliers' THEN
     IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN RAISE EXCEPTION 'Supplier identity is immutable' USING ERRCODE='23514'; END IF;
     IF btrim(NEW.name)='' OR COALESCE(NEW.credit_limit,0)<0 OR COALESCE(NEW.credit_limit,0)>9007199254740991 THEN RAISE EXCEPTION 'Invalid supplier attributes' USING ERRCODE='23514'; END IF;
    ELSIF TG_TABLE_NAME='branches' THEN
     IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN RAISE EXCEPTION 'Branch identity is immutable' USING ERRCODE='23514'; END IF;
     IF btrim(NEW.name)='' OR COALESCE(NEW.is_active,1) NOT IN (0,1) THEN RAISE EXCEPTION 'Invalid branch attributes' USING ERRCODE='23514'; END IF;
    ELSE
     IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.code IS DISTINCT FROM OLD.code OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by) THEN RAISE EXCEPTION 'Customer identity is immutable' USING ERRCODE='23514'; END IF;
    END IF;
    RETURN NEW;
   END $guard$`,
  ...['devices','suppliers','customers','branches'].map(name=>`CREATE TRIGGER pg_operational_profile_guard BEFORE INSERT OR UPDATE OR DELETE ON ${t(name)} FOR EACH ROW EXECUTE FUNCTION ${t('pg_operational_profile_guard')}()`),
  `CREATE TRIGGER pg_device_truncate BEFORE TRUNCATE ON ${t('devices')} FOR EACH STATEMENT EXECUTE FUNCTION ${t('repaid_audit_immutable')}()`,
  `CREATE TRIGGER pg_supplier_truncate BEFORE TRUNCATE ON ${t('suppliers')} FOR EACH STATEMENT EXECUTE FUNCTION ${t('repaid_audit_immutable')}()`,
  `CREATE TRIGGER pg_branch_truncate BEFORE TRUNCATE ON ${t('branches')} FOR EACH STATEMENT EXECUTE FUNCTION ${t('repaid_audit_immutable')}()`,
  `DROP TRIGGER repaid_unported_write ON ${t('devices')}`,
  `DROP TRIGGER repaid_unported_write ON ${t('suppliers')}`,
  `CREATE FUNCTION ${t('pg_invoice_forward_state_guard')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $guard$
   BEGIN
    IF NEW.status NOT IN ('draft','issued','partially_paid','paid','overdue','cancelled') THEN RAISE EXCEPTION 'Invalid invoice state' USING ERRCODE='23514'; END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.number IS DISTINCT FROM OLD.number OR NEW.type IS DISTINCT FROM OLD.type OR NEW.branch_id IS DISTINCT FROM OLD.branch_id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR NEW.ticket_id IS DISTINCT FROM OLD.ticket_id OR NEW.sale_id IS DISTINCT FROM OLD.sale_id OR NEW.purchase_order_id IS DISTINCT FROM OLD.purchase_order_id THEN RAISE EXCEPTION 'Original invoice identity and source ownership are immutable' USING ERRCODE='23514'; END IF;
    IF (OLD.status<>'draft' AND NEW.status='draft') OR (OLD.status='cancelled' AND NEW.status IS DISTINCT FROM OLD.status) THEN RAISE EXCEPTION 'Final invoice cannot be reopened as a mutable draft' USING ERRCODE='23514'; END IF;
    RETURN NEW;
   END $guard$`,
  `CREATE TRIGGER pg_invoice_forward_state BEFORE UPDATE ON ${t('invoices')} FOR EACH ROW EXECUTE FUNCTION ${t('pg_invoice_forward_state_guard')}()`,
  `CREATE FUNCTION ${t('pg_invoice_cache_proof')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $guard$
   DECLARE current record;
   BEGIN
    SELECT i.status,i.paid stored_paid,e.paid,e.total INTO current FROM ${t('invoices')} i JOIN ${t('effective_invoices')} e ON e.id=i.id WHERE i.id=NEW.id;
    IF current.status NOT IN ('draft','cancelled') AND (current.stored_paid IS DISTINCT FROM current.paid OR (current.status='paid' AND current.paid<current.total) OR (current.status='partially_paid' AND (current.paid<=0 OR current.paid>=current.total)) OR (current.status IN ('issued','overdue') AND current.paid<>0)) THEN RAISE EXCEPTION 'Invoice payment cache must agree with verified obligations' USING ERRCODE='23514'; END IF;
    RETURN NULL;
   END $guard$`,
  `CREATE CONSTRAINT TRIGGER pg_invoice_cache_proof AFTER UPDATE ON ${t('invoices')} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${t('pg_invoice_cache_proof')}()`,
  `CREATE FUNCTION ${t('pg_supervisor_revocation_guard')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $guard$BEGIN IF pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Supervisor grants require a reviewed workflow command' USING ERRCODE='23514'; END IF; RETURN OLD; END $guard$`,
  `DROP TRIGGER repaid_unported_write ON ${t('repair_workflow_supervisors')}`,
  `CREATE TRIGGER repaid_unported_write BEFORE INSERT OR UPDATE OR TRUNCATE ON ${t('repair_workflow_supervisors')} FOR EACH STATEMENT EXECUTE FUNCTION ${t('repaid_unported_write_fence')}()`,
  `CREATE TRIGGER pg_supervisor_revocation BEFORE DELETE ON ${t('repair_workflow_supervisors')} FOR EACH ROW EXECUTE FUNCTION ${t('pg_supervisor_revocation_guard')}()`,
  `CREATE FUNCTION ${t('pg_revoke_supervisor_employment')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $guard$
   DECLARE revoked record;
   BEGIN
    FOR revoked IN DELETE FROM ${t('repair_workflow_supervisors')} WHERE user_id=NEW.id RETURNING branch_id LOOP
     INSERT INTO ${t('audit_logs')}(user_id,action,entity,entity_id,"after",branch_id) VALUES(NULL,'employment_revocation','repair_workflow_supervisor',NEW.id,jsonb_build_object('system',true,'new_branch_id',NEW.branch_id,'new_role',NEW.role,'is_active',NEW.is_active)::text,revoked.branch_id);
    END LOOP;
    RETURN NEW;
   END $guard$`,
  `CREATE TRIGGER pg_revoke_supervisor_employment AFTER UPDATE OF branch_id,is_active,role ON ${t('users')} FOR EACH ROW WHEN(NEW.branch_id IS DISTINCT FROM OLD.branch_id OR NEW.is_active IS DISTINCT FROM 1::bigint OR NEW.role IS DISTINCT FROM OLD.role) EXECUTE FUNCTION ${t('pg_revoke_supervisor_employment')}()`,
 ];
}
export const postgresOperationalProfileChecksum=()=>createHash('sha256').update(postgresOperationalProfileStatements('repaid').join('\n')).digest('hex');
