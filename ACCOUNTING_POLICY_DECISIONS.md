> **Current integration checkpoint - 2026-11-05:** Read [INTEGRATION_CONTINUATION_STATUS.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/INTEGRATION_CONTINUATION_STATUS.md). New confirmed grouped cash intake is atomic with the existing receipt/ledger services; guarded refunds, actual receipt reports and responsive paper/price controls are connected. 358/358 database tests, PG39/39, compiled group-browser41 checks, final typecheck/build pass; lint0 errors/125 warnings. Original109 projections unchanged. Only existing legitimately approved recognition policies post; otherwise pending review. No real historical corrections or approvals. Full PostgreSQL operational port and listed commercial/target gates remain incomplete. **NOT READY FOR PRODUCTION.** Older entries below are historical.

---

# Banking continuation — 2026-10-30

No real financial policy was approved in this stage. See [DATABASE_BANKING_STATUS.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/DATABASE_BANKING_STATUS.md).

| Decision | Concrete alternatives / consequence | Current safe behavior | State |
|---|---|---|---|
| Bank transfer recognition | Recognize a documented confirmed transfer as one journal with both bank dimensions, or await verified settlement/statement evidence; recognition date and required evidence must be explicit. Register entry alone does not prove provider execution. | Both register legs are durable; reviewing one new leg independently is blocked. A complete linked-pair recognition service remains code work. No historical pair is guessed. | Pending business rule and implementation |
| Group intake advances | One verified customer receipt with explicit group reference and later allocations, or separately evidenced ticket advances. Instrument, settlement confirmation and allocation basis must be explicit. | Positive legacy bulk deposits fail before mutation; UI explains the missing integration. Zero-deposit intake/authorized assignment remain usable. | Pending integration and explicit receipt/allocation rules |
| Serial cost metadata | A serial's documented cost is evidence; a goods receipt/return remains the authoritative inventory movement. Treating serial registration as a second receipt would duplicate stock/value. | Serial creation changes metadata only. Sale linkage requires an existing eligible same-branch stock issue. Unsupported raw status transitions are blocked. | Full serialized repair/return integration incomplete |

Exact text parsing, exact display totals and showing unknown cached balances as requiring review are integrity fixes; they do not authorize opening balances, tax assumptions, external settlement, historical changes or automatic recognition.

---

# Current policy decision register — 2026-10-29

Continuation: per-document independent customer-credit, commission correction/recovery and standalone service-credit workflows are now implemented/tested. They do not approve a global automatic refund/commission/cancellation policy. Service credits reverse the actual posted original revenue account using explicitly reviewed exact net/tax amounts; unsupported mixed-goods allocation remains blocked. Customer allocation requires proven source postings; an unknown historical control classification is not inferred. Paid commission recovery requires an approved claim and a separate actual-cash confirmation. No automatic wage deduction. Future deduction branch ownership is technical identity preservation, not retroactive historical approval. [FINANCIAL_COMPLETION_STATUS.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/FINANCIAL_COMPLETION_STATUS.md).

- `advance_allocation_v1`: implemented future-only alternative, **not approved on real data**. Exact proven same-ticket cash advances are transferred from 2010 to 1100 after invoice recognition. Refunded/pending/unsupported records stay in review. Tests demonstrate behavior under disposable independent approvals only.
- Purchase freight/discount allocation: user decision requested between net line value, quantity or manually approved amounts. No default applied.
- Cancellation after diagnosis/performed labor: user decision requested about billable work versus case-by-case manager determination. No charges or write-offs invented.
- Refund-related commission correction: user decision requested about recalculation from net eligible invoice amount and independently approved recovery claims for paid excess. No automatic wage deduction or deletion of payouts.
- Historical inventory openings, applicable taxes and disputed historical cases retain their prior evidence/approval requirements.

These decisions remain pending until legitimately approved; a request to fix software does not supply missing source balances or impersonate an independent approver. See [DEEP_REVIEW_REPAIR_STATUS.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/DEEP_REVIEW_REPAIR_STATUS.md).

---

# V8 policy decisions — proposals, not real approvals

| Decision | Implemented explicit alternative | Approval / remaining boundary |
|---|---|---|
| General costing | `inventory_carrying_v1`: per-warehouse exact carrying pool, actual purchase/unbilled value, COGS and branch clearing; cumulative residuals | Separate independent future-only approval; starts from genuinely empty positions. Existing nonempty/global-cost positions require a reviewed cutover not implemented here. |
| Actual repair parts | `repair_parts_wip_v1`: Dr 1120 / Cr 1110 | Approved future policy + real consumed source; labor/payroll not inferred. |
| Final billed parts cost | `repair_wip_complete_v1`: Dr 5010 / Cr 1120 | Separate approval and exact remaining-WIP/source checks; no double stock cost. |
| Ordinary cancellation parts cost | `repair_wip_cancel_v1`: Dr 5010 / Cr 1120 | Separate approval; no restock or cash refund. Warranty/rework settlement explicitly blocked. |
| Freight/tax/discount/price variance | Capitalization, supplier-claim or explicitly classified variance alternatives materially differ | No default or generic balancing expense; unsupported cases pending legitimate policy. |
| Cancellation labor / service credit / commissions | Preserve performed work and original payouts; use separately controlled correction/settlement documents | Full lifecycle still incomplete. No wage deduction or invented revenue. |
| Populated credit schema | Verified copy rebuild, unchanged original documents, approved offline deployment | Rehearsal is not deployment approval; no production swap performed. |

