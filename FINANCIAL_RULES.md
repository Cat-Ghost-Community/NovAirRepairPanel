> **Current integration checkpoint - 2026-11-05:** Read [INTEGRATION_CONTINUATION_STATUS.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/INTEGRATION_CONTINUATION_STATUS.md). New confirmed grouped cash intake is atomic with the existing receipt/ledger services; guarded refunds, actual receipt reports and responsive paper/price controls are connected. 358/358 database tests, PG39/39, compiled group-browser41 checks, final typecheck/build pass; lint0 errors/125 warnings. Original109 projections unchanged. Only existing legitimately approved recognition policies post; otherwise pending review. No real historical corrections or approvals. Full PostgreSQL operational port and listed commercial/target gates remain incomplete. **NOT READY FOR PRODUCTION.** Older entries below are historical.

---

> **Current checkpoint — 2026-10-30:** Read [DATABASE_BANKING_STATUS.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/DATABASE_BANKING_STATUS.md). Adds native PostgreSQL bank register guards/services and preserved source snapshots, exact text-to-rial input across existing financial forms, blocked independent bank-transfer recognition, transactional scoped serial registration/proven sale linking and explicit protection against ignored bulk deposits. Live SQLite and original customer records remain unchanged. Latest full pipeline: 350/350 tests /64 suites, typecheck/build pass; PostgreSQL 39/39. Complete PostgreSQL operational/HTTP port, paired bank recognition, group deposits, serialized lifecycle, earlier financial/policy/historical and target-operation gates remain unfinished. **NOT READY FOR PRODUCTION.** Earlier entries below are historical.

---
# Current credit and compensation rules — 2026-10-29

- Verified original receipts are counted once. Available credit excludes refunds, installment allocations, cross-invoice allocations and non-excess invoice obligations. Unknown methods, uncleared cheques, uncertain providers and unproven historical postings cannot fund allocations.
- Allocation/reversal requires same customer and branch, exact current capacity, frozen evidence, independent approval, open posting period and balanced journal. Conflicting independent processes cannot both commit. Receipt identity cannot be reassigned while allocated.
- A customer cash refund documents actual disbursement; it does not execute a bank/provider operation. It cannot spend allocated funds and requires a durable actual reference. Settlement and journal changes are atomic.
- Commission reductions/reinstatements require a separate original repair commission, proven accrual/payout journals and independent approval. Paid excess creates an employee claim, never an automatic wage deduction. Actual recovery is distinct from accrual correction. Mixed salary/deduction runs require separately supported correction policy/documents.
- Service credits require a service-only original invoice with a posted, identifiable revenue account. Independently reviewed exact net/tax reductions remain bounded by original line and invoice budgets; no tax rate/allocation is invented. Reversal/reissue preserves original documents and uses the existing installment revision gates. Physical stock cannot be restored by a service credit.
- Supplier list conversion uses current explicit configured tax, exact fractional line totals and transactionally frozen source IDs. It creates a PO commitment only. Freight/discount/price-variance recognition and multiple partial supplier matching remain separate unresolved gates.

No rule or test approval activates a policy or rewrites real historical evidence. [FINANCIAL_COMPLETION_STATUS.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/FINANCIAL_COMPLETION_STATUS.md).

---

# V8 explicit valuation / WIP boundaries

Money remains integer IRR; item quantity precision remains scaled micro-units. Cumulative pool depletion/receipt allocation conserves the exact finite value, including rounding residuals. A transfer receives precisely the corresponding source value. A customer return uses the original extended issue amount, not selling price or rounded unit cost. A supplier credit/variance cannot bypass its approved cost treatment.

`inventory_carrying_v1` is an independently approved prospective warehouse-costing alternative, not an automatic replacement of the old global method. Nonempty legacy openings, ambiguous source identities and unsupported variance allocation stay blocked. Disabling policy cannot silently fall back. No real policy was approved in this work.

Operational cancellation preserves all original financial/physical evidence; actual timers must be ended first. Separate explicit parts-WIP policies govern 1120/1110 and 5010/1120. Remaining WIP is checked before posting so cost cannot be settled twice. Warranty/rework, performed labor, service-credit and wage/commission recovery assumptions remain unapproved/incomplete. Quote removal never creates physical stock. Details: [V8_IMPLEMENTATION_STATUS.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/V8_IMPLEMENTATION_STATUS.md).

---

# V7 installment agreement rules

Original invoice obligation and verified net receipts define the eligible remaining principal. Agreement terms must sum exactly in integer IRR. Monthly splitting is a documented proposal with an exact final remainder and independent acceptance, never an implicitly approved contract change. Existing terms/payments remain immutable. Credit-driven proposals require a named original credit, separate approval, stale-source protection and activation only with financial posting; reversal needs a separate accepted revision.

