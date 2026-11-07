import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import type {Session} from '../auth';
import {deriveLoginHash,hashLoginPassword} from '../credential-verification';
import {HttpError} from '../http-error';
import {hasPerm} from '../perms-shared';
import {postgresEffectivePermissions,postgresRelation} from './postgres-auth';
import {safePostgresInteger,type PostgresDatabase} from './postgres';

const WINDOW_MS=5*60*1000,SESSION_MS=7*24*60*60*1000;
type UserRow={id:string|number;name:string;email:string;role:string;branch_id:string|number|null;avatar_color:string|null;expires_at:string|Date;branch_active:string|number|null};
export type PostgresIdentity={session:Session;permissions:string[]};
export const postgresSessionDigest=(token:string)=>'sha256:'+createHash('sha256').update(token).digest('hex');
const validToken=(token:unknown):token is string=>typeof token==='string'&&/^[a-f0-9]{48}$/.test(token);

/** No schema startup, SQLite import, fallback, or seed is performed by authentication. */
export async function authenticatePostgres(db:PostgresDatabase,schema:string,emailInput:unknown,passwordInput:unknown,previousToken?:string):Promise<string>{
 if(typeof emailInput!=='string'||typeof passwordInput!=='string'||emailInput.length>254||emailInput.includes('\0')||passwordInput.length>1024||!emailInput.trim()||!passwordInput)throw new HttpError(400,'ایمیل و گذرواژه معتبر وارد کنید.');
 const table=(name:string)=>postgresRelation(schema,name),email=emailInput.trim().toLowerCase(),key=createHash('sha256').update(email).digest('hex'),now=Date.now();
 // This standalone statement commits before scrypt. Different processes reserve
 // the same durable budget atomically, including while earlier hashes run.
 const reserved=await db.query<{count:string|number}>(`INSERT INTO ${table('login_attempts')}(key,count,window_start) VALUES($1,1,$2)
 ON CONFLICT(key) DO UPDATE SET count=CASE WHEN ${table('login_attempts')}.window_start<=$3 THEN 1 ELSE ${table('login_attempts')}.count+1 END,
 window_start=CASE WHEN ${table('login_attempts')}.window_start<=$3 THEN EXCLUDED.window_start ELSE ${table('login_attempts')}.window_start END RETURNING count`,[key,now,now-WINDOW_MS]);
 if(safePostgresInteger(reserved.rows[0].count)>5)throw new HttpError(429,'تلاش‌های ورود زیاد بوده است. پنج دقیقه دیگر دوباره تلاش کنید.');
 await db.query(`DELETE FROM ${table('login_attempts')} WHERE window_start<$1`,[now-WINDOW_MS*2]);
 const user=(await db.query<{id:string|number;password_hash:string}>(`SELECT id,password_hash FROM ${table('users')} WHERE email=$1 AND is_active=1`,[email])).rows[0];
 const modern=/^scrypt\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(user?.password_hash??''),legacy=/^[a-f0-9]{64}$/.test(user?.password_hash??'');
 const actual=await deriveLoginHash(passwordInput,modern?modern[1]:legacy?'repaid-static-salt':'00000000000000000000000000000000',!legacy);
 const expected=Buffer.from(modern?modern[2]:legacy?user!.password_hash:'0'.repeat(64),'hex');
 if(!user||!timingSafeEqual(actual,expected)){
  await db.query(`INSERT INTO ${table('audit_logs')}(action,entity) VALUES('login_failed','session')`);
  throw new HttpError(401,'ایمیل یا گذرواژه اشتباه است.');
 }
 // Prepare a legacy upgrade before taking a row lock; the transaction rechecks
 // the exact original hash and active employment before changing any session.
 const upgraded=legacy?await hashLoginPassword(passwordInput):null;
 return db.transaction(async()=>{
  const current=(await db.query<{id:string|number;branch_id:string|number|null;role:string;branch_active:number|string|null}>(`SELECT u.id,u.branch_id,u.role,b.is_active branch_active FROM ${table('users')} u LEFT JOIN ${table('branches')} b ON b.id=u.branch_id WHERE u.id=$1 AND u.is_active=1 AND u.password_hash=$2 FOR UPDATE OF u`,[user.id,user.password_hash])).rows[0];
  if(!current)throw new HttpError(401,'اطلاعات حساب تغییر کرده است. دوباره وارد شوید.');
  if(!['owner','admin'].includes(current.role)&&(current.branch_id==null||Number(current.branch_active)!==1))throw new HttpError(403,'شعبهٔ فعال به حساب شما اختصاص ندارد.');
  if(upgraded)await db.query(`UPDATE ${table('users')} SET password_hash=$1 WHERE id=$2`,[upgraded,current.id]);
  await db.query(`DELETE FROM ${table('login_attempts')} WHERE key=$1`,[key]);
  // Timestamps use the existing canonical ISO representation. Expiration is
  // checked by actual parsed time below; cleanup affects modern ISO rows only.
  await db.query(`DELETE FROM ${table('sessions')} WHERE expires_at<=$1`,[new Date().toISOString()]);
  if(validToken(previousToken))await db.query(`DELETE FROM ${table('sessions')} WHERE token=ANY($1::text[])`,[[previousToken,postgresSessionDigest(previousToken)]]);
  const token=randomBytes(24).toString('hex');
  await db.query(`INSERT INTO ${table('sessions')}(token,user_id,expires_at) VALUES($1,$2,$3)`,[postgresSessionDigest(token),current.id,new Date(Date.now()+SESSION_MS).toISOString()]);
  await db.query(`INSERT INTO ${table('audit_logs')}(user_id,action,entity,branch_id) VALUES($1,'login','session',$2)`,[current.id,current.branch_id]);
  return token;
 });
}

