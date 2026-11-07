# Current release status

**NOT READY FOR PRODUCTION.** Repository cleanup/import is not completion of the remaining commercial and PostgreSQL acceptance gates.

## Imported implementation

The application, all database schema/migration sources, branch/auth controls, accounting primitives, operational modules, licensed assets, verified Linux wizard and automated tests were retained from the latest workspace. No original business data, live configuration, credentials, generated builds or old Git history were imported.

The original wizard/runtime source was verified in the legacy repository. Those historical links remain attributed to their original repository; they are not fabricated new-repository CI results. New-repository checks are recorded in [REPOSITORY_SETUP.md](REPOSITORY_SETUP.md). All three workflows passed for `cc3f42dbb207f65cfff51fd49d0a8462664cc3f1`: 468 application tests, 215 native PostgreSQL tests, 48 website/browser acceptance groups, network isolation, Linux installer/recovery and extended wizard lifecycle. Typecheck/build pass; lint retains 120 warnings and zero errors. This verifies the imported scope, not completion of the release gates below.

## Remaining release gates

- Complete supported returns/credit notes/service credits and compensation workflows
- Complete repair lifecycle/cancellation/WIP and approved inventory carrying integration
- Opening/cutover business commands with genuine independent approvals
- Remaining operational modules, SSR/UI, reports/import/export/background consumers
- Application-wide operational ports and current-source workflow acceptance beyond the bounded locally verified slice
- Reviewed historical data/object migration and eight disputed-case approvals
- Target PostgreSQL least privilege/TLS/storage/full backup-recovery/sustained workloads

The reviewed table matrix includes 39 schema-only/unported tables and 62 API files classified unported/unverified. These are scope observations, not completion percentages. Existing isolated PostgreSQL tests do not enable production PostgreSQL globally.

Original disputed cases, business-policy approvals and production data migration remain protected. Actual Iranian DNS/TLS/provider access, target storage/recovery and sustained capacity need target-specific evidence. No live cutover, destructive production correction or external billable test occurred during repository setup.

[Migration tracker](POSTGRES_MIGRATION_MASTER_TRACKER.md) | [Coverage](POSTGRES_OPERATIONS_COVERAGE.md) | [Financial reconciliation](FINANCIAL_RECONCILIATION.md) | [Wizard evidence](WIZARD_IMPLEMENTATION_REPORT.md)
