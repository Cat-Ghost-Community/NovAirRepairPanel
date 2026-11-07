# Network verification evidence

Network status: **APPLICATION READY — PRODUCTION VERIFICATION REQUIRED**. This covers the application/network changes, not the separate incomplete commercial/PostgreSQL release gates.

## Baseline and environment

- Baseline application source was the previous verified M9 checkpoint. Reused optimized artifact was independently bound to523 runtime/config files before this assignment.
- Fresh baseline isolation evidence: external private workspace `repaid-network-Xg6cXr`; original customer database unused. A clean browser and Node DNS/TCP guard reproduced unavailable jsDelivr print-font requests. Main fonts were already local.
- Windows environment: Node24, installed Chromium, disposable SQLite fixture, production build and isolated first-party loopback origin. Tests use existing real application services, not mocked financial implementations. Temporary credentials/keys stay outside the repository and are not uploaded.
- Linux CI additionally executes a loopback-only network namespace. Native processes cannot use an external interface there; a raw-IP canary runs without the Node preload. Actual CI execution status must be consulted before treating this layer as verified.

## Commands

```text
npm run typecheck
npm run lint
npm test
npm run check:network
node --import tsx --import ./scripts/test-environment.cjs --test tests/network-policy.test.ts tests/network-dependencies.test.ts tests/network-egress.test.ts tests/offline-release.test.ts
npm run test:network
sudo env PATH="$PATH" REPAID_NETWORK_WORKSPACE=/var/tmp CHROME_PATH=/usr/bin/google-chrome bash scripts/network-isolation-linux.sh
```

Build dependencies and browser binaries are prepared before isolation. `test:network` performs an actual production standalone build under the test transport restriction, packages/verifies it, and starts that packaged server. It does not run against the production service. The baseline-only mode requires an identified external pre-change build; normal acceptance never uses that mode.

## Executed focused checks

Initial focused suite:8/8 passed, covering policy/nonce freshness, spoofed headers, sensitive cache policy, public asset boundaries, original domestic allowlist compatibility, source/resource regression detection, exact WOFF2 bytes, actual loopback response, denied DNS/direct-IP probes and release tamper/platform checks. Fresh typecheck passed. Baseline lint:0 errors/124 warnings.

Initial full isolated build correctly refused a linked dependency root; physical prepared dependencies fixed the non-relocatable output. Subsequent browser isolation exposed the print QR origin mismatch; it was fixed without relaxing CSP. These attempts are not recorded as passing final acceptance.

## Required evidence and interpretation

Final Windows acceptance `repaid-network-bsIMUp`:15 check groups passed,39 actual page navigations,2,175 observed browser requests, zero unexpected external attempts, zero failed requests and zero runtime errors. Both exact Vazirmatn weights loaded locally. Real customer creation/search, internal chat message/file persistence and authenticated download, supplier popup print/XLSX export, durable137-rial cash receipt/replay, branch denial, CSRF denial, logout and a second clean-browser/backend restart passed. An administration bundle started without registry access. The raw-IP/DNS test canaries were denied. This local transport layer is a Node process guard, not an OS firewall; Linux kernel isolation is independently verified below. Sanitized [local results](local-results.json) are retained.

Reviewed screenshots include completed customer pages at375/768/1440px in light/dark mode and the estimate print document. Persian glyphs, QR image and existing styling remain intact; measured overflow checks passed. Dashboard geometry matches the baseline in all eight sampled rectangles. The public tracking page intentionally has no `main` element; the harness checks its actual body rather than assuming the authenticated shell. Earlier harness attempts failed on redirect-following, nested/absent `main` selectors and intentional restart prefetch; these were harness errors, corrected before this passing run.

Single paired desktop sample: LCP260ms before/248ms after, CLS0.0000375174/0.0000351563, encoded home JS315,929/314,350bytes, CSS18,727bytes unchanged, main font84,176bytes unchanged. Print fonts101,704bytes total, only requested when used. The baseline had two international font requests plus one incorrect first-party QR alias; the repaired run had none. These samples do not establish a statistically significant speed improvement. [Raw comparison](performance.json).

The acceptance result records page/workflow checks, actual requested resources and failures, font-face loading, browser runtime/CSP errors, server connections, fresh login/logout, backend restart and metric samples. No foreign request is fulfilled with an empty successful response. Canary attempts are labeled separately from application traffic. Real SMS/payment transactions are deliberately not executed; local cash receipt persistence/replay is a different assertion.

