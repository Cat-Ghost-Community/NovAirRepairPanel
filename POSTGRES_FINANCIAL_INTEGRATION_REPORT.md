> Imported engineering context: historical source/CI references belong to the legacy repository. Current new-repository status and validation: [REPOSITORY_SETUP.md](REPOSITORY_SETUP.md). This import does not complete remaining production gates.

# PostgreSQL financial integration — Master Prompt 02

Implementation checkpoint, 2026-11-06. **NOT READY FOR PRODUCTION. Phase02 is not accepted; Master Prompt03 prerequisites are incomplete.** This report supersedes Phase01 descriptions only for the boundaries explicitly listed below. Ordinary PostgreSQL production runtime remains blocked.

## Implemented boundaries

The existing async pool, current-session/permission/branch authorization, exact-rial helpers, accounting chart and recognition templates, immutable ledger, durable operation guards and native bank services are reused. SQLite remains the unchanged ordinary runtime while isolated PostgreSQL routes select native services before any SQLite call. There is no PostgreSQL-to-SQLite fallback.

Migrations1–2 retain their existing checksums. Migration3 installs immutable source-event, independent review and prospective policy guards. Migration4 adds native financial, inventory, credit, bank, cheque, expense and purchasing guards, then removes only the corresponding domain write fences. New supplier documents use nullable customer references rather than fabricated customer0 records; historical sentinels are preserved. Goods receipts have append-only `pg_purchase_receipt_lines` references. Unproven populated stock history is rejected before upgrading rather than assigned invented carrying values. Notifications permit only guarded low-stock INSERT; their UPDATE/DELETE/TRUNCATE fences remain.

| User/API boundary | Native service and atomic persistence | Ledger/reporting | Verification |
| --- | --- | --- | --- |
| `/api/accounting` chart, periods, manual drafts/edit/void/post/reverse, source review | `postgres-accounting.ts`, `postgres-journals.ts`, `postgres-financial-events.ts`; current actor lock, branch scope, immutable source/hash/audit | `postgres-ledger-reports.ts`: trial balance, keyset general ledger, statements; pending sources and absent verified opening disclosed | Native ledger and financial-bank-expenses tests; production HTTP scenarios |
| `/api/invoices`, `/[id]`, confirm/cancel/payment | `pg-customer-finance.ts`, native financial guards, exact source quantities, immutable finalized amounts, payload-bound invoice identity | Source event captured in the source transaction; eligible approved template posts atomically, otherwise explicit pending review | `customer-finance.test.ts`; production HTTP invoice1000/receipt400/refund100 |
| `/api/payments`, refund | Same native financial domain, verified receipt capacity, settled instruments and immutable refund evidence | Invoice/customer obligations derive from authoritative views; no external settlement is implied | Competing pools, injected audit rollback, preserved legacy operation names and replay |
| `/api/installments` | `pg-installments.ts`; independently accepted versions, frozen source hash, guarded receipt allocation, immutable settled history | No second cash receipt for an existing allocation; credit rescheduling hooks exist, full credit-note workflow remains unported | Native installment tests; production HTTP tests include independent approval, payment and revised schedule |
| `/api/customer-credit` | `pg-customer-credit-http.ts`, `postgres-customer-credit.ts`; independent proposal/approval/post/reversal/refund, outer legacy full-payload identity and native inner command | Reconciled customer control accounts required before allocation; allocation transfers existing funds, no new receipt | Real native allocation600/reversal100/refund500; independent-process same-key posting; HTTP scenario added, final result recorded below |
| `/api/bank` | Existing `postgres-bank.ts`/native guards; new empty register provenance, exact pair transfer, immutable balance evidence | Register/ledger position from one snapshot. Unsupported one-leg recognition is blocked | Separate-process duplicate transfer; lock timeout, failure and retry, bank report |
| `/api/checks` | `pg-checks.ts`; create/deposit/pass/bounce, one linked bank movement, exact original ownership | Pending cheque is not cash; clearance event is sole cash-recognition source, linked bank source has zero control | Native and actual HTTP pending/clearance assertions. Unsupported spend remains blocked |
| `/api/expenses` | `pg-expenses.ts`; existing documentary expense semantics, branch scope, audit/source/durable result in one transaction | Exact reviewed expense/cash posting; no invented provider execution or new approval policy | Native rollback/retry/ownership and HTTP expense25; profit differs from receipts |
| `/api/purchase-orders`, action/preview; purchase invoices/payments | `pg-purchasing.ts`, native receipt references and shared `postgres-inventory.ts` movement primitive | Partial receipt and supplier invoice do not create stock twice; independent stock/unbilled/AP/payment postings | Native1.5 units at101: stock152, payment100, AP52; HTTP two0.5 receipts at30 and AP20 |
| Isolated backup/restore primitive | `postgres-opening-backup.ts`; real native archive, private file, fsync/hash, separately created restored database, schema/source proof, owned cleanup | Exact ledger verification after restored-copy mutation; source unchanged | `opening-backup.test.ts`, real PostgreSQL18.4 dump/restore. This is **not** the complete business opening workflow |