/** Resolve current employment, role and overrides on every request. Callers may
 * request actor/session row locks only inside their own domain transaction. */
export async function loadPostgresIdentity(db:PostgresDatabase,schema:string,token:string|undefined,lockActor=false):Promise<PostgresIdentity|null>{
 if(!validToken(token))return null;
 const table=(name:string)=>postgresRelation(schema,name),rows=await db.query<UserRow>(`SELECT u.id,u.name,u.email,u.role,u.branch_id,u.avatar_color,s.expires_at,b.is_active branch_active FROM ${table('sessions')} s JOIN ${table('users')} u ON u.id=s.user_id LEFT JOIN ${table('branches')} b ON b.id=u.branch_id WHERE s.token=ANY($1::text[]) AND u.is_active=1 ORDER BY s.expires_at DESC LIMIT 1${lockActor?' FOR UPDATE OF u,s':''}`,[[token,postgresSessionDigest(token)]]),row=rows.rows[0];
 if(!row)return null;
 const expiration=row.expires_at instanceof Date?row.expires_at.getTime():Date.parse(row.expires_at);
 if(!Number.isFinite(expiration)||expiration<=Date.now()){
  await db.query(`DELETE FROM ${table('sessions')} WHERE token=ANY($1::text[])`,[[token,postgresSessionDigest(token)]]);return null;
 }
 if(!['owner','admin'].includes(row.role)&&(row.branch_id==null||Number(row.branch_active)!==1))return null;
 const user:Session['user']={id:safePostgresInteger(row.id),name:String(row.name),email:String(row.email),role:String(row.role),branch_id:row.branch_id==null?null:safePostgresInteger(row.branch_id),avatar_color:String(row.avatar_color??'#0ea5e9')};
 return {session:{user},permissions:await postgresEffectivePermissions(db,schema,user.id,user.role)};
}

export async function getPostgresSessionByToken(db:PostgresDatabase,schema:string,token:string|undefined):Promise<Session|null>{return (await loadPostgresIdentity(db,schema,token))?.session??null;}

export async function destroyPostgresSession(db:PostgresDatabase,schema:string,token:string|undefined):Promise<void>{
 if(!validToken(token))return;
 const table=(name:string)=>postgresRelation(schema,name);
 await db.transaction(async()=>{
  const removed=await db.query<{user_id:string|number}>(`DELETE FROM ${table('sessions')} WHERE token=ANY($1::text[]) RETURNING user_id`,[[token,postgresSessionDigest(token)]]);
  if(removed.rowCount)await db.query(`INSERT INTO ${table('audit_logs')}(user_id,action,entity,branch_id) SELECT id,'logout','session',branch_id FROM ${table('users')} WHERE id=$1`,[removed.rows[0].user_id]);
 });
}

