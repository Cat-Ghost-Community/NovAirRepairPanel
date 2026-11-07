import {createHash} from 'node:crypto';
import {ROLE_PERMISSIONS} from '../auth-roles';
import type {Session} from '../auth';
import {hasPerm} from '../perms-shared';
import {HttpError} from '../http-error';
import {safePostgresInteger,type PostgresDatabase} from './postgres';
export type Scope={session:Session;branchId:number|null};
export function postgresRelation(schema:string,name:string){if(!/^(?:repaid|repaid_(?:snapshot|integration)_[a-f0-9]{24})$/.test(schema)||!/^[_a-z][_a-z0-9]{0,62}$/.test(name))throw new Error('Identified PostgreSQL application or rehearsal schema and valid relation required');return '"'+schema+'"."'+name+'"';}
/** Shared by website identity and transactional commands. A supervisor grant is
 * effective only for current active employment in a nonlegacy branch workflow;
 * explicit personal denies still take precedence through hasPerm. */
export async function postgresEffectivePermissions(db:PostgresDatabase,schema:string,userId:number,role:string):Promise<string[]>{
 const table=(name:string)=>postgresRelation(schema,name),permissions=new Set(ROLE_PERMISSIONS[role]??[]);
 const supervisor=await db.query(`SELECT 1 FROM ${table('users')} u JOIN ${table('branches')} b ON b.id=u.branch_id JOIN ${table('repair_workflow_supervisors')} s ON s.user_id=u.id AND s.branch_id=u.branch_id JOIN ${table('branch_repair_workflows')} w ON w.branch_id=u.branch_id WHERE u.id=$1 AND u.is_active=1 AND b.is_active=1 AND w.mode!='legacy'`,[userId]);
 if(supervisor.rowCount){permissions.add('repairs.assign');permissions.add('repairs.view');}
 const overrides=await db.query<{perm:string;effect:string}>(`SELECT perm,effect FROM ${table('user_permissions')} WHERE user_id=$1`,[userId]);
 for(const row of overrides.rows){if(row.effect==='deny')permissions.add('!'+row.perm);else if(row.effect==='allow')permissions.add(row.perm);}
 return [...permissions];
}
/** Resolve CURRENT employment and personal denies from the target DB, never caller-supplied role/branch claims. */
export async function authorizePostgresScope(db:PostgresDatabase,schema:string,token:string,permission:string,branch:number|null|undefined,lockActor=false):Promise<Scope>{
 if(!/^[a-f0-9]{48}$/.test(token))throw new HttpError(401,'نشست معتبر نیست.');
 if(branch!=null&&(!Number.isSafeInteger(branch)||branch<=0))throw new HttpError(400,'شعبه معتبر نیست.');
 const table=(name:string)=>postgresRelation(schema,name),digest='sha256:'+createHash('sha256').update(token).digest('hex');
 const rows=await db.query(`SELECT u.id,u.name,u.email,u.role,u.branch_id,u.avatar_color,s.expires_at,b.is_active branch_active FROM ${table('sessions')} s JOIN ${table('users')} u ON u.id=s.user_id LEFT JOIN ${table('branches')} b ON b.id=u.branch_id WHERE s.token=ANY($1::text[]) AND u.is_active=1 ORDER BY s.expires_at DESC LIMIT 1${lockActor?' FOR UPDATE OF u,s':''}`,[[token,digest]]),raw=rows.rows[0];
 if(!raw||!Number.isFinite(Date.parse(raw.expires_at))||Date.parse(raw.expires_at)<=Date.now())throw new HttpError(401,'نشست منقضی شده است. دوباره وارد شوید.');
 const user:Session['user']={id:safePostgresInteger(raw.id),name:String(raw.name),email:String(raw.email),role:String(raw.role),branch_id:raw.branch_id==null?null:safePostgresInteger(raw.branch_id),avatar_color:String(raw.avatar_color??'#0ea5e9')};
 const permissions=await postgresEffectivePermissions(db,schema,user.id,user.role);
 if(!hasPerm(permissions,permission))throw new HttpError(403,'مجوز انجام این عملیات را ندارید.');
 if(['owner','admin'].includes(user.role)){if(branch!=null&&!((await db.query(`SELECT id FROM ${table('branches')} WHERE id=$1 AND is_active=1`,[branch])).rowCount))throw new HttpError(404,'شعبه یافت نشد.');return {session:{user},branchId:branch??null};}
 if(user.branch_id==null||Number(raw.branch_active)!==1)throw new HttpError(403,'شعبهٔ فعال به حساب شما اختصاص ندارد.');
 if(branch!=null&&branch!==user.branch_id)throw new HttpError(403,'گزارش شعبهٔ دیگر مجاز نیست.');return {session:{user},branchId:user.branch_id};
}
