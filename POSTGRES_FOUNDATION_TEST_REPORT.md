> Imported engineering context: historical source/CI references belong to the legacy repository. Current new-repository status and validation: [REPOSITORY_SETUP.md](REPOSITORY_SETUP.md). This import does not complete remaining production gates.

# PostgreSQL foundation verification

Tests use real disposable PostgreSQL and isolated application/source copies. Original business data is not a fixture.

## Final implementation commit

Commit `1cc2bf2db7ba588d4a29f7a5ed3b90bd70853f8c`: [CI42121272671](https://github.com/Cat-Ghost-Community/1beng/actions/runs/42121272671), **all three jobs succeeded**. Native PostgreSQL66/66; actual production HTTP/browser13 assertion groups; Linux regression447/447 with0 failures; typecheck, inventory source check, tool bundling and production build passed. Lint0 errors/125 existing warnings; dependency audit0 vulnerabilities. Actual disposable Ubuntu installation/update/code rollback/recovery doctor/HTTPS health passed again. Private final job logs: `.freebuff/pg-foundation-ci-final-postgres.txt` and `.freebuff/pg-foundation-ci-final-verify.txt`.

The difference from the earlier446 Linux count is one added inventory evidence-invalidation test, not another business workflow. Runtime slice coverage remains the same. Subsequent delivery-only documentation does not modify the tested runtime/generator. No actual customer host, original-data migration or application-wide PostgreSQL readiness was verified.

## Executed local evidence

- Initial typecheck found inferred protected-read result fields; fixed with an explicit typed result boundary. Subsequent typechecks passed.
- Combined native suite:65/65 PASS at `.freebuff/pg-foundation-native-final.txt` before the additional mid-request role-downgrade case. Latest customer focused suite9/9 PASS, including that real row-lock race; final combined count must be recorded after CI.
- Schema focused7/7 passed before CLI test inclusion; combined native run above includes the explicit migration CLI apply/replay/verify/error case.
- Windows unaffected/full regression:444/444 PASS,69 suites,0 skips,313.998s (`.freebuff/pg-foundation-regression.txt`). Existing tests retained; new gate/parser/inventory tests included.
- Local isolated production build and HTTP/browser acceptance:13 named assertion groups PASS; `.freebuff/pg-http-Y3kNCs/results.json`.
- Real production HTTP: unauthorized/forged sessions, exact MAX_SAFE rial field, persisted code/branch/audit/event, identical and conflicting replay, six concurrent duplicate requests, staff branch isolation/company-manager cross-branch access, actual injected audit failure rollback/retry, unsupported-route blocking, CSRF, safe GET logout/actual POST revoke and password-session rotation.
- Real Chromium: HTML server-action login, customer form submission and persisted profile; RTL;320/375/768/1440 widths, dark/light, no horizontal overflow/runtime page errors. Source/audit/event/operation totals each5; zero SQLite files; no manufactured contact journal.
- Screenshots inspected. Literal`null` in an absent surname was detected and corrected with null-safe presentation; final CI browser now asserts no such fixture text. No visual redesign.
- An initial development-mode run completed the HTTP groups but did not complete browser acceptance; it is not counted as a full pass. Its log is retained separately. Production-mode acceptance above completed all groups.
- Initial lint had3 generator binding-name errors; renamed without suppression. A new callback dependency warning was addressed with a stable callback. Final exact-source lint/build/CI results pending below.

## Exact-source CI and original-data verification

Source commit `74e76ed` was exercised in [CI42119920640](https://github.com/Cat-Ghost-Community/1beng/actions/runs/42119920640). The completed PostgreSQL job passed66 native integration tests and all13 production HTTP/browser assertion groups, including the final role-downgrade regression, absent-surname presentation and HEAD read. Its native suite took22.290s on the disposable runner; this is test duration, not a capacity benchmark. Private local job-log copy: `.freebuff/pg-foundation-ci-postgres.txt`.

The final read-only original-data check independently compared109 pre-existing table projections and original identities/sequences: unchanged, integrity `ok`, foreign-key violations0. Reviewed current schema SHA256 remains `0d09e63df008f0b08055aec40cefcda0216d111da6d32c3a2de62d0d5ff6d9a3`; private disputed-case evidence SHA256 remains `1c2f7bfc975bc20aa7f35fec1b794c019008672b68575533d53f46970e1e732d`. No private case contents were printed or changed. The earlier disclosed additive group-receipt startup migration predates this phase; it is not presented as a change made here.

Commands: `WORKFLOW_BASELINE=.freebuff/database-final-source-before.db node scripts/repair-workflow-original-check.cjs` (PowerShell environment assignment on Windows), followed by read-only `DatabaseSync` schema hashing and byte hashing of the private case file. No business write, historical correction, approval, opening entry or live cutover was executed.

All three jobs in that CI run completed successfully. General verification passed446/446 Linux regression tests (0 failures), typecheck, production tool bundling, inventory source check and production build. Lint:0 errors,125 existing warnings. `npm audit --audit-level=high`:0 vulnerabilities. The Linux installer job independently exercised actual systemd/SQLite/Nginx/self-signed TLS installation, update, code rollback, recovery doctor and HTTPS health on a disposable Ubuntu24.04 runner. This verifies compatibility of the existing SQLite deployment, not a PostgreSQL production installer or the customer's host.

No production-host, full PG financial workflow or enterprise-capacity claim follows from these tests. The source-bound inventory annotation commit is checked separately; its evidence refers only to unchanged runtime dependency fingerprints, not blanket migration of mixed legacy files.

Final inventory evidence hardening:7/7 focused generator tests passed (`.freebuff/postgres-inventory-reviewed-tests.txt`), targeted lint passed, and `node scripts/postgres-migration-inventory.cjs --check` confirmed647 source inputs,122 API files/189 handlers,70 pages/10 layouts,12 reviewed entrypoint records and8 reviewed HTTP handlers. Shared Next proxy/ancestor-layout changes invalidate review; the untested customer-detail POST stays unverified. This additional test is separate from the preceding444 Windows/446 Linux full-run counts.
