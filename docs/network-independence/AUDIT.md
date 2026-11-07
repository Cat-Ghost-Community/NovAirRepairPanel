# Runtime network audit

**Network status: APPLICATION READY — PRODUCTION VERIFICATION REQUIRED.** Application isolation passed locally and in a real loopback-only Linux namespace. This does not change the application's separate NOT READY FOR PRODUCTION business/PostgreSQL release assessment. Iranian production DNS/TLS/routing and approved provider sandbox checks remain required; no deployment was performed.

Scope: existing Next.js16.4.2 App Router / React19 / strict TypeScript / Tailwind4 / Node24 application. Existing SQLite persistence and isolated PostgreSQL migration remain unchanged. This is a network-readiness assessment, not certification of the unfinished financial/database migration.

Baseline: runtime code at the previous verified checkpoint had454 passing application tests,215 PostgreSQL tests and48 production HTTP/browser groups; lint0 errors/124 warnings. A fresh typecheck/lint was also executed before this change. Baseline browser isolation against the retained optimized build reproduced the print-font failure on disposable data. Original business data and private deployment configuration were not opened or copied.

## Actual dependencies

| Dependency | Classification / impact | Action and evidence |
|---|---|---|
| `cdn.jsdelivr.net`, Vazirmatn33.003 Regular and Bold WOFF2 in estimate HTML | LOCALIZABLE: one international runtime origin, two font files; approved print typography fails when blocked | Exact original weights localized; OFL1.1 retained; source/size/SHA-256 in `assets.json`. Baseline isolation reproduced failed loads. |
| `@fontsource-variable/estedad`5.3.0 | Already first-party bundled; main Persian/Latin variable font | Preserved; license retained in `licenses/Estedad-OFL.txt` and prepared releases. No Google Fonts runtime API. |
| Lucide SVG, Recharts, QRCode, bwip-js, SheetJS | Already bundled/local execution | Preserved; no second icon/chart/font library. SheetJS tarball CDN URL is a build dependency, not browser execution. |
| `tracking.post.ir` | DOMESTIC, existing optional postal API and user-clicked tracking link | Preserved HTTPS allowlist, bounded timeout and existing fallback. Live DNS/routing/TLS/provider accessibility unverified. |
| `api.kavenegar.com`, `rest.payamak-panel.com`, `gateway.ghasedak.me`, compatible `api.ghasedak.me` alias | DOMESTIC, existing three SMS adapters/five total built-in server hostnames including post | Preserved exact adapters, settlement/error semantics, HTTPS restriction and redirect refusal. No real or billable SMS sent. |
| Deployment-approved `REPAID_OUTBOUND_HOSTS` / configured postal/SMS URL | UNVERIFIED until operator reviews actual configuration | No automatic approval from `.ir`, IP location or user input. Existing server allowlist remains separate from browser policy. |
| Browser payment/connection destinations, if required by the deployment | DOMESTIC only after explicit operator approval | Exact HTTPS origins configurable; none are silently added. No gateway SDK, callback-verification implementation or provider credentials are invented. Local cash receipt tests are not gateway execution. |
| npm registry, SheetJS package archive, GitHub source/actions, Node.js/NodeSource, OS/container/browser distribution sources | BUILD/DEPLOY/MAINTENANCE ONLY | Lockfile retained. Prepared platform-specific standalone release avoids registry/source downloads at startup or installation of that prepared release. A fresh offline `npm ci` is not claimed. |
| SVG namespace identifiers, documentation/example URLs and user-clicked external anchors | Not runtime resource dependencies | Kept; automated checks distinguish these from scripts/fonts/media/imports/transports. |

`source-inventory.json` records source observations; multiple literal references are not counted as independent services. The scanner combines TypeScript AST resource/import/transport inspection with CSS/embedded-document checks. Browser and transport observation complement it; static analysis alone is not certification.

## Dynamic content and other runtime systems

Chat/repair attachments are authenticated first-party byte streams; signatures use validated PNG data URLs; avatars/icons are locally rendered. No source-supported remote-media migration was necessary. Production database/configuration values were not audited, so arbitrary live content or custom deployment adapters are not certified. CSP prevents unapproved resource loading rather than downloading arbitrary customer URLs.

Chat polling/SSE and local APIs use relative first-party routes. Background backup/recovery code uses existing local/private storage; off-host mounts, native subprocesses, DNS infrastructure and certificate maintenance require operator validation. No third-party authentication, CAPTCHA, analytics, remote licensing or AI SDK was identified in application runtime code. Framework telemetry must remain disabled by deployment configuration.

## Discovered defects repaired

1. Two international print-font requests.
2. Estimate QR resource used a server-derived origin, which can differ from the browser/proxy origin; strict isolation exposed this. Resource is now relative, while displayed tracking origin uses canonical `APP_ORIGIN`.
3. Adding strict CSP required explicit nonces for the two hand-written print scripts. Supplier popup interpolation was also HTML-escaped; stored text must not become an image/script request.
4. Linked dependency roots can escape into Next standalone output. Packaging refuses links; acceptance builds use physical prepared dependencies and verify the relocatable release.
5. Report-builder popup values were also interpolated as HTML. Headers, values and the report label now use the existing HTML-escape helper; the real browser scenario verifies a stored image-shaped customer name remains literal text, with no image node or external request.

Production DNS/CNAME/authoritative resolution, routing, TLS/OCSP, domestic provider credentials and real outage accessibility remain unverified. An Iranian server location or a passing lab is not proof of nationwide accessibility.
