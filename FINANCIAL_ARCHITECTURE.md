> **Current database checkpoint - 2026-11-05:** Read [DATABASE_FINALIZATION_STATUS.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/DATABASE_FINALIZATION_STATUS.md). Implemented bounded writer admission, automatic-rollback recovery, verified WAL/FULL/FKs, streamed historical ledger verification, independently verified backup copies and Windows-private backup/restore permissions. 379/379 Windows tests, native PG40/40, typecheck and root/isolated builds pass; financial browsers56+41, UI27, pages36/36, HTTP128/128. Original109 projections and complete original schema unchanged; local data/cache ACLs deliberately tightened. Three-minute 200-user/four-process case still has one BUSY failure; full PostgreSQL operational port and target recovery/deployment remain incomplete. **Database task remains open; NOT READY FOR PRODUCTION.** Earlier entries below are historical.

---

> **Current integration checkpoint - 2026-11-05:** Read [INTEGRATION_CONTINUATION_STATUS.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/INTEGRATION_CONTINUATION_STATUS.md). New confirmed grouped cash intake is atomic with the existing receipt/ledger services; guarded refunds, actual receipt reports and responsive paper/price controls are connected. 358/358 database tests, PG39/39, compiled group-browser41 checks, final typecheck/build pass; lint0 errors/125 warnings. Original109 projections unchanged. Only existing legitimately approved recognition policies post; otherwise pending review. No real historical corrections or approvals. Full PostgreSQL operational port and listed commercial/target gates remain incomplete. **NOT READY FOR PRODUCTION.** Older entries below are historical.

---

> **Current checkpoint — 2026-10-30:** Read [DATABASE_BANKING_STATUS.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/DATABASE_BANKING_STATUS.md). Adds native PostgreSQL bank register guards/services and preserved source snapshots, exact text-to-rial input across existing financial forms, blocked independent bank-transfer recognition, transactional scoped serial registration/proven sale linking and explicit protection against ignored bulk deposits. Live SQLite and original customer records remain unchanged. Latest full pipeline: 350/350 tests /64 suites, typecheck/build pass; PostgreSQL 39/39. Complete PostgreSQL operational/HTTP port, paired bank recognition, group deposits, serialized lifecycle, earlier financial/policy/historical and target-operation gates remain unfinished. **NOT READY FOR PRODUCTION.** Earlier entries below are historical.

---
> **2026-10-30:** Scoped invoice balances now share `invoicePaidExpression` between `netInvoicePaid` and `effective_invoices`; the row-level `invoice_settlements` view retains the same receipts/refunds/credits. This changes query execution, not recognition, monetary units or historical transactions. Native PostgreSQL operations commit existing journal/audit/proof/result together, with no second ledger; full operational/HTTP port remains incomplete. See [DATABASE_COMPLETION_STATUS.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/DATABASE_COMPLETION_STATUS.md).

---

# Customer credit, service corrections and employee recovery — 2026-10-29

The existing ledger remains authoritative. `customer_credit_operations` documents independently approved movements from an original settled receipt; `active_customer_credit` derives un-reversed usage. Shared `invoice_settlements` feeds effective invoices, installment terms, sale caches and statements. Allocating credit creates no cash receipt. Verified remaining-credit refunds atomically reuse the original refund service and record actual cash/journal evidence.

`commission_corrections` and `commission_positions` separate accrued entitlement, documented payouts, corrected payable and recoverable paid excess. Reduction debits unpaid 2030 and/or paid-excess 1320 against the original expense account. Recovery Dr 1000 / Cr 1320 records confirmed cash only; reinstatement offsets an existing claim before restoring liability. Posted history and original branch ownership remain fixed; wage deductions are never inferred.

`service_credit_documents` freezes the original posted revenue source; `service_credit_lines` references original service invoice lines. These extend existing `credit_notes`, installment approval gates and reversal services. Independent manual document approval is required; automatic physical-return templates cannot post a service correction. No physical receipt or stock movement is permitted. Customer credit, refunds and reporting then reuse the same authoritative obligation model.

New nullable `payroll_deductions.branch_id` records prospective financial ownership. Old unknown ownership is retained, never inferred from current employment. See [FINANCIAL_COMPLETION_STATUS.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/FINANCIAL_COMPLETION_STATUS.md) for modified modules and unsupported boundaries.

---

# Proven repair advance allocation — 2026-10-29