No interface redesign or new production seed was introduced. Existing financial pages outside the isolated allowlist remain unavailable in PG mode. HTTP integration does not certify every financial screen, export or browser journey.

## Financial invariant matrix

| Invariant | Enforced boundary | Evidence and limit |
| --- | --- | --- |
| Posted debit equals credit exactly | Existing native deferred ledger checks, trusted scoped journal posting | Manual/source journals, reversal, injected failures; native ledger chain independently verified |
| Exact money/quantity | BIGINT rial, NUMERIC/scaled quantities, cumulative extended-cost references | Fractional PO receipts; report totals beyond JavaScript safe integer range become exact decimal strings. All inventory policies/paths are not yet accepted |
| Immutable history | Native journal/source/operation/movement/document guards | Direct tampering rejected; corrections preserve original documents |
| Atomic source, audit, event and durable result | One shared PostgreSQL transaction; nested work uses savepoints | Actual audit failures roll back source/stock/register/event/operation; retry commits once |
| Duplicate/payload conflict protection | Native operation uniqueness/advisory locks, original legacy identity/hash compatibility | Competing pools/processes, replay and changed payload; transferred staff cannot reuse an old-branch nonce to create a new mutation |
| Branch/current authorization | Request boundary plus locked command reauthorization, source-owned branch | Staff denied other branch, owner/admin consolidated access; pending unported domains stay fenced |
| Protected periods | Ledger date/period guards, pending-source closure check | Closed-period failure; no retrospective opening or policy activation |
| Receipt counted once | Authoritative effective invoices, receipt funds, credit/instalment allocation/reversal views | Native credit1000 alloc600 reverse100 refund500 settle200 yields customer/control0 and only2 receipts |
| Cheque settlement proven | Cleared state and one native bank movement | Pending instrument leaves receivable unchanged; clearance recognizes once |
| No invented historical opening | Populated unproven upgrade/canonical bank baseline blocked; opening API remains503 | Synthetic tests cannot approve original accounting policies or disputed records |

## Bugs discovered and repaired during implementation

- Native ledger guard verification incorrectly included unrelated later `repaid_*` constraints; exact owned names now checked without changing original proof bodies/checksums.
- PostgreSQL compiles trigger record fields even across some boolean/CASE expressions. Inventory/purchase guards now use separate table-specific IF branches, avoiding nonexistent `NEW` fields.
- Supplier documents previously required a customer sentinel. Native schema now permits a genuine absent customer while customer invoice/receipt ownership guards remain strict.
- Quantity preview preserved numeric public contract rather than exposing exact internal text unexpectedly.
- Receipt settled flags normalize booleans explicitly; PostgreSQL boolean comparisons no longer use SQLite `=1`.
- Real dump/restore re-parses native CHECK expressions. Restored-copy normalization proves equivalent PostgreSQL-parsed expressions before reinstalling the frozen original CHECK; source rows, native proof and original schema remain untouched.
- Installment HTTP settlement initially queried `installments.branch_id`, which does not exist. Authorization/replay lookup now uses the authoritative `effective_installments` view, matching the native service. The first expanded HTTP run failed; it is not reported as a pass.
- Protected collection readers preserve original party/date/unpaid invoice filters, joined source display names and payment reference search, rather than silently narrowing search to document numbers.
- Customer-credit source reads reuse an existing snapshot rather than requesting a forbidden nested isolation change.
- Aggregate reports preserve exact large balances as decimal strings instead of rounding overflowing JavaScript numbers.

