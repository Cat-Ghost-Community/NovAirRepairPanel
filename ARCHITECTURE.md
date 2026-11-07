# Architecture

NovAirRepairPanel contains the existing Persian RTL repair/business application. Repository renaming does not rename its deployed service, data directories or REPAID_* configuration keys.

## Runtime

- Next.js16 App Router, React19, strict TypeScript, Tailwind4 and Node24.
- Default supported persistence is local SQLite on durable storage, one web process, transactional writes, foreign-key/integrity checks and protected backups.
- Native asynchronous PostgreSQL modules and integration tests exist. Full application-wide production PostgreSQL migration remains gated; no silent fallback or production cutover is enabled by this import.
- One business per deployment, multiple branches. Server-side sessions/permissions enforce branch ownership; the company owner has cross-branch authority.

## Source boundaries

| Path | Responsibility |
|---|---|
| src/app | Actual pages, server rendering and API entry points |
| src/lib | Authentication, branch policy, repairs, inventory, finance, persistence and recovery services |
| src/components | Existing shared Persian RTL interface |
| src/lib/db | SQLite schema/history and native PostgreSQL foundations/migrations |
| public | First-party assets and licensed local print fonts |
| deploy/wizard | Linux installation, protected configuration, updates, TLS, reset/recovery and credentials |
| scripts | Retained administration, migration, verification and load/browser tooling |
| tests | Automated regression/integration fixtures; never production data |

## Financial and data safety

Amounts retain exact documented rial precision and scaled quantity rules. Posted journals and correction histories remain immutable under the existing model. Source mutations, durable operation identities and accounting effects use supported transactional domain services. Unapproved recognition policies, uncertain settlements and disputed historical corrections must remain blocked/reviewed rather than fabricated.

The financial/operational PostgreSQL port is incomplete. Consult [current status](FINAL_REPORT.md), [migration tracker](POSTGRES_MIGRATION_MASTER_TRACKER.md), [coverage matrix](docs/postgres-operations-coverage.json), [financial rules](FINANCIAL_RULES.md) and [policy register](ACCOUNTING_POLICY_DECISIONS.md). Table/schema presence does not certify complete business workflows.

## Deployment and resources

The supported Linux wizard uses systemd/Nginx, separate service/build identities, immutable reviewed releases, private persistent data and encrypted database/object recovery. Clean reset archives the original before creating fresh active data. TLS/address failures have explicit recovery boundaries. No Windows demo launcher or automatic website demo seeding is present.

Main and print fonts, icons and scripts are first-party/bundled. Nonced CSP and network-isolation safeguards remain. Domestic adapters are preserved; actual provider DNS/TLS/routing and target-host acceptance are not inferred from CI.

[Installation](README.md) | [Operations](DEPLOYMENT.md) | [Network controls](docs/network-independence/IMPLEMENTATION.md)
