# Complete database and attachment recovery

Scheduled backups now produce **self-contained `.rpset` directories**. They contain the exact online SQLite snapshot and every private filesystem object that snapshot references. Legacy BLOB attachments remain inside SQLite. Duplicate repair/chat references share one archived object. Unreferenced uploads are not copied or deleted.

The settings download still explicitly provides a database snapshot. It is not a substitute for this complete operational recovery process when filesystem attachments are enabled. No existing UI, financial policy or historical document is changed.

## Format and safety

Each set contains `database.rpbak`, content-addressed encrypted files under `objects/`, a streamed `manifest.jsonl`, and `COMPLETE.json`. Payloads use the existing AES-256-GCM archive implementation with authenticated type/size/hash metadata. Attachment archives are distinguished from database archives and cannot be restored as databases. Existing RPDBAK01 database archives remain supported by the original restore command.

Cryptographic operations use the built-in [Node.js crypto APIs](https://nodejs.org/docs/latest-v24.x/api/crypto.html), not a new dependency or custom cipher.

The manifest contains object hashes, sizes and archive checksums, not attachment contents or customer filenames. It is authenticated by a domain-separated HMAC-SHA-256 with a dedicated HKDF-derived authentication key, separate from the payload encryption key. Completion is published only after independent decryption, database integrity/foreign-key checks, exact snapshot-reference comparison and object verification. Streaming bounds memory; database object references are enumerated from the saved snapshot, not a changing live table. Manifest line lengths, identities, file types and paths are validated. Symlinks, extra files, conflicting references, incomplete sets, wrong keys and corrupt bytes fail closed.

Every new plaintext file is restricted before its first sensitive byte, including Windows ACLs. Outputs must be new and outside `public`. A failed operation cleans only its own newly created, identity-checked output directory. Source archives and existing destinations are preserved. A crash can leave an incomplete directory without a valid completion record; verification refuses it. Do not delete retained sets merely because another job failed.

Each individual encrypted file retains the existing GCM archive size limit (approximately 64 GiB); oversize input is rejected, never truncated. A set can contain many such files. Large legacy databases may require the existing reviewed, offline attachment extraction procedure; this format is not a claim of unlimited database size. Filesystem attachment migration must retain source evidence and receive its separate deployment approval.

File flushes and POSIX directory synchronization are performed. On Windows, Node may not support directory synchronization; results report `directory_synced:false`. No power-loss or storage-device guarantee is inferred from a local test.

## Configuration

Run tools from the application installation directory using Node24. Provision private directories owned by the application service user:

- `REPAID_BACKUP_DIR`: local retained complete sets.
- `REPAID_BACKUP_WORK_DIR`: private workspace with room for the online snapshot and independent verification.
- `REPAID_BACKUP_KEY`: separate privately generated 32-byte hexadecimal key. Keep a recoverable copy independently of the server and backups. Never put it in shell arguments, Git, logs or the backup directory.
- `REPAID_OBJECT_DIR`: source private objects if filesystem attachment storage is enabled.
- `REPAID_BACKUP_COPY_DIR`: optional separately mounted destination supporting ordinary files, hard links, rename and flush operations. Set creation is followed by a byte-preserving, independently decrypted verification of the second copy.
- `REPAID_BACKUP_MAX_AGE_SECONDS`: default `7200`, matching the supplied hourly backup timer with margin. Select the organization's actual recovery-point objective; the check accepts 60 seconds through 31 days.

The source SQLite database requires durable **local** storage. A separately mounted network destination may hold encrypted backup sets if its real filesystem semantics and recovery are tested. Do not put SQLite itself on that network filesystem.

The tool always reports `physical_offhost_verified:false`: a second pathname alone cannot prove another machine, separate failure domain, retention or key custody. Those require actual target-host/operator evidence. It does not silently upload to an unknown provider or invent credentials.

## Commands

Supply secrets through the private environment file or process environment, not command arguments. `REPAID_BACKUP_OUTPUT` and `REPAID_RESTORE_OUTPUT` must name new destinations.

```sh
# Normal scheduled job: snapshot, objects, optional second copy, latest-success marker.
npm run backup:scheduled

# Manual complete set. Set REPAID_BACKUP_OUTPUT to a new .rpset directory.
npm run backup:set

# Set REPAID_BACKUP_INPUT to an existing complete set.
npm run backup:verify-set

# Set REPAID_BACKUP_OUTPUT to a new second-location .rpset directory.
npm run backup:copy-set

# Verify the actual newest complete set and its configured second copy and age.
npm run backup:check

# Set REPAID_RESTORE_OUTPUT to a new offline directory and REPAID_RECOVERY_REASON.
npm run backup:restore-set
```

`npm run db:build-tools` packages the same implementations. Docker uses `database-tools/scheduled.cjs`; the new command tool is `database-tools/recovery-set.cjs` with `create`, `verify`, `copy`, `check` or `restore` as its argument. Original `restore.cjs` and `npm run backup:restore` remain for old database-only archives. No legacy archive is silently converted or removed.

The scheduled job updates `latest-backup.json` only after the local set and any configured second copy independently pass. Failed second copies retain the previous latest-success marker and the verified local source. Freshness is measured from the authenticated conservative snapshot-start timestamp, not a modifiable marker timestamp or the end of a lengthy copy. Stale backups, excessive clock skew, wrong keys, missing objects and corrupt second copies make `backup:check` exit nonzero.

## Linux supervision

The existing `repaid-backup.timer` runs hourly. A separate check timer is supplied:

```sh
sudo install -m 0644 deploy/repaid-backup-check.service /etc/systemd/system/
sudo install -m 0644 deploy/repaid-backup-check.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now repaid-backup-check.timer
sudo systemctl start repaid-backup-check.service
sudo systemctl status repaid-backup-check.service
sudo journalctl -u repaid-backup.service -u repaid-backup-check.service
```

Provision `/etc/repaid/backup.env` privately and test the service as `repaid`. If the second location is outside the service's existing writable paths, add a systemd drop-in granting `ReadWritePaths` to that exact mounted destination for the backup service. The check service needs read access there and write access only to its private verification workspace. Wire nonzero service results and disk/backup-age signals into the actual host's alerting. No notification is sent or destination configured by this source-code change. These units are supplied; target installation/execution is not claimed.

For Compose, keep the existing source data and backup-work volumes. Mount the operator's separately provisioned destination into the backup container and pass `REPAID_BACKUP_COPY_DIR` explicitly. The default local backup volume is not proof of an off-host copy.

## Restore rehearsal and activation

1. Retain the original set and independent manifest identity. Verify it with the separately recovered backup key.
2. Restore to a new offline directory. Required objects are restored before SQLite is published there; their bytes must match the snapshot references exactly.
3. The directory contains `forensic.db` (the original exact snapshot), `objects/`, `repaid.db` (the existing controlled offline activation copy) and private `RECOVERY.json` evidence.
4. The offline copy invalidates old sessions and stale backup/download ownership through the established recovery service. Every original business-table projection is compared; unexpected trigger side effects cause rollback and rejection. Financial history, invoice amounts and ledger proofs are preserved.
5. Recover the original **application encryption key**, independently of the backup key. `application_encryption_key_verified:false` is deliberate: decrypting the archive does not prove application credentials can be decrypted. Check legitimate encrypted application data without printing secrets, then test authentication, branch scope and business reconciliation on the isolated restored server.
6. Measure restore duration and acceptable data loss on the actual target. Verify persistent storage, disk health, supervision, TLS, alerts and remote retention/key custody.
7. Only after those checks and the approved operational activation plan may an operator stop writers and switch the deployment. This command never replaces an active database or activates production. Keep the forensic copy and prior deployment for the documented rollback procedure.

The eight disputed historical financial cases and unapproved accounting policies remain unchanged. An intact backup preserves evidence; it does not certify disputed balances or authorize financial corrections.

## Test isolation

The test preloader now assigns a fresh private database before test-module imports. Explicit fixture paths must resolve within `.freebuff`; junctions resolving to business data are rejected. Each test process gets a distinct fallback. `getDb` also checks the runner-only boundary before file creation, startup migrations or cached connection return. Do not enable `REPAID_TEST_CONTEXT` in a deployment or use the test preloader for production maintenance.

This prevents accidental import/setup-order access through the application's database entry point. It is not an operating-system sandbox against deliberately opening arbitrary files with raw SQLite APIs. Continue using disposable fixtures and read-only comparison tools for actual customer data.
