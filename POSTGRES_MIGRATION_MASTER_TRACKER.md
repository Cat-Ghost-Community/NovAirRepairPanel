> Imported engineering context: historical source/CI references belong to the legacy repository. Current new-repository status and validation: [REPOSITORY_SETUP.md](REPOSITORY_SETUP.md). This import does not complete remaining production gates.

# PostgreSQL migration master tracker

<!-- M9_STATUS_START -->
## M9 current-source checkpoint (2026-11-07)

M9 technical repair source implemented and verified by the named clean CI. Migration9 adds immutable technical command evidence, optimistic technical versions and atomic status/timer/QC/outbox proofs while retaining frozen M1-M8 checksums. The original UI now delegates these specific operations to PostgreSQL. Complete Prompt03 remains INCOMPLETE / NOT READY FOR PRODUCTION. The global PostgreSQL runtime block remains; no live cutover or original-data correction occurred. [Exact checkpoint and remaining gates](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/POSTGRES_M9_TECHNICAL_WORK_CHECKPOINT.md).


Current verification: Runtime source9dbaee41ca0b1e42fc90813a86400bab6564b16d: CI42313819753 verify and postgres-acceptance jobs passed. Actual PostgreSQL215/215; Linux application regressions454/454; optimized production HTTP/browser48 groups; typecheck/build/source inventory/security audit passed; lint0 errors/124 warnings. Windows optimized HTTP/browser48 groups also passed, with523 runtime/config files independently matching current source. Windows full native run encountered57014 during timeout/restore-cleanup fixtures and is not certified; CI PostgreSQL restore rehearsal passed. Target-host production acceptance and full Prompt03 remain incomplete. [Exact CI evidence](https://github.com/Cat-Ghost-Community/1beng/actions/runs/42313819753). All three CI jobs passed, including existing Linux SQLite installer/update/rollback/recovery acceptance. This does not certify a production PostgreSQL installer or target host.
<!-- M9_STATUS_END -->


## Migration8 operational continuation — 2026-11-07

Implemented bounded workflow settings, supervisor history, assignment/reassignment/helper/shared claim, scoped queues and append-only repair notes through existing application controls.120 persisted tables; native identity and durable-operation permissions now share the same current grants/denies. Financial lock order and uncertain-response selection/operation identities were repaired. Supported runtime d00923d passed all three CI42303488350 jobs: native206, Linux453 and production HTTP/browser46; [current report](POSTGRES_OPERATIONS_INTEGRATION_REPORT.md) records evidence and failures. Full status/time/QC/delivery/cancellation, inventory/returns, remaining finance/admin/reporting and target deployment are still incomplete. Production PostgreSQL remains blocked; no customer history or approvals were changed. Older checkpoints below are historical.

## Current Master Prompt03 checkpoint — 2026-11-06

**Migration7 continuation:**116 persisted tables; native appointments/controlled conversion, complaints, single unassigned repair intake with optional verified cash advance, and original repair list/read-only workspace. Actual repair cost provenance and source-parent invoice uniqueness are integrated with existing financial services. Cancelled repair invoice construction/reuse is rejected. [Current report](POSTGRES_OPERATIONS_INTEGRATION_REPORT.md) distinguishes exact executed evidence from pending verification. Full repair mutation, general inventory/returns, remaining finance/settings/reporting and target deployment remain open; Master Prompt03 is not accepted. The migration5–6 counts below describe the earlier committed checkpoint.

Read [POSTGRES_OPERATIONS_INTEGRATION_REPORT.md](POSTGRES_OPERATIONS_INTEGRATION_REPORT.md) and the complete [operational coverage matrix](POSTGRES_OPERATIONS_COVERAGE.md). Migrations5–6 add native customer metadata/controlled merge/history, device profiles/checks/blacklist/reminders, supplier directory, branch metadata, notification reads and internal chat/attachments. Actual page/API integration is bounded explicitly; settings, complete repair/inventory/return and remaining financial workflows are not implicitly accepted.

Native source/financial evidence stays protected; final-to-draft invoice reopening and false payment caches are blocked, supervisor grants revoke on employment changes, and cached chat responses reauthorize current private-object access. The global PostgreSQL production block remains. No original customer data, disputed evidence, accounting approval or live cutover was changed.

Schema:115 persisted tables (110 canonical +5 explicit native extensions). Coverage enumerates122 API files/189 handlers/49 families. The AST inventory invalidates historical exact-source acceptance after shared runtime changes; its zero current reviewed acceptances does not certify or erase the separately documented tests. Final-source native/regression/production HTTP/browser evidence is recorded in the integration report.

**Master Prompt03 INCOMPLETE. Master Prompt02 remains INCOMPLETE. NOT READY FOR PRODUCTION.** The financial checkpoint below is historical evidence.

---

## Current Master Prompt02 checkpoint — 2026-11-06

Read [POSTGRES_FINANCIAL_INTEGRATION_REPORT.md](POSTGRES_FINANCIAL_INTEGRATION_REPORT.md) for implemented boundaries, exact invariants, executed evidence and unported domains. Native migrations3–4, accounting HTTP/manual journals/reports, customer invoices/receipts/refunds/installments/credit, bank/cheques/expenses and partial purchasing services are implemented in the isolated PostgreSQL profile. General inventory movements are shared with those commands. This does not certify all financial workflows or inventory policies.

Native88/88 passed; subsequent changed credit/recovery tests8/8 passed, including independent-process credit posting and real dump/restore. Expanded production HTTP discovered an installment source-scope column defect; fixed using `effective_installments`. Final production HTTP/browser19 groups and Windows445/445 regressions passed. Original109-table comparison passed unchanged. Global PG production block remains.

**Master Prompt02 is INCOMPLETE. Master Prompt03 acceptance handoff is not ready.** Opening business workflow, complete returns/credit notes, payroll/commissions, repair/WIP, POS and remaining reports/imports/recovery must still migrate. Business decisions and historical approvals remain separate gates. Generated inventory invalidates old acceptance when shared runtime hashes change; historical CI does not certify new financial code.

The Phase01 tracker below is historical evidence.

Independent source acceptance: commit`6e620d3`, [CI42137438197](https://github.com/Cat-Ghost-Community/1beng/actions/runs/42137438197), all3 jobs succeeded: nativePG88, production HTTP/browser19 groups, Linux447 regressions, build/types/lint/audit/inventory and real disposable Ubuntu SQLite install/update/rollback/recovery. These certify the implemented isolated scope only; they do not close the remaining financial or production gates.

---

Phase: **Master Prompt01 — foundation and first website slice**. This tracker does not certify application-wide PostgreSQL readiness.

| Requirement | Implemented boundary | Actual evidence/status |
| --- | --- | --- |
| Bounded inventory | AST import graph, all API handlers/pages/layouts/server actions, tools/deployment paths, repositories/services/transactions/test references | Reproducible JSON + Markdown; narrow reviewed acceptance bound to runtime source hashes and exact-source CI |
| Production schema foundation |110 canonical tables,100 indexes,10 views; versioned/checksummed native migrations, explicit unported-table fences | Real PG migration suite passed; CLI included in combined native acceptance |
| Async boundary | Existing pool/transaction interface reused; domain customer repository and request-scoped identity/branch services | Real native pooling/transaction/rollback and customer tests |
| Actual website authentication | API and HTML login, sessions/rotation/logout/expiry/throttle/permissions/branch/password change, SSR layout | Native auth tests and local production HTTP/browser acceptance passed |
| First real workflow | Existing customer form; PG create/counter/audit/event/idempotency; protected list/profile/API read | Actual production Next HTTP/browser, concurrency, injected audit rollback; exact source/audit/event/operation counts5 |
| Original-data safety | Only uniquely created test databases and isolated source fixtures used | Read-only comparison:109 original table projections/identities unchanged, integrity ok, FK0; reviewed schema and private case byte hashes unchanged; no live cutover |
| Global cutover block | Still enabled; only explicit loopback integration configuration can run the slice | Negative configuration and unsupported-route tests; no hidden SQLite fallback |

## Module ledger

| Module group | Migration state |
| --- | --- |
| Native pool/transactions, schema/migration administration | Implemented foundation; production-target acceptance still required |
| Login/session/authorization/customer contact creation and protected reads | Implemented isolated website slice; final exact-source CI evidence recorded in foundation test report |
| Shared shell/login/customer UI | Conditional async PG integration; existing normal SQLite behavior retained; financial view explicitly pending |
| Native ledger/manual journals/idempotency/bank preparation | Existing real native components reused; manual/native tests are not complete website integration |
| Other financial and operational commands | Unported; production DML fences and HTTP allowlist prevent unsafe writes |
| Financial reports/legacy imports/exports | Not certified as PG-backed; pending authoritative read-model/service ports |
| Background jobs, production PG installer/storage/recovery | Not completed; SQLite operations remain the supported ordinary installation |
| Original records, attachments, disputed cases | No migration/correction executed; reviewed full-data cutover remains future authorized work |

Authoritative route-by-route/module-by-module entries and source hashes are in `docs/postgres-migration-coverage.json`. Before full acceptance, each unported dependency must be replaced or safely delegated and its business/security/recovery tests must pass on real PostgreSQL.

## Next phase boundary

**Master Prompt02 can start.** Final implementation commit `1cc2bf2`: all three jobs of [CI42121272671](https://github.com/Cat-Ghost-Community/1beng/actions/runs/42121272671) succeeded. Evidence:66 native PG tests,13 production HTTP/browser groups,447 Linux regressions, source-bound inventory, typecheck/build/audit and actual disposable Ubuntu installation/update/rollback/recovery. Earlier Windows444 and source commit74e76ed/CI42119920640 remain separately recorded in the test report. Original-source read-only checks passed. Next phase should migrate real domain services/native invariants and remove their fences only through reviewed versioned migrations. It must not activate ordinary PostgreSQL production runtime or rewrite historical data merely because the first slice works.

Current open release gates:91 fenced domain tables; financial/operational/report/job/recovery parity; production least-privilege/TLS/storage/backup/cutover; existing financial policy and historical-case approvals. **Whole product remains NOT READY FOR PRODUCTION.**
