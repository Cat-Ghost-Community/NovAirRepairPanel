import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, audit,ok,HttpError,assertRequestSession } from "@/lib/api";
import { verifiedFileSnapshot,cleanupFileSnapshot,fileSha256 } from "@/lib/backup";
import fs from 'node:fs';import {Readable} from 'node:stream';
import {atomic} from '@/lib/db/transaction';
import type {DatabaseSync} from 'node:sqlite';
import {reserveBackupPreparation,releaseBackupPreparation,updateBackupStreamOwner,trackBackupStream,untrackBackupStream,cleanupExpiredBackupArtifacts} from '@/lib/backup-admission';

export const dynamic = "force-dynamic";

/**
 * پشتیبان‌گیری دستی: خروجی فایل دیتابیس برای دانلود.
 * Online snapshot includes committed WAL; streaming avoids a whole-database RAM copy.
 */
export async function GET(req: NextRequest) {
  let snapshot:Awaited<ReturnType<typeof verifiedFileSnapshot>>|undefined;
  let lease:{db:DatabaseSync;id:string}|undefined;
  try {
    const session = requireSession(req);
    requirePerm(session, "settings.edit");
    if (!["owner", "admin"].includes(session.user.role)) {
      return Response.json({ error: "فقط مدیر می‌تواند پشتیبان بگیرد." }, { status: 403 });
    }
    const db = getDb();
    if(req.nextUrl.searchParams.get('mode')==='prepare'&&req.method!=='POST')throw new HttpError(405,'آماده‌سازی نسخه نیازمند درخواست تأییدشده است.');
    const download=req.nextUrl.searchParams.get('download');
    if(download){
      cleanupExpiredBackupArtifacts(db);
      if(!/^[a-f0-9]{48}$/.test(download))throw new HttpError(404,'درخواست دریافت یافت نشد.');
      const ticket=atomic(db,()=>{const row=db.prepare("SELECT * FROM backup_downloads WHERE id=? AND user_id=? AND state='prepared' AND expires_at>?").get(download,session.user.id,Date.now());
        if(!row)throw new HttpError(409,'این دریافت استفاده شده یا منقضی است؛ نسخهٔ تازه آماده کنید.');db.prepare("UPDATE backup_downloads SET state='streaming' WHERE id=?").run(download);updateBackupStreamOwner(db,download,session.user.id);return row;});
      trackBackupStream(download);
      try{
        if(fs.lstatSync(String(ticket.snapshot_path)).isSymbolicLink()||fs.statSync(String(ticket.snapshot_path)).size!==ticket.bytes||await fileSha256(String(ticket.snapshot_path))!==ticket.sha256)throw new Error('Prepared backup checksum mismatch');
        assertRequestSession(req);
        return streamSnapshot(String(ticket.snapshot_path),Number(ticket.bytes),Number(ticket.backup_id),download);
      }catch(error){untrackBackupStream(download);cleanupFileSnapshot(String(ticket.snapshot_path));atomic(db,()=>{db.prepare("UPDATE backup_downloads SET state='failed' WHERE id=?").run(download);db.prepare("UPDATE backups SET status='failed' WHERE id=?").run(ticket.backup_id);});throw error;}
    }
    if(req.nextUrl.searchParams.get('mode')==='prepare'&&Number(db.prepare("SELECT COUNT(*) n FROM backup_downloads WHERE user_id=? AND state IN ('prepared','streaming')").get(session.user.id)!.n)>=2)throw new HttpError(429,'دو نسخهٔ آماده یا در حال دریافت دارید؛ دریافت فعلی را تمام کنید یا پس از انقضا دوباره تلاش کنید.');
    lease={db,id:reserveBackupPreparation(db,session.user.id)};
    snapshot = await verifiedFileSnapshot(db);
    assertRequestSession(req);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
    const filename = `repaid-backup-${stamp}.db`;

    const prepared=snapshot,ticketId=lease.id,isPrepare=req.nextUrl.searchParams.get('mode')==='prepare';
    const backupId=atomic(db,()=>{
      if(isPrepare&&Number(db.prepare("SELECT COUNT(*) n FROM backup_downloads WHERE user_id=? AND state IN ('prepared','streaming')").get(session.user.id)!.n)>=2)throw new HttpError(429,'دریافت فعلی را تمام کنید و دوباره تلاش کنید.');
      const id=Number(db.prepare("INSERT INTO backups(filename, size, kind, status, created_by) VALUES(?,?,?,?,?)")
        .run(filename, prepared.bytes, "manual", "snapshot_verified", session.user.id).lastInsertRowid);
      db.prepare('INSERT INTO backup_downloads(id,user_id,backup_id,snapshot_path,bytes,sha256,expires_at,state) VALUES(?,?,?,?,?,?,?,?)').run(ticketId,session.user.id,id,prepared.filename,prepared.bytes,prepared.sha256,Date.now()+15*60000,isPrepare?'prepared':'streaming');
      audit(session, "backup", "database", null, null, { filename, size: prepared.bytes });
      releaseBackupPreparation(db,ticketId);
      return id;
    });
    lease=undefined;
    if(isPrepare){snapshot=undefined;const response=ok({download_url:'/api/backup?download='+ticketId,bytes:prepared.bytes,expires_in_seconds:900,status:'snapshot_verified'});response.headers.set('Cache-Control','no-store');return response;}
    trackBackupStream(ticketId);const response=streamSnapshot(prepared.filename,prepared.bytes,backupId,ticketId);snapshot=undefined;return response;

    function streamSnapshot(path:string,bytes:number,id:number,ticket?:string){
    const file=fs.createReadStream(path),abort=()=>file.destroy();let ended=false;file.once('end',()=>{ended=true;});req.signal.addEventListener('abort',abort,{once:true});
    file.once('close',()=>{req.signal.removeEventListener('abort',abort);try{const state=ended?'streamed':'interrupted';atomic(db,()=>{db.prepare('UPDATE backups SET status=? WHERE id=?').run(state,id);if(ticket)db.prepare('UPDATE backup_downloads SET state=? WHERE id=?').run(state,ticket);});cleanupFileSnapshot(path);}catch{console.error(JSON.stringify({event:'backup_stream_cleanup_failed',backup_id:id}));}finally{if(ticket)untrackBackupStream(ticket);}});
    if(req.signal.aborted)file.destroy();
    return new Response(Readable.toWeb(file,{strategy:{highWaterMark:65536,size:(chunk:Uint8Array)=>chunk.byteLength}}) as ReadableStream<Uint8Array>, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="repaid-backup-${new Date().toISOString().slice(0,10)}.db"`,
        "Content-Length": String(bytes),
        "Cache-Control": "no-store",
      },
    });
    }
  } catch (e) {
    snapshot?.cleanup();
    if(lease)try{releaseBackupPreparation(lease.db,lease.id,true);}catch{console.error(JSON.stringify({event:'backup_admission_cleanup_failed',id:lease.id}));}
    return fail(e);
  }
}

export async function POST(req:NextRequest){return GET(req);}
