import {describe,it,after} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fork} from 'node:child_process';import {once} from 'node:events';import {DatabaseSync} from 'node:sqlite';
import {atomic} from '../src/lib/db/transaction';import {databaseTransactionMetrics} from '../src/lib/db/metrics';import {databaseContention} from '../src/lib/db/contention';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-contention-'));process.env.REPAID_DATA_DIR=directory;
after(()=>fs.rmSync(directory,{recursive:true,force:true}));
describe('real independent-process write contention and safe API failure',()=>{
 it('never calls financial work when BEGIN is blocked, reports 503 and permits an explicit safe request retry',async()=>{
  const filename=path.join(directory,'contention.db'),db=new DatabaseSync(filename);db.exec('PRAGMA journal_mode=WAL;PRAGMA busy_timeout=25;CREATE TABLE balances(id INTEGER PRIMARY KEY,amount INTEGER NOT NULL);INSERT INTO balances VALUES(1,100)');const worker=fork(path.resolve('tests/database-contention-worker.ts'),[filename],{execArgv:['--import','tsx'],stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});
  try{await once(worker,'message',{signal:AbortSignal.timeout(5000)});let called=false;const before=databaseTransactionMetrics();let failure:unknown;
   try{atomic(db,()=>{called=true;db.prepare('UPDATE balances SET amount=amount-20 WHERE id=1').run();});}catch(error){failure=error;}
   assert.equal(called,false);assert.equal(databaseContention(failure),true);assert.equal(db.isTransaction,false);assert.equal(db.prepare('SELECT amount FROM balances').get()?.amount,100);assert.equal(databaseTransactionMetrics().contentionFailures,before.contentionFailures+1);
   const {fail}=await import('../src/lib/api'),response=fail(failure);assert.equal(response.status,503);assert.equal(response.headers.get('retry-after'),'1');assert.equal((await response.json()).code,'DATABASE_BUSY');
   const ended=once(worker,'exit');worker.send('release');await ended;atomic(db,()=>db.prepare('UPDATE balances SET amount=amount-20 WHERE id=1').run());assert.equal(db.prepare('SELECT amount FROM balances').get()?.amount,87);
  }finally{if(worker.exitCode==null&&worker.signalCode==null){const ended=once(worker,'exit');worker.kill();await ended;}db.close();}
 });
 it('does not classify constraints, domain validation or shared-cache misuse as automatic retry candidates',()=>{assert.equal(databaseContention({code:'ERR_SQLITE_ERROR',errcode:517}),true);assert.equal(databaseContention({code:'ERR_SQLITE_ERROR',errcode:1555}),false);assert.equal(databaseContention({code:'ERR_SQLITE_ERROR',errcode:6}),false);assert.equal(databaseContention({code:'40001'}),true);assert.equal(databaseContention({code:'23514'}),false);assert.equal(databaseContention(new Error('database is locked')),false);});
});
