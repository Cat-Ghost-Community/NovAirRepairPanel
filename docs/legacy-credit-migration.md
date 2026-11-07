# Populated legacy credit migration — V8

This is an **offline restored-copy migration**, not an application-startup conversion. No production file is replaced by the tools. Independent business/deployment authorization is required before installing a prepared database. Disputed historical cases, opening values and accounting policies are not approved or corrected by migration.

## Supported source and preservation

The supported V5/V6/V7 legacy shape has one unconditional credit-note `return_id` uniqueness constraint and/or one credit-line `return_line_id` uniqueness constraint. The tool accepts inline UNIQUE constraints and explicit unique indexes. It preserves IDs, original amounts, source references, journals/reversals, refunds, invoice relationships, posted documents, customer data and audit rows. Existing incomplete unapproved drafts are preserved as evidence, not fabricated into complete financial documents.

Unknown columns, automatic uniqueness, CHECK/sequence semantics or custom credit triggers block migration for explicit compatibility review. Existing integrity/FK defects also block it. No orphan, amount, cheque link, old approval or missing source is guessed. Standard credit immutability/budget/reissue guards are recreated from the current canonical schema. Other triggers, indexes and dependent views are preserved. No `writable_schema` editing is used.

The rebuild follows SQLite's [documented generalized ALTER TABLE procedure](https://www.sqlite.org/lang_altertable.html#making_other_kinds_of_table_schema_changes): create the replacement, copy named columns, replace tables within one transaction, restore dependent schema, check all foreign keys and commit. Originals are not first renamed into an archival target that could redirect references. Injected failure after replacement rolls the entire schema/data change back, including old constraints and FK enforcement.

## Rehearsal command

Run from the application directory under a protected operator account. `.freebuff` must never be served, committed or copied into a public deployment artifact. Windows ACLs / Linux directory permissions and off-host retention remain the operator's responsibility.

```powershell
$env:REPAID_MIGRATION_SOURCE='D:\WorkSapace\IMAN\1beng\data\repaid.db'
node --import tsx scripts/rehearse-legacy-credits.ts
```

The source is opened **read-only**. The script creates `.freebuff/credit-migration-<unique>/backup.db`, independently restores `restored/repaid.db`, initializes additive schema only on that restored copy, and performs the controlled credit rebuild there. It then uses SQLite backup again to produce a standalone `prepared-upgrade.db`, independent of WAL sidecars. Integrity/FK checks and exact original-column record projections must pass for both the working copy and prepared artifact.

`manifest.json` records source and candidate paths, original backup and prepared artifact SHA-256 values, source column projection/fingerprint, full upgraded record fingerprint, counts, and explicit `productionApplied:false`. A nonlegacy source reports `changed:false`; this is not evidence that a populated legacy source was migrated.

Run the read-only pre-install verifier against the actual manifest path printed by rehearsal:

```powershell
node --import tsx scripts/verify-legacy-credit-candidate.ts .freebuff/credit-migration-<actual>/manifest.json
```

It checks backup/candidate hashes and independently compares **the current original** and candidate against the original projected record fingerprint. Any new business write after rehearsal invalidates installation. The command does not approve installation and never swaps database files.

## Approved production installation procedure

1. Obtain the legitimate recorded change approval, identify the actual configured database path and responsible operator, and confirm off-host recovery access. Synthetic test approvals authorize nothing here.
2. Put the application in maintenance mode and stop **all** writers, jobs and application processes belonging to this deployment. Do not stop unrelated services. Keep the original database and its sidecars together; never delete a live WAL or assume a raw file copy is a consistent backup.
3. Run rehearsal against that stopped deployment's actual database, using its compatible application build. Review the manifest, original/credit/source counts and private reconciliation evidence. Run the verifier immediately before installation. Reconcile every source-specific exception; do not bypass a failed check.
4. Under the approved maintenance change, retain the original database/sidecars and verified off-host snapshot, and install the verified standalone `prepared-upgrade.db` at the configured database path with correct owner/permissions. File replacement is deliberately **manual and outside these scripts**; the operator must verify absolute source/target paths before any replacement. Never overwrite the live database while a process holds it open.
5. Start one application instance. Verify readiness, integrity/FKs, unchanged original credit IDs/amounts/references and control balances, immutable old documents, scoped credit history and expected indexes. Test a reviewed permitted future reversal/reissue in the approved acceptance environment before opening production writes. Do not create artificial customer credits as a smoke test on production.
6. Retain approval identity, manifest hashes, operator/time, deployment version and verification results in the deployment audit/change record. Only then end maintenance.

## Rollback

Before accepting any new business write, the approved operator may stop the deployment again and restore the independently verified original snapshot, preserving the failed candidate separately. After new transactions are accepted, restoring an older snapshot would lose legitimate records: preserve both versions and use a reviewed forward/compensating procedure. There is no automatic destructive down-migration.

## Executed local evidence

`tests/legacy-credit-migration.test.ts` uses disposable real SQLite with populated **inline** legacy uniqueness, one preserved incomplete historical draft and a genuinely posted customer return credit. It verifies independent backup/restoration, the CLI's prepared artifact, exact all-table record fingerprints, FK/immutability guards, failure after table replacement, successful retry, actual immutable journal reversal, independent-process same-key replacement, fresh independent credit approval, one effective benefit, unchanged physical stock, exact invoice outstanding, balanced journals and idempotent migration replay. Original customer data and real disputed cases are never test targets.

Target-host installation, maintenance writer exclusion, operator approval and production rollback are **not yet verified**. See [V8_IMPLEMENTATION_STATUS.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/V8_IMPLEMENTATION_STATUS.md).
