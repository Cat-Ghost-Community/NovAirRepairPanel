import {it} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
const {prepare,reset,recover,commit}=createRequire(import.meta.url)('../deploy/wizard/reinstall-state.cjs');
const hash=(file:string)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-reinstall-')),data=path.join(root,'data'),backups=path.join(root,'backups'),config=path.join(root,'server.conf'),app=path.join(root,'app.env'),backup=path.join(root,'backup.env'),marker=path.join(root,'reinstall.json'),recovery=path.join(backups,'verified.rpset');
 for(const dir of [data,backups,recovery])fs.mkdirSync(dir,{mode:0o700});fs.writeFileSync(path.join(recovery,'manifest.jsonl'),'isolated filesystem-unit fixture; actual encrypted rehearsal covered in Linux acceptance');fs.writeFileSync(config,'APP_DIR=/opt/repaid\n',{mode:0o600});
 fs.writeFileSync(app,`REPAID_DATABASE_ENGINE=sqlite\nREPAID_DATA_DIR=${data}\nREPAID_ATTACHMENT_STORAGE=filesystem\nREPAID_OBJECT_DIR=${path.join(data,'objects')}\nREPAID_BACKUP_WORK_DIR=${path.join(data,'backup-work')}\nREPAID_ENCRYPTION_KEY=${'1'.repeat(64)}\n`,{mode:0o600});fs.writeFileSync(backup,`REPAID_BACKUP_DIR=${backups}\nREPAID_BACKUP_KEY=${'2'.repeat(64)}\n`,{mode:0o600});
 const db=new DatabaseSync(path.join(data,'repaid.db'));db.exec("CREATE TABLE evidence(id INTEGER PRIMARY KEY,value TEXT);INSERT INTO evidence VALUES(42,'original immutable evidence')");db.close();fs.mkdirSync(path.join(data,'objects'));fs.writeFileSync(path.join(data,'objects','original.bin'),'original attachment bytes');
 const originalHash=hash(path.join(data,'repaid.db')),keyHash=hash(app),backupHash=hash(backup);
 return {root,data,backups,config,app,backup,marker,recovery,uid:process.getuid?.()||1001,gid:process.getgid?.()||1001,originalHash,keyHash,backupHash};
}
it('clean active data preserves original database/attachments, keys and immutable recovery evidence; commit is one-way',()=>{
 const f=fixture();prepare(f);reset(f.marker);const state=JSON.parse(fs.readFileSync(f.marker,'utf8'));assert.equal(fs.existsSync(path.join(f.data,'repaid.db')),false);assert.equal(hash(path.join(state.retired,'repaid.db')),f.originalHash);assert.equal(fs.readFileSync(path.join(state.retired,'objects','original.bin'),'utf8'),'original attachment bytes');assert.equal(hash(f.app),f.keyHash);assert.equal(hash(f.backup),f.backupHash);
 const db=new DatabaseSync(path.join(f.data,'repaid.db'));db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,is_active INTEGER);INSERT INTO users VALUES(1,'owner',1)");db.close();const result=commit(f.marker);assert.equal(result.committed,true);assert.equal(fs.existsSync(f.marker),false);assert.equal(hash(path.join(state.retired,'repaid.db')),f.originalHash);assert.throws(()=>recover(f.marker));assert.equal(JSON.parse(fs.readFileSync(path.join(state.custody,'completed.json'),'utf8')).phase,'committed');
});
it('failed initialization restores the exact original identity and retains failed fresh data without deleting either history',()=>{
 const f=fixture(),before=fs.statSync(f.data).ino;prepare(f);reset(f.marker);const state=JSON.parse(fs.readFileSync(f.marker,'utf8'));assert.throws(()=>reset(f.marker));fs.writeFileSync(path.join(f.data,'failed-operation.txt'),'failure evidence');assert.throws(()=>commit(f.marker));recover(f.marker);assert.equal(fs.statSync(f.data).ino,before);assert.equal(hash(path.join(f.data,'repaid.db')),f.originalHash);assert.equal(fs.readFileSync(path.join(state.failed,'failed-operation.txt'),'utf8'),'failure evidence');assert.equal(hash(f.app),f.keyHash);assert.equal(hash(f.backup),f.backupHash);
});
it('recovers a real injected filesystem failure immediately after the original tree is detached',()=>{
 const f=fixture();prepare(f);const mkdir=fs.mkdirSync;try{fs.mkdirSync=((dir:fs.PathLike,...args:unknown[])=>{if(String(dir)===f.data)throw Error('injected mkdir failure');return Reflect.apply(mkdir,fs,[dir,...args]);}) as typeof fs.mkdirSync;assert.throws(()=>reset(f.marker),/injected/);}finally{fs.mkdirSync=mkdir;}
 recover(f.marker);assert.equal(hash(path.join(f.data,'repaid.db')),f.originalHash);assert.equal(fs.existsSync(f.marker),false);
});
it('rejects stale/tampered configuration and overlapping roots before silently overwriting evidence',()=>{
 const f=fixture();prepare(f);reset(f.marker);fs.appendFileSync(f.app,'UNREVIEWED=1\n');assert.throws(()=>recover(f.marker),/Configuration changed/);assert.ok(fs.existsSync(f.marker));const second=fixture();assert.throws(()=>prepare({...second,backups:second.data}),/separate/);assert.equal(hash(path.join(second.data,'repaid.db')),second.originalHash);
});
