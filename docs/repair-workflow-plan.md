# Implementation continuation — three choices approved

The user approved both proposed modes and explicitly retained the current setup as a third option. Implementation, resolved queue/transfer gaps, actual evidence and remaining product-wide gates are now documented in [REPAIR_WORKFLOW_IMPLEMENTATION.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/REPAIR_WORKFLOW_IMPLEMENTATION.md). The original planning checkpoint below is retained as decision history; it does not describe the latest implementation status.

---

# Repair intake and assignment workflow plan

Date: 2026-10-29. Status: repository review and implementation plan; **not implemented or activated**. This document does not supersede the outstanding financial release gates.

## 1. Required outcome and proposed modes

Confirmed requirement: in the managed workflow, only the company manager, branch manager or explicitly designated supervisor chooses the repair's technicians and authorizes reassignment. An ordinary technician cannot select, claim, accept a peer transfer to acquire, or work on an unassigned device. Enforcement must be server-side, not a hidden button or optional viewing preference.

Proposed second mode, pending confirmation: a shared **unassigned** queue. A technician may claim an eligible unassigned repair in their current branch, atomically assigning it to themselves before technical work is allowed. They cannot take another technician's repair. This is a proposed explicit workflow, not a claim that the current application already implements a safe claim service.

Recommended settings scope: each branch chooses a mode; company owner/admin controls settings and supervisor appointments. Branch managers operate their own branch; company owner/admin can manage either branch. These scope/second-mode choices are proposals, not changes to live settings.

| Rule | Managed assignment — «ارجاع توسط مدیر یا سرپرست» | Shared queue — «صف آزاد با انتخاب تعمیرکار» |
| --- | --- | --- |
| Reception records intake | Yes; technician optional, selection available only to authorized assignment staff | Yes; unassigned by default |
| Ordinary technician sees unassigned queue | No | Only eligible local queue cards |
| Ordinary technician claims work | Never | Only currently unassigned local repair; claim creates real assignment |
| Technician performs technical work | Only explicitly assigned primary/secondary worker | Same; must claim or receive assignment first |
| Assign/reassign another worker | Manager or designated supervisor | Manager or designated supervisor |
| Accept physical handover | Records receipt only; cannot grant assignment authority | Same |
| Other-branch work | Never for ordinary employees | Never for ordinary employees |

## 2. Verified current implementation and gaps

The existing `repair_tickets.technician_id` / `technician2_id`, `repair_assignments`, status graph, manager assignment screen, queue, audit and notifications remain the foundation. No replacement repair engine or accounting ledger is needed.

| Finding | Actual source / evidence | Required treatment |
| --- | --- | --- |
| Assignment already has a common manager service, expected-current-worker comparison, history, same-branch target validation and reason after work starts | `src/lib/repair-assign.ts`, `assignTickets`; `/api/repairs/assign`; `tests/assignment.test.ts` | Extend; do not rebuild. Move all assignment mutations through its transaction-aware core. |
| Assigned-only access is a global optional flag, off by default; some list/detail/search readers use it while board/queue apply different rules | `src/lib/auth.ts`, `repair-access.ts`, `/api/repairs`, `/api/search`, repair board | Replace contradictory behavior with effective branch workflow policy and common read/work predicates. Managed mode cannot be weakened by this flag. |
| Permission wildcard can authorize assignment without explicit supervisor designation | `requireAssignAccess` checks `repairs.assign`; `senior_tech` template grants `repairs.*` | Explicit assignment authority required in managed mode; wildcard permissions alone cannot bypass it. Supervisor designation does not grant unrestricted technician work. |
| Technician-to-technician transfer is an alternate assignment writer | `/api/repairs/transfers` POST requires `repairs.edit`; PATCH directly updates `technician_id` on recipient approval | In managed mode a worker can request handover, not decide ownership. Supervisor-authorized reassignment must use canonical service; receipt confirmation cannot select a worker. Existing pending requests need review. |
| Single/bulk intake directly writes the worker column, outside assignment history | `/api/repairs/route.ts`, `/api/repairs/bulk/route.ts` | Use canonical assignment inside existing intake transaction; validate every bulk target's active employment/branch. Preserve all-or-nothing bulk intake. |
| Appointment conversion is another intake path | `/api/appointments/[id]/convert` | Create unassigned repair under effective policy; appointment preference is not repair assignment authorization. |
| Queue ignores branch and returns primary assignments only | `myQueue`, `/api/repairs/queue` | First-priority fix: current branch AND explicit primary/secondary assignment; pagination and authorized counts. |
| Actual cross-branch queue discrepancy reproduced | Disposable real database + actual GET handler: queue returned HTTP 200 with previous-branch ticket; detail guard returned 404. Explicit secondary assignment absent from queue. `.freebuff/workflow-plan-probe.json` | Regression tests must reproduce and then eliminate both discrepancies before activation. These bugs remain unfixed in this planning checkpoint. |
| Start helper does not enforce branch itself and separates status transition from timer insertion | `startRepair`; HTTP route currently adds its own repair guard | Domain-level guards plus one transaction for authorization, valid status transition, timer, audit and notifications. Do not rely on the HTTP caller alone. |
| Reassignment leaves old timers and secondary-worker authorization untouched | `assignTickets` changes primary only | Explicit handover rules; no hidden retention of previous worker access. Preserve prior work and compensation evidence. |
| Expected worker ID alone misses A-to-B-to-A changes | Existing compare-and-set on `technician_id` | Incrementing assignment revision plus durable idempotency protects stale clients and replay. |
| Assignment dashboard/queue are silently capped at 400/300 | `assignmentDashboard`, `myQueue` | Proper server-side pagination, search and scoped totals. |
| Commission calculation uses primary worker at delivery | `src/lib/payroll.ts`, `computeTechnicianCommission` | Assignment change must not silently rewrite earned commission, payouts or past work. Compensation review is separate. |