Receipt allocations are within the same invoice; baseline-paid receipts are not reusable. Uncleared cheques cannot settle terms. Allocation/reversal is metadata, not another receipt/refund. Refunds cannot consume held allocations or exceed the current accepted plan's coverage. Legacy claimed paid flags are evidence for review, not verified money. No cross-invoice credit or WIP/variance policy is authorized by this implementation. Details and pending decisions: [V7_IMPLEMENTATION_STATUS.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/V7_IMPLEMENTATION_STATUS.md).

---

# Financial rules - V6 additions

Canonical money remains integer IRR; existing half-up rounding is unchanged. Quantities are parsed to integer micro-units without floating multiplication, limited by each new item's selected precision (default six for existing items). Supported return cost is cumulative rounded original-unit cost through physically returned quantity minus actual previous allocated return cost; stock movement extended value is immutable. Supplier fractional dispatch uses actual before/after rounded carrying value of its warehouse.

Restocking must exactly reconcile valuation delta and must not revalue another branch. Three v2 policy templates require new independent, future-only approval; v1 approvals are not silently broadened. No generic expense or balancing amount absorbs residuals/variance. A credit replacement requires a reversed original, fresh correction evidence, independent approval and preserved budgets. Reversal of already refunded notes remains blocked. Reissue never repeats stock, cash or original invoices.

P1 installment rescheduling/payment safety and repair cancellation/WIP remain incomplete; the discovered legacy installment endpoint bypass is a critical release gate. No unapproved rescheduling/WIP/recovery/tax policy is inferred. See [V6_IMPLEMENTATION_STATUS.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/V6_IMPLEMENTATION_STATUS.md).

---

# Financial rules - V5 current additions

No rule is approved by documentation or tests. Existing versioned independent policy approvals remain mandatory and future-only. Seven return templates implement documented original revenue/receivable reversal, supplier payable/claim adjustment, restocking cost, damaged cost reclassification, supplier stock dispatch and the two actual cash-refund directions. Original tax/discount ambiguity remains pending review.

Requests reserve source quantities; duplicate or excessive requests fail atomically. Physical receipt, inspection, final disposition and supplier acknowledgement are separate evidence. A cancelled invoice never restores stock. Posted credits alone reduce obligations. Refunds need original settled cash and unused posted return credit; uncleared cheques are excluded. Independent true-zero decisions do not invent zero journals, but actual stock cost still posts. Missing original cost is never zeroed.

Unallocated negative customer positions remain visible. Cross-invoice allocation, commission recovery, WIP, partial freight/tax variance and credit reissue after reversal are not approved shortcuts or complete features. Full contracts: [docs/returns-workflow.md](docs/returns-workflow.md).

---

# Financial rules — version 3, V4 current rules

The authoritative policy decision register is [ACCOUNTING_POLICY_DECISIONS.md](ACCOUNTING_POLICY_DECISIONS.md). No policy is enabled by migration/default or developer approval. Actual independent approvals are recorded per branch and apply only after the recorded event-ID boundary and effective date. Previously posted obligations/opening coverage are required before automatic customer/supplier/commission settlement. Unsupported cases remain pending; matched closed-period or persistence failures roll the source back.

Opening is an explicit current-day source snapshot, not a reconstruction of past transactions. Seven control balances require independent references, including an explicitly verified zero. AR/advance net and AP reconcile per party; stock reconciles per item and in total. Only balance-sheet accounts may open; source/document changes reject approval/rehearsal/apply. New-business zero is allowed only without branch financial sources. A different administrator approves; a verified restored rehearsal and intact retained backup precede explicit apply. Prior captured events covered by the opening cannot subsequently post. A historical date or >500-line opening requires a separately implemented reviewed process.

Cash/bank/WIP/legacy compensation evidence is not fabricated. Returns, tax allocation, credit splitting and compensation correction remain incomplete. This section supersedes conflicting statements in the retained V3/V2 history below.

---

## Retained V3 rules

2026-10-24. The following rules govern the implemented V3 engine. V2 notes below are historical. **Business accounting policy approval remains outstanding.**

