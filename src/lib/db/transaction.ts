import type { DatabaseSync } from "node:sqlite";
import {performance} from 'node:perf_hooks';import {recordWriteTransaction} from '@/lib/db/metrics';
import {databaseContention} from './contention';
import {beginSqliteWrite,rollbackSqlite} from './sqlite-admission';

let sequence = 0;

/** Consistent WAL read snapshot; unlike atomic(), does not reserve the writer.
 * Keep all work synchronous and bound the report size. */
export function readSnapshot<T>(db: DatabaseSync, work: () => T): T {
  if (db.isTransaction) return work();
  db.exec("BEGIN DEFERRED");
  try {
    const result = work();
    if (result && typeof (result as { then?: unknown }).then === "function") throw new Error("Async work cannot run inside a synchronous SQLite snapshot");
    db.exec("COMMIT");
    return result;
  } catch (error) { return rollbackSqlite(db,error); }
}

/** Synchronous, nestable unit of work. Never await while holding a SQLite write lock. */
export function atomic<T>(db: DatabaseSync, work: () => T): T {
  const nested = db.isTransaction;
  const savepoint = `repaid_${++sequence}`;
  const started=performance.now();let success=false,contended=false;
  try{
  if(nested)db.exec(`SAVEPOINT ${savepoint}`);else beginSqliteWrite(db);
  try {
    const result = work();
    if (result && typeof (result as { then?: unknown }).then === "function") throw new Error("Async work cannot run inside a synchronous SQLite transaction");
    db.exec(nested ? `RELEASE SAVEPOINT ${savepoint}` : "COMMIT");
    success=true;
    return result;
  } catch (error) {
    return rollbackSqlite(db,error,nested?savepoint:undefined);
  }
  }catch(error){contended=databaseContention(error);throw error;}
  finally{if(!nested)recordWriteTransaction(performance.now()-started,success,contended);}
}
