import type {DatabaseSync} from 'node:sqlite';

/** Check actual connection settings; successful PRAGMA execution alone does not
 * prove the filesystem accepted WAL. Never silently weaken durability. */
export function sqliteConnectionState(db:DatabaseSync){
 return {
  journalMode:String(db.prepare('PRAGMA journal_mode').get()!.journal_mode),
  foreignKeys:Number(db.prepare('PRAGMA foreign_keys').get()!.foreign_keys),
  synchronous:Number(db.prepare('PRAGMA synchronous').get()!.synchronous),
  busyTimeoutMs:Number(db.prepare('PRAGMA busy_timeout').get()!.timeout),
 };
}
export function configurePersistentSqlite(db:DatabaseSync){
 if(db.isTransaction)throw new Error('SQLite configuration requires an idle connection');
 db.exec('PRAGMA busy_timeout=5000;PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;PRAGMA synchronous=FULL');
 const state=sqliteConnectionState(db);
 if(state.journalMode!=='wal'||state.foreignKeys!==1||state.synchronous!==2||state.busyTimeoutMs!==5000)throw new Error('Persistent SQLite requires verified WAL, FULL durability and foreign-key enforcement');
 return state;
}
