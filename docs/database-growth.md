> **Current recovery checkpoint - 2026-11-05:** Read [DATABASE_RECOVERY_COMPLETION.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/DATABASE_RECOVERY_COMPLETION.md) and the recovery-set runbook. Complete encrypted DB/object sets, verified second copies, controlled offline restore, authenticated freshness checks and stronger test isolation are implemented. 400 regression tests, native PG40 and compiled browser34 checks pass. All109 pre-existing table projections/ID sequences/private case evidence remain unchanged; an unintended startup applied the existing additive group-receipt migration, independently reviewed (current110 tables). Full PostgreSQL application port and actual target-host acceptance remain incomplete. **NOT READY FOR PRODUCTION.** Earlier entries below are historical.

---

> **Current database delivery ? 2026-11-05:** Read [DATABASE_RELEASE_STATUS.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/DATABASE_RELEASE_STATUS.md). Supported runtime: one web process, durable local SQLite. Startup rejects serverless/clustered deployments. Regression: 384/384 tests; original 109 table projections unchanged. Complete PostgreSQL application port remains unfinished and disabled. Target recovery/deployment and documented business-financial gates remain unverified. **NOT READY FOR PRODUCTION.** Earlier entries below are historical.

---

> **Current database checkpoint - 2026-11-05:** Read [DATABASE_FINALIZATION_STATUS.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/DATABASE_FINALIZATION_STATUS.md). Implemented bounded writer admission, automatic-rollback recovery, verified WAL/FULL/FKs, streamed historical ledger verification, independently verified backup copies and Windows-private backup/restore permissions. 379/379 Windows tests, native PG40/40, typecheck and root/isolated builds pass; financial browsers56+41, UI27, pages36/36, HTTP128/128. Original109 projections and complete original schema unchanged; local data/cache ACLs deliberately tightened. Three-minute 200-user/four-process case still has one BUSY failure; full PostgreSQL operational port and target recovery/deployment remain incomplete. **Database task remains open; NOT READY FOR PRODUCTION.** Earlier entries below are historical.

---

> **Current checkpoint — 2026-10-30:** Read [DATABASE_BANKING_STATUS.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/DATABASE_BANKING_STATUS.md). Adds native PostgreSQL bank register guards/services and preserved source snapshots, exact text-to-rial input across existing financial forms, blocked independent bank-transfer recognition, transactional scoped serial registration/proven sale linking and explicit protection against ignored bulk deposits. Live SQLite and original customer records remain unchanged. Latest full pipeline: 350/350 tests /64 suites, typecheck/build pass; PostgreSQL 39/39. Complete PostgreSQL operational/HTTP port, paired bank recognition, group deposits, serialized lifecycle, earlier financial/policy/historical and target-operation gates remain unfinished. **NOT READY FOR PRODUCTION.** Earlier entries below are historical.

---
# Current implementation note — 2026-10-30

See [DATABASE_COMPLETION_STATUS.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/DATABASE_COMPLETION_STATUS.md). Eleven growth indexes; scoped settlement aggregates remove unrelated-history materialization while preserving exact obligations. Local10,000-invoice detail p95:52.2529ms to0.0131ms. This is not capacity acceptance: three-minute four-writer SQLite workloads still fail with BUSY. PostgreSQL durable operation uniqueness, immutable results, current authorization and real journal/audit/proof transaction integration now have tested native guards in the existing packaged port tool. Full operational/HTTP port, target workload/recovery and live cutover are still incomplete. No automatic historical backfill or guessed policy.

---

# Database growth, recovery and PostgreSQL preparation

Read [current status](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/DATABASE_INFRASTRUCTURE_STATUS.md) first. Application runtime remains SQLite. Do not set a PostgreSQL connection string and assume the business application has migrated.

## Current production-safe boundaries

Use Node 24, persistent local storage and the existing WAL/FULL/foreign-key controls. Do not put the SQLite database on NFS, a shared network folder or ephemeral serverless storage. Do not start multiple independent SQLite deployments against divergent copies of the business database.

Deploy new indexes and additive attachment/download fields only after a consistent backup and restored-copy rehearsal. Index creation can take longer on real large tables than in the local profile; quiesce writers for startup migrations. Do not run `VACUUM`, purge immutable journals/idempotency identities or delete historical records as routine optimization.

`GET /api/system/database` requires an owner/admin session with settings permission. It reports storage, disk availability, WAL size and bounded current-process transaction latency/outcomes; it exposes no paths or credentials. It is a monitoring input, not a certified integrity/recovery report. Wire it to authenticated monitoring and set disk/latency/backup-age thresholds on the actual host.

