# Preparing a restored database for activation

Restoration first produces an exact forensic SQLite file with an independently verified hash. **Do not send business traffic to that file immediately.** It can contain old valid login sessions, in-flight download tickets and preparation ownership from the old process/container.

`npm run backup:prepare-recovery` creates a **new separate activation copy**. It never replaces the active database or changes the forensic source. Supply:

```text
REPAID_RECOVERY_SOURCE=<verified standalone restored file>
REPAID_RECOVERY_SOURCE_SHA256=<hash retained from independent restore verification>
REPAID_RECOVERY_OUTPUT=<new private activation copy>
REPAID_RECOVERY_REASON=<actual operator/change reference and reason>
REPAID_RECOVERY_REPORT=<new private evidence filename>
REPAID_OBJECT_DIR=<restored private object directory, when referenced>
```

Packaged deployments use `node database-tools/prepare-recovery.cjs`. The destination disk must have room for the copy plus the unchanged configured reserve. Choose actual private directories; do not paste keys in commands or logs.

The implementation invalidates restored sessions, expires prepared tickets, marks interrupted transfers accurately and abandons copied preparation ownership. Backup history metadata is adjusted only as declared by those artifact transitions. Every original business projection is independently checked in the same transaction; unexpected trigger effects cause rollback. Original posted journals, invoices, payments, customers, encrypted credentials and previous recovery evidence remain unchanged. A separate provenance document records source hash, actual OS operator, reason and counts. Final SQLite/FK and referenced-object checks must pass. A fresh output hash identifies the activation artifact.

No token is silently revived. The forensic source remains byte-for-byte unchanged. Prior migration/recovery provenance remains compatible with the PostgreSQL rehearsal importer. The command explicitly returns `production_activated:false` and `application_encryption_key_verified:false`.

## Before actual deployment

The operator must still verify the **original application encryption key**, separate archive key custody, complete private object retention, authorization, target storage, supervision/TLS and backup recovery. A new encryption key cannot recover old encrypted device credentials. Use the original key privately for an authorized check; never print decrypted customer data. Stop all old writers and obtain the required deployment approval before replacing a live file. Preserve a recoverable original and rehearsed rollback plan. Do not run two independently writable copies.

## Abandoned preparation ownership

Backup generation is admitted durably before allocating snapshots. One generation runs at a time; at most two prepared/streaming artifacts are admitted per database. Manual native/direct downloads and scheduled/manual CLI backups share admission. Verified same-host dead processes and locally finished handlers can be reclaimed. A different PID namespace/container, unknown process identity or permissions error is **not proof of death**; admission stays blocked for operator review. Expired prepared files and provably interrupted transfers are marked transactionally before safe cleanup.

After a confirmed old-container failure, follow the cold recovery procedure with all writers stopped, a consistent forensic snapshot and an independently verified activation copy. Do not clear another active process's reservation by guessing from its PID or age. No time-based lease automatically steals a running backup. Monitoring of failed schedules/admission and off-host retention still needs the actual target infrastructure.

## Local evidence

Real SQLite integration tests verify exact ledger proofs, invoices, source bytes and encrypted credential retention while invalidating access. Injected trigger mutations are rolled back. An actual isolated business-source rehearsal completed migrated-object storage, encrypted scheduled archive, independently verified restoration and activation-copy preparation with one verified external object; the live database was not replaced. This is local recovery evidence, not target-host/off-host acceptance.
