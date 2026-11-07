#!/usr/bin/env node
// Native Node24 host helpers. Secrets never appear in arguments or stdout.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{parseEnv}=require('node:util');
function atomic(filename,contents,gid){
 const parent=fs.realpathSync(path.dirname(filename));if(fs.existsSync(filename)&&fs.lstatSync(filename).isSymbolicLink())throw Error('Symlinked environment refused');
 const temporary=path.join(parent,'.repaid-env-'+crypto.randomBytes(12).toString('hex')),file=fs.openSync(temporary,'wx',0o600);
 try{try{fs.writeFileSync(file,contents);if(process.platform!=='win32')fs.fchownSync(file,process.getuid(),gid);fs.fchmodSync(file,0o640);fs.fsyncSync(file);}finally{fs.closeSync(file);}fs.renameSync(temporary,filename);
  if(process.platform!=='win32'){const folder=fs.openSync(parent,'r');try{fs.fsyncSync(folder);}finally{fs.closeSync(folder);}}
 }finally{fs.rmSync(temporary,{force:true});}
}
function readEnvironment(filename){
 const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||(process.platform!=='win32'&&(stat.uid!==process.getuid()||(stat.mode&0o037))))throw Error('Untrusted environment file');
 return parseEnv(fs.readFileSync(filename,'utf8'));
}
function ordinaryEntry(filename){
 const entry=fs.lstatSync(filename,{throwIfNoEntry:false});if(entry?.isSymbolicLink())throw Error('Symlinked deployment state requires review');return entry;
}
function freshDataDirectory(directory){
 const entry=ordinaryEntry(directory);if(!entry)return true;if(!entry.isDirectory())return false;
 return fs.readdirSync(directory).every(name=>{if(!['objects','backup-work','restores'].includes(name))return false;const child=ordinaryEntry(path.join(directory,name));return child?.isDirectory()&&fs.readdirSync(path.join(directory,name)).length===0;});
}
function emptyDirectory(directory){const entry=ordinaryEntry(directory);return !entry||(entry.isDirectory()&&fs.readdirSync(directory).length===0);}
function initialize(options){
 const {app,backup,data,backups,origin,gid}=options;const url=new URL(origin);
 if(url.protocol!=='https:'||url.pathname!=='/'||url.username||url.password||url.search||url.hash)throw Error('Canonical HTTPS origin required');
 for(const folder of [data,backups])if(!/^\/[a-zA-Z0-9_./-]+$/.test(folder)||folder.split('/').some(v=>v==='..'))throw Error('Unsafe persistent path');
 const appExists=ordinaryEntry(app),backupExists=ordinaryEntry(backup);
 if((!appExists||!backupExists)&&(!freshDataDirectory(data)||!emptyDirectory(backups)||(!appExists&&backupExists)))throw Error('Missing deployment secrets require recovery of original files; automatic key replacement refused');
 if(fs.existsSync(app)){const current=readEnvironment(app);if(!/^[a-f0-9]{64}$/i.test(current.REPAID_ENCRYPTION_KEY??'')||current.REPAID_DATA_DIR!==data||current.REPAID_DATABASE_ENGINE!=='sqlite'||current.WEB_CONCURRENCY!=='1'||current.APP_ORIGIN!==url.origin)throw Error('Existing key/storage/origin configuration must be reviewed; no overwrite performed');}
 else atomic(app,[`NODE_ENV=production`,`TZ=Asia/Tehran`,`APP_ORIGIN=${url.origin}`,`HOSTNAME=127.0.0.1`,`WEB_CONCURRENCY=1`,`REPAID_DATABASE_ENGINE=sqlite`,`REPAID_DEMO_MODE=0`,`REPAID_COOKIE_SECURE=1`,`REPAID_TRUST_PROXY=1`,`REPAID_ENCRYPTION_KEY=${crypto.randomBytes(32).toString('hex')}`,`REPAID_DATA_DIR=${data}`,`REPAID_ATTACHMENT_STORAGE=filesystem`,`REPAID_OBJECT_DIR=${data}/objects`,`REPAID_OBJECT_MIN_FREE_BYTES=5368709120`,`REPAID_BACKUP_WORK_DIR=${data}/backup-work`,`REPAID_BACKUP_MIN_FREE_BYTES=5368709120`,``].join('\n'),gid);
 if(fs.existsSync(backup)){const current=readEnvironment(backup);if(!/^[a-f0-9]{64}$/i.test(current.REPAID_BACKUP_KEY??'')||current.REPAID_BACKUP_DIR!==backups||current.REPAID_BACKUP_WORK_DIR!==data+'/backup-work')throw Error('Existing backup configuration invalid; refusing rotation');}
 else atomic(backup,[`REPAID_BACKUP_KEY=${crypto.randomBytes(32).toString('hex')}`,`REPAID_BACKUP_DIR=${backups}`,`REPAID_BACKUP_WORK_DIR=${data}/backup-work`,`REPAID_BACKUP_MAX_AGE_SECONDS=7200`,``].join('\n'),gid);
 return {configured:true,existing_keys_preserved:true};
}
function hostReserved(host,files){
 const wanted=host.toLowerCase();
 for(const file of files){const text=fs.readFileSync(file,'utf8').replace(/#[^\n]*/g,'');for(const match of text.matchAll(/\bserver_name\s+([^;]+);/g))if(match[1].split(/\s+/).some(word=>word.replace(/^["']|["']$/g,'').toLowerCase()===wanted))return true;}
 return false;
}
function changeOrigin(filename,origin,gid){
 const url=new URL(origin);if(url.protocol!=='https:'||url.origin!==origin||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Canonical HTTPS origin required');
 const before=readEnvironment(filename),text=fs.readFileSync(filename,'utf8'),matches=[...text.matchAll(/^APP_ORIGIN=.*$/gm)];if(matches.length!==1)throw Error('Ambiguous origin configuration');
 const updated=text.replace(/^APP_ORIGIN=.*$/m,'APP_ORIGIN='+url.origin),parsed=parseEnv(updated);
 for(const key of new Set([...Object.keys(before),...Object.keys(parsed)]))if(key!=='APP_ORIGIN'&&before[key]!==parsed[key])throw Error('Unrelated configuration changed');
 atomic(filename,updated,gid);return {origin_updated:true,keys_preserved:true};
}
function main(){
 if(process.getuid?.()!==0)throw Error('Host configuration requires root');
 const [action,...args]=process.argv.slice(2);
 if(action==='env-init'){const[app,backup,data,backups,origin,gid]=args;return initialize({app,backup,data,backups,origin,gid:Number(gid)});}
 if(action==='change-origin')return changeOrigin(args[0],args[1],Number(args[2]));
 if(action==='host-free'){
  const own='/etc/nginx/sites-available/repaid',files=[];
  for(const directory of ['/etc/nginx/sites-enabled','/etc/nginx/conf.d'])if(fs.existsSync(directory))for(const entry of fs.readdirSync(directory)){const file=path.join(directory,entry),real=fs.realpathSync(file);if(real!==own&&fs.statSync(file).isFile())files.push(file);}
  if(hostReserved(args[0],files))throw Error('Hostname belongs to another enabled site');return {host_available:true};
 }
 if(action==='validate-edit'){
  const[app,backup,oldApp,oldBackup,data,backups,origin,gid]=args;
  const currentApp=readEnvironment(app),currentBackup=readEnvironment(backup);
  if(currentApp.REPAID_ENCRYPTION_KEY!==readEnvironment(oldApp).REPAID_ENCRYPTION_KEY||currentBackup.REPAID_BACKUP_KEY!==readEnvironment(oldBackup).REPAID_BACKUP_KEY)throw Error('Key rotation refused');
  return initialize({app,backup,data,backups,origin,gid:Number(gid)});
 }
 throw Error('Unknown host action');
}
module.exports={initialize,readEnvironment,hostReserved,changeOrigin};
if(require.main===module)try{console.log(JSON.stringify(main()));}catch{console.error('Host configuration rejected; existing secrets were not replaced.');process.exitCode=1;}