## Private attachment storage

Default remains `REPAID_ATTACHMENT_STORAGE=database`, preserving existing behavior. To enable `filesystem`, first create a private persistent directory outside `public`, set `REPAID_OBJECT_DIR`, verify off-host object retention and rehearse recovery of both database and objects. New bytes use immutable content-addressed files; original names remain only in the authorized database record. Downloads retain original repair/branch/chat membership checks and verify checksum before streaming.

Existing BLOBs are not removed, reinterpreted or silently migrated. Financial signature fields remain unchanged. Reverting code after new filesystem uploads must preserve the object-aware readers; older BLOB-only code cannot read empty in-DB payloads.

Objects may outlive current database references because older backups still reference them. Do not run blind filesystem garbage collection. A failed upload transaction may leave an unreferenced immutable object; retain it until a reviewed, backup-aware cleanup procedure exists.

## Encrypted backups and restore

Use a separate privately generated 64-hex-character `REPAID_BACKUP_KEY`. Store recoverable copies outside the server, separately from archives. Never commit keys or put them in URLs. Protect backup directories with POSIX mode 0700/file mode 0600 or equivalent Windows ACLs. The scheduled service uses `UMask=0077`.

Complete recovery also requires the **original application encryption key**, independently of the backup archive key. Production credentials use `REPAID_ENCRYPTION_KEY`; development may have an original `repaid.db.key` alongside the database (`src/lib/secrets.ts`). Preserve its exact existing bytes in separate restricted key custody. The database archive deliberately does not embed these keys. Generating a replacement key cannot decrypt existing device credentials. Preserve configuration and every referenced private object as well. Before reopening a restored deployment, use a reviewed maintenance procedure to invalidate restored login sessions and verify authorization; never test recovery by replacing the active database or altering disputed financial records.

Set `REPAID_BACKUP_OUTPUT` to a **new** private filename, then run `npm run backup:encrypted`. Publication requires SQLite/FK checks, plaintext hash, authenticated encryption and a separate decrypt/hash verification of the actual archive. Current archive format rejects snapshots above approximately 64 GiB; it does not silently disable authentication. PostgreSQL's eventual backup strategy must use independently validated provider/standard tooling and PITR.

Set `REPAID_BACKUP_INPUT` to that archive and `REPAID_RESTORE_OUTPUT` to a **new** filename in a private directory; run `npm run backup:restore`. Wrong keys, tampering, truncated archives, existing destinations and missing referenced external objects are rejected. Nothing replaces the active database automatically.

The website's manual export is an unencrypted administrator download, now streamed directly to the browser through an owner-bound expiring handoff. “Prepared” or “streamed” is not proof of off-host retention or completed disaster recovery. The UI warns that external objects are separate.

For scheduled local archives, create `REPAID_BACKUP_DIR` and run `npm run backup:scheduled`. Keep the default 5 GiB disk reserve unless a reviewed capacity plan says otherwise. The command also checks space for a source-sized working copy; large backups need disk space in the OS temporary directory. It writes `latest-backup.json` with `offhost_verified:false`. No automatic archive deletion occurs.

Linux source deployments can install `deploy/repaid-backup.service` and `.timer` after successful manual backup/restore rehearsals. Store the key in `/etc/repaid/backup.env` with restricted permissions. The hourly timer is a proposal, not an agreed recovery objective or an enabled deployment.

Docker images now contain bundled tools under `database-tools/`; no TypeScript runtime is needed. After building, `docker compose --profile backup run --rm backup` runs the scheduled command against the existing local data volume, separate archive volume and disk-backed working volume. It requires `REPAID_BACKUP_KEY`. The optional backup profile does not enable itself or upload to another host. Never use `docker compose down -v` as an upgrade/rollback operation.

Off-host transfer, remote verification, encryption-at-rest for external objects, key custody and periodic independent restore drills still require actual infrastructure. This repository does not claim those are configured merely because local archives pass.

## Isolated PostgreSQL verification

Use an existing private `REPAID_BACKUP_WORK_DIR` on a disk with room for the snapshot and reserve; the web process and scheduler must both have access. Docker Compose now mounts a private disk-backed workspace into both services; Linux units use `/var/lib/repaid/backup-work` (created by the installer). Snapshot and archive budgets are checked separately **after** snapshot allocation so the same free bytes cannot fund both copies. The system temp drive being too full is a real 507 failure, not a reason to disable the reserve. Private object ingest has its own `REPAID_OBJECT_MIN_FREE_BYTES` reserve.

