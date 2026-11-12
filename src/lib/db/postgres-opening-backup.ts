import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {protectPrivateStorage,openPrivateFile,syncPrivateDirectory} from '../private-storage';
import {createPostgresDatabase,type PostgresDatabase} from './postgres';
import {productionNamespace} from './pg-production-schema';
import {verifyPostgresLedgerEvidence} from './postgres-ledger-proof';
import {postgresSchemaEvidence} from './pg-migrations';
import {normalizeRestoredPostgresLedgerConstraints,verifyPostgresLedgerGuards} from './postgres-ledger';

function backupDirectory(){return path.resolve(process.env.REPAID_PG_OPENING_BACKUP_DIR??path.join(process.env.REPAID_BACKUP_WORK_DIR??process.env.REPAID_DATA_DIR??'data','pg-opening-backups'));}
function backupRoot(){const root=backupDirectory();fs.mkdirSync(root,{recursive:true,mode:0o700});protectPrivateStorage(root,'directory');return fs.realpathSync(root);}
async function fileHash(filename:string){const hash=createHash('sha256');for await(const chunk of fs.createReadStream(filename))hash.update(chunk);return hash.digest('hex');}
export async function verifyPostgresOpeningBackup(filename:string,expectedHash:string){
 if(typeof filename!=='string'||!/^[a-f0-9]{64}$/.test(expectedHash))throw Error('Invalid opening backup evidence');
 const root=fs.realpathSync(backupDirectory()),actual=fs.realpathSync(filename),stat=fs.lstatSync(filename);
 if(path.dirname(actual)!==root||stat.isSymbolicLink()||!stat.isFile()||stat.size===0||!/^opening-\d+-[a-f0-9]{24}\.dump$/.test(path.basename(actual)))throw Error('Opening backup is outside its private evidence boundary');
 protectPrivateStorage(actual,'file');if(await fileHash(actual)!==expectedHash)throw Error('Opening backup changed or is incomplete');return true;
}
function binary(name:'pg_dump'|'pg_restore'){
 const configured=process.env[name==='pg_dump'?'REPAID_PG_DUMP_BIN':'REPAID_PG_RESTORE_BIN'];
 if(configured){if(!path.isAbsolute(configured)||!fs.statSync(configured).isFile())throw Error('PostgreSQL backup executable must be an existing absolute file');return configured;}
 const linux18=path.join('/usr/lib/postgresql/18/bin',name);if(process.platform!=='win32'&&fs.existsSync(linux18))return linux18;
 return name;
}
async function run(tool:'pg_dump'|'pg_restore',args:string[],url:URL){
 const environment={...process.env,PGHOST:url.hostname.replace(/^\[|\]$/g,''),PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:decodeURIComponent(url.pathname.slice(1)),PGSSLMODE:'disable',PGCONNECT_TIMEOUT:'5'};
 await new Promise<void>((resolve,reject)=>{
  const child=spawn(binary(tool),args,{env:environment,windowsHide:true,stdio:['ignore','ignore','ignore']});
  const timer=setTimeout(()=>{child.kill();reject(Error(tool+' timed out during isolated opening recovery'));},120000);
  child.once('error',()=>{clearTimeout(timer);reject(Error(tool+' is unavailable for real opening recovery'));});
  child.once('exit',code=>{clearTimeout(timer);if(code===0)resolve();else reject(Error(tool+' failed during isolated opening recovery; no rehearsal was approved'));});
 });
}

/** Actual native archive + independent database restore, never a savepoint
 * labelled as recovery. Current acceptance is deliberately restricted to
 * disposable loopback databases; real-target recovery requires its own release.
 * External processes must run outside any source database transaction. */
