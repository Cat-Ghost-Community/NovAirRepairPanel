import {before,after,describe,it} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import type {DatabaseSync} from 'node:sqlite';
import {createRecoverySet,copyRecoverySet,verifyRecoverySet,restoreRecoverySet} from '../src/lib/recovery-set';
import {storeAttachmentObject} from '../src/lib/attachment-storage';
import {fileSha256,openStandaloneSqlite} from '../src/lib/backup';
import {scheduledRecovery,checkScheduledRecovery} from '../src/lib/scheduled-recovery';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-set-test-')),source=path.join(root,'source'),objects=path.join(root,'source-objects'),key=randomBytes(32).toString('hex');
const names=['REPAID_DATA_DIR','REPAID_DEMO_MODE','REPAID_OBJECT_DIR','REPAID_ATTACHMENT_STORAGE','REPAID_ENCRYPTION_KEY'] as const;
const original=Object.fromEntries(names.map(name=>[name,process.env[name]]));
fs.mkdirSync(source);fs.mkdirSync(objects);process.env.REPAID_DATA_DIR=source;process.env.REPAID_DEMO_MODE='0';process.env.REPAID_OBJECT_DIR=objects;process.env.REPAID_ATTACHMENT_STORAGE='filesystem';process.env.REPAID_ENCRYPTION_KEY=randomBytes(32).toString('hex');
let db:DatabaseSync,objectKey:string,verifyLedger:typeof import('../src/lib/accounting').verifyLedger;
const bytes=Buffer.concat([Buffer.from('PRIVATE-RECOVERY-ATTACHMENT\n'),Buffer.alloc(200000,91)]),emptyHash=createHash('sha256').update(Buffer.alloc(0)).digest('hex');
before(async()=>{
 const {getDb,DB_PATH}=await import('../src/lib/db/schema'),ledger=await import('../src/lib/accounting'),auth=await import('../src/lib/auth');assert.equal(DB_PATH,path.join(source,'repaid.db'));db=getDb();verifyLedger=ledger.verifyLedger;
 db.exec("INSERT INTO branches(id,name,code) VALUES(1,'fixture branch','ONE');INSERT INTO users(id,name,email,password_hash,role,branch_id) VALUES(1,'fixture owner','fixture@test.local','unused','owner',1);INSERT INTO customers(id,first_name,branch_id) VALUES(1,'original evidence',1);INSERT INTO invoices(id,number,type,customer_id,branch_id,status,total) VALUES(1,'PRESERVED','sale',1,1,'issued',5000)");auth.createSession(1);
 const session={user:{id:1,name:'fixture owner',email:'fixture@test.local',role:'owner',branch_id:1,avatar_color:'blue'}};ledger.initializeChart(db,session);ledger.createPeriod(db,session,{name:'fixture period',start_date:'2026-01-01',end_date:'2026-12-31'});
 const journal=ledger.createJournal(db,session,{branch_id:1,posting_date:'2026-11-05',event_key:'preserved-proof',source_type:'manual',source_id:'1',memo:'Immutable recovery fixture',lines:[{account_code:'1000',debit:17},{account_code:'4010',credit:17}]});ledger.postJournal(db,session,journal.id);
 const object=(await storeAttachmentObject(bytes))!,empty=(await storeAttachmentObject(Buffer.alloc(0)))!;objectKey=object.object_key;
 for(const row of [object,empty])db.prepare('INSERT INTO repair_attachments(filename,mime,size,data,object_key,object_sha256) VALUES(?,?,?,X\'\',?,?)').run('private fixture','application/octet-stream',row.size,row.object_key,row.object_sha256);
 db.prepare("INSERT INTO chat_attachments(uploaded_by,filename,mime,size,data,object_key,object_sha256) VALUES(1,'same private object','application/octet-stream',?,X'',?,?)").run(object.size,object.object_key,object.object_sha256);
 db.prepare("INSERT INTO repair_attachments(filename,mime,size,data) VALUES('legacy BLOB','text/plain',6,?)").run(Buffer.from('legacy'));
});
after(()=>{db?.close();for(const name of names){if(original[name]===undefined)delete process.env[name];else process.env[name]=original[name];}const resolved=fs.realpathSync(root);assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('repaid-set-test-'));fs.rmSync(resolved,{recursive:true,force:true});});
describe('complete encrypted database and object recovery sets',()=>{
 it('backs up exact snapshot objects once and restores onto another object root without reviving sessions',async()=>{
  const set=path.join(root,'complete.rpset'),result=await createRecoverySet(db,set,key);assert.equal(result.objects,2);assert.equal(result.object_bytes,String(bytes.length));assert.equal(result.production_activated,false);assert.equal(result.encrypted_payloads_verified,true);
  const completion=JSON.parse(fs.readFileSync(path.join(set,'COMPLETE.json'),'utf8')),direct=createHmac('sha256',Buffer.from(key,'hex')).update('repaid-recovery-set-v1\0').update(fs.readFileSync(path.join(set,'manifest.jsonl'))).digest('hex');assert.notEqual(completion.hmac,direct,'Manifest authentication must not directly reuse the payload-encryption key');
  assert.equal(fs.readFileSync(path.join(set,'objects',objectKey.slice(0,2),objectKey+'.rpbak')).includes(Buffer.from('PRIVATE-RECOVERY-ATTACHMENT')),false);
  const copy=path.join(root,'second-location.rpset'),copied=await copyRecoverySet(set,copy,key);assert.equal(copied.manifest_sha256,result.manifest_sha256);assert.equal(copied.physical_offhost_verified,false);
  const restored=path.join(root,'restored'),proof=await restoreRecoverySet(copy,restored,key,'independent full database and attachment recovery rehearsal');assert.equal(proof.objects,2);assert.equal(proof.offline_recovery.sessions_invalidated,1);assert.equal(proof.application_encryption_key_verified,false);assert.equal(process.env.REPAID_OBJECT_DIR,objects);
  assert.deepEqual(fs.readFileSync(path.join(restored,'objects',objectKey.slice(0,2),objectKey)),bytes);assert.equal(fs.statSync(path.join(restored,'objects',emptyHash.slice(0,2),emptyHash)).size,0);
  const forensic=openStandaloneSqlite(path.join(restored,'forensic.db')),ready=openStandaloneSqlite(path.join(restored,'repaid.db'));
  try{assert.equal(await fileSha256(path.join(restored,'forensic.db')),result.database_sha256);assert.equal(forensic.prepare('SELECT COUNT(*) n FROM sessions').get()!.n,1);assert.equal(ready.prepare('SELECT COUNT(*) n FROM sessions').get()!.n,0);assert.equal(ready.prepare('SELECT total FROM invoices WHERE id=1').get()!.total,5000);assert.equal(ready.prepare("SELECT data FROM repair_attachments WHERE filename='legacy BLOB'").get()!.data?.toString(),'108,101,103,97,99,121');const ledger=verifyLedger(ready);assert.equal(ledger.valid,true);assert.equal(ledger.count,1);assert.equal(ready.prepare("SELECT SUM(debit) amount FROM accounting_lines WHERE account_code='1000'").get()!.amount,17);}finally{forensic.close();ready.close();}
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get()!.n,1);assert.equal(verifyLedger(db).count,1);
 });
 it('fails before restoring for a wrong key, incomplete set or tampered authenticated manifest',async()=>{
  const set=path.join(root,'complete.rpset');await assert.rejects(()=>verifyRecoverySet(set,randomBytes(32).toString('hex')),/authentication/);
  const broken=path.join(root,'bad-manifest.rpset');fs.cpSync(set,broken,{recursive:true});fs.appendFileSync(path.join(broken,'manifest.jsonl'),'{}\n');
  const target=path.join(root,'must-not-restore');await assert.rejects(()=>restoreRecoverySet(broken,target,key,'reject forged manifest before restoration'),/authentication/);assert.equal(fs.existsSync(target),false);
  fs.unlinkSync(path.join(broken,'COMPLETE.json'));await assert.rejects(()=>verifyRecoverySet(broken,key));
 });
 it('rejects corrupt or missing attachment ciphertext and leaves the retained good set unchanged',async()=>{
  const set=path.join(root,'complete.rpset'),before=await verifyRecoverySet(set,key),broken=path.join(root,'bad-object.rpset');fs.cpSync(set,broken,{recursive:true});
  const file=path.join(broken,'objects',objectKey.slice(0,2),objectKey+'.rpbak'),data=fs.readFileSync(file);data[data.length-20]^=1;fs.writeFileSync(file,data);
  await assert.rejects(()=>verifyRecoverySet(broken,key),/identity/);fs.unlinkSync(file);await assert.rejects(()=>copyRecoverySet(broken,path.join(root,'rejected-copy'),key));assert.equal(fs.existsSync(path.join(root,'rejected-copy')),false);assert.equal((await verifyRecoverySet(set,key)).manifest_sha256,before.manifest_sha256);
 });
 it('never overwrites previous sets or restored business data and rejects nested source destinations',async()=>{
  const set=path.join(root,'complete.rpset');await assert.rejects(()=>createRecoverySet(db,set,key),/new/);await assert.rejects(()=>copyRecoverySet(set,set,key),/new/);await assert.rejects(()=>restoreRecoverySet(set,path.join(root,'restored'),key,'retain existing restored customer evidence'),/new/);await assert.rejects(()=>copyRecoverySet(set,path.join(set,'nested'),key),/inside/);assert.equal(fs.existsSync(path.join(set,'nested')),false);
 });
 it('removes only its new incomplete directory after an interrupted object publication',async()=>{
  const target=path.join(root,'interrupted.rpset'),link=fs.promises.link;
  try{fs.promises.link=(async(oldPath,newPath)=>{if(String(newPath).startsWith(target+path.sep)&&String(newPath).endsWith('.rpbak')&&!String(newPath).endsWith('database.rpbak'))throw Error('injected object publication failure');return link(oldPath,newPath);}) as typeof fs.promises.link;
   await assert.rejects(()=>createRecoverySet(db,target,key),/injected object/);assert.equal(fs.existsSync(target),false);assert.equal(verifyLedger(db).valid,true);assert.equal(db.prepare('SELECT total FROM invoices WHERE id=1').get()!.total,5000);
  }finally{fs.promises.link=link;}
 });
 it('takes object references from the saved database snapshot rather than a later live mutation',async()=>{
  const link=fs.promises.link,target=path.join(root,'snapshot-bound.rpset');let changed=false;
  try{fs.promises.link=(async(oldPath,newPath)=>{const result=await link(oldPath,newPath);if(String(newPath)===path.join(target,'database.rpbak')){db.prepare("INSERT INTO repair_attachments(filename,size,data) VALUES('post-snapshot',4,?)").run(Buffer.from('late'));changed=true;}return result;}) as typeof fs.promises.link;
   await createRecoverySet(db,target,key);assert.equal(changed,true);
  }finally{fs.promises.link=link;}
  const restored=path.join(root,'snapshot-bound-restore');await restoreRecoverySet(target,restored,key,'verify concurrent live writes do not enter an earlier snapshot');const ready=openStandaloneSqlite(path.join(restored,'repaid.db'));try{assert.equal(ready.prepare("SELECT COUNT(*) n FROM repair_attachments WHERE filename='post-snapshot'").get()!.n,0);}finally{ready.close();}assert.equal(db.prepare("SELECT COUNT(*) n FROM repair_attachments WHERE filename='post-snapshot'").get()!.n,1);
 });
 it('honors real disk admission without publishing an incomplete set',async()=>{
  const old=process.env.REPAID_BACKUP_MIN_FREE_BYTES,target=path.join(root,'no-space.rpset');process.env.REPAID_BACKUP_MIN_FREE_BYTES='18446744073709551615';try{await assert.rejects(()=>createRecoverySet(db,target,key),(error:unknown)=>(error as {status:number}).status===507);assert.equal(fs.existsSync(target),false);}finally{if(old===undefined)delete process.env.REPAID_BACKUP_MIN_FREE_BYTES;else process.env.REPAID_BACKUP_MIN_FREE_BYTES=old;}
 });
 it('rejects object-directory junctions and unexpected extra files instead of following external paths',async()=>{
  const set=path.join(root,'complete.rpset'),bad=path.join(root,'linked.rpset');fs.mkdirSync(bad);for(const name of ['database.rpbak','manifest.jsonl','COMPLETE.json'])fs.copyFileSync(path.join(set,name),path.join(bad,name));fs.symlinkSync(path.join(set,'objects'),path.join(bad,'objects'),process.platform==='win32'?'junction':'dir');await assert.rejects(()=>verifyRecoverySet(bad,key),/Unsafe/);
  fs.writeFileSync(path.join(set,'unexpected'),'must be detected');try{await assert.rejects(()=>verifyRecoverySet(set,key),/Unexpected/);}finally{fs.unlinkSync(path.join(set,'unexpected'));}
 });
 it('enforces independently verified platform permissions on uploaded and recovered plaintext files',()=>{
  const files=[path.join(objects,objectKey.slice(0,2),objectKey),path.join(root,'restored','forensic.db'),path.join(root,'restored','repaid.db')];
  if(process.platform==='win32'){
   const script="$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$allowed=@([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544');$unexpected=0;foreach($file in ($env:REPAID_ACL_FILES|ConvertFrom-Json)){$acl=Get-Acl -LiteralPath $file;if(!$acl.AreAccessRulesProtected){throw 'Inherited plaintext permissions'};$unexpected+=@($acl.Access|Where-Object {$_.AccessControlType -eq 'Allow' -and $allowed -notcontains $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value}).Count};@{unexpected=$unexpected}|ConvertTo-Json -Compress";
   const result=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,REPAID_ACL_FILES:JSON.stringify(files)}}));assert.equal(result.unexpected,0);
  }else for(const file of files)assert.equal(fs.statSync(file).mode&0o777,0o600);
 });
 it('runs the scheduled service with a verified second copy and checks authenticated snapshot freshness',async()=>{
  const local=path.join(root,'scheduled'),second=path.join(root,'second-scheduled');fs.mkdirSync(local);fs.mkdirSync(second);
  const result=await scheduledRecovery(db,{directory:local,key,copyDirectory:second});assert.equal(result.second_copy_verified,true);assert.equal(result.physical_offhost_verified,false);
  const checked=await checkScheduledRecovery({directory:local,key,copyDirectory:second,maxAgeSeconds:120});assert.equal(checked.status,'fresh_verified_recovery_set');assert.equal(checked.manifest_sha256,result.manifest_sha256);assert.equal(checked.second_copy_verified,true);
  const next=await scheduledRecovery(db,{directory:local,key,copyDirectory:second});assert.notEqual(next.filename,result.filename);assert.equal((await verifyRecoverySet(path.join(local,result.filename),key)).verified,true);
  const marker=path.join(local,'latest-backup.json'),status=JSON.parse(fs.readFileSync(marker,'utf8'));assert.equal(status.filename,next.filename);
  await assert.rejects(()=>checkScheduledRecovery({directory:local,key,maxAgeSeconds:60,now:Date.parse(next.created_at)+61000}),/stale/);
  status.verified_at=new Date(Date.parse(next.created_at)+100000000).toISOString();fs.writeFileSync(marker,JSON.stringify(status));await assert.rejects(()=>checkScheduledRecovery({directory:local,key,maxAgeSeconds:60,now:Date.parse(next.created_at)+61000}),/stale/);
  const archivedObject=path.join(second,next.filename,'objects',objectKey.slice(0,2),objectKey+'.rpbak');fs.unlinkSync(archivedObject);await assert.rejects(()=>checkScheduledRecovery({directory:local,key,copyDirectory:second}));
 });
 it('retains the previous latest-success marker when a configured second copy fails',async()=>{
  const local=path.join(root,'scheduled'),second=path.join(root,'failed-second');fs.mkdirSync(second);const marker=path.join(local,'latest-backup.json'),previous=fs.readFileSync(marker),link=fs.linkSync;
  try{fs.linkSync=((oldPath,newPath)=>{if(String(newPath).startsWith(second+path.sep))throw Error('injected second location publication failure');return link(oldPath,newPath);}) as typeof fs.linkSync;
   await assert.rejects(()=>scheduledRecovery(db,{directory:local,key,copyDirectory:second}),/injected second/);assert.deepEqual(fs.readFileSync(marker),previous);assert.equal(fs.readdirSync(second).length,0);
  }finally{fs.linkSync=link;}
  assert.equal((await checkScheduledRecovery({directory:local,key})).verified,true);
 });
});