/** Password changes revoke every previous session in the same transaction as
 * the hash/audit change. Async hash work finishes before actor rows are locked. */
export async function changePostgresPassword(db:PostgresDatabase,schema:string,token:string|undefined,currentInput:unknown,nextInput:unknown):Promise<string>{
 if(typeof currentInput!=='string'||currentInput.length>1024)throw new HttpError(400,'گذرواژه فعلی معتبر نیست.');
 if(typeof nextInput!=='string'||nextInput.length<12||nextInput.length>1024)throw new HttpError(400,'گذرواژه جدید باید بین ۱۲ تا ۱۰۲۴ نویسه باشد.');
 const identity=await requirePostgresIdentity(db,schema,token),table=(name:string)=>postgresRelation(schema,name);
 const user=(await db.query<{password_hash:string}>(`SELECT password_hash FROM ${table('users')} WHERE id=$1 AND is_active=1`,[identity.session.user.id])).rows[0];
 const modern=/^scrypt\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(user?.password_hash??''),legacy=/^[a-f0-9]{64}$/.test(user?.password_hash??'');
 const actual=await deriveLoginHash(currentInput,modern?modern[1]:legacy?'repaid-static-salt':'00000000000000000000000000000000',!legacy),expected=Buffer.from(modern?modern[2]:legacy?user!.password_hash:'0'.repeat(64),'hex');
 if(!user||!timingSafeEqual(actual,expected))throw new HttpError(400,'گذرواژه فعلی درست نیست.');
 const upgraded=await hashLoginPassword(nextInput);
 return db.transaction(async()=>{
  const current=await requirePostgresIdentity(db,schema,token,undefined,undefined,true);
  if(current.session.user.id!==identity.session.user.id)throw new HttpError(401,'نشست معتبر نیست.');
  const updated=await db.query(`UPDATE ${table('users')} SET password_hash=$1 WHERE id=$2 AND password_hash=$3 AND is_active=1 RETURNING id`,[upgraded,identity.session.user.id,user.password_hash]);
  if(updated.rowCount!==1)throw new HttpError(409,'اطلاعات حساب تغییر کرده است. دوباره وارد شوید.');
  await db.query(`DELETE FROM ${table('sessions')} WHERE user_id=$1`,[identity.session.user.id]);
  const nextToken=randomBytes(24).toString('hex');
  await db.query(`INSERT INTO ${table('sessions')}(token,user_id,expires_at) VALUES($1,$2,$3)`,[postgresSessionDigest(nextToken),identity.session.user.id,new Date(Date.now()+SESSION_MS).toISOString()]);
  await db.query(`INSERT INTO ${table('audit_logs')}(user_id,action,entity,entity_id,"after",branch_id) VALUES($1,'update','user',$1,$2,$3)`,[identity.session.user.id,JSON.stringify({action:'change_password'}),current.session.user.branch_id]);
  return nextToken;
 });
}

export async function requirePostgresIdentity(db:PostgresDatabase,schema:string,token:string|undefined,permission?:string,branch?:number|null,lockActor=false):Promise<PostgresIdentity&{branchId:number|null}>{
 if(branch!=null&&(!Number.isSafeInteger(branch)||branch<=0))throw new HttpError(400,'شعبه معتبر نیست.');
 const identity=await loadPostgresIdentity(db,schema,token,lockActor);
 if(!identity)throw new HttpError(401,'برای ادامه وارد شوید.');
 if(permission&&!hasPerm(identity.permissions,permission))throw new HttpError(403,'مجوز انجام این عملیات را ندارید.');
 if(['owner','admin'].includes(identity.session.user.role)){
  if(branch!=null&&!(await db.query(`SELECT id FROM ${postgresRelation(schema,'branches')} WHERE id=$1 AND is_active=1`,[branch])).rowCount)throw new HttpError(404,'شعبه یافت نشد.');
  return {...identity,branchId:branch??null};
 }
 if(branch!=null&&branch!==identity.session.user.branch_id)throw new HttpError(403,'دسترسی به شعبهٔ دیگر مجاز نیست.');
 return {...identity,branchId:identity.session.user.branch_id};
}
