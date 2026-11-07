> Imported engineering context: historical source/CI references belong to the legacy repository. Current new-repository status and validation: [REPOSITORY_SETUP.md](REPOSITORY_SETUP.md). This import does not complete remaining production gates.

# Wizard parity and reliability — 2026-11-07

Reference inspected: the owner's four scripts in `D:\WorkSapace\IMAN\exp`. Existing Repaid terminal components, installer, systemd services, verified deployment/backup/recovery tools and protected environment handling were reused. No original customer database/configuration was opened or modified.

## Implemented

| Area | Actual implementation |
|---|---|
| Guided install/management | Existing reference-style framing/prompts retained; clean-reinstall and TLS/address/backup controls integrated. |
| Repository access | Dedicated root SSH identity or root-only HTTPS token file; Git askpass, no embedded token URLs; credential paths retained for updates. |
| Release selection | Stale installer branch default replaced; explicit reviewed branch/SHA supported. |
| Privileged build boundary | Every Git-tracked wizard control is checked, including newly introduced modules; symlinked control parents and build-hook modifications rejected. |
| Bootstrap boundary | A root bootstrap refuses ambient modules beneath shared/untrusted directories and fetches a pinned verified source instead. Git trace environment variables are unset before credentials are used. |
| Runtime deployment | Telemetry disabled in service defaults; only the two actual Next runtime-cache directories are service-writable, preserving immutable application code. Generic Linux service explicitly binds loopback. |
| Backup schedule | Real systemd backup interval5–60 minutes; protected managed override with rollback on restart failure, freshness checks retained. |
| Domain TLS | Managed Certbot deploy hook validates/reloads Nginx after renewal; certificate SAN/expiry checked. |
| Address/IP trust rotation | Controlled canonical-origin/proxy change; retained configuration and certificate rollback; durable interrupted-change marker and explicit recovery. |
| Clean active reinstall | Exact site-bound approval, verified encrypted snapshot and restored-copy rehearsal, retained original data/attachments and key custody, fresh real owner, new verified backup, rollback/recovery journal. |
| Documentation | README rewritten around actual requirements, private/public bootstrap, root deploy keys/PATs, real prompts/paths, maintenance, TLS, backup, clean-reset consequences and limitations. |

Clean reinstall is not secure erasure. It preserves offline original financial evidence and infrastructure/backup keys. It does not drop PostgreSQL roles, invent financial adjustments, switch the database engine or restore a historical backup over active transactions. Mounted/overlapping/unsupported storage and unknown recovery state are blocked.

## Initial local checkpoint

Locally executed:19 focused installer/reinstall tests passed; typecheck passed. Tests use disposable directories and actual SQLite files. Covered original database/attachment preservation, unchanged keys, duplicate transition rejection, failed initialization recovery, injected filesystem failure after detachment and tampered configuration rejection. Existing15 Bash installer tests remain passing. Final executed Linux/CI evidence follows below.

New isolated Linux acceptance exercises actual Git HTTP authentication, installed systemd/Nginx service, backup scheduling/encrypted recovery, self-signed trust rotation, invalid reset approval/owner rollback, clean-data initialization, interrupted reset recovery and actual ACME HTTP-01 issuance/renewal through the official Pebble test CA. Test CA source/binary are pinned to v2.10.1 and verified release digest. It never disables certificate or challenge validation. This is a local protocol test, not proof of live Let's Encrypt DNS/routing on the customer's host.

## Production boundaries

- Actual private GitHub deploy key/token access and expiry depend on operator credentials; the automated credential mechanism test uses a local private Git server and a synthetic credential.
- Public-domain Let's Encrypt issuance, Iranian DNS/routing, provider access and real target storage/recovery require target access and approved configuration.
- Installer Ubuntu/Debian and actual Node24 requirements supersede the unrelated TimYab example requirements. PostgreSQL migration remains gated; systemd/SQLite are preserved.
- Original disputed financial cases are untouched. No deployment, financial correction, production data reset or host credential migration was executed.
- Installed older management versions should be upgraded through a reviewed checkout when adopting newly added privileged modules; new version verifies the whole wizard control tree for subsequent builds.

## Rollback

Source-only changes can be reverted without a database migration. Ordinary code rollback preserves current data and requires compatible schemas. Interrupted reset/address operations have explicit recovery commands and retained evidence. A committed clean reset cannot be undone by code rollback; original archives remain offline and reactivation requires a separately reviewed recovery decision. Keep archives/keys private and under explicit retention custody.

Primary references: [GitHub SSH testing](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/testing-your-ssh-connection?platform=linux), [official Pebble test CA](https://github.com/letsencrypt/pebble/tree/v2.10.1).

## Final executed acceptance

**Documented wizard workflows implemented and verified on disposable Ubuntu24.04. Target production host remains unverified.** Code revision: `d644c7177641701e39c47db7800dc55aa1690619`; The legacy README pinned that revision; it is not a commit in this fresh repository. Current install references use the new repository history. Later documentation does not change those tested sources.

[Extended wizard CI42329177725](https://github.com/Cat-Ghost-Community/1beng/actions/runs/42329177725) passed all seven acceptance groups:

1. Root bootstrap refuses ambient modules beneath shared/writable directories.
2. Real authenticated Git smart-HTTP fetch returns the independently expected commit/file; synthetic credential never appears in output; unsafe file permissions are denied.
3. Actual systemd/Nginx/SQLite installation, encrypted backup,15-minute schedule and self-signed certificate rotation pass.
4. Generic `--yes` cannot wipe. Invalid owner initialization restores the original; successful reset creates only the intended new owner and empty active business. Retained fixture-original SHA-256 and witness records match exactly.
5. Interrupted reset leaves a durable journal, blocks ordinary mutations and recovers through the installed CLI.
6. Real ACME HTTP-01 issuance/renewal succeeds; after bounded worker convergence, the served certificate serial exactly matches the renewed leaf.
7. Unavailable CA causes address-change failure; original domain/proxy/environment and healthy business data are restored.

Official Pebble test CA: v2.10.1, source commit `b1e1ca4f3c30abb64111adaca4544bc5374cc306`, binary SHA-256 `4f2fcb5bca8c85c9cf73ad140fccfc0d2be40bd81ab99879c79b7b8a0b4f70ed`. No challenge/TLS validation is skipped. Test CA trust/hostname records exist only on that disposable VM. This is not live Let's Encrypt verification on the customer's domain.

[Regression CI42329177641](https://github.com/Cat-Ghost-Community/1beng/actions/runs/42329177641) passed all three jobs:468 application tests,215 real PostgreSQL tests,48 protected HTTP/browser groups, typecheck, production build, tool compilation, inventory and dependency audit. No reported vulnerabilities; lint0errors/124 existing warnings. Standard Linux installer/update/code-rollback/recovery also passed.

[Network CI42329177536](https://github.com/Cat-Ghost-Community/1beng/actions/runs/42329177536) passed all17 loopback-only network-namespace groups.

Intermediate failures were corrected, not counted as passes: dumb-HTTP fixture transport, missing interruption-harness log variable, non-executable official test archive binary, and an assertion preceding asynchronous Nginx reload convergence. Credential testing also exposed that `GIT_CURL_VERBOSE=0` enables tracing; relevant trace variables are now unset. No real credential was used in those attempts.

Actual production DNS/routing, live GitHub credentials, real-domain CA issuance, off-host recovery and non-Ubuntu24 target verification remain operator acceptance gates. Separate business/PostgreSQL commercial-release blockers remain unchanged. No original business data or production host was touched.
