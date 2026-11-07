import {NextRequest} from 'next/server';import fs from 'node:fs';import {getDb,DB_PATH} from '@/lib/db/schema';
import {requireSession,requirePerm,HttpError,ok,fail} from '@/lib/api';import {databaseTransactionMetrics} from '@/lib/db/metrics';
import {sqliteConnectionState} from '@/lib/db/sqlite-config';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){try{const session=requireSession(req);requirePerm(session,'settings.edit');if(!['owner','admin'].includes(session.user.role))throw new HttpError(403,'پایش زیرساخت پایگاه داده فقط برای مدیر سامانه مجاز است.');
 const db=getDb(),pages=Number(db.prepare('PRAGMA page_count').get()!.page_count),free=Number(db.prepare('PRAGMA freelist_count').get()!.freelist_count),pageSize=Number(db.prepare('PRAGMA page_size').get()!.page_size),disk=fs.statfsSync(DB_PATH,{bigint:true});
 const connection=sqliteConnectionState(db);
 const response=ok({engine:'sqlite',postgresCutover:'blocked_until_service_port_acceptance',journalMode:connection.journalMode,connection,
  databaseBytes:pages*pageSize,reusableBytes:free*pageSize,walBytes:fs.existsSync(DB_PATH+'-wal')?fs.statSync(DB_PATH+'-wal').size:0,
  diskAvailableBytes:(disk.bavail*disk.bsize).toString(),transactions:databaseTransactionMetrics(),attachmentStorage:process.env.REPAID_ATTACHMENT_STORAGE??'database',
  integrity:'not_run_by_this_lightweight_probe',backupAndTargetRecovery:'require_separate_verified_evidence'});response.headers.set('Cache-Control','no-store');return response;
}catch(error){return fail(error);}}
