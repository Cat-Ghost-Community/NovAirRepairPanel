import {postgresRelation} from './postgres-auth';
import {requirePostgresIdentity} from './pg-app-auth';
import {postgresDurableOperation} from './postgres-operations';
import {safePostgresInteger,type PostgresDatabase} from './postgres';
import {HttpError} from '../http-error';
import {CUSTOMER_TYPES,customerTypeValue} from '../customer-type';
import {toEnDigits} from '../format';
import {rial} from '../money';
import {customerSalutation} from '../customer-identity';
import {requireReceptionCustomerName} from '../reception-validation';

type Query={q?:string;page?:number;perPage?:number;vip?:string;blacklist?:string;type?:string};
export type CustomerProfile={id:number;code:string;first_name:string|null;last_name:string|null;company:string|null;mobile:string|null;email:string|null;tags:string;created_at:string;device_count:number;repair_count:number;balance:null;[key:string]:unknown};
export class DuplicatePostgresCustomer extends HttpError{constructor(public readonly duplicates:Record<string,unknown>[]){super(409,'مشتری مشابه وجود دارد؛ اطلاعات را بررسی کنید.');}}
function customerRecord(row:Record<string,unknown>){const result={...row};for(const key of ['id','branch_id','created_by','credit_limit','is_vip','is_blacklisted','is_company','is_archived','is_colleague','referrer_customer_id'])if(result[key]!=null)result[key]=safePostgresInteger(result[key] as string|number|bigint);return result;}
function text(body:Record<string,unknown>,key:string,max:number){const value=body[key];if(value==null||value==='')return null;if(typeof value!=='string'||value.length>max||value.includes('\0'))throw new HttpError(400,`مقدار ${key} معتبر نیست.`);return value.trim()||null;}
function input(value:unknown){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new HttpError(400,'اطلاعات مشتری معتبر نیست.');
 const body=value as Record<string,unknown>,fields:Record<string,string|null>={};
 for(const [key,max] of Object.entries({first_name:60,last_name:60,company:120,mobile:40,phone:40,email:254,address:1000,city:100,tax_id:40,contact_person:120,notes:2000,national_id:20,job:120,referral_source:120,nickname:120,postal_code:20,organization_name:120}))fields[key]=text(body,key,max);
 requireReceptionCustomerName(fields);
 fields.salutation=customerSalutation(body.salutation);
 if(fields.mobile){let mobile=toEnDigits(fields.mobile).replace(/[ +()-]/g,'');if(mobile.startsWith('98'))mobile='0'+mobile.slice(2);if(/^9\d{9}$/.test(mobile))mobile='0'+mobile;if(!/^09\d{9}$/.test(mobile))throw new HttpError(400,'شماره موبایل معتبر نیست.');fields.mobile=mobile;}
 if(fields.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email))throw new HttpError(400,'ایمیل معتبر نیست.');
 if(fields.national_id){fields.national_id=toEnDigits(fields.national_id);if(!/^\d{10}$/.test(fields.national_id))throw new HttpError(400,'کد ملی معتبر نیست.');}
 const type=customerTypeValue(body.customer_type);if(typeof type!=='string'||!CUSTOMER_TYPES.includes(type as typeof CUSTOMER_TYPES[number]))throw new HttpError(400,'نوع مشتری معتبر نیست.');
 for(const key of ['force','is_vip','is_colleague'])if(body[key]!=null&&typeof body[key]!=='boolean')throw new HttpError(400,'گزینهٔ مشتری معتبر نیست.');
 const tags=body.tags??[];if(!Array.isArray(tags)||tags.length>20||tags.some(tag=>typeof tag!=='string'||tag.length>60||tag.includes('\0')))throw new HttpError(400,'برچسب‌ها معتبر نیستند.');
 if(body.referrer_customer_id!=null||body.referrer_commission_type!=null||body.referrer_commission_value!=null)throw new HttpError(409,'گردش مالی معرف هنوز در مرحلهٔ مهاجرت PostgreSQL فعال نشده است.');
 let credit:number|undefined;try{if(body.credit_limit!=null&&body.credit_limit!=='')credit=rial(body.credit_limit,'سقف اعتبار');if(credit!=null&&credit<0)throw Error('negative');}catch{throw new HttpError(400,'سقف اعتبار معتبر نیست.');}
 return {fields,type,tags,credit,force:body.force===true,vip:body.is_vip===true,colleague:type==='colleague'||body.is_colleague===true,branch:body.branch_id};
}
export function requestedPostgresBranch(value:string|null|undefined){if(!value||value==='all')return null;if(!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(Number(value)))throw new HttpError(400,'شعبه معتبر نیست.');return Number(value);}