`advance_allocation_v1` is a new **proposed / independently approvable** recognition rule: Dr 2010 / Cr 1100 for exact same-ticket cash advances already posted as customer liabilities, after recognition of the repair invoice. New allocation snapshots preserve payment IDs and receipt event IDs. Invoice recognition precedes a transactional retry of allocation posting. Existing cash receipt and original journal remain unchanged; no second cash/revenue event is created. Eligibility excludes refunded, unproven or noncash receipts; unsupported and pre-approval sources remain pending. No historical backfill or real policy approval occurred. Real-database acceptance, limitations and remaining generic credit/correction work: [DEEP_REVIEW_REPAIR_STATUS.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/DEEP_REVIEW_REPAIR_STATUS.md).

---

# V8 current inventory / repair integration

Existing stock tables, transactions, source registry and ledger remain authoritative. Four nullable columns add exact carrying values/pool evidence and immutable source-line identity. Per-warehouse carrying pools conserve integer IRR under the explicitly approved prospective `inventory_carrying_v1` policy; no historical position is guessed into that method. Rounded catalogue unit cost remains reference/display data. Source-line cumulative receipts and original extended issue values supply exact return/transfer costs.

Separate proposed parts-WIP policies post actual consumed parts to 1120, and only remaining documented WIP to 5010 on eligible final billing/ordinary cancellation. Warranty/labor/compensation decisions are not inferred. Cancellation records an immutable source snapshot, preserves receipts/invoices/work, and exposes live pending-review flags. Inventory readers use carrying values and distinguish pending/reversed stock posting from unexplained differences.

Populated credit migration is an offline verified restored-copy rebuild; startup still preserves and blocks nonempty legacy reissue until legitimately migrated. No production swap performed. Actual modules/schema/policy boundaries and open gates: [V8_IMPLEMENTATION_STATUS.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/V8_IMPLEMENTATION_STATUS.md).

---

# V7 current financial integration

Existing ledger/source-event/policy architecture retained. New immutable installment agreements and append-only receipt-to-term allocations use the authoritative original invoice/settled receipts, not cached paid fields. Existing receipt allocation has zero new cash/journal effect; new collection delegates to the existing receipt/posting engine. Explicit independently accepted credit revisions activate atomically with the existing credit journal or its reversal. Two nullable original-table links plus four indexed additive tables; no historical paid cache backfill. See [V7_IMPLEMENTATION_STATUS.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/V7_IMPLEMENTATION_STATUS.md) for invariants, schema, transaction boundaries and release gates. General carrying-value residuals, WIP and legacy populated-credit migration are still incomplete.

---

# Financial architecture - V6 current checkpoint

Existing ledger/stack preserved; 95 tables remain. Five new columns support item quantity precision, immutable return cost/valuation proof, exact extended movement cost and replacement-note lineage. Old source hashes/rows are preserved: new snapshot fields appear only when explicitly recorded. Fresh/empty credit schemas allow multiple immutable versions with one active note and one replacement per reversed note. Populated legacy schemas are not rebuilt automatically.

Supported returns allocate integer original cost by differences of cumulative half-up micro-quantity valuation, and persist before/after proof. Separate v2 policies authorize fractional/restock-cost/depletion recognition; no real policy is enabled. Aggregate-mismatch rounding pools, cross-branch revaluation, general fractional outbound costing and unexplained supplier variance remain blocked/incomplete. This is not a completed universal weighted-cost engine.

Exact implemented contracts, user/API/service/posting/report trace and limitations: [V6_IMPLEMENTATION_STATUS.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/V6_IMPLEMENTATION_STATUS.md). Real original backup/restore and a separate schema rehearsal preserve business fingerprints and pass integrity/foreign-key checks. No historical financial adjustment was applied.

---

# Financial architecture - V5 current implementation

The existing ledger, immutable journals, event snapshots, future-only policies and opening controls are preserved. Five additive return structures bring the application to 95 tables: business_returns, business_return_lines, credit_notes, credit_note_lines and return_settlements. Nullable refund/return evidence fields and customer_events.branch_id preserve old rows without guessing historical links. Startup DDL and effective balance views are transactional.

Credit notes reference original documents; posted unreversed credits change effective obligations, never original invoice totals. Verified settlement comes from original receipts/refunds, not stored paid caches. party_balance_events is the shared operational position source; ledger control accounts remain the financial recognition authority, with discrepancies explicitly reported. Supplier returned-goods claims use asset 1310 (23 chart accounts). Customer cost automation waits for posted credit/independent true-zero approval; eligible cost and credit postings share a transaction.

