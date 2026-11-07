> Imported engineering context: historical source/CI references belong to the legacy repository. Current new-repository status and validation: [REPOSITORY_SETUP.md](REPOSITORY_SETUP.md). This import does not complete remaining production gates.

# PostgreSQL operational coverage

<!-- M9_STATUS_START -->
## M9 current-source checkpoint (2026-11-07)

Current machine ledger:121 persisted tables, including110 canonical and11 native tables.39 canonical tables remain schema-only/unported;62 API files remain unported or unverified. M9 connects six original technical repair API files. These counts do not certify complete workflows or estimate remaining effort. Current authority: `docs/postgres-operations-coverage.json`; detailed boundary and acceptance evidence: [M9 checkpoint](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/POSTGRES_M9_TECHNICAL_WORK_CHECKPOINT.md). Earlier M8 entries below describe that historical source.


Current verification: Runtime source9dbaee41ca0b1e42fc90813a86400bab6564b16d: CI42313819753 verify and postgres-acceptance jobs passed. Actual PostgreSQL215/215; Linux application regressions454/454; optimized production HTTP/browser48 groups; typecheck/build/source inventory/security audit passed; lint0 errors/124 warnings. Windows optimized HTTP/browser48 groups also passed, with523 runtime/config files independently matching current source. Windows full native run encountered57014 during timeout/restore-cleanup fixtures and is not certified; CI PostgreSQL restore rehearsal passed. Target-host production acceptance and full Prompt03 remain incomplete. [Exact CI evidence](https://github.com/Cat-Ghost-Community/1beng/actions/runs/42313819753). All three CI jobs passed, including existing Linux SQLite installer/update/rollback/recovery acceptance. This does not certify a production PostgreSQL installer or target host.
<!-- M9_STATUS_END -->


**NOT READY FOR PRODUCTION. Master Prompt03 and02 remain INCOMPLETE.**

M8 source review,2026-11-07. Every persisted table/API route family is enumerated below and every route has a JSON record. Foundation, native primitive, source command, HTTP, UI and complete financial workflow remain distinct. No tests authorize historical corrections, real policies or live cutover.

Scope: **110 canonical +10 native additions =120 persisted tables;122 API files /189 explicit handlers /49 families.** AST730 inputs/71 pages/3396 runtime edges/164 type-only edges/0 unresolved;230 normalized reviewed fingerprints. Counts describe scope, never completion percentage. Fingerprints do not certify execution.

## Current evidence and limits

- Exact runtime d00923d: [CI42303488350](https://github.com/Cat-Ghost-Community/1beng/actions/runs/42303488350) all three jobs PASS. PostgreSQL206/206; Linux453/453; actual production HTTP/browser46; types/build/inventory/audit PASS; lint0errors/125warnings.
- Focused notes7 and workflow11 reported PASS; finance lock-order plus existing regressions16/16 PASS, auth parity9/9 PASS. These overlap and are not a full-suite total.
- Browser acceptance verified the actual201-technician primary/helper selector, three mode explanations, confirmed settings/assignment, private notes, branch isolation and lost committed-response retry. Current local PostgreSQL is unavailable; CI used a real disposable PostgreSQL18.4 service. Latest full Windows parity remains unverified.
- Historical M7 [d6d83f2 CI42162260087](https://github.com/Cat-Ghost-Community/1beng/actions/runs/42162260087):PG185/Linux450/HTTP42 passed. Historical local Windows448/448 and original109 projections/schema/disputed case preservation remain recorded in JSON. Those results do not certify changed M8 runtime.
- Seven retained M1-7 checksums are independently recorded in `tests/fixtures/postgres-m7-checksums.json`; latest fresh migration asserts them. No historical SQL rewrite or customer-data migration is authorized.
- Source hashes are SHA256 after CRLF-to-LF normalization; current M8 AST and fingerprints are refreshed. Machine reviewed acceptances remain0 after shared source changes. Final CI does not imply whole-product readiness.
- Existing20k synthetic notification EXPLAIN:0.109ms short-history index,0.022ms ordered long-history index; no enterprise/target-capacity claim.

## Source and UI boundaries

| Group | Source state | UI boundary | Remaining gap |
| --- | --- | --- | --- |
| authentication | native_foundation_partial_operations | auth_ui_implemented_other_admin_unported | Login/session/permission enforcement implemented; employee administration, role changes, employment transitions and team UI are not fully ported. |
| infrastructure | native_infrastructure | not_ported | Shared identity/audit/migration infrastructure is not business-workflow completion. Production roles/cutover/target recovery remain unverified. |
| customer_profiles | operational_slice_implemented | list_create_profile_edit_merge_history_browser_verified_blacklist_archive_api_only | Native list/create/read/update/archive/blacklist plus controlled same-branch merge and alias-history read implemented. Only nonfinancial/nonoperational SOURCE can merge; established TARGET finances unchanged. NULL ownership/shared profiles remain controlled. Financial/repair-linked source correction and populated legacy merge evidence migration remain blocked; complete statements still unported. |
| branches | operational_slice_implemented | header_scope_implemented_management_ui_unported | Scoped list and company-manager create/update API supported; settings-management UI and deactivate/transfer lifecycle remain unported. |
| device_profiles | operational_slice_implemented | list_new_detail_browser_verified_scoped_history_native_verified | List/create/detail/scoped history plus check/blacklist/reminder services implemented. Complete device edit/archive and repair lifecycle remain unported; support-page UI acceptance pending. |
| supplier_directory | operational_slice_implemented | unported | Central directory list/create API supported. Purchase-list conversion/import/export, directory UI, supplier statements and update/archive parity remain unported. |
| notifications | operational_slice_implemented | actual_http_and_header_browser_verified | Own-recipient scoped list/mark with immutable durable operations implemented. Producer scope includes manager low-stock, native internal-chat, and exact assignment notification source proofs; arbitrary/customer notifications remain blocked. Full future nonchat producers and target capacity/recovery unverified. |
| accounting_core | native_financial_slice | financial_pages_unported | Chart/period/manual/source journals and bounded ledger statements supported. Business reconciliation/cases/opening commands and financial screen parity remain incomplete. |
| recognition_policy | native_financial_slice | not_ported | Prospective policy services exist; only legitimately approved policies may post. Real opening/policy approvals absent; no historical backfill authorized. |
| opening_cutover | foundation_or_primitive_only | not_ported | Dump/restore primitive exists. Complete propose/independent approve/rehearse/apply business workflow, opening native guards and reviewed cutover remain incomplete; command safely blocked. |
| invoice_receipt | native_financial_slice | unported | Invoice/receipt/documentary refund services plus authoritative actual repair issue-cost snapshot/hash implemented. Eligible source-linked repair/sale reuses original active invoice across different keys/actors/processes; ambiguous legacy duplicates stay unchanged409. Source-linked INSERT requires READ COMMITTED (55000 under REPEATABLE READ/SERIALIZABLE); standalone drafts unaffected. No quote/catalog cost substituted, no duplicate physical issue, no fabricated WIP journal. Full POS, return/credit-note, repair billing/finalization/commission and financial UI acceptance remain incomplete. Known Cancelled repair rejects409 before draft creation or existing-invoice acknowledgement; direct native INSERT rejects23514. Original cancelled-source documents/evidence are retained. M8 corrects actor/session -> customer funds -> source/invoice/payment lock ordering, revalidates identity after waiting and reroutes advances after invoice creation; no supplier policy or historical journal rewrite. |
| installments | native_financial_slice | unported | Versioned approval/verified receipt settlement supported. Complete return/credit-note native workflow and UI acceptance remain incomplete. |
| customer_credit | native_financial_slice | unported | Independent allocation/reversal/documentary refund supported. Full return-credit origin lifecycle and remaining statements/UI remain incomplete. |
| bank_cheques | native_financial_slice | unported | Native bank/paired transfer/cheque create-deposit-pass-bounce supported; unsupported spend and unproven baselines blocked. Provider execution, broad banking UI/reconciliation/import parity remain unverified. |
| expenses | native_financial_slice | unported | Documentary expense/source/accounting path supported; provider execution and full expense UI acceptance not certified. |
| purchasing | native_financial_slice | unported | Unadjusted partial receipts/invoice/payment supported. Adjusted partial freight/discount/tax allocation needs approved rule; supplier returns/purchase-list/UI remain unported. |
| inventory | shared_native_primitive_partial_workflow | unported | Exact shared movement primitive supported. Standalone stock API/tools/transfers/adjustments/imports, full carrying-policy lifecycle, historical valuation cutover and control-account reconciliation not fully accepted. |
| settings | foundation_read_partial | not_ported | Currency/shell settings and separate versioned repair-workflow settings slice supported. General settings/flags, integrations and administration UI/mutations remain unported. |
| employment_grant_revocation | partial_native_employment_and_controlled_grants | workflow_settings_implemented_current_browser_pending | Employment changes revoke prior supervisor grants permanently with audit; controlled owner/admin workflow configuration grants/revokes current branch employees with immutable history. General employee administration and all employment transitions remain incomplete. |
| controlled_merge | operational_slice_implemented | actual_http_and_profile_edit_merge_history_browser_verified | Native immutable evidence/alias history, same-branch nonfinancial source, exact device-only exception, original event authorship, sorted funds/customer row locks and merged-reference guards implemented. Financial/draft/repair source references and populated legacy merge_log remain explicitly blocked; no accounting identities rewritten. |
| device_support | operational_slice_implemented | existing_blacklist_component_adapted_full_support_page_acceptance_pending | Scoped serial/IMEI check, blacklist create/revoke with immutable original registry, reminder list/set and durable source proofs implemented and actual API checks passed. Broader device edit/archive/repair workflows remain unported. Separate blacklist/reminder page reachability and SSR/browser journeys are not certified. |
| internal_chat | operational_slice_implemented | actual_http_internal_chat_page_attachment_browser_verified | Native internal-only organizational chat covers all10 existing API files and /chat page, current employment/branch/membership checks, history/search/events, uploads/attachments and proven notification production. Exact local HTTP/browser checks passed; no customer-facing chat enabled. Production target storage/off-host recovery/cutover remains unverified. |
| appointments | operational_slice_implemented | actual_http_and_existing_appointments_browser_verified_assigned_conversion_blocked | Scoped appointment list/create/update/selectors and immutable history/conversion links implemented. Unassigned conversion delegates native single repair intake. Assigned conversion remains independently blocked409; the new assignment engine is not automatically an appointment-conversion integration; no fake assignment or silently ignored technician. |
| complaints | operational_slice_implemented | actual_http_and_documentary_complaints_browser_verified | Native scoped documentary list/create/read/update/selectors with current employment checks, audit/idempotency implemented. Resolution is documentary, not a refund/payment execution or accounting correction. Complete financial complaint remedies remain outside this slice. |
| repair_intake_read | bounded_intake_and_read_only_slice | single_intake_and_read_workspace_plus_restricted_notes_assignment_current_browser_pending | Native unassigned single intake/cash source and scoped exact-cost/redacted reads remain supported. M8 separately adds controlled assignment/helper/claim, queues and append-only notes. Full diagnosis/status/QC/time tracking/grouped intake/cancellation/WIP/delivery/commission and stock mutations remain unported; assigned appointment conversion stays a separate explicit409 boundary. |
| repair_status_reference | read_only_reference_with_reviewed_defaults | read_only_in_repair_list_detail | Existing reference statuses preserved; reviewed original defaults initialize an empty system during migration. Ordinary status-definition INSERT/UPDATE/DELETE/TRUNCATE remain fenced. Reference seeding is not a native repair state-transition workflow. |
| repair_workflow | bounded_assignment_workflow_implemented | existing_assignment_queue_and_standalone_workflow_settings_implemented_browser_pending | Versioned legacy/managed/shared modes; owner/admin config, current supervisors, primary/helper assignment, claim, bounded queues, explicit timer handover and real source-proven notifications implemented. Exact assignment/version durable proof, current replay authority, active branch, field immutability and startup verifier enforced. Full technical work, timers, diagnosis/status/QC/cancellation/WIP/delivery and full repair financial lifecycle are unported. |
| repair_notes | append_only_operational_slice_implemented | existing_repair_workspace_notes_and_bounded_search_implemented_browser_pending | Append-only persisted notes, private/internal/public visibility, exact audit/durable proof and current assigned-only replay authorization supported. Added nullable BIGINT branch provenance without rewriting old note history. No attachment, diagnosis, QC, ticket status or stock mutation added. |

Native additions: `_repaid_migrations`, `pg_appointment_history`, `pg_chat_notification_sources`, `pg_device_blacklist_revocations`, `pg_notification_operations`, `pg_purchase_receipt_lines`, `pg_repair_assignment_notices`, `pg_repair_assignment_proofs`, `pg_repair_supervisor_history`, `pg_repair_workflow_history`.

## Critical operational and accounting boundary

M8 enables controlled three-mode routing, versioned independent company configuration, primary/helper assignment, self-claim in shared mode, scoped paginated queues, current supervisor grants, exact immutable assignment/audit/durable-operation proof and genuine assignment notifications. Replay rechecks current authority/object visibility. Existing settings/assignment/queue design is reused; current-source browser acceptance remains pending.

Notes are append-only with current branch/assignment/privacy checks and bounded search in the existing workspace. Nullable BIGINT branch provenance preserves original NULL history; no backfill. `time_entries` supports only assignment handover closure, not general timer start/pause/resume. Full diagnosis, status/QC, cancellation/WIP, physical parts, delivery and compensation lifecycle remain unported. Assigned appointment conversion remains independently blocked409 until its actual bridge is verified.

Finance lock-order correction serializes customer funds before source/invoice/payment locks, rechecks immutable ownership after waiting and routes delayed advances to the committed invoice. Distinct-actor/pool tests observe actual advisory waits; failed refund audit rolls back, retry/replay preserves exact balances. No accounting policy, supplier policy, WIP recognition or posted history was fabricated.

## Every persisted table

| Table | Group | State |
| --- | --- | --- |
| _repaid_migrations | infrastructure | native_infrastructure |
| accounting_accounts | accounting_core | native_financial_slice |
| accounting_automatic_postings | recognition_policy | native_financial_slice |
| accounting_cutover | opening_cutover | foundation_or_primitive_only |
| accounting_event_reviews | accounting_core | native_financial_slice |
| accounting_events | accounting_core | native_financial_slice |
| accounting_journal_voids | accounting_core | native_financial_slice |
| accounting_journals | accounting_core | native_financial_slice |
| accounting_lines | accounting_core | native_financial_slice |
| accounting_opening_documents | opening_cutover | foundation_or_primitive_only |
| accounting_opening_event_links | opening_cutover | foundation_or_primitive_only |
| accounting_periods | accounting_core | native_financial_slice |
| accounting_recognition_policies | recognition_policy | native_financial_slice |
| appointments | appointments | operational_slice_implemented |
| audit_logs | infrastructure | native_infrastructure |
| backup_downloads | unported | schema_only_unported |
| backup_preparations | unported | schema_only_unported |
| backups | unported | schema_only_unported |
| bank_accounts | bank_cheques | native_financial_slice |
| bank_transactions | bank_cheques | native_financial_slice |
| branch_repair_workflows | repair_workflow | bounded_assignment_workflow_implemented |
| branches | branches | operational_slice_implemented |
| business_return_lines | unported | schema_only_unported |
| business_returns | unported | schema_only_unported |
| chat_attachments | internal_chat | operational_slice_implemented |
| chat_conversations | internal_chat | operational_slice_implemented |
| chat_events | internal_chat | operational_slice_implemented |
| chat_members | internal_chat | operational_slice_implemented |
| chat_mentions | internal_chat | operational_slice_implemented |
| chat_messages | internal_chat | operational_slice_implemented |
| chat_presence | internal_chat | operational_slice_implemented |
| chat_reactions | internal_chat | operational_slice_implemented |
| chat_typing | internal_chat | operational_slice_implemented |
| checks | bank_cheques | native_financial_slice |
| commission_approvals | unported | schema_only_unported |
| commission_corrections | unported | schema_only_unported |
| commission_payments | unported | schema_only_unported |
| complaints | complaints | operational_slice_implemented |
| counters | infrastructure | native_infrastructure |
| credit_note_lines | unported | schema_only_unported |
| credit_notes | unported | schema_only_unported |
| customer_credit_operations | customer_credit | native_financial_slice |
| customer_credit_refunds | customer_credit | native_financial_slice |
| customer_events | customer_profiles | operational_slice_implemented |
| customers | customer_profiles | operational_slice_implemented |
| daily_report_versions | unported | schema_only_unported |
| daily_reports | unported | schema_only_unported |
| dashboard_layouts | unported | schema_only_unported |
| device_blacklist | device_support | operational_slice_implemented |
| devices | device_profiles | operational_slice_implemented |
| estimate_items | unported | schema_only_unported |
| estimates | unported | schema_only_unported |
| expenses | expenses | native_financial_slice |
| financial_corrections | unported | schema_only_unported |
| goods_receipts | purchasing | native_financial_slice |
| installment_allocation_reversals | installments | native_financial_slice |
| installment_allocations | installments | native_financial_slice |
| installment_schedule_terms | installments | native_financial_slice |
| installment_schedules | installments | native_financial_slice |
| installments | installments | native_financial_slice |
| intake_answers | unported | schema_only_unported |
| intake_questions | unported | schema_only_unported |
| inventory_locations | inventory | shared_native_primitive_partial_workflow |
| inventory_movements | inventory | shared_native_primitive_partial_workflow |
| inventory_stock | inventory | shared_native_primitive_partial_workflow |
| inventory_transfers | inventory | shared_native_primitive_partial_workflow |
| invoice_items | invoice_receipt | native_financial_slice |
| invoices | invoice_receipt | native_financial_slice |
| login_attempts | authentication | native_foundation_partial_operations |
| merge_log | controlled_merge | operational_slice_implemented |
| message_templates | unported | schema_only_unported |
| messages | unported | schema_only_unported |
| notifications | notifications | operational_slice_implemented |
| operation_receipts | infrastructure | native_infrastructure |
| parts | inventory | shared_native_primitive_partial_workflow |
| payments | invoice_receipt | native_financial_slice |
| payroll_deductions | unported | schema_only_unported |
| payroll_profiles | unported | schema_only_unported |
| payroll_runs | unported | schema_only_unported |
| pg_appointment_history | appointments | operational_slice_implemented |
| pg_chat_notification_sources | internal_chat | operational_slice_implemented |
| pg_device_blacklist_revocations | device_support | operational_slice_implemented |
| pg_notification_operations | notifications | operational_slice_implemented |
| pg_purchase_receipt_lines | purchasing | native_financial_slice |
| pg_repair_assignment_notices | repair_workflow | bounded_assignment_workflow_implemented |
| pg_repair_assignment_proofs | repair_workflow | bounded_assignment_workflow_implemented |
| pg_repair_supervisor_history | repair_workflow | bounded_assignment_workflow_implemented |
| pg_repair_workflow_history | repair_workflow | bounded_assignment_workflow_implemented |
| purchase_order_items | purchasing | native_financial_slice |
| purchase_orders | purchasing | native_financial_slice |
| refunds | invoice_receipt | native_financial_slice |
| repair_assignments | repair_workflow | bounded_assignment_workflow_implemented |
| repair_attachments | unported | schema_only_unported |
| repair_group_receipts | unported | schema_only_unported |
| repair_notes | repair_notes | append_only_operational_slice_implemented |
| repair_status_history | repair_intake_read | bounded_intake_and_read_only_slice |
| repair_statuses | repair_status_reference | read_only_reference_with_reviewed_defaults |
| repair_tariffs | unported | schema_only_unported |
| repair_templates | unported | schema_only_unported |
| repair_tickets | repair_intake_read | bounded_intake_and_read_only_slice |
| repair_workflow_supervisors | employment_grant_revocation | partial_native_employment_and_controlled_grants |
| return_settlements | unported | schema_only_unported |
| sale_items | unported | schema_only_unported |
| sales | unported | schema_only_unported |
| saved_reports | unported | schema_only_unported |
| serialized_parts | unported | schema_only_unported |
| service_credit_documents | unported | schema_only_unported |
| service_credit_lines | unported | schema_only_unported |
| services | unported | schema_only_unported |
| sessions | authentication | native_foundation_partial_operations |
| settings | settings | foundation_read_partial |
| supplier_purchase_items | unported | schema_only_unported |
| suppliers | supplier_directory | operational_slice_implemented |
| ticket_items | unported | schema_only_unported |
| time_entries | repair_workflow | assignment_closure_only |
| tracking_tokens | unported | schema_only_unported |
| user_permissions | authentication | native_foundation_partial_operations |
| users | authentication | native_foundation_partial_operations |
| warranties | unported | schema_only_unported |
| warranty_claims | unported | schema_only_unported |

## Every API route family

| Family | State | Routes |
| --- | --- | --- |
| accounting | partial_or_bounded_slice | /api/accounting |
| appointments | partial_or_bounded_slice | /api/appointments/[id]/convert, /api/appointments/[id], /api/appointments |
| auth | partial_or_bounded_slice | /api/auth/change-password, /api/auth/login, /api/auth/logout |
| backup | unported_or_unverified | /api/backup |
| bank | partial_or_bounded_slice | /api/bank |
| barcode | unported_or_unverified | /api/barcode |
| branches | partial_or_bounded_slice | /api/branches |
| chat | partial_or_bounded_slice | /api/chat/attachments/[id], /api/chat/conversations/[id]/messages, /api/chat/conversations/[id], /api/chat/conversations, /api/chat/events, /api/chat/messages/[id], /api/chat/search, /api/chat/summary, /api/chat/upload, /api/chat/users |
| checks | partial_or_bounded_slice | /api/checks |
| commission-corrections | unported_or_unverified | /api/commission-corrections |
| complaints | partial_or_bounded_slice | /api/complaints/[id], /api/complaints |
| customer-credit | partial_or_bounded_slice | /api/customer-credit |
| customers | partial_or_bounded_slice | /api/customers/[id], /api/customers/lookup, /api/customers/merge, /api/customers |
| daily-reports | unported_or_unverified | /api/daily-reports |
| devices | partial_or_bounded_slice | /api/devices/blacklist, /api/devices/check, /api/devices, /api/devices/service-reminders |
| estimates | unported_or_unverified | /api/estimates/[id]/document |
| expenses | partial_or_bounded_slice | /api/expenses |
| files | unported_or_unverified | /api/files/[id] |
| health | partial_or_bounded_slice | /api/health/ready, /api/health |
| installments | partial_or_bounded_slice | /api/installments |
| intake-questions | unported_or_unverified | /api/intake-questions |
| inventory | unported_or_unverified | /api/inventory/excel, /api/inventory/tools |
| invoices | partial_or_bounded_slice | /api/invoices/[id]/cancel, /api/invoices/[id]/confirm, /api/invoices/[id]/edit, /api/invoices/[id]/payments, /api/invoices/[id], /api/invoices/config, /api/invoices |
| message-templates | unported_or_unverified | /api/message-templates/[id] |
| messages | unported_or_unverified | /api/messages/dispatch, /api/messages/send |
| notifications | partial_or_bounded_slice | /api/notifications |
| parts | unported_or_unverified | /api/parts/[id]/stock, /api/parts/price, /api/parts, /api/parts/search |
| payments | partial_or_bounded_slice | /api/payments/refund, /api/payments |
| payroll | unported_or_unverified | /api/payroll |
| purchase-orders | partial_or_bounded_slice | /api/purchase-orders/[id]/preview, /api/purchase-orders/[id], /api/purchase-orders |
| qr | unported_or_unverified | /api/qr |
| repair-tariffs | unported_or_unverified | /api/repair-tariffs/[id], /api/repair-tariffs |
| repair-templates | unported_or_unverified | /api/repair-templates |
| repairs | partial_or_bounded_slice | /api/repairs/[id]/attachments, /api/repairs/[id]/checklist, /api/repairs/[id]/diagnosis, /api/repairs/[id]/estimate, /api/repairs/[id]/invoice-preview, /api/repairs/[id]/invoice, /api/repairs/[id]/items/[itemId]/remove, /api/repairs/[id]/items, /api/repairs/[id]/journey, /api/repairs/[id]/notes, /api/repairs/[id]/postal, /api/repairs/[id]/qc, /api/repairs/[id]/reveal-security, /api/repairs/[id]/settle, /api/repairs/[id]/start, /api/repairs/[id]/status, /api/repairs/[id]/time, /api/repairs/assign, /api/repairs/assignment, /api/repairs/available, /api/repairs/bulk, /api/repairs/claim, /api/repairs/queue, /api/repairs, /api/repairs/technicians, /api/repairs/transfers, /api/repairs/workflow |
| report-builder | unported_or_unverified | /api/report-builder |
| reports | unported_or_unverified | /api/reports/iran |
| returns | unported_or_unverified | /api/returns |
| sales | unported_or_unverified | /api/sales/[id], /api/sales |
| search | unported_or_unverified | /api/search |
| serials | unported_or_unverified | /api/serials |
| service-credits | unported_or_unverified | /api/service-credits |
| services | unported_or_unverified | /api/services |
| settings | partial_or_bounded_slice | /api/settings/flags, /api/settings/repair-workflow, /api/settings |
| suppliers | partial_or_bounded_slice | /api/suppliers/[id]/purchase-list/convert, /api/suppliers/[id]/purchase-list/excel, /api/suppliers/[id]/purchase-list, /api/suppliers/purchase-list/[itemId], /api/suppliers |
| system | unported_or_unverified | /api/system/database |
| team | unported_or_unverified | /api/team/permissions |
| track | unported_or_unverified | /api/track/estimate, /api/track/message, /api/track/verify |
| users | unported_or_unverified | /api/users/[id], /api/users |
| warranties | unported_or_unverified | /api/warranties/claims, /api/warranties |

Each of the122 API files retains explicit methods, native services/tests, current UI boundary and remaining gap in `docs/postgres-operations-coverage.json`. Source-reviewed native API support is not current-source HTTP/browser acceptance.

## Release gates

- Complete supported returns/credit notes/service credits and compensation workflows
- Complete repair lifecycle/cancellation/WIP and approved inventory carrying integration
- Opening/cutover business commands with genuine independent approvals
- Remaining operational modules, SSR/UI, reports/import/export/background consumers
- Application-wide operational ports and current-source workflow acceptance beyond the bounded locally verified slice
- Reviewed historical data/object migration and eight disputed-case approvals
- Target PostgreSQL least privilege/TLS/storage/full backup-recovery/sustained workloads

Original disputed historical records remain unchanged and require legitimate approvals, verified backup/restoration/rehearsal and explicit application. No real policy approvals, opening balances, corrections or customer cutover were performed.
