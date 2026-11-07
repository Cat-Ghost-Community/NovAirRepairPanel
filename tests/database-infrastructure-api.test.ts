import {before,after,describe,it} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {NextRequest} from 'next/server';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-database-api-'));process.env.REPAID_DATA_DIR=directory;process.env.REPAID_DEMO_MODE='0';process.env.REPAID_ATTACHMENT_STORAGE='filesystem';process.env.REPAID_OBJECT_DIR=path.join(directory,'objects');fs.mkdirSync(process.env.REPAID_OBJECT_DIR);
let db:ReturnType<typeof import('../src/lib/db/schema').getDb>,owner:string,foreign:string,otherOwner:string;const origin='http://app.test';
const request=(url:string,token:string)=>new NextRequest(origin+url,{headers:{cookie:'repaid_session='+token,origin}});
before(async()=>{db=(await import('../src/lib/db/schema')).getDb();const {createSession}=await import('../src/lib/auth');
 db.exec("INSERT INTO branches(id,name,code) VALUES(1,'ONE','ONE'),(2,'TWO','TWO');INSERT INTO users(id,name,email,password_hash,role,branch_id) VALUES(1,'Owner','o@test','x','owner',1),(2,'Other','f@test','x','manager',2),(3,'Other owner','oo@test','x','owner',2);INSERT INTO customers(id,first_name,branch_id) VALUES(1,'Customer',1);INSERT INTO devices(id,customer_id,type,branch_id) VALUES(1,1,'phone',1);INSERT INTO repair_statuses(id,name) VALUES(1,'Received');INSERT INTO repair_tickets(id,number,branch_id,customer_id,device_id,status_id) VALUES(1,'INFRA-ONE',1,1,1,1);");owner=createSession(1);foreign=createSession(2);otherOwner=createSession(3);
});after(()=>{db.close();delete process.env.REPAID_ATTACHMENT_STORAGE;delete process.env.REPAID_OBJECT_DIR;fs.rmSync(directory,{recursive:true,force:true});});
describe('database infrastructure preserves actual API authorization and recovery',()=>{
 it('uploads to private objects, retains metadata and denies another branch before reading bytes',async()=>{
  const {POST}=await import('../src/app/api/repairs/[id]/attachments/route'),{GET}=await import('../src/app/api/files/[id]/route');
  const bytes=Buffer.from('%PDF-1.7\nprivate database infrastructure attachment'),form=new FormData();form.set('file',new File([bytes],'evidence.pdf',{type:'application/pdf'}));
  const response=await POST(new NextRequest(origin+'/api/repairs/1/attachments',{method:'POST',headers:{cookie:'repaid_session='+owner,origin},body:form}),{params:Promise.resolve({id:'1'})});assert.equal(response.status,200);
  const row=db.prepare('SELECT * FROM repair_attachments ORDER BY id DESC LIMIT 1').get()!;assert.equal((row.data as Uint8Array).length,0);assert.equal(String(row.object_key).length,64);
  const params={params:Promise.resolve({id:String(row.id)})};assert.equal((await GET(request('/api/files/'+row.id,foreign),params)).status,404);const downloaded=await GET(request('/api/files/'+row.id,owner),params);assert.equal(downloaded.status,200);assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),bytes);
 });
 it('streams a consistent authorized backup and does not claim success with missing attachment storage',async()=>{
  const {GET}=await import('../src/app/api/backup/route');assert.equal((await GET(request('/api/backup',foreign))).status,403);
  const response=await GET(request('/api/backup',owner));assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(Number(response.headers.get('Content-Length')),bytes.length);
  const file=path.join(directory,'downloaded.db');fs.writeFileSync(file,bytes);const {openStandaloneSqlite}=await import('../src/lib/backup');const copy=openStandaloneSqlite(file);try{assert.equal(copy.prepare('SELECT COUNT(*) n FROM repair_attachments').get()!.n,1);}finally{copy.close();}
  const root=process.env.REPAID_OBJECT_DIR;delete process.env.REPAID_OBJECT_DIR;try{assert.equal((await GET(request('/api/backup',owner))).status,500);}finally{process.env.REPAID_OBJECT_DIR=root;}
 });
 it('restricts infrastructure metrics to administrators and contains no path or secret',async()=>{
  const {GET}=await import('../src/app/api/system/database/route');assert.equal((await GET(request('/api/system/database',foreign))).status,403);const response=await GET(request('/api/system/database',owner));assert.equal(response.status,200);const json=await response.json();assert.equal(json.engine,'sqlite');assert.equal(json.attachmentStorage,'filesystem');assert.equal(json.journalMode,'wal');assert.equal(JSON.stringify(json).includes(directory),false);
 });
 it('hands off a one-use owner-bound native download without a browser-sized Buffer',async()=>{
  const {GET,POST}=await import('../src/app/api/backup/route'),prepare=()=>POST(new NextRequest(origin+'/api/backup?mode=prepare',{method:'POST',headers:{cookie:'repaid_session='+owner,origin}}));
  assert.equal((await GET(request('/api/backup?mode=prepare',owner))).status,405);
  const prepared=await prepare();assert.equal(prepared.status,200);const json=await prepared.json(),url=String(json.download_url),id=new URL(origin+url).searchParams.get('download')!,row=db.prepare('SELECT * FROM backup_downloads WHERE id=?').get(id)!;
  assert.equal((await GET(request(url,otherOwner))).status,409);assert.equal((await GET(request(url,foreign))).status,403);
  const download=await GET(request(url,owner));assert.equal(download.status,200);assert.equal((await download.arrayBuffer()).byteLength,json.bytes);await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal((await GET(request(url,owner))).status,409);assert.equal(fs.existsSync(String(row.snapshot_path)),false);assert.equal(db.prepare('SELECT status FROM backups WHERE id=?').get(row.backup_id)!.status,'streamed');
  const first=await (await prepare()).json(),second=await (await prepare()).json();assert.equal((await prepare()).status,429);
  db.prepare("UPDATE backup_downloads SET expires_at=0 WHERE state='prepared'").run();assert.equal((await GET(request(first.download_url,owner))).status,409);assert.equal((await GET(request(second.download_url,owner))).status,409);
  const denied=await POST(new NextRequest(origin+'/api/backup?mode=prepare',{method:'POST',headers:{cookie:'repaid_session='+owner,origin:'https://foreign.test'}}));assert.equal(denied.status,403);
 });
 it('records only outer write transaction outcomes with bounded aggregate metrics',async()=>{
  const {atomic}=await import('../src/lib/db/transaction'),{databaseTransactionMetrics}=await import('../src/lib/db/metrics');const before=databaseTransactionMetrics();
  atomic(db,()=>atomic(db,()=>db.prepare('SELECT 1').get()));assert.throws(()=>atomic(db,()=>{throw new Error('expected rollback');}),/expected/);const now=databaseTransactionMetrics();assert.equal(now.committed-before.committed,1);assert.equal(now.rolledBack-before.rolledBack,1);assert.equal(now.buckets.length,8);
 });
 it('reserves capacity before concurrent API preparations can allocate multiple snapshots',async()=>{
  const {GET,POST}=await import('../src/app/api/backup/route');const make=()=>POST(new NextRequest(origin+'/api/backup?mode=prepare',{method:'POST',headers:{cookie:'repaid_session='+owner,origin}})),results=await Promise.all([make(),make(),make()]);assert.equal(results.filter(response=>response.status===200).length,1);assert.equal(results.filter(response=>response.status===429).length,2);assert.equal(db.prepare("SELECT count(*) n FROM backup_preparations WHERE state='preparing'").get()?.n,0);
  const ticket=await results.find(response=>response.status===200)!.json(),download=await GET(request(ticket.download_url,owner));assert.equal(download.status,200);await download.arrayBuffer();await new Promise(resolve=>setTimeout(resolve,20));
 });
});