Detailed actual contracts, account entries and restrictions: [docs/returns-workflow.md](docs/returns-workflow.md). No real policy/opening/correction was activated. P1 is not fully accepted; cross-invoice credits, fractional cost disposition and correction policy gates remain open.

---

# Financial architecture — V4 current implementation

V3's ledger remains authoritative. `accounting-v4-schema.ts` adds four structures (90 application tables total): `accounting_recognition_policies`, `accounting_automatic_postings`, `accounting_opening_documents` and `accounting_opening_event_links`. Startup remains additive/transactional. No old document or journal is rewritten.

`accounting-policy.ts` manages independently approved versioned policies. `accounting-policy-plan.ts` matches five narrow future-only alternatives; unsupported dates, methods, goods/tax cases and unrecognized original obligations remain pending. `accounting.ts` shares private validated writers between manually authorized operations and source-atomic approved execution. Source actor, policy approver and automatic provenance remain distinct. No fake admin session is created. The snapshot's conservative `review_required` label does not determine posting status; immutable review/journal/automatic links do.

`accounting-opening.ts` implements explicit current-day balances, per-party AR/AP and per-item stock checks, independent approval, retained hashed backup, restored-copy rehearsal and exact apply. The core writer uses explicit-connection `auditRecord`; rehearsal writes neither journals nor their audits into the live database. New-business zero needs explicit reviewed declarations; legacy balances are not inferred as zero. Cash/bank/commission statement evidence remains a human acceptance responsibility. Accepted prior events receive immutable opening coverage and cannot be posted again; pre-cutover journal insertion/date editing and ordinary opening reversal are blocked.

Current implementation/test limitations: [V4_CHECKPOINT.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/V4_CHECKPOINT.md). Real approvals: none applied here. Policy semantics: [ACCOUNTING_POLICY_DECISIONS.md](ACCOUNTING_POLICY_DECISIONS.md). **NOT READY FOR PRODUCTION.**

---

## Retained V3 architecture

2026-10-24. **NOT READY FOR PRODUCTION.** The double-entry engine now exists and is tested. Automatic recognition policy, opening balances, complete returns/credit notes and several operational integrations remain unapproved or incomplete.

## Implemented authority and boundaries

The existing Next.js/TypeScript/Tailwind/Node SQLite architecture is retained. Operational documents own physical obligations and settlements; immutable source events reference those documents. Reviewed posted journals are the accounting reporting authority. There is no independently editable financial total or synthetic historical backfill. Operational dashboards remain explicitly operational and are not silently relabelled as complete accounting statements.

`accounting-schema.ts` adds eleven tables (86 application tables total): accounts, periods, journal headers/lines, source events/reviews, immutable cutover metadata, reviewed cache corrections, commission approvals, actual documentary payouts and immutable draft cancellations. Startup applies them inside the existing migration transaction. Revised posting/correction guards are replaced within that same transaction, avoiding stale trigger definitions after an upgrade. Existing business records are preserved.

## Ledger engine

- `accounting.ts`: generic account classifications and normal sides; an explicitly initialized 22-account starting chart; nonoverlapping, immutable period boundaries; draft/post/reverse services; exact integer IRR; bounded line counts; source identities; branch authorization; audit.
- A journal posts only with at least two positive one-sided lines and exactly equal debit/credit totals. Server validation and SQLite guards both enforce this. Draft creation, posting and source-event approval each use synchronous nested transactions.
- `accounting-drafts.ts` edits only unposted manual drafts under an expected-content hash, preserving source identity and auditing old/new lines. Posting also checks the exact reviewed hash at the API boundary. Mistakes can be voided without posting; immutable `accounting_journal_voids` preserves the original draft/reason/actor, blocks later editing/posting and excludes it from unposted-period blockers. No CHECK-table rewrite or deleted financial history is needed.
- Posted headers and lines cannot be edited/deleted through ordinary SQL/application paths. Corrections produce opposite posted journals, reference the original, and preserve its values. Reversal uniqueness and exact inverse lines are checked in SQLite. Closed periods reject posting; owner/admin reopening requires an audited reason. Closing rejects drafts and unreviewed positive events created in that period; it does not certify an approved fiscal cutoff policy.
- Immutable posting sequence and SHA-256 content/previous hashes support full chain verification. Source payload hashes and references are checked too. This is tamper evidence within this deployment, not externally anchored/WORM storage or protection against an administrator who can replace the entire database and code.
- `trialBalance`, `generalLedger` and `financialStatements` read posted/reversed history, include the offsetting reversing journals, use exact accumulation and branch scope, and never count collections as profit. Ledger pagination preserves a journal's same-account lines. Reports state that recognition/opening acceptance remains outstanding.

