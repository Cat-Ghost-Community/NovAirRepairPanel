# Deploying without international runtime downloads

No automatic production deployment is performed. Preserve the existing domestic server, database, SMS/payment providers, proxy and secret management.

## Configuration

- Keep `APP_ORIGIN` set to the canonical public HTTPS origin; preserve secure cookies, encryption keys, existing database/storage paths and branch/authentication settings.
- Set `NEXT_TELEMETRY_DISABLED=1` for build and service startup.
- Existing SMS/postal integrations retain their built-in hosts and `REPAID_OUTBOUND_HOSTS` extension. Review each additional exact hostname and its DNS/TLS/routing; this setting does not approve browser assets.
- `REPAID_BROWSER_CONNECT_ORIGINS` and `REPAID_BROWSER_FORM_ORIGINS` default empty. If a legitimate domestic browser service or payment form requires an exception, record the owner, purpose and verification, then configure comma-separated exact HTTPS origins. Wildcards, paths and credentials are rejected. Do not add CDN/font exceptions.
- No `REPAID_NETWORK_*` test variables or Node preload belong in production configuration.

## Prepare while build infrastructure is available

```sh
npm ci
npm run check:network
npm run typecheck
NEXT_TELEMETRY_DISABLED=1 BUILD_STANDALONE=1 npm run build
npm run db:build-tools
npm run package:offline -- /absolute/new/repaid-release
```

Build on the target OS/architecture/Node-major platform; do not deploy a Windows build on Linux. Also match native runtime requirements such as Linux libc/distribution compatibility; the manifest's platform/architecture/Node-major checks do not certify every native ABI combination. Retain the emitted manifest digest through a trusted channel. Ship the prepared release through existing domestic/private artifact storage. Keep the build lock and third-party licenses. Registry access, GitHub, OS packages, browser binaries and Node installation are preparation/maintenance dependencies; an uncached offline install is not guaranteed.

## Verify and start the prepared release

```sh
node /absolute/repaid-release/verify-release.cjs --verify /absolute/repaid-release TRUSTED_MANIFEST_SHA256
cd /absolute/repaid-release
# Use the existing service manager/environment file, outside this immutable artifact.
NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=127.0.0.1 PORT=3000 node server.js
```

The prepared release includes required runtime modules, static chunks, public fonts and the existing bundled database administration tools under `.database-tools`. Runtime npm aliases for scheduled/encrypted/plain backups, recovery sets and supported migration tools point to these local bundles; development/build commands require a source checkout. startup does not run npm, Git or an asset downloader. Verification rejects added/missing/modified files and platform mismatch. It verifies integrity against the supplied trusted digest, not independent publisher identity. Keep mutable data, secrets and uploads outside the artifact. The two explicitly mutable Next cache directories (`.next/cache` and `.next/server/route-cache`) are omitted from release packaging and excluded from code-integrity checks; they can be mounted separately for a read-only code deployment. Do not put executable application code, secrets or customer uploads in them. Use existing controlled database upgrade/backup procedures; this task introduces no database migration.

## Delivery and production acceptance

Keep existing Nginx/TLS topology and hashed Next static caching. New versioned font paths have one-year immutable cache headers. Never shared-cache authenticated HTML/API responses. Preserve release assets together; do not overwrite an older immutable font version with different bytes. Existing gzip/Next compression remain enabled; Brotli is optional only if already available and tested.

Before cutover, run the isolated acceptance harness on non-production data and the real Linux namespace check where supported. Then verify from actual Iranian client networks: first navigation with empty cache, print/fonts, login, forms, uploads, internal chat, reports and restart. Inspect all browser requests and provider DNS/CNAME/TLS chains. Validate SMS/payment using approved sandbox credentials only. Confirm domestic authoritative/resolver availability, certificate renewal/stapling, monitoring and off-host recovery during the intended isolation policy. No hardcoded IP geography or disabled TLS validation is an acceptable substitute.

Deploy through the existing approved release procedure. The optional prepared standalone artifact is not a drop-in replacement for the managed wizard's source/revision contract: service commands, update/rollback paths and retention must be reviewed for that deployment. The existing wizard remains intact; its fresh source installation still needs prepared build access. Retain the previous verified artifact for code rollback. This network change requires no customer-data rewrite. The product's other financial/PostgreSQL release gates remain independent; network acceptance is not commercial production certification.
