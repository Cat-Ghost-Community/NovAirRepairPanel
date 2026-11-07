import {before,after,it} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createPostgresDatabase} from '../../src/lib/db/postgres';
import {applyPostgresMigrations,verifyPostgresMigrations} from '../../src/lib/db/pg-migrations';
import {postgresSessionDigest} from '../../src/lib/db/pg-app-auth';
import {listPostgresNotifications,markPostgresNotifications} from '../../src/lib/db/pg-notifications';
const url=process.env.REPAID_PG_TEST_URL??'',database=process.env.REPAID_PG_TEST_DATABASE??'';
if(!/^repaid_test_[a-f0-9]{24}$/.test(database)||new URL(url).pathname!=='/'+database)throw Error('Disposable PostgreSQL runner required');
const db=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true}),other=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true}),schema='repaid_integration_'+randomBytes(12).toString('hex'),t=(name:string)=>'"'+schema+'"."'+name+'"';
const owner=randomBytes(24).toString('hex'),peer=randomBytes(24).toString('hex'),staff=randomBytes(24).toString('hex'),invalid=randomBytes(24).toString('hex'),status=(n:number)=>(error:unknown)=>(error as {status?:number}).status===n;
before(async()=>{
 await applyPostgresMigrations(db,schema,{targetVersion:1});
 await db.query(`INSERT INTO ${t('branches')}(id,name,code) VALUES(1,'One','ONE'),(2,'Two','TWO')`);
 await db.query(`INSERT INTO ${t('users')}(id,name,email,password_hash,role,branch_id) VALUES(1,'Owner','owner@notification.invalid','not-used','owner',1),(2,'Peer','peer@notification.invalid','not-used','admin',2),(3,'Staff','staff@notification.invalid','not-used','technician',1)`);
 await db.query(`INSERT INTO ${t('users')}(id,name,email,password_hash,role,branch_id) VALUES(4,'Review','review@notification.invalid','not-used','owner',1)`);
 // Legacy notifications are retained unchanged through the upgrade, including
 // recipients whose notification producers are intentionally not yet enabled.
 await db.query(`INSERT INTO ${t('notifications')}(id,user_id,title,body,branch_id) VALUES(101,1,'Legacy One','Original evidence',1),(102,1,'Legacy Two','Original evidence',2),(103,1,'Legacy Three','Original evidence',1),(201,2,'Peer private','Never exposed',2),(301,3,'Staff one','Legacy branch',1),(302,3,'Staff two','Legacy branch',2)`);
 await db.query(`INSERT INTO ${t('notifications')}(id,user_id,title,read,branch_id) VALUES(202,2,'Legacy null',NULL,2),(401,4,'Invalid historical flag',2,1)`);
 const original=(await db.query(`SELECT * FROM ${t('notifications')} ORDER BY id`)).rows;
 await applyPostgresMigrations(db,schema);assert.equal((await verifyPostgresMigrations(db,schema)).verified,true);
 assert.deepEqual((await db.query(`SELECT * FROM ${t('notifications')} ORDER BY id`)).rows,original);
 for(const [token,id]of [[owner,1],[peer,2],[staff,3],[invalid,4]] as const)await db.query(`INSERT INTO ${t('sessions')}(token,user_id,expires_at) VALUES($1,$2,$3)`,[postgresSessionDigest(token),id,new Date(Date.now()+3600000).toISOString()]);
});
after(async()=>{try{await db.query('DROP SCHEMA "'+schema+'" CASCADE');}finally{await other.close();await db.close();}});
it('paginates own notifications in a consistent scoped snapshot; manager sees no peer data',async()=>{
 const first=await listPostgresNotifications(db,schema,owner,null,1,2),second=await listPostgresNotifications(db,schema,owner,null,2,2);
 assert.deepEqual(first.notifications.map(row=>row.id),[103,102]);assert.equal(first.hasMore,true);assert.equal(first.unread,3);assert.deepEqual(second.notifications.map(row=>row.id),[101]);assert.equal(second.hasMore,false);
 assert.deepEqual((await listPostgresNotifications(db,schema,owner,2)).notifications.map(row=>row.id),[102]);
 assert.deepEqual((await listPostgresNotifications(db,schema,staff,null)).notifications.map(row=>row.id),[301]);
 await assert.rejects(()=>listPostgresNotifications(db,schema,staff,2),status(403));await assert.rejects(()=>listPostgresNotifications(db,schema,'invalid',null),status(401));await assert.rejects(()=>listPostgresNotifications(db,schema,owner,null,0),status(400));
});
it('marks once across independent pools and binds nonce to action/id/scope',async()=>{
 const args=[schema,owner,null,'notification-concurrent',{action:'mark_read',id:101}] as const;
 const [one,two]=await Promise.all([markPostgresNotifications(db,...args),markPostgresNotifications(other,...args)]);assert.deepEqual(one,{ok:true,updated:1});assert.deepEqual(two,one);
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('pg_notification_operations')} WHERE operation_key=$1`,[args[3]])).rows[0].n,'1');
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('audit_logs')} WHERE entity='notification' AND entity_id=101`)).rows[0].n,'1');
 await assert.rejects(()=>markPostgresNotifications(db,schema,owner,1,args[3],{action:'mark_read',id:101}),status(409));
 await assert.rejects(()=>markPostgresNotifications(db,schema,owner,null,args[3],{action:'mark_read',id:102}),status(409));
 await assert.rejects(()=>markPostgresNotifications(db,schema,owner,null,'notification-peer-denied',{action:'mark_read',id:201}),status(404));
});
it('preserves recipient/branch/content/history and keeps v4 insertion restrictions',async()=>{
 for(const sql of [`UPDATE ${t('notifications')} SET user_id=2,read=1 WHERE id=102`,`UPDATE ${t('notifications')} SET branch_id=1,read=1 WHERE id=102`,`UPDATE ${t('notifications')} SET body='tamper',read=1 WHERE id=102`,`UPDATE ${t('notifications')} SET read=0 WHERE id=101`,`DELETE FROM ${t('notifications')} WHERE id=102`,`TRUNCATE ${t('notifications')}`,`DELETE FROM ${t('pg_notification_operations')}`,`TRUNCATE ${t('pg_notification_operations')}`])await assert.rejects(()=>db.query(sql));
 await assert.rejects(()=>db.query(`INSERT INTO ${t('notifications')}(user_id,title,link,branch_id) VALUES(3,'موجودی کم','/parts/1',1)`));
 await db.query(`INSERT INTO ${t('notifications')}(id,user_id,title,link,branch_id) VALUES(104,1,'موجودی کم','/parts/1',1)`);
 assert.equal((await db.query(`SELECT body FROM ${t('notifications')} WHERE id=102`)).rows[0].body,'Original evidence');
});
it('rolls read state, operation receipt and audit back on failure then safely retries',async()=>{
 await db.query(`CREATE FUNCTION ${t('notification_fail_audit')}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.entity='notification' THEN RAISE EXCEPTION 'Injected audit failure'; END IF; RETURN NEW; END$$`);
 await db.query(`CREATE TRIGGER notification_fail_audit BEFORE INSERT ON ${t('audit_logs')} FOR EACH ROW EXECUTE FUNCTION ${t('notification_fail_audit')}()`);
 try{await assert.rejects(()=>markPostgresNotifications(db,schema,owner,2,'notification-failure-retry',{action:'mark_read',id:102}));}finally{await db.query(`DROP TRIGGER notification_fail_audit ON ${t('audit_logs')}`);}
 assert.equal((await db.query(`SELECT read FROM ${t('notifications')} WHERE id=102`)).rows[0].read,'0');assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('pg_notification_operations')} WHERE operation_key='notification-failure-retry'`)).rows[0].n,'0');
 assert.deepEqual(await markPostgresNotifications(db,schema,owner,2,'notification-failure-retry',{action:'mark_read',id:102}),{ok:true,updated:1});
});
it('reauthorizes transferred staff on nonce replay and does not mark another branch',async()=>{
 await markPostgresNotifications(db,schema,staff,1,'notification-staff-transfer',{action:'mark_read',id:301});
 await db.query(`UPDATE ${t('users')} SET branch_id=2 WHERE id=3`);
 await assert.rejects(()=>markPostgresNotifications(db,schema,staff,1,'notification-staff-transfer',{action:'mark_read',id:301}),status(403));
 await assert.rejects(()=>markPostgresNotifications(db,schema,staff,2,'notification-staff-transfer',{action:'mark_read',id:302}),status(409));
 assert.equal((await db.query(`SELECT read FROM ${t('notifications')} WHERE id=302`)).rows[0].read,'0');
 await assert.rejects(()=>markPostgresNotifications(db,schema,staff,2,'notification-cross-read',{action:'mark_read',id:103}),status(404));
});
it('marks only own selected branch/all-company scope and retains exact replay outcome',async()=>{
 const saved=await markPostgresNotifications(db,schema,owner,1,'notification-mark-all-one',{action:'mark_all_read'});assert.deepEqual(saved,{ok:true,updated:2});
 assert.deepEqual(await markPostgresNotifications(db,schema,owner,1,'notification-mark-all-one',{action:'mark_all_read'}),saved);
 assert.equal((await listPostgresNotifications(db,schema,peer,null)).unread,2);assert.equal((await listPostgresNotifications(db,schema,owner,null)).unread,0);
 await assert.rejects(()=>markPostgresNotifications(db,schema,owner,null,'notification-invalid-action',{action:'anything'}),status(400));
 await assert.rejects(()=>markPostgresNotifications(db,schema,owner,null,'notification-invalid-id',{action:'mark_read',id:0}),status(400));
 assert.deepEqual(await markPostgresNotifications(db,schema,owner,null,'notification-company-all',{action:'mark_all_read'}),{ok:true,updated:0});
});
it('explicitly marks legacy NULL flags and blocks invalid historical scalar states',async()=>{
 const before=await listPostgresNotifications(db,schema,peer,2);assert.equal(before.notifications.find(row=>row.id===202)?.read,0);
 assert.deepEqual(await markPostgresNotifications(db,schema,peer,2,'notification-legacy-null',{action:'mark_read',id:202}),{ok:true,updated:1});
 assert.equal((await listPostgresNotifications(db,schema,peer,2)).unread,1);
 await assert.rejects(()=>listPostgresNotifications(db,schema,invalid,null),status(409));await assert.rejects(()=>markPostgresNotifications(db,schema,invalid,1,'notification-invalid-flag',{action:'mark_read',id:401}),status(409));
 assert.equal((await db.query(`SELECT read FROM ${t('notifications')} WHERE id=401`)).rows[0].read,'2');
});
it('uses the scoped chronological index on a larger measured collection without forcing the planner',async()=>{
 await db.query(`INSERT INTO ${t('notifications')}(user_id,branch_id,title,body,link) SELECT CASE WHEN n%100=0 THEN 1 ELSE 2 END,CASE WHEN n%100=0 THEN 1 ELSE 2 END,'موجودی کم','Synthetic query-plan alert','/parts/1' FROM generate_series(1,10000) n`);
 await db.query(`ANALYZE ${t('notifications')}`);
 const result=(await db.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT * FROM ${t('notifications')} WHERE user_id=$1 AND ($2::bigint IS NULL OR branch_id=$2) ORDER BY created_at DESC NULLS LAST,id DESC LIMIT 31 OFFSET 0`,[1,1])).rows[0]['QUERY PLAN'];
 assert.ok(Number.isFinite(result[0]?.['Execution Time']));
 const usesIndex=(value:unknown):boolean=>{if(!value||typeof value!=='object')return false;const row=value as Record<string,unknown>;return row['Index Name']==='pg_notifications_recipient_page'||Object.values(row).some(usesIndex);};
 // A short recipient history may correctly prefer the existing branch/user
 // index plus a small sort. Exercise a long history before requiring the new
 // ordered-page index; never disable sequential scans or other valid plans.
 await db.query(`INSERT INTO ${t('notifications')}(user_id,branch_id,title,body,link) SELECT 1,1,'موجودی کم','Synthetic long recipient history','/parts/1' FROM generate_series(1,10000)`);
 await db.query(`ANALYZE ${t('notifications')}`);
 const history=(await db.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT * FROM ${t('notifications')} WHERE user_id=$1 AND ($2::bigint IS NULL OR branch_id=$2) ORDER BY created_at DESC NULLS LAST,id DESC LIMIT 31 OFFSET 0`,[1,1])).rows[0]['QUERY PLAN'];
 assert.equal(usesIndex(history),true);
 const page=await listPostgresNotifications(db,schema,owner,1,1,30);assert.equal(page.notifications.length,30);assert.equal(page.hasMore,true);assert.equal(page.notifications.every(row=>row.user_id===1&&row.branch_id===1),true);

});