| Rule | Origin / implemented behavior / decision boundary |
| --- | --- |
| Monetary unit | Existing canonical integer IRR, one-rial precision. Toman display/input is explicitly ten rials; repaired payroll forms allow at most one toman decimal. No foreign exchange or jurisdictional tax rule is inferred. |
| Posting | User requirement: exact balanced double entry. Positive one-sided lines, safe integer totals, atomic writes and database guards. A balanced journal is necessary, not proof of correct recognition/classification. |
| Draft correction | Only manual, unposted, unvoided drafts may be edited. Expected content hash prevents stale editing/posting. Voiding preserves the draft and reason in an immutable cancellation record; it creates no debit/credit posting. |
| Chart | Generic classifications; explicit initialization creates 22 starting accounts. User-defined accounts are supported by the service/API. The chart does not activate tax law, recognition policy or opening balances. |
| Source review | Actual source events/control amounts are immutable. Qualified finance reviewer explicitly chooses accounts/date/reason; dimensions follow known source parties. No guessed historical posting and no automatic source recognition policy. |
| Invoice / sale | Existing invoiced obligation/POS source ownership retained. Linked official POS invoice is not a second independent revenue event. Invoice source amounts remain original snapshots. |
| Advance | Existing same-ticket allocation retained. Receipt, final invoice and advance allocation are separate auditable events. Uncollected cheque is not cash. Excess/unrelated credit splitting remains blocked pending an approved allocation model. |
| Inventory / WIP | Actual physical movement is separate from invoice cancellation. Consumed-part cost and later invoice recognition are separate events for reviewed WIP/COGS decisions. Global rounded weighted-average unit cost remains existing operational policy; valuation-to-ledger differences are exposed, never artificially balanced. |
| Period | Posting date must lie in an open period; posted documents remain immutable even after period reopening. Owner/admin reopening requires a reason. Closing checks drafts and pending positive events created within the period; fiscal cutoff/late-document acceptance is not certified. |
| Reversal | Exact inverse journal, same branch/dimensions, open posting date, unique original reference. Original source documents and actual cash/stock movements are not silently undone. Subsequent corrections require explicit adjusting evidence. |
| Commission | Existing eligibility event is delivery. New accrual is unique by repair. Approval and actual documentary payout are separate. Own-pay approval is prohibited. Partial payouts cannot exceed remaining approved net; same request replays, changed request conflicts, repeated payment reference rejects. |
| Commission refund/rework | No guessed negative commission or erased payout. Changed source/refund/rework evidence prevents further disbursement until reviewed correction. The adjustment/cancellation/recovery policy itself remains incomplete. |
| Expense | Existing manual expense recording captures its source event. Full separate expense approval/payable/disbursement lifecycle remains incomplete. Reviewing a journal does not claim an external transfer was executed. |
| Historical cache correction | Only derived invoice paid/status caches: separate proposer/approver, consistent backup, restored-copy rehearsal, unchanged evidence and explicit apply. No obligation/tax/cheque/payment amount is rewritten. Other case types require separately approved corrective business documents. |
| Idempotency | Existing durable identities extended to journal actions, event approval and payroll profile/deduction/approval/payout. Source identities and SQL uniqueness add protection independent of browser disabling. Asynchronous correction backup uses durable correction stage/evidence rather than awaiting under a SQLite writer lock. |
| Report basis | Posted journals only for trial balance/GL/statements. Current source records for operational subledger comparison. UTC source capture dates, explicit posting dates and Persian display are distinct. Opening balances, external bank statements, custom control mappings and complete historical reconciliation remain unverified. |

Concrete unresolved alternatives, not selected policies:

- Recognition: invoice-based accrual would debit receivables/credit revenue on final invoice and separately settle receipts; a cash-recognition model would recognize revenue at approved cash events and requires different treatment of outstanding work. These produce different period revenue and must not be silently mixed. Current runtime uses per-event human review.
- Repair cost: stage consumed parts in WIP until final billing/delivery, or expense at consumption under an explicitly approved policy. Tests exercise the WIP-at-consumption/invoice-cost-release case only.
- Customer excess: preserve as refundable advance or allocate against a specifically approved obligation. Do not delete excess payments or arbitrarily choose oldest debt.
- Purchase freight/discount/tax: allocate proportionally across received value, or require reviewed supplier invoices after complete receipt. Partial adjusted receipts remain blocked. Whether freight/tax belongs in inventory, expense or recoverable tax requires approval.
- Refund: reversal of a settlement alone reopens a receivable; a credit note changes the obligation/revenue. Physical return/restocking, tax correction and commission impact require distinct approved decisions. Full credit-note/return integration is not implemented.
- Commission corrections: reverse unpaid accrual, recover/offset already paid amounts, or preserve earned commission under a warranty policy. No option was activated.

---

## V2 historical rules

# Financial rules — version 1, implementation checkpoint

2026-10-24. Status: partial implementation; accounting approval outstanding.

