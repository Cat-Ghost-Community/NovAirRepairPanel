# PostgreSQL migration inventory

Generated from actual repository source; rerun after source changes. **Not a production-readiness certificate.**

```bash
node scripts/postgres-migration-inventory.cjs
node scripts/postgres-migration-inventory.cjs --check
```

Source-tree digest: `85072c581297f107405101f689480520a270fcb4e3ec83ba58c5569852132c13`. Complete machine-readable graph: [docs/postgres-migration-coverage.json](docs/postgres-migration-coverage.json). The generator never loads application modules, opens a database or reads customer data/secrets.

## Measured footprint

| Measure | Count |
| --- | ---: |
| input files | 729 |
| api route files | 122 |
| api handlers | 189 |
| pages | 71 |
| layouts | 10 |
| server actions | 1 |
| command tools | 26 |
| deployment scripts | 14 |
| local runtime edges | 3467 |
| type only edges | 166 |
| unresolved local edges | 0 |
| nonliteral dynamic expressions | 1 |
| reviewed entrypoint acceptances | 0 |
| reviewed handler acceptances | 0 |
| partially verified api routes | 0 |

## Interpretation

Runtime imports and type-only imports are separated; proxy and ancestor-layout dependencies are included implicitly, and accepted entrypoints are bound to their transitive runtime/configuration fingerprints. Hashes normalize CRLF to LF. Each entry records source services, storage/transaction modules, transitive dependencies, literal HTTP links, unresolved dynamic expressions, and direct/transitive test references. Every source module is retained in the JSON, including modules without a discovered entrypoint. Module reachability conservatively includes legacy SQLite fallback and gated PostgreSQL branches; it does not prove that both execute in one request.

Default PostgreSQL acceptance is **not_verified**. New native services or an opt-in route remain unverified until explicit reviewed execution evidence is recorded. Existing native PostgreSQL tests support only their actual isolated behaviors; no result is inferred from a file name/import. `production_ready` remains false in this inventory.

## Entrypoint coverage

SQLite/PG columns count reachable source modules carrying database signals; these are dependency counts, not defect counts or percentages. Details and complete paths are in the JSON.

