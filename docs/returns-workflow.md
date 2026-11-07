# Return processing: implemented contracts and release limits

## V6 superseding checkpoint

Supported fractional returns now persist exact cumulative cost and before/after valuation proof. Three parts can carry 33/34/33 rial while preserving the original 100; quantity rendering retains all six permitted decimals. Item precision is persisted at creation and validated by the central stock writer/return reservation. Separate v2 policy approvals are required for fractional or qualifying changed-average recognition. Arbitrary carrying residuals, cross-branch revaluation and price variance remain blocked/incomplete; this is not universal inventory-cost completion.

Credit notes now retain uniquely referenced reversed/replacement versions with one active note, independent approval, protected periods and no physical stock replay. Fresh/empty credit schemas support reissue; populated old schemas retain existing operations and explicitly block reissue until reviewed migration tooling/approval/rehearsal. Reduced credit is pending explicit accounting review, not an invented discount policy. History and original line/payment/warehouse selectors have server paging/search and branch checks.

The old restrictions below about all fractional disposition/reissue being absent are retained V5 history and are superseded only for the qualifying scope above. Installment payment/rescheduling and repair WIP remain critical incomplete gates. Exact commands, financial invariants, actual browser results and complete limitations: [V6_IMPLEMENTATION_STATUS.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/V6_IMPLEMENTATION_STATUS.md).

---

The existing ledger and policy approval engine remain authoritative. This workflow does not authorize real recognition policies, historical corrections or provider payments.

## Documents and physical states

`business_returns` references an immutable original invoice and its branch. Each `business_return_lines` row references an original physical invoice line, snapshots its documented selling price and cost, and reserves exact integer micro-quantity. Pending requests reserve eligibility too: independent writers cannot claim the same remaining quantity.

Customer path: requested -> authorized -> received -> inspected -> disposed -> credit_pending -> completed. Supplier path: requested -> authorized -> inspected -> dispatched -> received -> credit_pending -> completed. A rejected request releases its reservation. Rejected physical lines release eligibility only after documented handover/non-dispatch; mixed accepted lines continue independently. Quarantine blocks disposition. An invoice cancellation never restores goods.

Real receipt, inspection and final disposition require separate documentary references. Customer resale stock returns to the selected authorized branch warehouse; damaged/disposed goods never increase saleable stock. Supplier dispatch reduces available stock once at its actual current carrying cost, and supplier acknowledgement precedes the credit proposal. Original inventory movement references remain preserved.

## Credit, recognition and settlement

`credit_notes` and `credit_note_lines` hold draft, independent approval, posted and reversed history. Draft correction preserves the original requester. Approval cannot exceed original invoice, original line or tax budgets after prior active credits. Finalized invoice totals are never rewritten. Only posted, unreversed notes reduce `invoiceObligation().effective_total`; pending approval is not payment or a balance adjustment.

Customer accounting: debit the uniquely established original revenue account, credit that customer's receivable control account. Documented original tax requires explicit approved treatment; it is not guessed. Supplier credit: debit the supplier payable, credit supplier returned-goods claim asset 1310. Physical supplier dispatch debits 1310 and credits inventory. No duplicate supplier obligation is created.

For customer restocking, inventory debit and original COGS credit require documented original cost recognition. Damaged return cost transfers from recognized COGS to return loss expense, without doubling expense. Automatic customer cost recognition waits for the posted credit (or independently approved genuine zero-credit decision); eligible pending cost events are posted in the same credit transaction. A financial/source/audit failure rolls the whole transaction back. Unsupported cost policies remain visibly pending. Physical on-hand and ledger value may differ during this interval; reconciliation exposes the difference.

Refund capacity is the lesser of unused posted return credit and actual excess verified invoice settlement. Each refund references the original settled payment and the return. Refund evidence has a durable uniqueness constraint per return. Cash and payable/receivable postings belong to the original refund source event, not a second cash register. Uncleared cheques cannot fund a refund. The UI records confirmed cash/card/transfer evidence; it does not execute bank transfers or certify provider settlement. Uncertain external execution remains outside this acceptance scope.

No new positive credit is fabricated for an actual free/warranty line. An independent zero-credit decision needs evidence and a truly zero effective obligation, while actual inventory cost is still recognized. Unknown cost is blocked rather than treated as zero.

## Permissions, durability and reporting

`/api/returns` checks operation permission and resource branch before returning an idempotent replay. Durable keys are bound to request payload and operation. Reads are `no-store`, use consistent snapshots and bounded lists. Source quantity, credit budgets, unique stock movement and immutable documents also have database guards. Multi-step services use `atomic()`.

Invoice list/readers use `effective_invoices`: original totals, posted credits and verified net settlement remain distinguishable. Party statements derive original obligations, credits/reversals, verified receipts and refunds once; standalone finalized POS documents are not counted again through linked invoices. Customer and supplier current positions derive from `party_balance_events` rather than cached balances. Customer financial details and timeline records are branch-scoped. New financial timeline events carry source branch; unidentified historical financial events are not assigned a guessed branch.

Iranian P&L headline figures and journal use posted ledger data. Operational estimates are explicitly separate. Inventory valuation sums all relevant stock records using exact money helpers, paginates displayed rows and exposes ledger difference. These reports do not certify historical opening balances or external bank statements.

## Explicit remaining gates

- Cross-invoice customer credit allocation, including refunds after such allocation, remains incomplete.
- Fractional monetary stock disposition requires an extended-cost foundation; request/receipt/inspection are safe, but physical financial disposition is blocked.
- A rounded global weighted-cost change or revaluation of another branch is blocked before stock mutation. No balancing amount is invented.
- Supplier credit versus carrying-cost variance, partial freight/tax allocation and repair WIP require approved treatment.
- Open installment plans require reviewed rescheduling before credit approval.
- Reissuing a credit after its reversal needs a separate correction lifecycle. Existing refund settlements prohibit silent note reversal.
- Commission correction/recovery and general repair cancellation/rework are incomplete. Posted credits invalidate old payout approval evidence.
- The eight original disputed records remain unchanged. No real policy/opening/correction has been approved, and target deployment/provider acceptance is outstanding.

## Reproduction

Run `npm test` (disposable SQLite only), `npm run typecheck`, `npm run lint` and `npm run build` sequentially where memory requires it. Use `node scripts/test-server.cjs 20 3002` for a disposable production-mode server. Its `.freebuff/fixture-20.json` contains the database directory.

Set `BASE_URL=http://127.0.0.1:3002`, `FINANCIAL_BROWSER_MUTATIONS=1` and `E2E_DB=<that directory>/repaid.db`, then run `node scripts/returns-browser.cjs`. The script refuses arbitrary or nonlocal paths, creates documentary source records and isolated synthetic policy approvals, performs actual browser actions with independent identities, checks exact final ledger/stock/report balances, and writes private `.freebuff` evidence. Test credentials/approvals are never production authorization. Keep all fixture files, backup rehearsals and screenshots out of customer deployments.