Fresh existing regression baseline: **222 tests / 36 suites passed**, zero failures/skips; `.freebuff/workflow-plan-baseline.txt` (40.4 seconds). Passing baseline does not cover the newly reproduced queue discrepancy. No production data was used for probes or mutated by tests.

## 3. One effective policy and one assignment authority

Add a small domain module, proposed `src/lib/repair-workflow.ts`, that resolves current actor, current employment, source branch and current workflow revision inside the transaction. Separate these questions:

1. May this actor read this repair?
2. May this actor manage its assignment?
3. May this actor perform technical work on it?
4. May this actor claim this currently unassigned repair?
5. May this actor record physical handover?

Company owner/admin retains cross-branch supervision. Branch manager is local. A designated supervisor receives assignment authority only in their granted branch, while actively employed there. Transfer/deactivation/revocation removes that authority immediately; it must not follow them into a different branch. Only owner/admin can grant/revoke supervisors or change modes. A supervisor cannot appoint another supervisor or change company permissions.

An ordinary technician requires current-branch, active explicit assignment for technical reads/mutations. A supervisor who also repairs uses separate supervisory and worker capabilities: ability to see/manage a branch queue does not make them the worker. Proposed default: technician-supervisors cannot use delegation to assign work to themselves; manager assignment is required. This self-assignment rule needs confirmation.

Role wildcards, broad `repairs.edit`, old cookies, direct resource IDs, stale browser tabs and old transfer requests cannot override the effective policy. Apply it to lists, dashboard, board, queue, search, detail, receipt/print, journey, attachments/files, security revelation, notes, diagnosis, checklists, estimates, parts, time, QC, status, invoicing and related exports. Existing financial permissions remain additional requirements.

Primary and secondary workers both count as explicitly assigned, but managers control both. New jobs need only a primary worker; adding/removing a helper is an explicit authorized action with history. Existing secondary assignments are retained for review, not erased or retroactively attributed to a fictitious approver. Replacement screen must state whether the prior primary remains a helper; default is removal from current work access, not silent retention.

## 4. Operational lifecycle

**Intake:** reception records customer/device, condition, accessories, consent and any authorized advance. Without assignment authority, the technician selector is absent and a supplied technician field is rejected. Repair remains «در انتظار ارجاع». Manager can assign at intake or later. Standard, quick, bulk and appointment-conversion intake follow the same policy. Quick service must not add technical work before assignment.

**Assignment:** manager/supervisor chooses an active technician employed in that repair's branch. UI shows real workload and current status. Creating assignment does not automatically start diagnosis, repair, labor, commission, revenue or inventory consumption. Assignment availability stays separate from existing physical repair status; no parallel contradictory status system is introduced.