## Executed evidence

- Full native PostgreSQL: **88/88, 8 suites, 0 skipped/failed**,122.873s; `.freebuff/postgres-financial-native-3.txt`.
- Earlier unchanged-runtime baseline: **445/445,69 suites**,303.623s; `.freebuff/postgres-financial-baseline.txt`. Final unaffected regression rerun: **445/445,69 suites,0 failed/skipped**,330.869s; `.freebuff/postgres-financial-regression-final.txt`.
- Earlier production HTTP/browser:17 groups passed (`.freebuff/postgres-financial-http-2.txt`); subsequent expanded run failed at installment transport and motivated the repair above. These are distinct source checkpoints.
- Typecheck after customer-credit HTTP bridge: PASS (`.freebuff/postgres-financial-types-12.txt`). Later IPC test additions are also checked by the next production build.
- Lint before latest transport changes:0errors/125existing warnings. Final lint result recorded below.
- Dependency audit: **0 vulnerabilities**, `.freebuff/postgres-financial-audit.txt`.
- Read-only original comparison:109 table projections unchanged, integrity ok, FK violations0, live workflow/supervisor grants0. Reviewed schema SHA256 and private case-file SHA256 both independently match the previously retained values. No original business database was used for mutating tests, no original financial correction or policy approval executed.

Private artifacts contain isolated fixtures or structural evidence and must not be committed. PostgreSQL18.4 Windows recovery clients were obtained from the official PostgreSQL Windows/EDB distribution and used locally; CI explicitly requires matching18 clients. Target-host recovery/off-host retention/least privilege are not certified.

## Remaining acceptance gates — technical migration versus business policy

| Gate | Type | Exact remaining boundary |
| --- | --- | --- |
| Native opening/cutover business commands | Incomplete migration | Propose/independent approve/rehearse/apply controls and native opening guards must be ported; current API503. A tested dump/restore helper alone does not satisfy this gate |
| Approved automatic recognition acceptance | Technical dependency plus legitimate business approvals | Prospective policy services/guards exist; approval requires a posted opening. No real policy approved or retrospective posting generated |
| Customer/supplier returns and credit-note posting/reissue | Incomplete migration | Existing SQLite workflows and legacy populated migration must be ported with receipt/disposition/stock/refund/credit-schedule atomicity. Shared inventory/credit hooks alone are insufficient |
| Payroll, commissions/corrections/recovery, warranty/repair cancellation/WIP | Incomplete migration plus listed policy decisions | Native operational commands and source-to-ledger tests are not complete; original payout/evidence must remain immutable. No missing policy is used to disguise missing port work |
| POS/sales and remaining financial imports/batches/readers | Incomplete migration | Existing unported APIs/tables remain fenced; financial report/export/customer/supplier screen parity and missing-source detection remain incomplete |
| Inventory valuation/carrying cutover | Incomplete acceptance plus opening evidence | Exact shared movements/PO path exist; complete approved-policy lifecycle, populated migration and control reconciliation require further tests. Unproven historical stock cannot upgrade silently |
| Partial freight/discount/tax supplier matching | Business decision and supported-scope limit | Adjusted partial PO invoice409 until an approved allocation rule exists. Unadjusted partial/full supported paths are ported |
| Eight disputed historical cases | Legitimate independent approval | Original evidence preserved; no guessed cheque link, erased overpayment, fabricated opening or automatic correction |
| Deployment and recovery | Infrastructure acceptance | Global PG runtime remains blocked; ordinary installer uses SQLite. Production roles/TLS/storage/object backup/restore/cutover and sustained target workload have not passed |

**Master Prompt03 is not ready for acceptance handoff.** Independent work may continue, but Master Prompt02 cannot be marked complete while the supported financial paths above still depend on SQLite.

## Final verification addendum