export async function rehearsePostgresOpeningBackup(db:PostgresDatabase,schema:string,options:{openingId:number;sourceHash:string;verifySource:(restoredDb:PostgresDatabase)=>Promise<void>;applyOnRestored:(restoredDb:PostgresDatabase)=>Promise<unknown>}){
 productionNamespace(schema);
 if(db.isTransaction())throw Error('Opening dump/restore cannot run inside a financial transaction');
 if(!Number.isSafeInteger(options.openingId)||options.openingId<=0||!/^[a-f0-9]{64}$/.test(options.sourceHash))throw Error('Opening recovery identity is invalid');
 const database=String((await db.query('SELECT current_database() name')).rows[0].name);
 await verifyPostgresLedgerGuards(db,schema);
 const candidates=[process.env.REPAID_PG_TEST_URL,process.env.REPAID_PG_URL].filter((value):value is string=>!!value);
 let source:URL|undefined;for(const candidate of candidates){try{const parsed=new URL(candidate);if(parsed.pathname==='/'+database)source=parsed;}catch{/* Invalid candidates are never used or echoed. */}}
 if(!source||!['postgres:','postgresql:'].includes(source.protocol)||source.search||!['127.0.0.1','localhost','[::1]'].includes(source.hostname)||!/^repaid_(?:test|phase01)_[a-f0-9]{24}$/.test(database))throw Error('Opening restore currently requires explicit disposable loopback PostgreSQL configuration');
 const adminUrl=new URL(source);adminUrl.pathname='/postgres';
 const admin=createPostgresDatabase({connectionString:adminUrl.toString(),allowLocalPlaintext:true,statementTimeoutMs:120000,lockTimeoutMs:10000}),name='repaid_opening_'+randomBytes(12).toString('hex'),restoreUrl=new URL(source);restoreUrl.pathname='/'+name;
 const directory=backupRoot(),filename=path.join(directory,'opening-'+options.openingId+'-'+randomBytes(12).toString('hex')+'.dump');
 let created=false,restored:PostgresDatabase|undefined,failure:unknown;
 try{
  const fd=openPrivateFile(filename);fs.closeSync(fd);
  // pg_dump provides one consistent MVCC snapshot. Existing functions, exact
  // values, identities, constraints and immutable source evidence are included.
  await run('pg_dump',['--format=custom','--no-owner','--no-privileges','--schema='+schema,'--file='+filename],source);
  const archive=fs.openSync(filename,'r+');try{fs.fsyncSync(archive);}finally{fs.closeSync(archive);}
  const backup_hash=await fileHash(filename);await verifyPostgresOpeningBackup(filename,backup_hash);syncPrivateDirectory(directory);
  await admin.query('CREATE DATABASE "'+name+'"');created=true;
  // Data is restored before post-data triggers/FKs, without disabling guards on
  // the source or requiring session_replication_role/superuser bypass.
  for(const section of ['pre-data','data','post-data'])await run('pg_restore',['--exit-on-error','--no-owner','--no-privileges','--section='+section,'--dbname='+name,filename],restoreUrl);
  restored=createPostgresDatabase({connectionString:restoreUrl.toString(),allowLocalPlaintext:true});
  const normalization=await normalizeRestoredPostgresLedgerConstraints(restored,schema);
  const originalSchema=await postgresSchemaEvidence(db,schema),restoredSchema=await postgresSchemaEvidence(restored,schema);
  if(originalSchema.digest!==restoredSchema.digest){
   const sections=['columns','constraints','indexes','triggers','views','functions','sequences'];
   const changed=sections.filter((_,index)=>JSON.stringify(originalSchema.components[index])!==JSON.stringify(restoredSchema.components[index]));
   const diagnostics=filename+'.schema-drift.json',fd=openPrivateFile(diagnostics);try{fs.writeFileSync(fd,JSON.stringify({changed,source:originalSchema.components,restored:restoredSchema.components}));}finally{fs.closeSync(fd);}
   throw Error('Native restored schema differs: '+changed.join(', ')+'; private structural evidence retained');
  }
  await options.verifySource(restored);const result=await options.applyOnRestored(restored);
  const ledger=await verifyPostgresLedgerEvidence(restored,schema);if(!ledger.valid)throw Error('Restored opening journal failed independent ledger verification');
  await verifyPostgresOpeningBackup(filename,backup_hash);
  return {backup_path:filename,backup_hash,rehearsal:{restored:true as const,source_hash:options.sourceHash,result,ledger,constraint_normalization:normalization}};
 }catch(error){failure=error;throw error;}finally{
  try{try{await restored?.close();}finally{if(created)await admin.query('DROP DATABASE "'+name+'" WITH (FORCE)');}}
  catch(cleanup){throw failure?new AggregateError([failure,cleanup],'Opening rehearsal and owned database cleanup failed'):cleanup;}
  finally{await admin.close();}
 }
}