/** Domain-specific persistence boundary. It owns local transactions; routes do
 * not issue SQL. No ledger posting is required for creating a contact profile. */
export class PostgresCustomersRepository{
 private table:(name:string)=>string;
 constructor(private db:PostgresDatabase,private schema:string){this.table=name=>postgresRelation(schema,name);}
 async list(token:string|undefined,branch:number|null,query:Query={}){
  const page=query.page??1,perPage=query.perPage??50,q=(query.q??'').trim();if(!Number.isSafeInteger(page)||page<1||page>1000000||!Number.isSafeInteger(perPage)||perPage<1||perPage>100||q.length>200||q.includes('\0'))throw new HttpError(400,'پارامترهای فهرست معتبر نیستند.');
  return this.db.transaction(async()=>{
   const scope=await requirePostgresIdentity(this.db,this.schema,token,'customers.view',branch),values:unknown[]=[scope.branchId],where=[`c.is_archived=0`,`($1::bigint IS NULL OR c.id IN(SELECT customer_id FROM ${this.table('customer_branch_access')} WHERE branch_id=$1))`];
   if(q){values.push('%'+q+'%');where.push(`(COALESCE(c.first_name,'')||' '||COALESCE(c.last_name,'') ILIKE $${values.length} OR c.company ILIKE $${values.length} OR c.mobile ILIKE $${values.length} OR c.email ILIKE $${values.length} OR c.code ILIKE $${values.length})`);}
   if(query.vip==='1')where.push('c.is_vip=1');if(query.blacklist==='1')where.push('c.is_blacklisted=1');
   if(query.type){if(!CUSTOMER_TYPES.includes(query.type as typeof CUSTOMER_TYPES[number]))throw new HttpError(400,'نوع مشتری معتبر نیست.');values.push(query.type);where.push(`(CASE WHEN c.customer_type IS NULL OR c.customer_type='new' THEN 'regular' ELSE c.customer_type END)=${values.length}`);}
   const total=safePostgresInteger((await this.db.query(`SELECT COUNT(*) total FROM ${this.table('customers')} c WHERE ${where.join(' AND ')}`,values)).rows[0].total);
   const currentPage=Math.min(page,Math.max(1,Math.ceil(total/perPage)));
   const rows=await this.db.query(`SELECT c.*,(SELECT COUNT(*) FROM ${this.table('devices')} d WHERE d.customer_id=c.id AND d.is_archived=0 AND ($1::bigint IS NULL OR d.id IN(SELECT device_id FROM ${this.table('device_branch_access')} WHERE branch_id=$1))) device_count,(SELECT COUNT(*) FROM ${this.table('repair_tickets')} t WHERE t.customer_id=c.id AND ($1::bigint IS NULL OR t.branch_id=$1)) repair_count FROM ${this.table('customers')} c WHERE ${where.join(' AND ')} ORDER BY c.created_at DESC,c.id DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,perPage,(currentPage-1)*perPage]);
   return {customers:rows.rows.map(row=>({...customerRecord(row),id:safePostgresInteger(row.id),device_count:safePostgresInteger(row.device_count),repair_count:safePostgresInteger(row.repair_count),balance:null}) as CustomerProfile),total,page:currentPage,perPage};
  },{isolation:'repeatable read'});
 }
 async get(token:string|undefined,branch:number|null,id:number):Promise<Record<string,unknown>&{id:number}>{
  if(!Number.isSafeInteger(id)||id<=0)throw new HttpError(400,'شناسه معتبر نیست.');
  return this.db.transaction(async()=>{const scope=await requirePostgresIdentity(this.db,this.schema,token,'customers.view',branch);const row=(await this.db.query(`SELECT c.* FROM ${this.table('customers')} c WHERE c.id=$1 AND c.is_archived=0 AND ($2::bigint IS NULL OR c.id IN(SELECT customer_id FROM ${this.table('customer_branch_access')} WHERE branch_id=$2))`,[id,scope.branchId])).rows[0];if(!row)throw new HttpError(404,'مشتری یافت نشد.');return {...customerRecord(row),id:safePostgresInteger(row.id),balance:null};},{isolation:'repeatable read'});
 }
 async create(token:string|undefined,branch:number|null,payload:unknown,key:string|null){
  const body=input(payload),scope=await requirePostgresIdentity(this.db,this.schema,token,'customers.create',branch);let recordBranch=scope.branchId;
  if(recordBranch==null){const first=(await this.db.query(`SELECT id FROM ${this.table('branches')} WHERE is_active=1 ORDER BY id LIMIT 1`)).rows[0];if(!first)throw new HttpError(409,'شعبهٔ فعال وجود ندارد.');recordBranch=safePostgresInteger(first.id);}
  if(body.branch!=null&&body.branch!==recordBranch)throw new HttpError(403,'ثبت در شعبهٔ دیگر مجاز نیست.');
  return postgresDurableOperation(this.db,this.schema,token??'',{permission:'customers.create',branchId:recordBranch,operation:'customer.create',key,payload},async current=>{
   await this.db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[this.schema,'customer.create:'+recordBranch]);
   const lookupBranch=['owner','admin'].includes(current.session.user.role)?scope.branchId:current.branchId;
   const f=body.fields,dupes=await this.db.query(`SELECT c.id,c.first_name,c.last_name,c.mobile FROM ${this.table('customers')} c WHERE c.is_archived=0 AND ($1::bigint IS NULL OR c.id IN(SELECT customer_id FROM ${this.table('customer_branch_access')} WHERE branch_id=$1)) AND (($2::text IS NOT NULL AND c.mobile=$2) OR ($3::text IS NOT NULL AND c.email=$3) OR ($4::text IS NOT NULL AND c.national_id=$4)) ORDER BY c.id LIMIT 20`,[lookupBranch,f.mobile,f.email,f.national_id]);
   if(dupes.rowCount&&!body.force)throw new DuplicatePostgresCustomer(dupes.rows.map(row=>({...row,id:safePostgresInteger(row.id)})));
   let credit=body.credit;if(credit==null){const configured=(await this.db.query(`SELECT value FROM ${this.table('settings')} WHERE key='default_credit_limit'`)).rows[0];try{credit=rial(configured?.value??0,'سقف اعتبار');}catch{throw new HttpError(409,'سقف اعتبار پیش‌فرض نیازمند بررسی است.');}}
   const counter=(await this.db.query(`INSERT INTO ${this.table('counters')}(key,value) VALUES('customer',1) ON CONFLICT(key) DO UPDATE SET value=${this.table('counters')}.value+1 RETURNING value`)).rows[0],code='C'+String(safePostgresInteger(counter.value)).padStart(4,'0');
   const fields={code,...f,tags:JSON.stringify(body.tags),is_vip:body.vip?1:0,is_blacklisted:0,is_company:f.company?1:0,credit_limit:credit,is_colleague:body.colleague?1:0,customer_type:body.type,created_by:current.session.user.id,branch_id:recordBranch};
   const columns=Object.keys(fields),row=(await this.db.query(`INSERT INTO ${this.table('customers')}(${columns.map(name=>'"'+name+'"').join(',')}) VALUES(${columns.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING id`,Object.values(fields))).rows[0],id=safePostgresInteger(row.id);
   await this.db.query(`INSERT INTO ${this.table('audit_logs')}(user_id,action,entity,entity_id,"after",branch_id) VALUES($1,'create','customer',$2,$3,$4)`,[current.session.user.id,id,JSON.stringify({code,branch_id:recordBranch}),recordBranch]);
   await this.db.query(`INSERT INTO ${this.table('customer_events')}(customer_id,type,title,detail,user_id,branch_id) VALUES($1,'customer','مشتری ثبت شد',$2,$3,$4)`,[id,[f.first_name,f.last_name].filter(Boolean).join(' ')||f.company,current.session.user.id,recordBranch]);
   return {id,code,redirect:'/customers/'+id};
  });
 }
}
