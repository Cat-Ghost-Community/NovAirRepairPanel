import type { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { randomInt } from 'node:crypto';

const sleeper = new Int32Array(new SharedArrayBuffer(4));

/** Retry only acquisition of a writer, before any caller work has executed.
 * Keep the connection's existing timeout as the total admission budget. Short
 * probes and jitter let competing processes make progress instead of repeatedly
 * monopolizing SQLite's native busy handler. Never replay statements or COMMIT.
 */
export function beginSqliteWrite(db: DatabaseSync): void {
  if (db.isTransaction) throw new Error('Writer admission requires an idle connection');
  const timeout = Number(db.prepare('PRAGMA busy_timeout').get()!.timeout);
  if (!Number.isSafeInteger(timeout) || timeout < 0) throw new Error('Invalid SQLite busy timeout');
  const deadline = performance.now() + timeout;
  let changed = false;
  try {
    for (;;) {
      const remaining = Math.max(0, Math.floor(deadline - performance.now()));
      db.exec(`PRAGMA busy_timeout=${Math.min(remaining, 25)}`);
      changed = true;
      try { db.exec('BEGIN IMMEDIATE'); return; }
      catch (error) {
        // Only a failed BEGIN with no transaction is safe to retry. Do not
        // classify SQLITE_LOCKED or arbitrary message text as contention.
        const native = error as {code?: string; errcode?: number};
        if (db.isTransaction || native.code !== 'ERR_SQLITE_ERROR' || native.errcode !== 5 || performance.now() >= deadline) throw error;
        Atomics.wait(sleeper, 0, 0, Math.min(randomInt(2, 15), Math.max(0, deadline - performance.now())));
      }
    }
  } finally {
    if (changed) {
      try { db.exec(`PRAGMA busy_timeout=${timeout}`); }
      catch (error) {
        // Never leave an acquired transaction open if connection setup failed.
        try { if (db.isTransaction) db.exec('ROLLBACK'); } finally { db.close(); }
        throw error;
      }
    }
  }
}

/** SQLite may already have rolled a transaction back (FULL/IOERR/RAISE(ROLLBACK)).
 * Do not mask that original error with "no transaction is active". A failed
 * cleanup closes the connection so later requests cannot commit unknown work.
 */
export function rollbackSqlite(db: DatabaseSync, original: unknown, savepoint?: string): never {
  try {
    if (db.isTransaction) {
      if (savepoint) {
        db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      } else db.exec('ROLLBACK');
    }
  } catch (cleanup) {
    try { db.close(); } catch { /* Already unusable: retain both original causes. */ }
    throw new AggregateError([original, cleanup], 'SQLite rollback failed; connection closed', {cause: original});
  }
  throw original;
}