Synthetic fixture approvals authorize no real business policy, opening or historical repair. [V8_IMPLEMENTATION_STATUS.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/V8_IMPLEMENTATION_STATUS.md).

---

# V7 policy register update

| Decision | Alternatives and consequence | Implemented safe boundary | Approval state |
|---|---|---|---|
| Change installment obligation/dates | Automatic distribution would alter a contract; explicit terms/monthly proposal records customer agreement | Exact remaining verified obligation, reason/evidence, independent approval, stale-source rejection | Every real agreement requires its own approval; synthetic fixtures approve no real contract |
| Credit/reversal on financed invoice | Silent term rewrite erases accepted history; explicit linked revision preserves it | Approved pending version activates only in the credit/reversal financial transaction | Per-document independent approval required |
| Legacy claimed paid amount | Trusting cache can fabricate settlement; source reconciliation preserves disputed evidence | Read-only `legacy_review`, actual verified receipts only, inconsistent claimed amounts block acceptance | Historical correction still requires legitimate existing dual control |
| WIP, carrying residuals and variances | Different recognition/valuation categories materially change balances | Existing unsupported paths remain blocked; no generic balancing account | Still awaiting policy/implementation where required |

No global recognition policy, tax rule, actual opening balance or historical correction was approved in V7. [V7_IMPLEMENTATION_STATUS.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/V7_IMPLEMENTATION_STATUS.md).

---

# Accounting policy decision register — V6 additions

No new policy has real business approval. The existing future-only independent approval mechanism now exposes three additional technical proposals:

| Template | Exact proposal / effect | Alternative and approval boundary |
|---|---|---|
| `return_restock_cost_v2` | Original cumulative cost for fractional or changed-average restocking, only when recorded before/after inventory valuation differs by exactly that cost and another branch is not revalued | Unsupported residual pools/branch allocation need a separate approved carrying-value model; no balancing expense. Real approval awaiting. |
| `return_damage_cost_v2` | Reclassify the cumulative original fractional cost from documented COGS to return loss, with no saleable stock or double expense | WIP/warranty recognition outside that documented goods source remains unresolved. Real approval awaiting. |
| `supplier_return_stock_v2` | Deplete actual rounded carrying value of the selected warehouse for fractional dispatch; credit/claim stays separate | Supplier credit versus carrying-value variance, freight and tax require explicit mapping/approval. Real approval awaiting. |

The pre-existing v1 definitions/approvals are unchanged. True fractional carrying residuals and general purchase/outbound/transfer valuation are **not** certified by these bounded return templates. Installment rescheduling, WIP/cancellation, cross-invoice customer credit and employee recovery remain unresolved implementation/policy gates; no default is silently selected.

---

# Retained V5 policy additions

No real return policy is approved. Seven technical templates extend the existing future-only, branch-specific independent approval mechanism. Test approvals are confined to disposable databases.

| Decision | Proposed technical template / alternative | Business effect and boundary | Real approval |
|---|---|---|---|
| Customer return credit | Reverse the uniquely documented original 4000/4010 revenue against customer 1100; otherwise explicit reviewed split | Reduces recognized revenue and obligation only after posting; original invoice preserved; discount/tax allocation not guessed | Awaiting |
| Supplier return credit | Debit supplier 2000, credit returned-goods claim 1310 | Reduces a previously recognized payable; credit must match dispatched carrying cost or wait for a separate approved variance document | Awaiting |
| Resale return cost | Debit inventory, credit documented original COGS after posted credit | Same original/global average is eligible for automation; rounded revaluation or other-branch effects block stock disposition | Awaiting |
| Damaged return cost | Debit loss 6020, credit documented original COGS after posted credit | Reclassifies existing cost, no saleable stock and no double expense | Awaiting |
| Supplier dispatch | Debit supplier claim 1310, credit inventory at actual carrying cost | Physical dispatch precedes supplier acknowledgement/financial credit; no invented payable reduction | Awaiting |
| Customer cash refund | Debit original customer receivable, credit cash | Requires unused posted return credit and original actual excess settled payment; no bank/provider execution | Awaiting |
| Supplier cash refund | Debit cash, credit original supplier payable | Requires original supplier payment and unused return credit; supplier claim/credit/cash remain separate events | Awaiting |
| Fractional extended cost / partial freight-tax / variance / WIP / recovery | No automatic default; explicit accounting decision and implementation required | Unsafe operations remain blocked or pending rather than creating balancing amounts | Unresolved |

These proposals are not legal/tax determinations and do not authorize historical entries. Original cutover, bank, commission and other policy alternatives remain below.

---

