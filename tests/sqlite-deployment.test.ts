import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {assertSqliteRuntime} from '../src/lib/db/runtime';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import cluster from 'node:cluster';
import {spawnSync} from 'node:child_process';
import {once} from 'node:events';
describe('explicit supported SQLite deployment',()=>{
 it('accepts a dedicated single web process and never silently switches engines',()=>{
  assert.doesNotThrow(()=>assertSqliteRuntime('sqlite',{},false));
  assert.doesNotThrow(()=>assertSqliteRuntime('sqlite',{WEB_CONCURRENCY:'1'},false));
  assert.throws(()=>assertSqliteRuntime('postgres',{},false),/No SQLite fallback/);
 });
 it('blocks Vercel, Netlify and Lambda before temporary business persistence can be opened',()=>{
  for(const environment of [{VERCEL:'1'},{NETLIFY:'true'},{AWS_LAMBDA_FUNCTION_NAME:'business-function'}])assert.throws(()=>assertSqliteRuntime('sqlite',environment,false),/serverless temporary storage is unsupported/);
 });
 it('rejects declared multi-process/clustered web instances without weakening independent backup tooling',()=>{
  for(const WEB_CONCURRENCY of ['0','2','4','many','1.0'])assert.throws(()=>assertSqliteRuntime('sqlite',{WEB_CONCURRENCY},false),/one application web process/);
  assert.throws(()=>assertSqliteRuntime('sqlite',{},true),/Clustered/);
 });
 it('rejects declared serverless startup in independent processes without creating a database directory',()=>{
  for(const flag of ['VERCEL','NETLIFY','AWS_LAMBDA_FUNCTION_NAME']){
   const root=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-runtime-'));
   try{
    const result=spawnSync(process.execPath,['--import','tsx','tests/sqlite-deployment-worker.ts'],{encoding:'utf8',windowsHide:true,timeout:10000,env:{...process.env,REPAID_DEPLOYMENT_PROBE_DIR:root,[flag]:'1'}});
    assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{blocked:true,created:false,clusterWorker:false});
   }finally{const resolved=fs.realpathSync(root);assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('repaid-runtime-'));fs.rmSync(resolved,{recursive:true,force:true});}
  }
 });
 it('rejects a real Node cluster worker before any persistence is opened',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-runtime-'));
  cluster.setupPrimary({exec:path.resolve('tests/sqlite-deployment-worker.ts'),execArgv:['--import','tsx'],silent:true});
  const worker=cluster.fork({REPAID_DEPLOYMENT_PROBE_DIR:root}),ended=once(worker,'exit');
  try{const [result]=await once(worker,'message',{signal:AbortSignal.timeout(10000)});assert.deepEqual(result,{blocked:true,created:false,clusterWorker:true});await ended;}
  finally{if(!worker.isDead()){worker.kill();await ended;}const resolved=fs.realpathSync(root);assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('repaid-runtime-'));fs.rmSync(resolved,{recursive:true,force:true});}
 });
});
