export const BACKUP_DOWNLOAD_DDL=`
CREATE TABLE IF NOT EXISTS backup_downloads(
 id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),backup_id INTEGER NOT NULL REFERENCES backups(id),
 snapshot_path TEXT NOT NULL,bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,expires_at INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','streaming','streamed','interrupted','failed','expired')),
 created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_backup_download_actor ON backup_downloads(user_id,state,expires_at);
CREATE TABLE IF NOT EXISTS backup_preparations(
 id TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),pid INTEGER NOT NULL,instance_id TEXT NOT NULL,runtime_scope TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('preparing','released','failed','abandoned')),created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backup_preparation_state ON backup_preparations(state);
`;