After an exact restore, follow [recovery-activation.md](recovery-activation.md). The new copy-only activation tool invalidates restored authentication/operational artifacts and verifies all other business projections; it does not replace production or certify unavailable key custody.

Local `npm test` preloads `scripts/test-environment.cjs` to place synthetic temporary databases, archive outputs and workspaces on the private project test disk. It does not reduce production storage reserves or bypass integrity verification. Actual customer-data rehearsals use separate restricted private directories.

The continuation adds `db:port-postgres-ledger`: a native port of core journal checks, immutable evidence, exact reversal/chain rules, serialized posting and period overlap guards in an **identified rehearsal schema**. Set `REPAID_PG_REHEARSAL_URL`, `REPAID_PG_SOURCE_REPORT` to the retained import manifest, and `REPAID_PG_LEDGER_REPORT` to a new private filename. The command independently verifies source data and existing ledger evidence before/after installing native guards; it does not guess corrections. Remote execution additionally requires explicit rehearsal authorization. The asynchronous trial-balance service resolves current sessions, roles, personal denies and branch employment from PostgreSQL itself and is parity-tested against SQLite. No live website routes use that incomplete target engine yet. Full operational services and the rest of the business rules remain to be ported.

Legacy BLOB extraction now has a real, resumable copy-only implementation: follow [attachment-migration.md](attachment-migration.md). This replaces the earlier absence of migration tooling; the production swap remains intentionally unexecuted.

`deploy/postgres-rehearsal.yml` provides a separate PostgreSQL 18.4 test service bound to loopback port 55432, SCRAM authentication and persistent version-correct PostgreSQL 18 volume placement. Supply a private rehearsal-only password. This Compose definition has not been run locally because the Docker engine was stopped; local integration used PostgreSQL 18.4 Windows binaries instead.

Set `REPAID_PG_TEST_ADMIN_URL` to a dedicated test service, then `npm run test:postgres`. The runner creates a random `repaid_test_…` database, runs real tests, closes clients and drops **only that newly created database**. Remote tests require explicit opt-in and verified TLS/CA configuration. Never point it at a production application database.

The asynchronous PostgreSQL layer bounds pool/lock/statement/idle-transaction timeouts, pins nested work to one connection and refuses manual transaction escape. TLS verification cannot be disabled for remote hosts. Connection URLs cannot override SSL/options. BIGINT/NUMERIC remain exact strings unless an explicit safe integer conversion is valid. Financial operations are never blindly retried after uncertain outcomes.

## Business-data rehearsal and independent verification

1. Select a protected source using `REPAID_SQLITE_SOURCE` and a new private `REPAID_SQLITE_SNAPSHOT`; run `npm run db:snapshot`. This uses SQLite's online backup and does not initialize/change source schemas. Never copy only the live main file while committed records may be in WAL.
2. Set `REPAID_PG_REHEARSAL_URL` to an isolated authorized destination and `REPAID_PG_REHEARSAL_REPORT` to a new private report filename. Run `npm run db:rehearse-postgres`.
3. Run `npm run db:verify-postgres` separately against the retained external report. Protect that report outside the database operator's sole custody for an independent cutover review.

Each import creates a unique `repaid_snapshot_…` schema, preserves original IDs, exact text/JSON whitespace/order and binary bytes, checks hashes/counts/FKs and records original SQLite schema evidence. Import failures roll back the new schema. Batches are capped by row count, parameter count and approximately 4 MiB, with a 64 MiB maximum individual row; oversized or incompatible sources block with evidence instead of truncation. Fractional values in integer-affinity columns are explicitly reported. NUL/invalid UTF-8 text, unsafe integer-to-float conversion and identifiers beyond PostgreSQL's 63-byte limit are rejected rather than rewritten.

These tables are **not application-ready**: original business triggers, CHECK rules, unique expressions, views, default behavior and synchronous callers are not automatically certified or translated. Do not grant the application's production role access or route business traffic to a rehearsal schema. No second authoritative ledger is introduced.

Actual cutover requires a fully ported application, equivalent constraints, repeated business/authorization/concurrency/browser tests, reconciled inventory and financial statements, tested target backups/PITR, least-privilege runtime roles, operator-approved write freeze and recovery plan. A database engine change does not resolve existing disputed financial history.