Changed-domain credit/recovery acceptance: **8/8,0 skipped/failed**,54.423s; `.freebuff/postgres-financial-credit-recovery-final.txt`. This reruns part of the88-test suite; it is not96 distinct tests. The credit lifecycle now posts/replays through two independent Node processes, with one persisted operation and exact original totals. Native archive file fsync, actual restore/schema/source verification and restored-only journal mutation passed.

Final unaffected regression:445/445 as above. Final lint at that checkpoint:0errors/125existing warnings (`.freebuff/postgres-financial-lint-final.txt`). Source inventory regenerated:674 input files,122 API route files,189 handlers, no unresolved local imports. Old source-bound acceptances are deliberately stale after shared runtime changes; the generator does not infer completed financial migration from imports or test references.

Expanded final production HTTP/browser: **19/19 groups PASS**, `.freebuff/postgres-financial-http-final.txt`, structured evidence `.freebuff/pg-http-Uqh2Dq/results.json`. An isolated production build and actual Next server exercised authenticated financial API commands, invoice/detail/collection and payment-reference readers, independently approved installment versions/settlement/history/legacy replay, customer-credit proposal/approval/post/refund, permissions, branch scope and exact persisted source/journal/report totals. Credit100 allocated60/refunded40 leaves AR610 and advances0, assets1125/liabilities20/profit1095; no second cash receipt. Five actual customer creations reconcile to five customer audits/events/operation identities. No SQLite file was created.

Real browser acceptance in that run covers the existing login/customer create/profile journey, Persian RTL,320/375/768/1440 widths and light/dark themes. It does **not** certify unported financial screens or customer-host deployment. Full financial commands in this checkpoint are exercised through actual HTTP plus native database tests.

Final standalone `npm run typecheck`:PASS (`.freebuff/postgres-financial-types-final.txt`); targeted lint on changed transports/scenarios/IPC worker:PASS with no diagnostics (`.freebuff/postgres-financial-lint-transport.txt`). Source-inventory `--check`:PASS. Staged text normalization/`git diff --cached --check`:PASS; no customer evidence or private test artifacts staged. Isolated SQLite preview health200 at http://127.0.0.1:3000.

CI/target-host results must be recorded separately from this local evidence. The global production block, technical migration gaps and historical/policy restrictions above remain in effect despite successful supported-slice tests.

Checkpoint source commit:`a78d1fb`, branch `feat/postgres-financial-engine-20261106`. Initial CI42137154767 could not start PostgreSQL tests because the Ubuntu runner's default repository lacks `postgresql-client-18`; this is recorded as a failed infrastructure prerequisite, not a financial test pass. CI now configures the [official signed PostgreSQL Ubuntu repository](https://www.postgresql.org/download/linux/ubuntu/) with its documented primary-key fingerprint before installing matching native clients. No test is skipped to avoid the recovery requirement. Subsequent CI results remain separate evidence until executed.

### Independent CI result

Implementation plus recovery-client correction commit **`6e620d3756310313ef808aaa2f2a6173d91bf169`**: all three jobs of [CI42137438197](https://github.com/Cat-Ghost-Community/1beng/actions/runs/42137438197) **SUCCEEDED**. PostgreSQL18.4 native88/88 and production HTTP/browser19 groups passed on Linux, including real dump/restore, separate-process posting and exact financial totals. Main verification passed447 Linux regressions/69 suites, source-bound inventory, whitespace, lint, typecheck, bundled recovery tools, audit0, Vite-removal gate and production build.

The separate disposable Ubuntu installer job also passed real systemd/SQLite/Nginx/TLS installation, update, code rollback and recovery doctor. It validates compatibility of the existing SQLite deployment profile; **it does not validate a PostgreSQL production installation, a customer target or application-wide financial migration**. Final original read-only comparison after local regressions again confirmed109 preserved table projections, integrity ok and FK0. Only the user's pre-existing untracked `imanpng.PNG` remains outside the committed checkpoint.

This documentation addendum records the exact executable/configuration checkpoint verified above; later documentation-only commits do not change that runtime evidence. **Master Prompt02 remains incomplete and Master Prompt03 acceptance handoff remains blocked by the technical/business/infrastructure gates listed above.**