## Actual operational connections

`accounting-events.ts` captures actual source snapshots and exact control amounts inside payment/refund, invoice confirmation/cancellation, POS, expense, stock, cheque collection, bank-register and commission transactions. Same-ticket advance allocation and consumed-part repair cost recognition have distinct references. Pending cheques and formalization of a linked POS invoice have zero independent posting amount, preventing duplicate settlement/revenue. Cost and allocation events retain their underlying records. A reviewer supplies accounts, date and justification; the approved journal must equal the exact event control amount. Known customer/supplier/employee/part/bank dimensions are carried into relevant control-account lines.

No automatic accrual/cash policy was activated. Deterministic tests explicitly choose accrual mappings for their isolated scenarios; that is not business approval for customer data. Event review atomically persists journal, posting, approval and audit. Original source mutation and its captured event are atomic; subsequent human review is a separate transaction, not falsely claimed to be synchronous automatic posting.

`accounting_cutover` records source ID high-watermarks once. `accounting-reports.ts` identifies newer source documents that bypassed capture and compares current customer/supplier positions and stock valuation with the posted control accounts. It pages parties and reports gaps; it never inserts balancing/opening entries. Starting control mappings are 1100/2010, 2000, 1110, 2030 and 1020. Custom mappings, WIP and external bank reconciliation require further approval/acceptance.

`commission-settlement.ts` separates earned commission, approval and documentary cash disbursement. Approval snapshots amounts/source evidence and disallows self-approval. Partial/full payouts require valid approval, an explicit completed-payment attestation, date/method/reference, exact remaining capacity and durable request protection. Duplicate document references are rejected. Refund/rework or changed eligibility blocks further payout pending reviewed correction; past payouts are retained. No bank transfer/provider execution occurs.

New commission accruals persist the ticket branch in additive nullable `payroll_runs.branch_id`; SQL prevents later reassignment. `payroll-scope.ts` consistently resolves persisted accrual ownership, then approval ownership, then the original ticket. Moving an employee does not move existing payables. Historical ownership is not backfilled from an employee's current branch; unowned legacy runs are blocked for settlement and excluded from scoped branch access pending review. Legacy salary/deduction allocation and mutable historical ticket ownership still need separate acceptance.

## Historical safeguards and interface

`financial-cases.ts` provides record-specific, read-only evidence and proposed treatments. `financial-corrections.ts` implements only the unambiguous derived invoice-paid/status cache correction: independent owner/admin approval, unchanged source fingerprint, independently verified backup, restored-copy rehearsal, explicit application and immutable evidence. It cannot rewrite invoice obligations, fabricate cheque links or dispose of overpayments. No disputed real record was approved/applied here.

`/finance/accounting` and `/api/accounting` provide real chart/period, journal/line inspection, event review, reports, reconciliation and correction controls, using existing Persian RTL styles/components. `/payroll` now records actual payout documents rather than flipping a paid flag. A standalone stock-posted invoice cannot be cancelled to invent a physical return; the missing documented return/credit-note workflow remains a release blocker. Imports, legacy reports/exports, full expense approvals, opening acceptance and complete return/commission corrections are not certified.

---

## V2 historical implementation record

# Financial architecture — V2 implementation checkpoint

Date: 2026-10-24. **NOT READY FOR PRODUCTION.** This describes implemented behavior, not a completed commercial accounting system.

## Actual authority

Next.js App Router / TypeScript / Node 24 SQLite remain unchanged. One business owns multiple internal branches. There is no chart of accounts, general ledger, accounting period, opening-balance approval, immutable journal or trial balance implementation. No historical journals were fabricated. Recognition policy was requested from the business owner and remains unresolved.

