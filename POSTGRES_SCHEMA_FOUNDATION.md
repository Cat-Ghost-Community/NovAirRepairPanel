> Imported engineering context: historical source/CI references belong to the legacy repository. Current new-repository status and validation: [REPOSITORY_SETUP.md](REPOSITORY_SETUP.md). This import does not complete remaining production gates.

# PostgreSQL production-schema foundation

Implemented for Master Prompt01. No customer database was opened or modified by this schema work. The canonical model was extracted from an explicitly isolated, empty SQLite fixture under `.freebuff`, not from the business database or a customer snapshot.

## Source and versioned ownership

- `src/lib/db/pg-production-schema.json`: frozen canonical110-table model,100 explicit indexes,10 views, original field/default/PK/FK/unique/CHECK definitions and130-source-trigger inventory. No data rows or financial balances are included.
- `pg-production-schema.ts`: reviewed native rendering. Money/IDs/micro-quantities use BIGINT; fractional quantities and original REAL-affinity fields use exact NUMERIC. Legacy SQLite INTEGER-affinity `qty` and `received_qty` fields explicitly become NUMERIC because the existing application supports fractional stock. Text retains byte-oriented C collation and original evidence strings. Timestamp defaults produce UTC ISO text; existing imported strings are not rewritten.
- `pg-migrations.ts`: two ordered, checksummed migrations and immutable version/applied-role/timestamp/duration/schema-fingerprint history. Uses the existing bounded async pool/transaction layer and a schema-specific transaction advisory lock. Concurrent migration calls serialize. DDL failure rolls back the whole upgrade. Unmanaged adoption, downgrade, unknown versions, code/checksum mismatch and schema drift fail closed.
- `scripts/migrate-postgres.ts`: actual administrative CLI requires exactly one of `--apply`/`--verify` plus explicit `--schema`. Credentials come only through `REPAID_PG_URL`/secret-manager environment, with optional `REPAID_PG_CA_FILE`. Plaintext requires explicit `REPAID_PG_ALLOW_LOCAL_PLAINTEXT=1` and remains loopback-only under the existing adapter. Errors expose structured codes, never credentials or raw SQL. Connections close on success/failure; applying schema does not import data or enable application cutover.
- `postgres-ledger.ts`: only its namespace-validation boundary was centralized through `postgresRelation`. Native ledger function bodies and historical proof semantics remain unchanged.

Namespaces are explicit: `repaid` for the eventual production database, or `repaid_integration_<24hex>` for isolated application integration. Rehearsal snapshot schemas are not renamed into production. Administrative migration application is explicit; ordinary verification does no DDL and does not create a database/schema.

## Migrations

1. Canonical baseline: creates all110 tables with reviewed native types, defaults, primary/unique/check/foreign-key constraints,100 original explicit indexes and10 translated authoritative read views. Stronger customer-slice references connect customer branch/creator, customer events and audit ownership; future populated cutover must review any incompatible legacy orphan evidence rather than deleting or inventing references.
2. Native foundation safety: reuses the existing ledger and durable-operation native guards, advances identities above preserved explicit rows without reducing existing sequence high-water marks, freezes customer branch ownership and audit/customer-event history, and installs statement-level DML fences over unported domains.

Identity adjustment uses transactional `ALTER ... RESTART`, not nontransactional `setval()`. Populated-upgrade tests preserve explicit IDs and verify the next generated identity.

## Important coverage boundary

Nineteen foundation/native-guarded tables are enabled;91 unported-domain tables reject INSERT/UPDATE/DELETE/TRUNCATE with SQLSTATE55000 until a future reviewed migration replaces each fence with accepted native invariant parity. Coverage is available from `productionSchemaCoverage()` and includes the full SQLite-trigger inventory. A caller-supplied request parameter cannot disable these database triggers.

The existing bank guards require an imported-snapshot provenance/baseline model. This implementation does not fabricate that snapshot metadata or claim bank-production parity; bank writes remain fenced. Other130 SQLite source triggers are not falsely described as fully translated merely because their tables/views exist. The application-wide PostgreSQL runtime block must remain until domain completion. This is an authoritative persistent foundation with explicit blocked capabilities, not a production cutover or a new accounting source of truth.

## Actual native verification

`tests/postgres/production-migrations.test.ts`: **7/7 PASS**,0 skipped/failures,12.894s on local disposable PostgreSQL18.4. Log: `.freebuff/pg-foundation-migrations-tests.txt`. A random dedicated `repaid_test_<24hex>` database was created and dropped; no original SQLite data or real financial case was involved.

Verified:

- Fresh110-table schema, native types, views and immutable migration history.
- Populated v1-to-v2 upgrade preserves Persian evidence and ID7001; next customer ID7002.
- Exact numeric0.1+0.2=0.3 and integer carrying value51 survive the upgrade; unsupported later stock writes are blocked.
- Independent pools concurrently migrating the same schema produce exactly one set of version rows and a safe replay.
- A real mid-DDL division-by-zero injected at the database boundary rolls the schema/registry back completely; retry succeeds.
- Schema drift, unmanaged adoption and downgrade are rejected without automatic repair.
- Invalid foreign keys, customer branch changes, audit deletion and unported invoice mutation are rejected.
- Existing native ledger guards reject an unbalanced17/16 journal; its state remains draft.

The initial schema run exposed a separate rehearsal-only namespace check in the native ledger module; validation was centralized without changing guard/proof bodies. A test also detected that legacy INTEGER-affinity quantities require NUMERIC in PostgreSQL; canonical quantity mappings were corrected. A fixture-specific identity collision was corrected to exercise the intended foreign-key error explicitly, rather than weakening a database constraint.

Parent integration owns full existing PostgreSQL regressions, website authentication/customer HTTP/browser verification, typecheck/build and final release evidence. Fresh successful fixtures do not reconcile disputed historical accounting or authorize production cutover.

The CLI apply/replay/verify/error case was added as an eighth native test after that initial run. All eight schema/migration cases subsequently passed in the combined66-test native suite on source commit `74e76ed`, [CI42119920640](https://github.com/Cat-Ghost-Community/1beng/actions/runs/42119920640). Production website HTTP/browser and unaffected regressions/build also passed; see `POSTGRES_FOUNDATION_TEST_REPORT.md` for precise scope. No production cutover was executed.