Performance comparison uses the same initial synthetic database, browser viewport and clean profiles. External print-font attempts must change from the baseline to zero after localization. LCP/CLS, resource counts and bytes are lab samples, not field Core Web Vitals, nationwide measurements or capacity evidence. INP is not claimed from a short synthetic run. Screenshots and layout/font observations support review; a complete pixel-perfect comparison of all business states is not claimed.

## Unverified production gates

Actual domestic DNS/CNAME/resolver paths; DNS/TLS behavior on Iranian access networks; provider-side foreign dependencies; approved SMS/payment sandbox transactions; target-host firewall, native processes, scheduled workers and off-host recovery; and nationwide outage behavior remain unverified without target access and approved credentials. Existing unrelated business/database migration incompleteness remains separately documented.

## Linux kernel isolation and CI

[Network run42321362605](https://github.com/Cat-Ghost-Community/1beng/actions/runs/42321362605), revision `cd90ff8`, passed. Build dependencies and installed Chromium were prepared first. The actual production build, administration bundles, offline package/verifier, server and clean browser then ran inside a fresh network namespace with only loopback, no default route and a raw-IP denial canary independent of the Node guard. All17 check groups passed:39 pages,1,900 observed browser requests, zero unexpected external attempts/failures/runtime errors and both local print weights loaded. Cold startup/restart and real persisted mutations passed. The final report-builder scenario also verifies that a persisted image-shaped customer name prints literally, without creating an image element or making an external request. [Sanitized Linux results](linux-results.json).

The prior network run42320332997 passed its complete namespace acceptance step but failed uploading evidence because private fixtures were root-owned700 directories. The CI correction copies only sanitized result JSON into a separate readable publication directory; auth files, databases, logs and private directories remain protected. The corrected complete workflow passed. Earlier cancelled intermediate runs are not acceptance evidence.

[Final regression run42321362544](https://github.com/Cat-Ghost-Community/1beng/actions/runs/42321362544), application revision `cd90ff8`, passed all three jobs:462/462 application tests,215/215 real PostgreSQL tests,48 protected PostgreSQL HTTP/browser groups, typecheck, production build, source-inventory verification, database-tool compilation and npm audit with zero reported vulnerabilities. Lint remained0errors/124 pre-existing warnings. The disposable Linux installer also passed SQLite/systemd/Nginx/self-signed TLS installation, update, code rollback and recovery verification. That installer test used network access during preparation; it is not an offline OS installer or an Iranian target-host test. The final revision includes report-builder escaping and its real print-popup acceptance scenario. Earlier successful regression runs remain historical evidence; the linked final run covers the final implementation.

## Acceptance boundaries

| Gate | Evidence/status |
|---|---|
| First-party core assets, fonts, scripts and CSS | Source guard plus actual browser traces pass; one former international origin/two resources localized. |
| Cold backend/build/runtime without international downloads | Passed with prepared dependencies in the Linux namespace. Uncached dependency/OS provisioning remains online preparation. |
| Authentication, permissions, CSRF, database persistence, internal communication and print/export | Real disposable application and existing PostgreSQL regression suites passed. |
| Domestic SMS/postal/payment compatibility | Existing adapters and allowlists retained; no billable calls or invented gateway execution. Live credentials/provider dependencies unverified. |
| Design/RTL/themes/responsive behavior | Completed375/768/1440px customer views, print and eight dashboard geometry samples reviewed; PostgreSQL browser regressions additionally exercise320px. Full all-state pixel equivalence is not claimed. |
| CI regression prevention | AST/resource/font-integrity tests, full application suite, enforced CSP, browser request observation and Linux transport denial. Ordinary links remain permitted. |
| Original data and rollback | Original database/configuration unused; synthetic external fixtures only; no database migration. Prior release rollback described in deployment guide. |
| Actual Iranian outage accessibility, production DNS/TLS/providers and recovery | Not verified; requires operator target access and approved test credentials. |

HTTP routing instrumentation disables browser cache, so these cold-profile lab samples should not be interpreted as normal warm-cache traffic volumes. Performance/INP/enterprise capacity claims beyond the recorded measurements are not made.