**Work:** assigned technician sees their queue and can use existing permitted diagnosis/approval/parts/work/QC steps. The existing state graph, approval requirements, financial controls and inventory services still apply. Starting work atomically checks current assignment/workflow revisions, transitions only through allowed states and creates at most one applicable open timer. Sending an “In Repair” status directly must obey the same worker eligibility.

**Reassignment before work:** authorized actor selects replacement and reason; record previous/current worker, primary/helper changes, actor, branch, policy revision, assignment revision and timestamp. New worker receives access; old worker loses future technical access immediately after commit.

**Reassignment during work:** present open timers, work history, parts and physical handover requirements. Proposed default: require an explicit “Pause active work and reassign” confirmation; stop affected timers at the server-recorded handover time and preserve elapsed work in the same transaction. No fabricated minutes or erased entries. If that action is not approved for initial rollout, return a clear conflict until timers are stopped; never silently leave the old timer running. Former worker consent must not become a veto over authorized manager reassignment.

Physical receipt confirmation is independently recorded. If physical handover is required, the newly assigned worker can confirm receipt of that assigned item; accepting it never changes who was selected. A technician's transfer request cannot grant the recipient access before authorized assignment. Pending legacy transfers are invalidated for assignment purposes or explicitly reviewed against the new revisions.

**Ready/delivered/cancelled/rework:** reuse existing status guards. Closed/delivered jobs cannot be reassigned through ordinary controls. Reopening/warranty uses its controlled existing path, then an explicit valid assignment. Cancellation preserves parts, receipts, labor and historical payouts; this feature does not invent refund, WIP or compensation accounting policies. Company administrators retain existing controlled financial correction services.

## 5. Persistence, transactions and migration

Minimal proposed additions:

- Branch workflow configuration: branch, one of two mode values, revision, changed-by and timestamp.
- Explicit branch-supervisor grants: branch/user, active grant/revocation metadata and audit. Existing role permissions remain; grant is an additional scoped authority, not a second employee account or role rewrite.
- Incrementing `repair_tickets.assignment_version` and additive nullable metadata on existing assignment history for policy revision, operation identity and primary/helper changes where needed.
- Reuse existing durable operation protection for assign/reassign/claim/start/handover, with operation/actor/branch/ticket scope and payload binding. Do not implement an in-memory lock or independent assignment source.

The transaction-aware assignment core accepts the caller's database transaction; public APIs own one outer boundary. Single/bulk intake must not call the current function that independently issues `BEGIN IMMEDIATE` from inside an existing transaction. Validate all relevant state again after asynchronous input reads and under the writer transaction.

Commit assignment, revision, history, audit and durable notification intent together. Notification dispatch occurs after commit and retries from durable intent; a delivery failure must not report that committed assignment failed or execute it again. Existing per-ticket partial results for bulk reassignment remain explicit; grouped intake remains atomic as a group.

A repeated identical key returns the original result. Changed payload with same key conflicts. Concurrent claims cannot both win. Stale actor membership, workflow revision, worker revision or helper membership conflicts without partial mutation. Use prepared queries and appropriate branch/worker/status indexes; avoid loading all jobs to compute a page.

Before activation, preview each branch's current assignments, invalid/transferred workers, helpers, open timers, pending transfers and broad permission grants. Preserve current mode/flag behavior until a reviewed explicit change; do not silently choose an operational mode for the business. The old assigned-only control becomes derived/read-only or is retired with clear compatibility handling; toggling it cannot weaken managed mode.

Accepted active assignments survive activation if branch/employment is valid. Invalid assignments are shown for manager reassignment; never moved between branches or silently claimed. Existing assignment/time/payment/commission history is not rebuilt or erased. Safe additive migration, consistent backup, restored-copy rehearsal and rollback before new-feature writes are required. After new events exist, rollback must retain their history and controls; never drop evidence merely to downgrade application code.

## 6. Settings and existing-screen changes

Add «گردش کار پذیرش و تعمیر» to existing settings navigation using `SettingsShell`, `SettingsSection`, existing cards, buttons, Select, badges and Persian formatting. Include:

- Explicit branch selector/context; company “all branches” shows branch summaries and requires an explicit target for edits, not silent first-branch writes.
- Two modes with concise Persian explanations and a permission preview.
- Supervisor selection from eligible active local employees; current grants and revoke action.
- Activation impact preview, conflict/error state and audit identity. Saving confirms only persisted server success.

Reuse `/repairs/assignment` for manager control and `/repairs/queue` for worker tasks. In managed mode remove claim/peer reassignment controls and explain «فقط دستگاه‌های ارجاع‌شده توسط مدیر یا سرپرست در دسترس شماست». Unassigned intake belongs in manager queue. Shared mode adds a distinct available queue and atomic claim action, exposing only necessary local intake data before claim.

Manager repair detail gains a reasoned reassignment/handover dialog with current worker, helper treatment, version and affected timers. Existing colors, typography, themes, layout and animations remain. Loading, empty, blocked, stale-version and retry states are Persian and real. Check 320/375/768/1440, both themes, keyboard focus and touch targets; no success indication before server commit.

## 7. Implementation checkpoints and acceptance

1. **Close existing safety gaps first:** regression for old-branch queue and secondary assignment; canonical branch/access predicates; constrain legacy transfers and direct work starts. Keep existing functionality and financial history intact.
2. **Policy and authority:** additive schema, effective per-branch mode, explicit supervisor grant/revocation, revision checks, compatible old-flag treatment and tests before activation.
3. **Unify mutations:** transaction-aware assign/reassign/primary/helper service, complete intake callers, independent assignment/work guards, atomic timer handover and durable notifications/idempotency.
4. **Settings and screens:** expose effective persisted mode and authority; reuse assignment/queue/detail UI. Implement shared claim only if that second mode is confirmed.
5. **Integration and acceptance:** all readers/exports, original-data verification, full regressions and actual browser journeys on disposable production-mode databases. Activate only through an explicit reviewed configuration change, not a test fixture approval.

Required deterministic acceptance scenarios:

- Reception creates normal/quick/bulk/appointment intake; unauthorized supplied primary/helper IDs fail without partial repair/financial effects.
- Ordinary technician cannot list/open/claim/start/time/diagnose/add parts/change status on unassigned or another technician's repair in managed mode, including direct API calls and broad permission templates.
- Manager assigns; only selected primary/helper can work. Unrelated users cannot reveal security or download attachment/receipt links.
- Authorized local supervisor can assign others; cannot appoint supervisors, operate another branch or exploit dual technician/supervisor identity. Revocation and employment transfer take immediate effect.
- Reassignment retains notes, labor, consumed stock, deposits and existing financial records, removes previous future access and does not reattribute past payouts. Timer handover is atomic.
- Two managers race; two technicians race to claim in shared mode; same-key replay, payload conflict and A-to-B-to-A stale requests are safe.
- Existing pending transfer cannot bypass manager selection. Physical acknowledgement cannot choose another assignee.
- Branch 1 managed and branch 2 shared remain independent; company manager sees/manages both while employees remain local after transfers.
- Workflow changes while a request/body/file upload is pending; stale request is denied at commit. Reopening, cancellation and financial corrections preserve existing protections.
- Failure injection after assignment/before timer/history/notification intent leaves no partial mutation; post-commit notification delivery failure retries without duplicate assignment.
- Queue/dashboard/board/search/print/export counts agree on primary/helper/current-branch scope; pagination exposes later records without cross-branch leakage.
- Full real browser journey from settings through intake, manager assignment, worker start and mid-work reassignment; exact SQLite state/history/revisions and financial non-effects asserted.

Completion means these chains work, not just that the settings toggle exists. Baseline 222 passing tests must remain enabled; new failures cannot be hidden by removing fixtures or weakening assertions.

## 8. Decisions still open

1. Confirm that shared self-claim queue is the intended second mode; it is not fully implemented today.
2. Confirm per-branch choice versus company-wide mode. Per-branch is recommended for the existing two-branch organization.
3. Confirm whether designated technician-supervisors may assign work to themselves; recommended initial default is no.
4. Confirm explicit supervisor pause-and-handover authority for open timers; otherwise block reassignment until existing timers stop.

These decisions do not prevent implementing the common safety fixes, explicit manager-only guards and tests. They do prevent silently activating an invented operating policy. No application behavior, live workflow setting, employee authority or customer record changed during this planning task.
