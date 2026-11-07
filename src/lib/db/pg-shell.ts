import {readyApplicationPostgres} from './pg-application';
import {loadPostgresIdentity,requirePostgresIdentity} from './pg-app-auth';
import {postgresRelation} from './postgres-auth';
import {postgresCookieBranch} from './pg-branch';
import {safePostgresInteger} from './postgres';
import {setCurrencyUnit} from '../format';

export async function postgresShellState(token:string|undefined,branchCookie:string|undefined){
 const {database,schema}=await readyApplicationPostgres(),identity=await loadPostgresIdentity(database,schema,token);
 if(!identity)return {session:null,permissions:[],branches:[],scope:null};
 const branch=await postgresCookieBranch(database,schema,identity.session,branchCookie);
 const scoped=await requirePostgresIdentity(database,schema,token,undefined,branch);
 const manager=['owner','admin'].includes(scoped.session.user.role);
 const branches=(await database.query(`SELECT id,name FROM ${postgresRelation(schema,'branches')} WHERE is_active=1 AND ($1::bigint IS NULL OR id=$1) ORDER BY id`,[manager?null:scoped.branchId])).rows.map(row=>({id:safePostgresInteger(row.id),name:String(row.name)}));
 const setting=(await database.query(`SELECT value FROM ${postgresRelation(schema,'settings')} WHERE key='currency_unit'`)).rows[0];if(setting?.value==='rial'||setting?.value==='toman')setCurrencyUnit(setting.value);
 return {session:scoped.session,permissions:scoped.permissions,branches,scope:{branchId:scoped.branchId}};
}
