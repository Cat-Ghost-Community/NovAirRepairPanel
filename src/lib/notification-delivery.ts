import type {DatabaseSync} from 'node:sqlite';
import type {Session} from './auth';
import {canUser} from './auth';
import {internalChatAccess} from './chat';
import {atomic} from './db/transaction';

export function notificationScope(session:Session,branch:number|null){
 const chat=internalChatAccess(session.user.id),allowed=canUser(session,'chat.view')?1:0;
 return {sql:`n.user_id=? AND (
 (COALESCE(n.link,'') LIKE '/chat?c=%' AND ?=1 AND EXISTS(SELECT 1 FROM chat_conversations c JOIN chat_members m ON m.conversation_id=c.id WHERE n.link='/chat?c='||c.id AND m.user_id=? AND m.left_at IS NULL AND ${chat.sql}))
 OR (COALESCE(n.link,'') NOT LIKE '/chat?c=%' AND (? IS NULL OR n.branch_id=?)))`,params:[session.user.id,allowed,session.user.id,...chat.params,branch,branch]};
}
/** Claim under the SQLite write transaction so tabs and devices share one announcement. Read/unread state stays independent. */
export function claimNotificationDeliveries(db:DatabaseSync,session:Session,branch:number|null){return atomic(db,()=>{
 const start=db.prepare('INSERT OR IGNORE INTO notification_delivery_state(user_id,baseline_id) SELECT ?,COALESCE(MAX(id),0) FROM notifications WHERE user_id=?').run(session.user.id,session.user.id);
 if(start.changes)return [];
 const access=notificationScope(session,branch);
 const rows=db.prepare(`SELECT n.id,n.title,n.body,n.link FROM notifications n WHERE ${access.sql} AND COALESCE(n.read,0)=0
 AND n.id>(SELECT baseline_id FROM notification_delivery_state WHERE user_id=?)
 AND NOT EXISTS(SELECT 1 FROM notification_deliveries d WHERE d.user_id=n.user_id AND d.notification_id=n.id)
 ORDER BY n.id LIMIT 100`).all(...access.params,session.user.id);
 const insert=db.prepare('INSERT INTO notification_deliveries(user_id,notification_id) VALUES(?,?)');
 for(const row of rows)insert.run(session.user.id,Number(row.id));
 return rows;
});}
