import type {Session} from '../auth';
import type {PostgresDatabase} from './postgres';
import {postgresRelation} from './postgres-auth';
import {requestedPostgresBranch} from './pg-customers';

/** Preserve activeBranch semantics: staff cookies never alter employment;
 * invalid/stale manager cookies fall back to the authorized company scope. */
export async function postgresCookieBranch(db:PostgresDatabase,schema:string,session:Session,cookie:string|undefined){
 if(!['owner','admin'].includes(session.user.role))return session.user.branch_id;
 let branch:number|null;try{branch=requestedPostgresBranch(cookie);}catch{return null;}
 if(branch==null)return null;
 return (await db.query(`SELECT 1 FROM ${postgresRelation(schema,'branches')} WHERE id=$1 AND is_active=1`,[branch])).rowCount?branch:null;
}
