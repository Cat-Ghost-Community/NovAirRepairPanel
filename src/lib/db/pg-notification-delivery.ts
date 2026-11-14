import {requirePostgresIdentity} from './pg-app-auth';
import {postgresCompanyChatPredicate} from './pg-chat';
import {postgresRelation} from './postgres-auth';
import {safePostgresInteger,type PostgresDatabase} from './postgres';
import {hasPerm} from '../perms-shared';

export function postgresNotificationVisibility(schema:string,user='$1',branch='$2',alias='n',includeChat=true){
 const q=(name:string)=>postgresRelation(schema,name);
 return `${alias}.user_id=${user} AND ((COALESCE(${alias}.link,'') LIKE '/chat?c=%' AND ${includeChat?'TRUE':'FALSE'} AND EXISTS(SELECT 1 FROM ${q('chat_conversations')} c JOIN ${q('chat_members')} mem ON mem.conversation_id=c.id WHERE ${alias}.link='/chat?c='||c.id::text AND mem.user_id=${user} AND mem.left_at IS NULL AND ${postgresCompanyChatPredicate(schema,user)})) OR (COALESCE(${alias}.link,'') NOT LIKE '/chat?c=%' AND (${branch}::bigint IS NULL OR ${alias}.branch_id=${branch})))`;
}
export async function claimPostgresNotifications(db:PostgresDatabase,schema:string,token:string,branch:number|null){return db.transaction(async()=>{
 const scope=await requirePostgresIdentity(db,schema,token,undefined,branch),user=scope.session.user.id,q=(name:string)=>postgresRelation(schema,name);
 await db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[schema,'notification-delivery:'+user]);
 const start=await db.query(`INSERT INTO ${q('notification_delivery_state')}(user_id,baseline_id) SELECT $1,COALESCE(MAX(id),0) FROM ${q('notifications')} WHERE user_id=$1 ON CONFLICT(user_id) DO NOTHING RETURNING user_id`,[user]);
 if(start.rowCount)return [];
 const rows=(await db.query(`SELECT n.id,n.title,n.body,n.link FROM ${q('notifications')} n WHERE ${postgresNotificationVisibility(schema)} AND COALESCE(n.read,0)=0
 AND ($3::boolean OR COALESCE(n.link,'') NOT LIKE '/chat?c=%') AND n.id>(SELECT baseline_id FROM ${q('notification_delivery_state')} WHERE user_id=$1)
 AND NOT EXISTS(SELECT 1 FROM ${q('notification_deliveries')} d WHERE d.user_id=n.user_id AND d.notification_id=n.id) ORDER BY n.id LIMIT 100`,[user,scope.branchId,hasPerm(scope.permissions,'chat.view')])).rows;
 for(const row of rows)await db.query(`INSERT INTO ${q('notification_deliveries')}(user_id,notification_id) VALUES($1,$2)`,[user,row.id]);
 return rows.map(row=>({...row,id:safePostgresInteger(row.id)}));
});}