| Entry | Type | Route/action | SQLite modules | PG modules | Reviewed acceptance |
| --- | --- | --- | ---: | ---: | --- |
| `src/app/api/accounting/route.ts` | api_route | /api/accounting | 38 | 44 | not_verified |
| `src/app/api/appointments/[id]/convert/route.ts` | api_route | /api/appointments/[id]/convert | 31 | 41 | not_verified |
| `src/app/api/appointments/[id]/route.ts` | api_route | /api/appointments/[id] | 15 | 41 | not_verified |
| `src/app/api/appointments/route.ts` | api_route | /api/appointments | 15 | 41 | not_verified |
| `src/app/api/auth/change-password/route.ts` | api_route | /api/auth/change-password | 15 | 41 | evidence_source_changed |
| `src/app/api/auth/login/route.ts` | api_route | /api/auth/login | 15 | 41 | evidence_source_changed |
| `src/app/api/auth/logout/route.ts` | api_route | /api/auth/logout | 9 | 41 | evidence_source_changed |
| `src/app/api/backup/route.ts` | api_route | /api/backup | 17 | 0 | not_verified |
| `src/app/api/bank/route.ts` | api_route | /api/bank | 32 | 41 | not_verified |
| `src/app/api/barcode/route.ts` | api_route | /api/barcode | 13 | 0 | not_verified |
| `src/app/api/branches/route.ts` | api_route | /api/branches | 15 | 42 | not_verified |
| `src/app/api/chat/attachments/[id]/route.ts` | api_route | /api/chat/attachments/[id] | 32 | 41 | not_verified |
| `src/app/api/chat/conversations/[id]/messages/route.ts` | api_route | /api/chat/conversations/[id]/messages | 32 | 41 | not_verified |
| `src/app/api/chat/conversations/[id]/route.ts` | api_route | /api/chat/conversations/[id] | 32 | 41 | not_verified |
| `src/app/api/chat/conversations/route.ts` | api_route | /api/chat/conversations | 32 | 41 | not_verified |
| `src/app/api/chat/events/route.ts` | api_route | /api/chat/events | 32 | 41 | not_verified |
| `src/app/api/chat/messages/[id]/route.ts` | api_route | /api/chat/messages/[id] | 32 | 41 | not_verified |
| `src/app/api/chat/search/route.ts` | api_route | /api/chat/search | 32 | 41 | not_verified |
| `src/app/api/chat/summary/route.ts` | api_route | /api/chat/summary | 32 | 41 | not_verified |
| `src/app/api/chat/upload/route.ts` | api_route | /api/chat/upload | 32 | 41 | not_verified |
| `src/app/api/chat/users/route.ts` | api_route | /api/chat/users | 15 | 41 | not_verified |
| `src/app/api/checks/route.ts` | api_route | /api/checks | 32 | 41 | not_verified |
| `src/app/api/commission-corrections/route.ts` | api_route | /api/commission-corrections | 33 | 0 | not_verified |
| `src/app/api/complaints/[id]/route.ts` | api_route | /api/complaints/[id] | 15 | 41 | not_verified |
| `src/app/api/complaints/route.ts` | api_route | /api/complaints | 15 | 41 | not_verified |
| `src/app/api/customer-credit/route.ts` | api_route | /api/customer-credit | 32 | 42 | not_verified |
| `src/app/api/customers/[id]/route.ts` | api_route | /api/customers/[id] | 31 | 41 | evidence_source_changed |
| `src/app/api/customers/lookup/route.ts` | api_route | /api/customers/lookup | 14 | 0 | not_verified |
| `src/app/api/customers/merge/route.ts` | api_route | /api/customers/merge | 31 | 41 | not_verified |
| `src/app/api/customers/route.ts` | api_route | /api/customers | 31 | 41 | evidence_source_changed |
| `src/app/api/daily-reports/route.ts` | api_route | /api/daily-reports | 15 | 0 | not_verified |
| `src/app/api/devices/blacklist/route.ts` | api_route | /api/devices/blacklist | 15 | 41 | not_verified |
| `src/app/api/devices/check/route.ts` | api_route | /api/devices/check | 15 | 41 | not_verified |
| `src/app/api/devices/route.ts` | api_route | /api/devices | 31 | 41 | not_verified |
| `src/app/api/devices/service-reminders/route.ts` | api_route | /api/devices/service-reminders | 15 | 41 | not_verified |
| `src/app/api/estimates/[id]/document/route.ts` | api_route | /api/estimates/[id]/document | 30 | 0 | not_verified |
| `src/app/api/expenses/route.ts` | api_route | /api/expenses | 31 | 41 | not_verified |
| `src/app/api/files/[id]/route.ts` | api_route | /api/files/[id] | 16 | 0 | not_verified |
| `src/app/api/health/ready/route.ts` | api_route | /api/health/ready | 8 | 0 | not_verified |
| `src/app/api/health/route.ts` | api_route | /api/health | 9 | 39 | evidence_source_changed |
| `src/app/api/installments/route.ts` | api_route | /api/installments | 31 | 43 | not_verified |
| `src/app/api/intake-questions/route.ts` | api_route | /api/intake-questions | 14 | 0 | not_verified |
| `src/app/api/inventory/excel/route.ts` | api_route | /api/inventory/excel | 14 | 0 | not_verified |
| `src/app/api/inventory/tools/route.ts` | api_route | /api/inventory/tools | 30 | 0 | not_verified |
| `src/app/api/invoices/[id]/cancel/route.ts` | api_route | /api/invoices/[id]/cancel | 30 | 43 | not_verified |
| `src/app/api/invoices/[id]/confirm/route.ts` | api_route | /api/invoices/[id]/confirm | 30 | 43 | not_verified |
| `src/app/api/invoices/[id]/edit/route.ts` | api_route | /api/invoices/[id]/edit | 29 | 0 | not_verified |
| `src/app/api/invoices/[id]/payments/route.ts` | api_route | /api/invoices/[id]/payments | 31 | 43 | not_verified |
| `src/app/api/invoices/[id]/route.ts` | api_route | /api/invoices/[id] | 30 | 43 | not_verified |
| `src/app/api/invoices/config/route.ts` | api_route | /api/invoices/config | 14 | 0 | not_verified |
| `src/app/api/invoices/route.ts` | api_route | /api/invoices | 31 | 43 | not_verified |
| `src/app/api/message-templates/[id]/route.ts` | api_route | /api/message-templates/[id] | 14 | 0 | not_verified |
| `src/app/api/messages/dispatch/route.ts` | api_route | /api/messages/dispatch | 14 | 0 | not_verified |
| `src/app/api/messages/send/route.ts` | api_route | /api/messages/send | 14 | 0 | not_verified |
| `src/app/api/notifications/route.ts` | api_route | /api/notifications | 15 | 41 | not_verified |
| `src/app/api/parts/[id]/stock/route.ts` | api_route | /api/parts/[id]/stock | 30 | 0 | not_verified |
| `src/app/api/parts/price/route.ts` | api_route | /api/parts/price | 14 | 0 | not_verified |
| `src/app/api/parts/route.ts` | api_route | /api/parts | 30 | 0 | not_verified |
| `src/app/api/parts/search/route.ts` | api_route | /api/parts/search | 14 | 0 | not_verified |
| `src/app/api/payments/refund/route.ts` | api_route | /api/payments/refund | 31 | 43 | not_verified |
| `src/app/api/payments/route.ts` | api_route | /api/payments | 31 | 43 | not_verified |
| `src/app/api/payroll/route.ts` | api_route | /api/payroll | 32 | 0 | not_verified |
| `src/app/api/purchase-orders/[id]/preview/route.ts` | api_route | /api/purchase-orders/[id]/preview | 16 | 41 | not_verified |
| `src/app/api/purchase-orders/[id]/route.ts` | api_route | /api/purchase-orders/[id] | 31 | 41 | not_verified |
| `src/app/api/purchase-orders/route.ts` | api_route | /api/purchase-orders | 16 | 41 | not_verified |
| `src/app/api/qr/route.ts` | api_route | /api/qr | 13 | 0 | not_verified |
| `src/app/api/repair-tariffs/[id]/route.ts` | api_route | /api/repair-tariffs/[id] | 14 | 0 | not_verified |
| `src/app/api/repair-tariffs/route.ts` | api_route | /api/repair-tariffs | 14 | 0 | not_verified |
| `src/app/api/repair-templates/route.ts` | api_route | /api/repair-templates | 14 | 0 | not_verified |
| `src/app/api/repairs/[id]/attachments/route.ts` | api_route | /api/repairs/[id]/attachments | 16 | 0 | not_verified |
| `src/app/api/repairs/[id]/checklist/route.ts` | api_route | /api/repairs/[id]/checklist | 16 | 41 | not_verified |
| `src/app/api/repairs/[id]/diagnosis/route.ts` | api_route | /api/repairs/[id]/diagnosis | 16 | 41 | not_verified |
| `src/app/api/repairs/[id]/estimate/route.ts` | api_route | /api/repairs/[id]/estimate | 30 | 0 | not_verified |
| `src/app/api/repairs/[id]/invoice-preview/route.ts` | api_route | /api/repairs/[id]/invoice-preview | 30 | 0 | not_verified |
| `src/app/api/repairs/[id]/invoice/route.ts` | api_route | /api/repairs/[id]/invoice | 30 | 0 | not_verified |
| `src/app/api/repairs/[id]/items/[itemId]/remove/route.ts` | api_route | /api/repairs/[id]/items/[itemId]/remove | 15 | 0 | not_verified |
| `src/app/api/repairs/[id]/items/route.ts` | api_route | /api/repairs/[id]/items | 30 | 0 | not_verified |
| `src/app/api/repairs/[id]/journey/route.ts` | api_route | /api/repairs/[id]/journey | 16 | 0 | not_verified |
| `src/app/api/repairs/[id]/notes/route.ts` | api_route | /api/repairs/[id]/notes | 16 | 42 | not_verified |
| `src/app/api/repairs/[id]/postal/route.ts` | api_route | /api/repairs/[id]/postal | 30 | 0 | not_verified |
| `src/app/api/repairs/[id]/qc/route.ts` | api_route | /api/repairs/[id]/qc | 31 | 41 | not_verified |
| `src/app/api/repairs/[id]/reveal-security/route.ts` | api_route | /api/repairs/[id]/reveal-security | 30 | 0 | not_verified |
| `src/app/api/repairs/[id]/settle/route.ts` | api_route | /api/repairs/[id]/settle | 30 | 0 | not_verified |
| `src/app/api/repairs/[id]/start/route.ts` | api_route | /api/repairs/[id]/start | 32 | 41 | not_verified |
| `src/app/api/repairs/[id]/status/route.ts` | api_route | /api/repairs/[id]/status | 31 | 41 | not_verified |
| `src/app/api/repairs/[id]/time/route.ts` | api_route | /api/repairs/[id]/time | 32 | 41 | not_verified |
| `src/app/api/repairs/assign/route.ts` | api_route | /api/repairs/assign | 32 | 42 | not_verified |
| `src/app/api/repairs/assignment/route.ts` | api_route | /api/repairs/assignment | 31 | 42 | not_verified |
| `src/app/api/repairs/available/route.ts` | api_route | /api/repairs/available | 31 | 42 | not_verified |
| `src/app/api/repairs/bulk/route.ts` | api_route | /api/repairs/bulk | 31 | 0 | not_verified |
| `src/app/api/repairs/claim/route.ts` | api_route | /api/repairs/claim | 15 | 42 | not_verified |
| `src/app/api/repairs/queue/route.ts` | api_route | /api/repairs/queue | 32 | 42 | not_verified |
| `src/app/api/repairs/route.ts` | api_route | /api/repairs | 31 | 42 | not_verified |
| `src/app/api/repairs/technicians/route.ts` | api_route | /api/repairs/technicians | 32 | 42 | not_verified |
| `src/app/api/repairs/transfers/route.ts` | api_route | /api/repairs/transfers | 30 | 0 | not_verified |
| `src/app/api/repairs/workflow/route.ts` | api_route | /api/repairs/workflow | 15 | 42 | not_verified |
| `src/app/api/report-builder/route.ts` | api_route | /api/report-builder | 14 | 0 | not_verified |
| `src/app/api/reports/iran/route.ts` | api_route | /api/reports/iran | 31 | 0 | not_verified |
| `src/app/api/returns/route.ts` | api_route | /api/returns | 33 | 0 | not_verified |
| `src/app/api/sales/[id]/route.ts` | api_route | /api/sales/[id] | 14 | 0 | not_verified |
| `src/app/api/sales/route.ts` | api_route | /api/sales | 30 | 0 | not_verified |
| `src/app/api/search/route.ts` | api_route | /api/search | 14 | 0 | not_verified |
| `src/app/api/serials/route.ts` | api_route | /api/serials | 14 | 0 | not_verified |
| `src/app/api/service-credits/route.ts` | api_route | /api/service-credits | 32 | 0 | not_verified |
| `src/app/api/services/route.ts` | api_route | /api/services | 14 | 0 | not_verified |
| `src/app/api/settings/flags/route.ts` | api_route | /api/settings/flags | 14 | 0 | not_verified |
| `src/app/api/settings/repair-workflow/route.ts` | api_route | /api/settings/repair-workflow | 15 | 42 | not_verified |
| `src/app/api/settings/route.ts` | api_route | /api/settings | 14 | 0 | not_verified |
| `src/app/api/suppliers/[id]/purchase-list/convert/route.ts` | api_route | /api/suppliers/[id]/purchase-list/convert | 31 | 0 | not_verified |
| `src/app/api/suppliers/[id]/purchase-list/excel/route.ts` | api_route | /api/suppliers/[id]/purchase-list/excel | 14 | 0 | not_verified |
| `src/app/api/suppliers/[id]/purchase-list/route.ts` | api_route | /api/suppliers/[id]/purchase-list | 14 | 0 | not_verified |
| `src/app/api/suppliers/purchase-list/[itemId]/route.ts` | api_route | /api/suppliers/purchase-list/[itemId] | 14 | 0 | not_verified |
| `src/app/api/suppliers/route.ts` | api_route | /api/suppliers | 15 | 41 | not_verified |
| `src/app/api/system/database/route.ts` | api_route | /api/system/database | 14 | 0 | not_verified |
| `src/app/api/team/permissions/route.ts` | api_route | /api/team/permissions | 14 | 0 | not_verified |
| `src/app/api/track/estimate/route.ts` | api_route | /api/track/estimate | 31 | 0 | not_verified |
| `src/app/api/track/message/route.ts` | api_route | /api/track/message | 0 | 0 | not_verified |
| `src/app/api/track/verify/route.ts` | api_route | /api/track/verify | 15 | 0 | not_verified |
| `src/app/api/users/[id]/route.ts` | api_route | /api/users/[id] | 14 | 0 | not_verified |
| `src/app/api/users/route.ts` | api_route | /api/users | 14 | 0 | not_verified |
| `src/app/api/warranties/claims/route.ts` | api_route | /api/warranties/claims | 14 | 0 | not_verified |
| `src/app/api/warranties/route.ts` | api_route | /api/warranties | 14 | 0 | not_verified |
| `scripts/audit-network-dependencies.cjs` | command_tool | — | 0 | 0 | not_verified |
| `scripts/backup-encrypted.ts` | command_tool | — | 11 | 0 | not_verified |
| `scripts/backup.ts` | command_tool | — | 11 | 0 | not_verified |
| `scripts/bootstrap.ts` | command_tool | — | 30 | 0 | not_verified |
| `scripts/build-database-tools.cjs` | command_tool | — | 0 | 0 | not_verified |
| `scripts/create-migration-snapshot.ts` | command_tool | — | 3 | 0 | not_verified |
| `scripts/deployment-operations.ts` | command_tool | — | 36 | 0 | not_verified |
| `scripts/load-test.cjs` | command_tool | — | 0 | 0 | not_verified |
| `scripts/migrate-attachments.ts` | command_tool | — | 5 | 0 | not_verified |
| `scripts/migrate-postgres.ts` | command_tool | — | 8 | 39 | not_verified |
| `scripts/network-isolation.cjs` | command_tool | — | 1 | 0 | not_verified |
| `scripts/package-offline.cjs` | command_tool | — | 0 | 0 | not_verified |
| `scripts/port-postgres-ledger.ts` | command_tool | — | 2 | 9 | not_verified |
| `scripts/postgres-http-acceptance.ts` | command_tool | — | 8 | 49 | not_verified |
| `scripts/prepare-recovery.ts` | command_tool | — | 5 | 0 | not_verified |
| `scripts/profile-database.ts` | command_tool | — | 8 | 0 | not_verified |
| `scripts/recovery-set.ts` | command_tool | — | 14 | 0 | not_verified |
| `scripts/rehearse-postgres.ts` | command_tool | — | 2 | 4 | not_verified |
| `scripts/restore-backup.ts` | command_tool | — | 2 | 0 | not_verified |
| `scripts/rotate-credentials.ts` | command_tool | — | 10 | 0 | not_verified |
| `scripts/scheduled-backup.ts` | command_tool | — | 14 | 0 | not_verified |
| `scripts/server-smoke.cjs` | command_tool | — | 0 | 0 | not_verified |
| `scripts/test-environment.cjs` | command_tool | — | 0 | 0 | not_verified |
| `scripts/test-postgres.ts` | command_tool | — | 0 | 3 | not_verified |
| `scripts/ui-smoke.cjs` | command_tool | — | 0 | 0 | not_verified |
| `scripts/verify-postgres.ts` | command_tool | — | 2 | 4 | not_verified |
| `deploy.sh` | deployment_script | — | 39 | 0 | not_verified |
| `deploy/install-vps.sh` | deployment_script | — | 0 | 0 | not_verified |
| `deploy/wizard/address.sh` | deployment_script | — | 0 | 0 | not_verified |
| `deploy/wizard/core.sh` | deployment_script | — | 0 | 0 | not_verified |
| `deploy/wizard/git-askpass.sh` | deployment_script | — | 0 | 0 | not_verified |
| `deploy/wizard/install.sh` | deployment_script | — | 39 | 0 | not_verified |
| `deploy/wizard/proxy.sh` | deployment_script | — | 0 | 0 | not_verified |
| `deploy/wizard/reinstall.sh` | deployment_script | — | 39 | 0 | not_verified |
| `deploy/wizard/releases.sh` | deployment_script | — | 38 | 0 | not_verified |
| `install.sh` | deployment_script | — | 39 | 0 | not_verified |
| `manage.sh` | deployment_script | — | 39 | 0 | not_verified |
| `scripts/network-isolation-linux.sh` | deployment_script | — | 0 | 0 | not_verified |
| `scripts/wizard-linux-acceptance.sh` | deployment_script | — | 36 | 0 | not_verified |
| `setup.sh` | deployment_script | — | 39 | 0 | not_verified |
| `src/app/appointments/page.tsx` | page | /appointments | 33 | 41 | not_verified |
| `src/app/audit/page.tsx` | page | /audit | 33 | 41 | not_verified |
| `src/app/bank/page.tsx` | page | /bank | 33 | 41 | not_verified |
| `src/app/calendar/page.tsx` | page | /calendar | 33 | 41 | not_verified |
| `src/app/chat/page.tsx` | page | /chat | 32 | 41 | not_verified |
| `src/app/checks/page.tsx` | page | /checks | 33 | 41 | not_verified |
| `src/app/communication/page.tsx` | page | /communication | 33 | 41 | not_verified |
| `src/app/complaints/page.tsx` | page | /complaints | 33 | 41 | not_verified |
| `src/app/customers/[id]/page.tsx` | page | /customers/[id] | 33 | 41 | evidence_source_changed |
| `src/app/customers/[id]/statement/page.tsx` | page | /customers/[id]/statement | 34 | 41 | not_verified |
| `src/app/customers/new/page.tsx` | page | /customers/new | 32 | 41 | evidence_source_changed |
| `src/app/customers/page.tsx` | page | /customers | 33 | 41 | evidence_source_changed |
| `src/app/daily-report/page.tsx` | page | /daily-report | 34 | 41 | not_verified |
| `src/app/devices/[id]/page.tsx` | page | /devices/[id] | 33 | 41 | not_verified |
| `src/app/devices/new/page.tsx` | page | /devices/new | 32 | 41 | not_verified |
| `src/app/devices/page.tsx` | page | /devices | 33 | 41 | not_verified |
| `src/app/estimates/[id]/page.tsx` | page | /estimates/[id] | 33 | 41 | not_verified |
| `src/app/estimates/page.tsx` | page | /estimates | 33 | 41 | not_verified |
| `src/app/expenses/new/page.tsx` | page | /expenses/new | 32 | 41 | not_verified |
| `src/app/expenses/page.tsx` | page | /expenses | 33 | 41 | not_verified |
| `src/app/finance/accounting/page.tsx` | page | /finance/accounting | 32 | 41 | not_verified |
| `src/app/finance/page.tsx` | page | /finance | 34 | 41 | not_verified |
| `src/app/installments/page.tsx` | page | /installments | 33 | 41 | not_verified |
| `src/app/inventory-tools/page.tsx` | page | /inventory-tools | 33 | 41 | not_verified |
| `src/app/invoices/[id]/page.tsx` | page | /invoices/[id] | 33 | 41 | not_verified |
| `src/app/invoices/new/page.tsx` | page | /invoices/new | 32 | 41 | not_verified |
| `src/app/invoices/page.tsx` | page | /invoices | 33 | 41 | not_verified |
| `src/app/labels/page.tsx` | page | /labels | 33 | 41 | not_verified |
| `src/app/login/page.tsx` | page | /login | 33 | 41 | evidence_source_changed |
| `src/app/outbox/page.tsx` | page | /outbox | 33 | 41 | not_verified |
| `src/app/page.tsx` | page | / | 33 | 41 | not_verified |
| `src/app/parts/[id]/page.tsx` | page | /parts/[id] | 33 | 41 | not_verified |
| `src/app/parts/new/page.tsx` | page | /parts/new | 32 | 41 | not_verified |
| `src/app/parts/page.tsx` | page | /parts | 33 | 41 | not_verified |
| `src/app/payments/credit/page.tsx` | page | /payments/credit | 33 | 41 | not_verified |
| `src/app/payments/new/page.tsx` | page | /payments/new | 32 | 41 | not_verified |
| `src/app/payments/page.tsx` | page | /payments | 33 | 41 | not_verified |
| `src/app/payroll/corrections/page.tsx` | page | /payroll/corrections | 35 | 41 | not_verified |
| `src/app/payroll/page.tsx` | page | /payroll | 33 | 41 | not_verified |
| `src/app/pos/page.tsx` | page | /pos | 33 | 41 | not_verified |
| `src/app/purchase-orders/[id]/page.tsx` | page | /purchase-orders/[id] | 33 | 41 | not_verified |
| `src/app/purchase-orders/new/page.tsx` | page | /purchase-orders/new | 32 | 41 | not_verified |
| `src/app/purchase-orders/page.tsx` | page | /purchase-orders | 33 | 41 | not_verified |
| `src/app/repairs/[id]/page.tsx` | page | /repairs/[id] | 34 | 43 | not_verified |
| `src/app/repairs/[id]/receipt/page.tsx` | page | /repairs/[id]/receipt | 34 | 41 | not_verified |
| `src/app/repairs/assignment/page.tsx` | page | /repairs/assignment | 32 | 41 | not_verified |
| `src/app/repairs/board/page.tsx` | page | /repairs/board | 33 | 41 | not_verified |
| `src/app/repairs/bulk/page.tsx` | page | /repairs/bulk | 33 | 41 | not_verified |
| `src/app/repairs/group-receipt/[gid]/page.tsx` | page | /repairs/group-receipt/[gid] | 34 | 41 | not_verified |
| `src/app/repairs/new/page.tsx` | page | /repairs/new | 32 | 41 | not_verified |
| `src/app/repairs/page.tsx` | page | /repairs | 33 | 42 | not_verified |
| `src/app/repairs/queue/page.tsx` | page | /repairs/queue | 32 | 41 | not_verified |
| `src/app/repairs/quick/page.tsx` | page | /repairs/quick | 32 | 41 | not_verified |
| `src/app/report-builder/page.tsx` | page | /report-builder | 33 | 41 | not_verified |
| `src/app/reports/iran/page.tsx` | page | /reports/iran | 32 | 41 | not_verified |
| `src/app/reports/page.tsx` | page | /reports | 34 | 41 | not_verified |
| `src/app/reports/vat/page.tsx` | page | /reports/vat | 33 | 41 | not_verified |
| `src/app/returns/page.tsx` | page | /returns | 32 | 41 | not_verified |
| `src/app/returns/services/page.tsx` | page | /returns/services | 32 | 41 | not_verified |
| `src/app/serials/page.tsx` | page | /serials | 33 | 41 | not_verified |
| `src/app/settings/page.tsx` | page | /settings | 33 | 41 | not_verified |
| `src/app/settings/repair-workflow/page.tsx` | page | /settings/repair-workflow | 32 | 41 | not_verified |
| `src/app/suppliers/[id]/page.tsx` | page | /suppliers/[id] | 33 | 41 | not_verified |
| `src/app/suppliers/new/page.tsx` | page | /suppliers/new | 32 | 41 | not_verified |
| `src/app/suppliers/page.tsx` | page | /suppliers | 33 | 41 | not_verified |
| `src/app/tariffs/page.tsx` | page | /tariffs | 32 | 41 | not_verified |
| `src/app/team/page.tsx` | page | /team | 33 | 41 | not_verified |
| `src/app/track/[token]/page.tsx` | page | /track/[token] | 34 | 41 | not_verified |
| `src/app/track/estimate/[token]/page.tsx` | page | /track/estimate/[token] | 33 | 41 | not_verified |
| `src/app/track/page.tsx` | page | /track | 32 | 41 | not_verified |
| `src/app/warranty/page.tsx` | page | /warranty | 33 | 41 | not_verified |
| `src/app/login/page.tsx` | server_action | login | 33 | 41 | evidence_source_changed |