# Retained V4 policy decision register

The application ships with **no enabled recognition policy**. Technical templates are alternatives, not business approval. Approval records in `accounting_recognition_policies`, not test fixtures or this document, authorize execution. The developer has not approved or impersonated anyone for the real deployment.

| Decision / versioned alternative | Proposed treatment and consequence | Approval status / runtime boundary |
| --- | --- | --- |
| `cash_advance_v1` | Actual unallocated incoming cash: debit 1000, credit customer 2010; creates a liability, not revenue | Implemented/tested; independent branch policy approval and posted opening required. No real approval here. |
| `cash_receivable_v1` | Cash receipt against an already recognized customer invoice: debit 1000, credit customer 1100 | Implemented/tested; source obligation must have a posted confirmation or accepted opening coverage. POS-linked receipts remain pending. |
| `cash_payable_v1` | Cash payment against an already recognized supplier invoice: debit supplier 2000, credit 1000 | Implemented/tested using the actual invoice payment service. Does not recognize purchase receipts/invoices a second time. |
| `commission_cash_v1` | Approved documentary cash payout against recognized commission accrual: debit employee 2030, credit 1000 | Implemented/tested. Does not accrue commissions, execute bank transfers or approve recovery/deductions. |
| `service_invoice_v1` | Confirmed customer invoice with only labor lines, no POS link and zero tax: debit customer 1100, credit 4010, net of discounts | Implemented/tested. Material accrual decision still needs actual independent approval. Goods/taxed invoices are outside this template. |
| Repair revenue | Invoice-based accrual versus delivery-based recognition versus a separately designed cash basis changes period revenue | No business selection; general repair automation remains pending. A pure service invoice can use the explicitly approved narrow template above. |
| Inventory/WIP/COGS | Stage consumed parts in 1120 until billing/delivery, versus expense on consumption | Unapproved. Existing event review retained; V3 fixture mapping is not approval. |
| Advances/credit allocation | Refund excess, allocate to a specifically selected invoice, or retain refundable advance | Whole-document same-ticket V3 allocation retained. Splitting/excess/future-credit allocation remains incomplete. |
| Partial purchasing | Allocate freight/discount/tax by received value versus reviewed final supplier invoice; capitalized freight versus expense/recoverable tax | Unapproved; adjusted partial invoices remain blocked. No arbitrary percentage introduced. |
| Returns/credit notes/tax | Physical disposition, original-price allocation, tax correction and settlement must be separately approved and traceable | Complete return/credit/debit-note system remains incomplete. Existing cancellation cannot fabricate restocking. |
| Commission correction | Reverse unpaid liability; treat already-paid excess as recovery versus authorized future deduction | Unapproved; no historical payments erased or automatic deductions introduced. Correction/recovery workflow remains incomplete. |
| Period cutoff | These templates post on UTC event-capture date. Explicit late source date/payment date stays pending. Closed periods roll the source transaction back | Narrow template semantics require approval; no silent shift to an open period. General fiscal calendar/late-adjustment policy remains unapproved. |
| Opening/cutover | Current-source snapshot, independently reviewed control balances and opening equity versus a separately evidenced historical-date migration | Implemented current-day snapshot path. No zero assumed for unknown balances. Historical-date reconstruction and >500-line batch opening are unsupported. |
| Bank/POS/cheques | Cash, clearing, statement settlement, failed/uncertain outcomes must remain distinct | General automatic bank/provider posting remains pending. No approved test credentials/target integration supplied. |

Activation is future-only: approval records the current maximum event ID. Even an earlier effective date cannot cause old events to post automatically. A new material rule requires a new versioned template; disabling a rule preserves all previous approval/posting evidence. Source actor, independently approving policy actor, event and journal remain separately attributable.

An accepted opening may explicitly cover prior captured source events without reconstructing their transactions. Immutable `accounting_opening_event_links` prevents subsequently recognizing those events again. Pre-registry source IDs are bounded by the existing immutable cutover watermark. Unknown or bypassed source relationships remain pending, never inferred.

Status distinction: all template approvals in the acceptance tests are **synthetic local authorizations**. No production recognition policy, opening, historical correction or payout was activated/applied in customer data during V4.

## 2026-11-05: Accounting business-day boundary - awaiting approval

Evidence: near UTC midnight, Tehran UI payment date differs from the UTC financial-event date. Existing automaticPlan deliberately leaves the source pending; opening cutover currently also uses UTC. Do not retroactively post these events without review.

Alternative A: retain UTC for recognition/cutover and explicitly label/default all financial forms to the UTC accounting date. Consequence: the accounting day differs from local civil time. Alternative B (proposed Persian-first default, NOT approved): use Asia/Tehran for accounting recognition/cutover and consistent UI defaults; persist UTC event timestamps separately. Consequence: period boundaries and late-document tests must follow local accounting dates. Existing immutable history stays unchanged. Alternative C: deployment-configured business timezone, requiring versioned effective-date approval and broader testing. No option was activated by synthetic tests. See INTEGRATION_CONTINUATION_STATUS.md.
