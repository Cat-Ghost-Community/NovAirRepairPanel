import type {DatabaseSync} from 'node:sqlite';

/** Additive evidence archive. Existing reports are archived only when an
 * authorized author saves a correction, never rewritten during migration. */
export const DAILY_REPORT_EVIDENCE_DDL=`
CREATE TABLE IF NOT EXISTS daily_report_versions (
 id INTEGER PRIMARY KEY, report_id INTEGER NOT NULL REFERENCES daily_reports(id),
 revision INTEGER NOT NULL, snapshot_json TEXT NOT NULL, actor_id INTEGER NOT NULL REFERENCES users(id),
 reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(report_id,revision)
);
CREATE TRIGGER IF NOT EXISTS daily_report_version_no_update BEFORE UPDATE ON daily_report_versions BEGIN SELECT RAISE(ABORT,'Report evidence is immutable'); END;
CREATE TRIGGER IF NOT EXISTS daily_report_version_no_delete BEFORE DELETE ON daily_report_versions BEGIN SELECT RAISE(ABORT,'Report evidence cannot be deleted'); END;
`;

export function archiveDailyReport(db:DatabaseSync,row:Record<string,unknown>,actor:number,reason:string){
 db.prepare('INSERT INTO daily_report_versions(report_id,revision,snapshot_json,actor_id,reason) VALUES(?,?,?,?,?) ON CONFLICT(report_id,revision) DO NOTHING')
 .run(Number(row.id),Number(row.revision??0),JSON.stringify(row),actor,reason);
}
