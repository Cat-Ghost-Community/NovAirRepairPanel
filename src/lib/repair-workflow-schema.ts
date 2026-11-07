export const REPAIR_WORKFLOW_DDL = `
CREATE TABLE IF NOT EXISTS branch_repair_workflows (
 branch_id INTEGER PRIMARY KEY REFERENCES branches(id),
 mode TEXT NOT NULL CHECK(mode IN ('legacy','managed','shared')),
 revision INTEGER NOT NULL CHECK(revision>0),
 updated_by INTEGER NOT NULL REFERENCES users(id),updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE IF NOT EXISTS repair_workflow_supervisors (
 branch_id INTEGER NOT NULL REFERENCES branches(id),user_id INTEGER NOT NULL REFERENCES users(id),
 granted_by INTEGER NOT NULL REFERENCES users(id),granted_at TEXT NOT NULL DEFAULT(datetime('now')),
 PRIMARY KEY(branch_id,user_id)
);
CREATE TRIGGER IF NOT EXISTS revoke_repair_supervisor_employment AFTER UPDATE OF branch_id,is_active,role ON users
WHEN NEW.branch_id IS NOT OLD.branch_id OR NEW.is_active!=1 OR NEW.role IS NOT OLD.role
BEGIN DELETE FROM repair_workflow_supervisors WHERE user_id=NEW.id; END;`;
