> Imported engineering context: historical source/CI references belong to the legacy repository. Current new-repository status and validation: [REPOSITORY_SETUP.md](REPOSITORY_SETUP.md). This import does not complete remaining production gates.

# PostgreSQL application architecture

<!-- M9_STATUS_START -->
## M9 current-source checkpoint (2026-11-07)

M9 extends the existing persistence boundary through `pg-repair-work.ts`, native version9 guards, and `pg-repair-work-http.ts`. Technical work is a single local PostgreSQL transaction covering source projection, status history, time, queued notices, immutable audit and payload-bound durable operation. Existing branch/workflow/assignment authorization is reused. No second ledger or SQLite fallback exists. Minutes do not imply labor wages, WIP, commission or revenue. Financial delivery/cancellation remain separate blocked workflows pending their native integration. [Boundary details](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/POSTGRES_M9_TECHNICAL_WORK_CHECKPOINT.md).


Current verification: Runtime source9dbaee41ca0b1e42fc90813a86400bab6564b16d: CI42313819753 verify and postgres-acceptance jobs passed. Actual PostgreSQL215/215; Linux application regressions454/454; optimized production HTTP/browser48 groups; typecheck/build/source inventory/security audit passed; lint0 errors/124 warnings. Windows optimized HTTP/browser48 groups also passed, with523 runtime/config files independently matching current source. Windows full native run encountered57014 during timeout/restore-cleanup fixtures and is not certified; CI PostgreSQL restore rehearsal passed. Target-host production acceptance and full Prompt03 remain incomplete. [Exact CI evidence](https://github.com/Cat-Ghost-Community/1beng/actions/runs/42313819753). All three CI jobs passed, including existing Linux SQLite installer/update/rollback/recovery acceptance. This does not certify a production PostgreSQL installer or target host.
<!-- M9_STATUS_END -->


## Migration8 boundaries

`pg-repair-workflow.ts` owns branch mode/revision and current supervisor access. `pg-repair-assignment.ts` owns assignment-only ticket changes, preserved timers/history, source-proven internal notices and bounded queues/selectors. `pg-repair-notes.ts` owns immutable note provenance, current private access and paginated similar-note search. Their HTTP adapters delegate existing routes; the original UI uses separate notes/assignment capabilities rather than enabling unsupported editing.

Four new evidence tables bring the total to120. SQL/checksums1–7 remain frozen and are compared with retained checkpoint hashes. Migration8 uses version-aware exact verification for the expanded assignment/stock/chat notification router; altered trigger timing, qualification or source functions fail verification. Its role snapshot is versioned, while current personal permission overrides remain dynamic.

Actor/session locks precede customer-funds locks before financial source/document locks. Operational assignment locks affected employees without waiting before workflow/ticket mutation; stale state or contention returns an explicit safe failure. Durable results retain source identity and reauthorize sensitive replay. Test workspaces are external and isolated from business data. These changes do not migrate the remaining technical or financial workflows or enable live PostgreSQL cutover.

## Migration7 continuation

The schema now has116 persisted tables. Migration7 adds `pg_appointment_history`, native appointment/complaint guards, initial repair-intake source guards and source-linked invoice identity protection. Earlier migration1–6 checksums remain frozen. Each installer has an exact startup verifier; partially applied or tampered guards do not pass readiness.

`pg-appointments.ts` owns versioned scheduling and atomic conversion of an unassigned appointment using a real device and the shared intake service. `pg-complaints.ts` owns scoped documentary resolution/reopening; resolving a complaint does not execute a refund. Both retain original source ownership and atomically persist audit/idempotency evidence.

`pg-repair-intake.ts` owns a single unassigned intake, credential encryption and an optional verified cash advance using the existing receipt transaction. Group intake and simultaneous technician assignment remain unavailable. `pg-repair-read.ts` serves the original list and a deliberately read-only workspace with current assignment/privacy filtering. It separates invoice allocations, available advances and uncleared instruments; malformed financial evidence requires review instead of becoming zero.

`pg-repair-cost.ts` derives cost from immutable physical issue evidence, including actual legacy ticket/item identities, rather than mutable quotation prices or the billing `consumed` flag. Source snapshots pin the exact movement set and provenance. `pg-invoice-source-identity.ts` locks the repair/sale parent and prevents a second active obligation. Source-linked inserts require READ COMMITTED; unsupported stronger-isolation inserts fail explicitly. A cancelled repair cannot acquire or reuse an invoice through this constructor. Existing disputed duplicate invoices are preserved and blocked for review.

Complete repair mutations, inventory/return interfaces, WIP recognition, administrative workflows and target operations remain incomplete. The global PostgreSQL runtime block is retained. Current evidence and limits are in [the operational report](POSTGRES_OPERATIONS_INTEGRATION_REPORT.md).

## Operational extensions — Master Prompt03

Migrations5–6 preserve earlier frozen migration checksums and add explicit domain guards. `pg-operational-profiles.ts` owns contact/device/supplier metadata, `pg-customer-merge.ts` owns reference-safe same-branch alias evidence, `pg-device-support.ts` owns blacklist revocations/reminders, and `pg-branches.ts` owns company-authorized branch metadata. Native profile/device pages reuse the existing components. These are bounded ports, not the complete repair or inventory lifecycle.

`pg-notifications.ts` owns recipient/branch-scoped reads and read-flag operations. Internal chat uses `pg-chat.ts`, its HTTP adapter and exact native guards across nine existing tables. `pg-chat-notifications.ts` proves each message delivery into the existing inbox; the original stock-notification rules remain. Source conversation branch and recipient delivery branch remain distinct. Customer-linked communication is unavailable in this internal-only release.

`postgresDurableOperation` retains atomic payload-bound results and supports an optional domain replay authorization hook. Chat rechecks current membership, permissions, branch/history and visible immutable source before returning cached private content. Lost client responses preserve the original request identity. No synchronous SQLite adapter, alternate ledger or production fallback was introduced. See [the operational report](POSTGRES_OPERATIONS_INTEGRATION_REPORT.md) for full transaction/report/test traceability and unported boundaries.


## Current financial extension — Master Prompt02

Native migrations3–4 extend the frozen foundation; migrations1–2 and the global runtime block are preserved. Exact chart and recognition templates are extracted from existing SQLite implementations without changing rules. `pg-financial-http.ts` owns request identity/origin/branch validation; commands reauthorize under current actor/source locks. `pg-customer-finance.ts`, `pg-installments.ts`, `postgres-customer-credit.ts`, `pg-purchasing.ts`, `pg-expenses.ts` and `pg-checks.ts` own transactional mutations. Existing native bank, journal, operation and authorization services are reused.

`postgres-financial-events.ts` captures immutable canonical source snapshots inside the source transaction. Approved compatible recognition posts inside that transaction; missing approvals produce explicit pending events. `postgres-accounting-guards.ts` protects policy provenance, reviews and positive pending-source period closure. Posted history stays immutable; original legacy operation names, payload hashes and successful result envelopes remain replayable.

`postgres-inventory.ts` is the shared exact movement primitive, protected by native source uniqueness, quantity/carrying-value and weighted-cost guards. Partial PO receipts retain append-only original-line/movement references. Cancellation is never physical restocking. Unproven populated stock upgrades are blocked rather than assigned invented openings. Supplier customer references can be NULL; no customer0 is created.

`postgres-ledger-reports.ts` exposes posted trial balance, ledger and statements. Aggregate balances beyond JavaScript safe integers are exact decimal strings. Snapshots disclose missing verified opening and pending sources. `postgres-opening-backup.ts` performs real private native archive/independent restore rehearsal for disposable loopback acceptance only; it is not the missing opening approval/application service or certified production recovery.

Support and limits: [POSTGRES_FINANCIAL_INTEGRATION_REPORT.md](POSTGRES_FINANCIAL_INTEGRATION_REPORT.md). Ordinary production enablement and unported routes remain blocked. Existing Persian UI/design and ordinary SQLite behavior are preserved. Phase01 architecture below is historical context.

---

# PostgreSQL application foundation — Phase01

## Authority and deployment boundary

PostgreSQL is the sole database for the implemented isolated website slice. It is not an enabled production replacement for the entire application. `assertSqliteRuntime('postgres')` remains blocked. The selected PG slice bypasses no guard: it uses async PG services directly; unported paths/methods return `PG_MIGRATION_PENDING` before legacy bodies execute.

`REPAID_PG_INTEGRATION=1` additionally requires engine `postgres`, a loopback PG URL naming a fresh `repaid_phase01_<24hex>` database, matching `repaid_integration_<24hex>` schema and loopback application origin. Production/shared names and mismatched namespaces are refused. No SQLite fallback, app-start schema creation, automatic seed or real cutover occurs.

Normal SQLite behavior remains selected when integration mode is absent. This compatibility is transitional; it is not a proposal for permanent dual-authoritative storage.

## Versioned native schema

`pg-production-schema.json` freezes an empty canonical110-table blueprint,100 baseline indexes,10 views and130 source-trigger inventory records. It contains no customer rows. Amounts/IDs are BIGINT; permitted decimal quantities are NUMERIC. Text timestamps preserve explicit UTC presentation. Native foreign keys, unique/check constraints, defaults and sequences are installed by controlled migrations, not a snapshot importer.

`pg-migrations.ts` owns versions1–2, checksums, immutable applied history, schema drift verification and a transaction-scoped advisory migration lock. Fresh, populated, replay, concurrency, drift, downgrade and failure-retry cases use real PostgreSQL. Populated identity advancement is transactional `ALTER SEQUENCE … RESTART`; nontransactional `setval` is deliberately avoided.

The production administrative namespace is `repaid`. Isolated acceptance uses `repaid_integration_<24hex>`. Native snapshot tools retain their separate `repaid_snapshot_<24hex>` names and exact-import verification.

Existing ledger and durable-operation native guards are reused. Nineteen foundation/native-guarded tables permit writes;91 unported domain tables have explicit statement-level INSERT/UPDATE/DELETE/TRUNCATE fences. Customer financial branch changes and audit/customer-event rewriting are blocked. These fences preserve safety while business-specific native parity is unfinished; they are not a claim that all130 SQLite triggers are ported. Snapshot-dependent bank provenance is not fabricated for production.

## Async persistence and transactions

- Existing `createPostgresDatabase` remains the single pooling/transaction primitive. Defaults:10 connections,5s acquisition timeout,15s statement timeout,3s lock timeout,15s idle-transaction timeout; verified TLS outside explicit local tests.
- AsyncLocalStorage pins each transaction to one client. Controlled nested savepoints, rollback/release, post-transaction context rejection and pool shutdown remain existing tested behavior.
- No generic SQLite-like `prepare()` shim or giant repository was added.
- `PostgresCustomersRepository` owns customer domain validation, scoped reads, duplicate checks, counter allocation, audit/event persistence and transaction boundaries. SQL is parameterized; identifiers derive only from fixed schema/field contracts.
- Customer creation uses existing payload-bound `postgresDurableOperation`. The current actor/session is checked under row lock even on replay. A bounded database lock serializes same-branch duplicate checks. No callback, statement or external payment is blindly retried.
- A real downgrade race test proves an owner demoted while waiting on the actor lock cannot leak another branch's duplicate-contact data. Lookup visibility uses the locked current identity.
- PG BIGINT strings are normalized only through exact safe-integer checks at the application boundary. Numeric0 flags are not exposed as truthy string`"0"`. Financial balances in the unfinished read model are explicitly pending/null, never invented zero.

## Authentication and authorization

`credential-verification.ts` shares bounded asynchronous scrypt derivation between existing SQLite login and PG login. Public synchronous password helpers remain compatible. `pg-app-auth.ts` implements durable pre-hash throttling, salted credentials/legacy rehash, hashed seven-day sessions, prior-token rotation, logout, expiry, account-state recheck, current branch/employment, personal permission overrides, workflow-supervisor grants and transactional password change with full old-session revocation.

Existing login API, HTML server action, logout and password-change route select PG explicitly in isolated mode. `readRequestJson` is a shared bounded/CSRF-aware parser without database access. Legacy `readJson` retains its existing SQLite request/session/branch checks after parsing; PG requests do not accidentally invoke those SQLite checks.

`pg-branch.ts` preserves current branch semantics: staff cookies cannot change employment scope; owner/admin can select an active branch or company scope. Invalid/stale manager cookies fall back to authorized company scope. Explicit forbidden branch requests are denied server-side.

## Actual website slice

`Proxy` passes only implemented isolated routes. Login, protected customers list/new/profile pages, customer collection GET/POST, customer detail GET, logout/password change and PG health are integrated. Root layout resolves PG identity/settings/branch directory before any legacy seed/currency/SQLite call. Page-level access rechecks identity for navigation. Unported mutations stay unavailable.

Existing Persian components, forms, shell, themes and layout classes are reused. Only available navigation/controls are active in isolated mode; normal SQLite navigation is unchanged. Customer creation finishes at a real protected persisted profile. No journal is manufactured for creating a contact. Financial status is explicitly awaiting reconciliation until the financial read models migrate.

## Operations and verification

Administrative command: `npm run db:migrate-postgres -- --apply|--verify --schema repaid`. Credentials/TLS material come from `REPAID_PG_URL` and optional `REPAID_PG_CA_FILE`; explicit local plaintext requires `REPAID_PG_ALLOW_LOCAL_PLAINTEXT=1`. Do not execute against a real target without authorized migration procedure and retained recovery evidence. Website startup verifies current migrations; it never runs DDL.

`npm run test:postgres` creates/drops a unique disposable database. `npm run test:postgres:http` independently creates a matching isolated database/schema, copies code without customer data, builds an isolated Next application, exercises real HTTP/browser flows, verifies exact persisted identities and absence of SQLite files, then stops only its owned app and drops only its created database. Diagnostic workspaces remain private under `.freebuff`; credentials are not printed.

Machine-readable entrypoint/module ledger: `docs/postgres-migration-coverage.json`; generator/checker: `scripts/postgres-migration-inventory.cjs`. Reviewed acceptance is source-fingerprint-bound. Static imports alone do not prove migration or execution.

## Explicit unfinished work

Full financial/operational command ports, all native domain guard parity, full read/report/import/export parity, background processing and PostgreSQL-consistent DB/object recovery, least-privilege production deployment/cutover and whole-product acceptance remain later phases. The ordinary installer still deploys the supported SQLite profile; it does not offer an unsafe PostgreSQL live switch. Original data/disputed cases/policies remain untouched. Overall application remains NOT READY FOR PRODUCTION.

Implementation acceptance: commit `1cc2bf2`, [CI42121272671](https://github.com/Cat-Ghost-Community/1beng/actions/runs/42121272671); all three jobs passed. Native66, production HTTP/browser13 groups, Linux447 plus build/typecheck/source-inventory and disposable SQLite installer/recovery compatibility. These results authorize continuing the next engineering phase, not production cutover.
