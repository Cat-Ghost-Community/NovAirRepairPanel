import {describe,it,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {fork} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {atomic,readSnapshot} from '../src/lib/db/transaction';
import {beginSqliteWrite} from '../src/lib/db/sqlite-admission';
import {configurePersistentSqlite,sqliteConnectionState} from '../src/lib/db/sqlite-config';

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-admission-'));
after(()=>{const resolved=fs.realpathSync(directory);assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('repaid-admission-'));fs.rmSync(resolved,{recursive:true,force:true});});
describe('bounded writer admission and real SQLite automatic rollback',()=>{
 it('verifies actual persistent WAL/FULL/foreign-key configuration and rejects an in-memory durability fallback',()=>{
  const db=new DatabaseSync(path.join(directory,'configured.db'));try{
   assert.deepEqual(configurePersistentSqlite(db),{journalMode:'wal',foreignKeys:1,synchronous:2,busyTimeoutMs:5000});
   atomic(db,()=>assert.deepEqual(sqliteConnectionState(db),{journalMode:'wal',foreignKeys:1,synchronous:2,busyTimeoutMs:5000}));
  }finally{db.close();}
  const memory=new DatabaseSync(':memory:');try{assert.throws(()=>configurePersistentSqlite(memory),/verified WAL/);}finally{memory.close();}
 });
 it('waits only before the callback, restores timeout and commits exactly once after another process releases the writer',async()=>{
  const file=path.join(directory,'writer.db'),db=new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL;PRAGMA busy_timeout=1000;CREATE TABLE balances(id INTEGER PRIMARY KEY,amount INTEGER);INSERT INTO balances VALUES(1,100)');
  const worker=fork(path.resolve('tests/sqlite-admission-worker.ts'),[file],{execArgv:['--import','tsx'],stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});
  const ended=once(worker,'exit');
  try{
   await once(worker,'message',{signal:AbortSignal.timeout(5000)});
   let calls=0;atomic(db,()=>{calls++;db.prepare('UPDATE balances SET amount=amount-20 WHERE id=1').run();});
   assert.equal(calls,1);assert.equal(db.prepare('SELECT amount FROM balances').get()!.amount,87);
   assert.equal(db.prepare('PRAGMA busy_timeout').get()!.timeout,1000);assert.equal(db.isTransaction,false);
   assert.equal((await ended)[0],0);
  }finally{if(worker.exitCode==null&&worker.signalCode==null){worker.kill();await ended;}db.close();}
 });
 it('never replays the financial callback when a trigger automatically rolls the entire transaction back',()=>{
  const db=new DatabaseSync(':memory:');try{
   db.exec("CREATE TABLE balances(amount INTEGER);INSERT INTO balances VALUES(100);CREATE TRIGGER reject BEFORE UPDATE ON balances BEGIN SELECT RAISE(ROLLBACK,'original automatic rollback');END");
   let calls=0;assert.throws(()=>atomic(db,()=>{calls++;db.prepare('UPDATE balances SET amount=80').run();}),/original automatic rollback/);
   assert.equal(calls,1);assert.equal(db.isTransaction,false);assert.equal(db.prepare('SELECT amount FROM balances').get()!.amount,100);
  }finally{db.close();}
 });
 it('retains the original error when a nested trigger cancels all parent savepoints',()=>{
  const db=new DatabaseSync(':memory:');try{
   db.exec("CREATE TABLE balances(amount INTEGER);INSERT INTO balances VALUES(100);CREATE TRIGGER reject BEFORE UPDATE ON balances BEGIN SELECT RAISE(ROLLBACK,'nested automatic rollback');END");
   assert.throws(()=>atomic(db,()=>{db.prepare('INSERT INTO balances VALUES(50)').run();atomic(db,()=>db.prepare('UPDATE balances SET amount=80').run());}),/nested automatic rollback/);
   assert.equal(db.prepare('SELECT COUNT(*) n FROM balances').get()!.n,1);assert.equal(db.isTransaction,false);
  }finally{db.close();}
 });
 it('rolls failed deferred-constraint COMMIT back and does not retry business work',()=>{
  const db=new DatabaseSync(':memory:');try{
   db.exec('PRAGMA foreign_keys=ON;CREATE TABLE parents(id INTEGER PRIMARY KEY);CREATE TABLE children(parent INTEGER REFERENCES parents(id) DEFERRABLE INITIALLY DEFERRED)');
   let calls=0;assert.throws(()=>atomic(db,()=>{calls++;db.exec('INSERT INTO children VALUES(9)');}),/FOREIGN KEY/);
   assert.equal(calls,1);assert.equal(db.isTransaction,false);assert.equal(db.prepare('SELECT COUNT(*) n FROM children').get()!.n,0);
  }finally{db.close();}
 });
 it('preserves read-snapshot errors after SQLite has already rolled the snapshot back',()=>{
  const db=new DatabaseSync(':memory:');try{
   assert.throws(()=>readSnapshot(db,()=>{db.exec('ROLLBACK');throw Error('original snapshot failure');}),/original snapshot failure/);
   assert.equal(db.isTransaction,false);
  }finally{db.close();}
 });
 it('does not start another writer inside an existing transaction or alter zero-timeout semantics',()=>{
  const db=new DatabaseSync(':memory:');try{
   db.exec('PRAGMA busy_timeout=0');beginSqliteWrite(db);assert.equal(db.prepare('PRAGMA busy_timeout').get()!.timeout,0);
   assert.throws(()=>beginSqliteWrite(db),/idle connection/);db.exec('ROLLBACK');
  }finally{db.close();}
 });
 it('fails closed if cleanup cannot use the connection while retaining the original failure',()=>{
  const db=new DatabaseSync(':memory:');let failure:unknown;
  try{atomic(db,()=>{db.close();throw Error('original closed connection failure');});}catch(error){failure=error;}
  assert.ok(failure instanceof AggregateError);assert.equal((failure.cause as Error).message,'original closed connection failure');assert.equal(db.isOpen,false);
 });
});
