import {it,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const privateRoot=fs.realpathSync(process.env.REPAID_TEST_WORKSPACE!),directory=fs.mkdtempSync(path.join(privateRoot,'runner-isolation-'));
after(()=>{const resolved=fs.realpathSync(directory);assert.equal(path.dirname(resolved),privateRoot);assert.ok(path.basename(resolved).startsWith('runner-isolation-'));fs.rmSync(resolved,{recursive:true,force:true});});
function probe(environment:NodeJS.ProcessEnv,script='process.stdout.write("preload-accepted")'){
 return spawnSync(process.execPath,['--import','tsx','--import','./scripts/test-environment.cjs','--input-type=module','--eval',script],{encoding:'utf8',windowsHide:true,timeout:20000,env:environment});
}
it('gives an early schema import a fresh private database instead of the business database',()=>{
 const environment:NodeJS.ProcessEnv={...process.env,REPAID_DEMO_MODE:'0'};delete environment.REPAID_DATA_DIR;delete environment.REPAID_TEST_DEFAULT_DATA_DIR;
 const child=probe(environment,"const {getDb,DB_PATH}=await import('./src/lib/db/schema.ts');const db=getDb();try{process.stdout.write(JSON.stringify({filename:DB_PATH,customers:Number(db.prepare('SELECT COUNT(*) n FROM customers').get().n)}));}finally{db.close();}");assert.equal(child.status,0,child.stderr);
 const result=JSON.parse(child.stdout),folder=fs.realpathSync(path.dirname(result.filename));assert.ok(folder.startsWith(privateRoot+path.sep));assert.ok(path.basename(folder).startsWith('repaid-test-default-'));assert.equal(result.customers,0);fs.rmSync(folder,{recursive:true,force:true});
});
it('rejects an explicitly configured business directory before evaluating the test module',()=>{
 const child=probe({...process.env,REPAID_DATA_DIR:path.resolve('data')});assert.notEqual(child.status,0);assert.match(child.stderr,/Test data must stay inside/);assert.equal(child.stdout,'');
});
it('rejects a test workspace configured as the business directory',()=>{
 const child=probe({...process.env,REPAID_TEST_WORKSPACE:path.resolve('data')});assert.notEqual(child.status,0);assert.match(child.stderr,/Test workspace must be separate/);assert.equal(child.stdout,'');
});
it('rejects a test-workspace junction into the business directory',()=>{
 const link=path.join(directory,'workspace-business-link');fs.symlinkSync(path.resolve('data'),link,process.platform==='win32'?'junction':'dir');try{const child=probe({...process.env,REPAID_TEST_WORKSPACE:link});assert.notEqual(child.status,0);assert.match(child.stderr,/Test workspace must be separate/);assert.equal(child.stdout,'');}finally{fs.unlinkSync(link);}
});
it('rejects a private-workspace junction that resolves outside disposable storage',()=>{
 const link=path.join(directory,'business-link');fs.symlinkSync(path.resolve('data'),link,process.platform==='win32'?'junction':'dir');try{const child=probe({...process.env,REPAID_DATA_DIR:link});assert.notEqual(child.status,0);assert.match(child.stderr,/Test data must stay inside/);assert.equal(child.stdout,'');}finally{fs.unlinkSync(link);}
});
it('blocks a late business-directory override before getDb opens or migrates it',()=>{
 const environment:NodeJS.ProcessEnv={...process.env};delete environment.REPAID_DATA_DIR;delete environment.REPAID_TEST_DEFAULT_DATA_DIR;
 const child=probe(environment,"process.env.REPAID_DATA_DIR='data';const {getDb}=await import('./src/lib/db/schema.ts');let blocked=false;try{getDb();}catch(error){blocked=/Test database directory/.test(error.message);}process.stdout.write(JSON.stringify({blocked}));");assert.equal(child.status,0,child.stderr);assert.deepEqual(JSON.parse(child.stdout),{blocked:true});
});
it('allows an explicitly isolated new nested directory without weakening the boundary',()=>{
 const target=path.join(directory,'new','nested'),environment:NodeJS.ProcessEnv={...process.env};delete environment.REPAID_DATA_DIR;delete environment.REPAID_TEST_DEFAULT_DATA_DIR;
 const script=`process.env.REPAID_DATA_DIR=${JSON.stringify(target)};const {getDb}=await import('./src/lib/db/schema.ts');const db=getDb();try{process.stdout.write(JSON.stringify({customers:Number(db.prepare('SELECT COUNT(*) n FROM customers').get().n)}));}finally{db.close();}`;
 const child=probe(environment,script);assert.equal(child.status,0,child.stderr);assert.deepEqual(JSON.parse(child.stdout),{customers:0});assert.equal(fs.existsSync(path.join(target,'repaid.db')),true);
});