Operational documents remain authoritative: `invoices`/`invoice_items` establish invoiced obligations; `sales` establishes POS obligations until a finalized linked invoice takes ownership; `payments` and original-payment-linked `refunds` establish documentary settlements; `checks` records instruments, not immediate settlement. `inventory_stock`/`inventory_movements` own physical stock. `payroll_runs` records commission accrual, not necessarily cash payment. Bank balances remain a separate operational register, linked to payments only through the repaired cheque workflow. This separation is a release blocker, not a second certified accounting ledger.

## Implemented changes

- `src/lib/money.ts`: integer IRR (one rial) storage, BigInt intermediates, exact decimal multiplication/percentage calculation, half-up rounding, safe-integer bounds. Shared invoice totals and delivered-work commission calculations use it. This does not certify every legacy calculation or SQL monetary expression.
- `payment-state.ts`: one settlement predicate and net invoice-payment calculation. Linked cheques count only after `passed`; pending valid instruments reserve invoice capacity. Cheque collection time is persisted for documentary cash reporting. Legacy links/times are not inferred.
- `customer-payments.ts`: shared receipt/refund operations, source/customer/branch consistency, atomic audit and document updates. Linked POS payments/refunds synchronize the original sale and invoice. Unverified online confirmation is rejected.
- `checks.ts`: guarded instrument transitions; incoming collection deposits, issued collection withdraws; terminal collection is retry-safe independently of request keys. Bank movement, invoice state, cheque state and audit commit together. Endorsement/spending without a supplier allocation is explicitly blocked.
- `bank.ts`: centralized transfers commit both legs and audit together; exact amount/type/date/account validation. Cross-branch authority is required because accounts lack operating-branch ownership. Scoped staff can still collect an authorized branch's cheque through its instrument workflow.
- `idempotency.ts`: durable actor/operation/key/payload-hash receipts. Branch-scoped operations include branch identity; centralized bank operations use business scope. Changed payload returns 409; failed transactions retain neither mutation nor receipt. No automatic receipt expiry.
- `financial-report.ts`: branch-scoped, consistent WAL snapshot of documentary receipts, payments, refunds, expenses, invoiced obligations and stock valuation. UI identifies this as an operational report, not P&L. Stock is read in bounded batches; invoice settlement is aggregated rather than queried per invoice.

## Additive schema

`operation_receipts` plus its scope column/index; `checks.payment_id` (unique nullable FK), `checks.settled_at`; `bank_transactions.check_id` (unique nullable FK); refund lookup index. Existing evidence is preserved. New columns are nullable where historical interpretation is unknown. Migration initialization remains transactional. Restore and legacy-preservation tests run against isolated databases.

The additive `inventory_transfers` header and unique per-direction movement index establish one durable transfer identity with two matching physical movements. There are now 75 application tables. No existing transaction was rewritten.

### Extended integration implemented in this checkpoint

POS sales, PO creation/receipt/actions, opening stock, stock mutations, inventory transfers, bulk prices, repair item batches and repair settlement now require durable payload-bound operation identities. API error responses also roll back the transaction. Invoice creation binds its client identity to the complete request; legacy identities without matching receipts require review.

`invoice-source.ts` preserves original POS and received-PO snapshots. Full PO invoices carry original freight, discounts and tax without receiving inventory twice. Unreceived quantities are never billed. Partial receipts with monetary adjustments are blocked pending approved allocation policy; zero-adjustment partial receipts can be billed for actual received quantities.

`repair-finance.ts` allocates explicit same-ticket advances, their original-payment refunds and linked cheque instruments when the repair invoice is confirmed. Original amounts and timestamps remain intact; only document references are linked and audited. Settled and pending amounts cannot exceed invoice capacity. Ambiguous historical references and excess advances block confirmation instead of being guessed. Generic ticket receipts after invoicing route to that invoice. Repair settlement and legal delivery commit together; invalid delivery rolls back its payment.

Quick intake now records genuine stock-linked items and canonical-rial advances, checks every response and continues to the repair workspace. It no longer claims that a newly received device has already passed repair/QC and been delivered. Automated shortcut delivery remains unavailable until a valid business workflow exists.

## Next accounting foundation

Approve recognition, deposit allocation, inventory/WIP costing, refund/credit-note treatment, commission adjustments, fiscal periods, tax mappings and opening balances first. Then implement one event-to-posting authority inside existing transactions, unique source identities, balanced journals, protected periods, immutable posted history and explicit reversals. Do not backfill ambiguous history automatically. Operational reports must be reconciled with that authority before being presented as accounting statements.
