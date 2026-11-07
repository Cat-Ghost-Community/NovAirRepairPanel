'use strict';
// Offline filesystem transition only. Never deletes an original or failed data tree.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{parseEnv}=require('node:util');
function digest(file){const hash=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),buffer=Buffer.allocUnsafe(65536);try{let count;while((count=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,count));return hash.digest('hex');}finally{fs.closeSync(fd);}}
function ordinary(file,directory=false){const s=fs.lstatSync(file);if(s.isSymbolicLink()||(directory?!s.isDirectory():!s.isFile())||fs.realpathSync(file)!==path.resolve(file))throw Error('Ordinary canonical path required');return s;}
function sync(directory){if(process.platform==='win32')return;const fd=fs.openSync(directory,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function write(file,value,exclusive=false){const target=exclusive?file:file+'.'+crypto.randomBytes(6).toString('hex'),fd=fs.openSync(target,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}if(!exclusive)fs.renameSync(target,file);sync(path.dirname(file));}
const identity=s=>({ino:String(s.ino),dev:String(s.dev)});
const same=(s,id)=>String(s.ino)===id.ino&&String(s.dev)===id.dev;
function privateCopy(from,to){const stat=ordinary(from);if(process.platform!=='win32'&&(stat.uid!==process.getuid()||(stat.mode&0o022)))throw Error('Untrusted configuration');fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);fs.chmodSync(to,0o600);if(digest(from)!==digest(to))throw Error('Configuration copy verification failed');return {source:from,copy:to,sha256:digest(to)};}
function load(marker){const stat=ordinary(marker);if(process.platform!=='win32'&&(stat.uid!==process.getuid()||(stat.mode&0o077)))throw Error('Private reset journal required');const s=JSON.parse(fs.readFileSync(marker,'utf8'));if(s.format!==1||!/^[a-f0-9]{24}$/.test(s.id)||s.retired!==s.data+'.retired-'+s.id||s.failed!==s.data+'.failed-'+s.id||path.dirname(s.custody)!==s.backups||path.basename(s.custody)!=='clean-reinstall-'+s.id)throw Error('Invalid reset journal');for(const item of s.configuration){ordinary(item.copy);ordinary(item.source);if(digest(item.copy)!==item.sha256||digest(item.source)!==item.sha256)throw Error('Configuration changed during reset; review retained evidence');}return s;}
function prepare(o){
 if(fs.existsSync(o.marker))throw Error('An unfinished reset requires recovery');
 const stat=ordinary(o.data,true);ordinary(path.dirname(o.data),true);ordinary(o.backups,true);ordinary(path.dirname(o.marker),true);
 if(String(stat.dev)!==String(fs.statSync(path.dirname(o.data)).dev))throw Error('Mounted data roots require a separate reviewed migration');
 const app=parseEnv(fs.readFileSync(o.app,'utf8')),backup=parseEnv(fs.readFileSync(o.backup,'utf8'));
 if(o.data===o.backups||o.backups.startsWith(o.data+path.sep)||o.data.startsWith(o.backups+path.sep))throw Error('Data and backup roots must be separate');
 if(app.REPAID_DATABASE_ENGINE!=='sqlite'||app.REPAID_DATA_DIR!==o.data||backup.REPAID_BACKUP_DIR!==o.backups||app.REPAID_BACKUP_WORK_DIR!==path.join(o.data,'backup-work')||(app.REPAID_ATTACHMENT_STORAGE==='filesystem'&&app.REPAID_OBJECT_DIR!==path.join(o.data,'objects')))throw Error('Unsupported data/key ownership; no reset applied');
 if(!Number.isSafeInteger(o.uid)||o.uid<=0||!Number.isSafeInteger(o.gid)||o.gid<=0)throw Error('Dedicated service identity required');
 ordinary(path.join(o.data,'repaid.db'));ordinary(o.recovery,true);ordinary(path.join(o.recovery,'manifest.jsonl'));
 if(!o.recovery.startsWith(o.backups+path.sep))throw Error('Managed rehearsed recovery set required');
 const id=crypto.randomBytes(12).toString('hex'),custody=path.join(o.backups,'clean-reinstall-'+id);
 fs.mkdirSync(custody,{mode:0o700});const configuration=[['app.env',o.app],['backup.env',o.backup],['server.conf',o.config]].map(([name,file])=>privateCopy(file,path.join(custody,name)));
 const state={format:1,id,data:o.data,backups:o.backups,custody,retired:o.data+'.retired-'+id,failed:o.data+'.failed-'+id,rehearsed_recovery_set:o.recovery,configuration,original:identity(stat),original_database_sha256:digest(path.join(o.data,'repaid.db')),original_mode:stat.mode&0o777,original_uid:stat.uid,original_gid:stat.gid,service_uid:o.uid,service_gid:o.gid,phase:'prepared',created_at:new Date().toISOString()};
 write(o.marker,state,true);return {prepared:true,custody};
}
function reset(marker){const s=load(marker);if(s.phase!=='prepared'||!same(ordinary(s.data,true),s.original)||fs.existsSync(s.retired)||fs.existsSync(s.failed))throw Error('Reset state changed');
 fs.renameSync(s.data,s.retired);fs.chmodSync(s.retired,0o700);if(process.platform!=='win32')fs.chownSync(s.retired,process.getuid(),process.getgid());sync(path.dirname(s.data));s.phase='detached';write(marker,s);
 fs.mkdirSync(s.data,{mode:0o700});s.fresh=identity(fs.statSync(s.data));write(marker,s);fs.writeFileSync(path.join(s.data,'.repaid-reinstall'),s.id,{flag:'wx',mode:0o600});
 for(const folder of [s.data,path.join(s.data,'objects'),path.join(s.data,'backup-work')]){if(folder!==s.data)fs.mkdirSync(folder,{mode:0o700});if(process.platform!=='win32')fs.chownSync(folder,s.service_uid,s.service_gid);}
 s.phase='fresh';write(marker,s);return {fresh_data_prepared:true,custody:s.custody};
}
function recover(marker){const s=load(marker);
 if(fs.existsSync(s.retired)){if(!same(ordinary(s.retired,true),s.original)||digest(path.join(s.retired,'repaid.db'))!==s.original_database_sha256)throw Error('Retained original identity/evidence changed');
  if(fs.existsSync(s.data)){const current=ordinary(s.data,true);if(s.fresh?!same(current,s.fresh):fs.readdirSync(s.data).length!==0)throw Error('Unrecognized replacement data; manual review required');if(fs.existsSync(s.failed))throw Error('Failed-data evidence already exists');fs.renameSync(s.data,s.failed);fs.chmodSync(s.failed,0o700);if(process.platform!=='win32')fs.chownSync(s.failed,process.getuid(),process.getgid());}
  fs.renameSync(s.retired,s.data);fs.chmodSync(s.data,s.original_mode);if(process.platform!=='win32')fs.chownSync(s.data,s.original_uid,s.original_gid);sync(path.dirname(s.data));
 }else if(!same(ordinary(s.data,true),s.original))throw Error('Original data is unavailable; use reviewed recovery set');
 s.phase='recovered';s.recovered_at=new Date().toISOString();write(marker,s);fs.renameSync(marker,path.join(s.custody,'recovered.json'));sync(path.dirname(marker));return {original_restored:true,custody:s.custody};
}
function commit(marker){const s=load(marker);if(s.phase!=='fresh'||!same(ordinary(s.data,true),s.fresh))throw Error('Fresh data identity changed');ordinary(path.join(s.data,'repaid.db'));const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(path.join(s.data,'repaid.db'),{readOnly:true});try{if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||!db.prepare("SELECT id FROM users WHERE role='owner' AND is_active=1 LIMIT 1").get())throw Error('Fresh database is not ready');}finally{db.close();}
 s.phase='committed';s.committed_at=new Date().toISOString();write(marker,s);fs.renameSync(marker,path.join(s.custody,'completed.json'));sync(path.dirname(marker));return {committed:true,custody:s.custody,retained_original:s.retired};
}
module.exports={prepare,reset,recover,commit};
if(require.main===module)try{if(process.platform!=='linux'||process.getuid()!==0)throw Error('Linux root operation required');const[action,...args]=process.argv.slice(2);let result;if(action==='prepare'){const[marker,config,app,backup,data,backups,recovery,uid,gid]=args;result=prepare({marker,config,app,backup,data,backups,recovery,uid:Number(uid),gid:Number(gid)});}else if(['reset','recover','commit'].includes(action))result=module.exports[action](args[0]);else throw Error('Unknown reset operation');console.log(JSON.stringify(result));}catch(error){console.error(error.message);process.exitCode=1;}
