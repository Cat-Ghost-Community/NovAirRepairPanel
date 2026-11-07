# Implemented changes

## Browser and resources

- Exact Vazirmatn33.003 Regular/Bold files and original OFL are under `public/fonts/vazirmatn/33.003/`; print templates use those versioned first-party paths with `font-display:swap`. Existing Estedad, icons, charts and responsive styles remain intact.
- `src/lib/network-policy.ts` centralizes existing domestic server hosts, reviewed public-font paths, exact browser-origin validation and CSP construction. Existing `outbound.ts` reuses those same host values without weakening HTTPS/port/redirect rules.
- `src/proxy.ts` generates a fresh nonce, overwrites spoofed incoming nonce/CSP headers, passes the policy to Next rendering and applies it to responses including denial/redirect paths. Production has no script `unsafe-inline` or `unsafe-eval`; inline style support remains for existing React/Tailwind/charts. Ordinary external links remain usable. Explicit browser connect/form origins are separate from server integration hosts.
- Existing raw print scripts carry the request/document nonce. Supplier and report-builder popup text is escaped; estimate QR uses a relative resource URL. Normal formatting remains unchanged. No foreign scripts, CSS, images or fonts are added as exceptions.
- Versioned font resources are anonymously readable, including the isolated PostgreSQL profile, with one-year immutable caching. Sensitive HTML/APIs remain private/no-store. Existing Next asset hashes/compression and Nginx gzip remain; no service worker is introduced.

## Build and deployment

`package:offline` consumes a completed Next standalone build and emits a new external release directory with traced runtime dependencies, `.next/static`, public assets, build lock, bundled original administration tools, compatible runtime npm aliases, licenses, verifier and SHA-256 manifest. Existing destinations, private data/secret files, unsupported links and incompatible platform/architecture/Node-major releases are rejected. Only the two fixed Next runtime-cache prefixes are excluded and omitted during packaging; arbitrary added files or changed code are still rejected. This is file-integrity verification, not a publisher signature: transfer a trusted manifest digest separately.

Acceptance starts this actual packaged server after blocking outbound transport. npm/source checkout is not used during server startup. Dependencies must first be prepared using the unchanged lockfile; no claim is made that an uncached offline build or OS provisioning works. No dependency directories, release bundles or test databases are committed.

## Regression prevention

- `check:network` inspects actual resource/import/network call contexts and asset hashes; tests reject representative regressions while permitting ordinary links and namespaces.
- Test-only `network-egress-preload.cjs` rejects non-loopback DNS/TCP and records sanitized host decisions. It is never imported by production code and never returns fake success responses.
- `network-isolation.cjs` builds and tests an isolated production release, fresh browser sessions, all configured page routes, forms/APIs, chat/files, print/fonts, spreadsheet export, cash receipt replay, branch/CSRF boundaries and restart.
- `network-isolation-linux.sh` adds a real loopback-only Linux network namespace, checks interface/route state and independently rejects a raw-IP canary before the Node guard runs. CI uses already prepared dependencies and browser binaries.
- CI publishes only sanitized result JSON through a separate directory; private fixture credentials, databases and logs retain their restrictive permissions. Canary exclusions identify only the exact intentional probe URL, never a broad time window or all failed requests. Secondary `srcSet` candidates and remote SVG sprite resources are covered by regression checks.

Changes are limited to resource delivery, policies, print compatibility and verification tooling. Database schema, customer data, provider selection, payment verification, session semantics and branch/business permissions are not redesigned. Remaining non-network product release gates remain binding.

## Rollback

Revert this feature branch or select the previous verified release through the existing deployment procedure. No database rollback or historical correction is required. Restore the previous application artifact/configuration together; do not mix hashed assets from different releases. Keep immutable font versions available to existing clients until normal release retention expires. A rollback restores the old CDN dependency and must not be described as network-independent.
