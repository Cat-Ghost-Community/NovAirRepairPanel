# Offline legacy attachment migration

This implemented tool migrates a **separate SQLite copy** into private immutable objects. It does not replace the active database, change financial documents, approve historical corrections or upload customer files to another host.

## Preparation

1. Create a consistent standalone snapshot with `npm run db:snapshot`; retain the original snapshot, its independent hash and original application encryption key privately. Never copy an active SQLite main file without its committed WAL.
2. Create a private persistent object directory outside `public`. Protect it with owner-only filesystem permissions/Windows ACLs. Arrange recovery and retention of both database archives and referenced objects before enabling it for production.
3. Choose a **new private destination** and **new private evidence-report filename**, both separate from the original source and active database. Set:

```text
REPAID_ATTACHMENT_STORAGE=filesystem
REPAID_OBJECT_DIR=<private object directory>
REPAID_ATTACHMENT_MIGRATION_SOURCE=<standalone snapshot>
REPAID_ATTACHMENT_MIGRATION_OUTPUT=<new isolated copy.db>
REPAID_ATTACHMENT_MIGRATION_REPORT=<new evidence.json>
```

Run `npm run db:migrate-attachments`. Packaged Node 24 deployments can run `node database-tools/migrate-attachments.cjs` with the same environment. No credentials or customer filenames appear in successful output.

## Actual invariants

- Source is opened immutable/read-only; its SHA-256 must remain identical.
- Existing business schema, triggers, indexes and views are preserved. Source business projections are independently hashed; only declared attachment `data`, `object_key`, `object_sha256` changes are excluded and separately verified.
- BLOBs are read in 256 KiB pieces; original content is independently hashed again. Objects are atomically published and checked before a short database transaction replaces the copy's BLOB with an immutable reference.
- The original snapshot always retains the original BLOB. Set `REPAID_ATTACHMENT_RETAIN_BLOBS=1` if the destination should also retain those bytes. Options cannot silently change during resume.
- Size mismatch, missing objects, altered source/copy/evidence, corrupt retained BLOBs and unsupported schemas fail closed. Financial totals are never adjusted to make a migration pass.
- Private copy tables `_repaid_attachment_migration` and `_repaid_attachment_migration_rows` retain source identity, exact attachment hash, original size and state. A separate exclusive lock prevents concurrent migration of the same destination. Objects may safely remain after a failed row; no automatic garbage deletion occurs.
- Final verification includes SQLite integrity, foreign keys, original schema/business evidence and every required object. Output explicitly says `production_swapped:false`.

## Interruption and resume

Retain the source, target and evidence. Fix the **identified** cause; do not erase evidence or force success. Set `REPAID_ATTACHMENT_MIGRATION_RESUME=1`, keep the same source/destination/options and use a **new** evidence-report filename. Rerun the command. Already migrated rows are reverified, not applied twice.

An OS/process crash can leave `<destination>.attachment-migration.lock`. There is deliberately no automatic stale-lock bypass. Confirm the recorded process is no longer running and no migration accesses that destination; archive the lock as incident evidence before an operator removes it. Never remove another running migration's lock.

A migrated SQLite file can retain free pages after BLOB extraction. This command does not compact the live database. Any later compaction must operate on a separately verified copy, preserve all references and be included in the deployment/restore rehearsal.

## Deployment and rollback boundary

The local source-copy rehearsal passed; it does **not** authorize a production swap. Actual replacement needs an approved maintenance window, verified database/object recovery, stopped writers, full attachment/authorization/browser regression on the copy and operator approval. Preserve the original database/object/key set. Do not resume an old writable database after new writes without an explicit reconciliation plan. Existing disputed financial cases remain unchanged.