| Rule | Origin and actual implementation |
| --- | --- |
| Currency | Established repository rule: integer rial (IRR). Toman display means ten rials; residual rials remain visible as tenths of a toman, including large safe-integer values. No cents, exchange-rate or foreign-currency feature. |
| Rounding | Explicit implementation rule for repaired invoice/commission paths: exact rational intermediates, half up to one rial, safe-integer rejection. Quantity/rate precision at most six decimal places. Existing configured invoice rounding remains supported. |
| Tax | Existing `vat_enabled`, `tax_rate`, `duty_rate`, `round_to` settings retained. No new statutory rate or jurisdiction assumed. Repaired POS/PO interfaces use exact server-matched totals; linked invoices preserve original source amounts. Other legacy reports require acceptance. |
| Invoice lifecycle | Draft may be edited; finalized monetary lines cannot be edited through the draft editor. Confirm/edit/cancel checks execute under a writer transaction and enforce branch scope. Due-date metadata changes are audited separately. |
| Payment | Manual cash/card/transfer documents attest settlement; there is no verified online provider. Invoice amount cannot exceed remaining capacity. Pending cheques reserve capacity but do not mark invoices paid. Overpayments must be separately recorded advances. |
| Cheque | `in_hand` → `deposited` → `passed`, or `in_hand/deposited` → `bounced`. Collection is terminal through this API; no silent bounce after bank posting. Received cheques credit the selected bank; issued cheques debit it. Selection is explicit. |
| Legacy cheque | Missing payment link or collection date is not reconstructed from similar amounts/references. Reported for review. Existing invoice counters are not mass-rewritten. |
| Refund | References original payment, cannot exceed its remaining settled value, updates invoice/POS net paid, retains history. Unsettled cheques cannot be refunded as cash. This reverses settlement, not automatically revenue or inventory. A service credit note/physical return policy is still required. |
| Customer position | Invoices plus POS obligations without a finalized linked invoice, minus net settled receipts including advances. Independent cached paid totals are not used by `customerBalance`. Explicit branch scope is supported. This is not proof that every customer screen uses that function. |
| Deposit allocation | Explicit same-ticket, same-customer, same-branch advances and original refunds are linked when the repair invoice is confirmed. Pending linked cheques reserve capacity. Whole documents only: excess advance or ambiguous legacy instrument blocks confirmation for reviewed credit/refund allocation. Unrelated customer credits are not automatically consumed. |
| Repair stock | Invoice confirmation/cancellation must not toggle physical consumption flags. Physical repair stock belongs to repair/inventory operations. Full cancellation/warranty/return acceptance remains outstanding. |
| Inventory costing | Existing global weighted-average cost, exact integer-rial rounding, including genuine zero-cost receipts. Quantities allow six decimal places. Explicit branch/location guards apply; stock transfer preserves global quantity/value with two atomic referenced movements. Reserved stock cannot be transferred out. Inventory-to-ledger reconciliation remains unavailable. |
| Commission | Existing eligibility event is delivery. Exact repaired calculations, inactive profiles excluded, unique source ticket prevents duplicate accrual. Refund/rework adjustments and payout accounting are not complete. |
| Expense | Current schema is a single manually recorded expense; approval, recognition and external payment confirmation are not distinct states. Repaired creation is exact, branch-scoped and idempotent, but not a complete approval/payables system. |
| Bank | Accounts are centralized in this schema; direct register access requires existing cross-branch roles plus financial permission. No new legal entities. Overdraft policy is unchanged; negative and noninteger transfer amounts are rejected. External statements are not reconciled. |
| Idempotency | Required on repaired receipt/payment/refund/cheque/expense/bank/POS/PO/receipt/stock/transfer/opening/bulk-price/repair-item/repair-settlement APIs. Invoice creation uses payload-bound client identity. Same actor/scope/operation/key and payload replays the original result; changed payload returns 409. Browser retains uncertain identities across reload. Imports and other legacy mutations remain unverified. |
| Source purchasing | Only received quantities become linked invoice lines. Full receipts preserve original freight, discounts and tax. Partial receipts with adjustments require approved allocation policy and currently return 409. No ordered-quantity fallback or invented freight allocation. |
| Accounting recognition/periods | Unresolved business decision. No ledger posting, automatic closed-period change or artificial opening balance is performed. |

Outstanding approval decisions: accrual versus cash basis; WIP and COGS recognition; receipt/invoice timing for supplier liabilities; deposit allocation priority; credit notes versus cash refunds; refund/rework commission policy; tax account mapping; approval/segregation requirements; accounting calendar and protected periods; historical discrepancy adjustments.