## Reviewed isolated scope

[PostgreSQL CI run42119920640](https://github.com/Cat-Ghost-Community/1beng/actions/runs/42119920640) passed native66 tests and13 actual HTTP/browser check groups at code commit `74e76ed140a6daebb090cd0874811298f9b4f665`. Source-bound records accept only auth login/logout/password, customer collection GET/POST, customer-id GET, website health, root layout, login/customer SSR pages and the login server action. Customer-id POST remains **not_verified**; lookup/merge/financial modules and every other route receive no acceptance claim. The native schema/migration and authentication foundations exist; remaining concerns below describe their application-wide completion. Acceptance means a disposable loopback integration, never production cutover or customer-host certification. Later changes to a reviewed entrypoint, its runtime/framework dependencies or configuration invalidate that record.

## Explicit limits

- Graph is module-level, not a function-sensitive execution proof; unused imports and mutually exclusive engine branches remain conservatively reachable.
- Nonliteral imports/requires, computed paths, runtime-generated SQL and dependency injection cannot be resolved statically; listed explicitly.
- Literal HTTP references are reference hints, not proof of requested methods, authentication, successful browser execution or full dynamic URL coverage.
- External packages/assets are recorded but their internal graphs are not traversed. Symlinked input files/directories are excluded.
- Shell imports/tool dispatch and createRequire bases are recognized only for explicit managed patterns; native systemd and shell behavior still need actual-host tests.
- SQLite/PG reachability and test counts are dependency metrics, not defect counts or a migration completion percentage.

## Remaining migration concerns

1. Extend the implemented/verified native schema and versioned-migration foundation to full view/default/unique/CHECK/trigger semantics for every remaining domain.
2. Extend the implemented/verified async auth/session and customer SSR/HTTP slice to the remaining application without hidden synchronous SQLite calls.
3. Financial command services and immutable source-to-ledger/obligation invariants.
4. Operational services: inventory, repair, purchasing, returns and other existing modules.
5. Authoritative reports, statements, pagination, exports/imports and reconciliation.
6. Background operations, installer/health and native PostgreSQL backup/object recovery.
7. Reviewed cutover rehearsal, source preservation, sessions, audit and recovery plan.
8. Application-wide PostgreSQL HTTP/browser/security/concurrency/failure/workload acceptance beyond the explicitly verified isolated slice.

These concerns describe separate work boundaries; they are not estimates of effort or a promise of complete commercial accounting. Protected historical approvals and customer-target operation acceptance remain separate.
