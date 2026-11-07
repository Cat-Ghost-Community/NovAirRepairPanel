# Linux deployment and recovery

Use the [README wizard guide](README.md) for the actual private-repository SSH/PAT bootstrap, supported hosts, owner credentials and commands. This repository is private; anonymous clone/raw download is not an installation path until visibility changes deliberately.

## Supported deployment

Ubuntu22.04/24.04 or Debian12/13, real systemd, x64/arm64, Node24, durable local storage and one web process. The current default database is SQLite. Production PostgreSQL selection remains blocked pending the documented migration gates. Do not use serverless ephemeral storage, a shared network SQLite file or unreviewed multiple writers/replicas.

The wizard separates /opt/repaid releases, /var/lib/repaid data, /var/backups/repaid recovery and /etc/repaid private configuration. Existing service/environment names remain intentionally compatible. Root repository credentials are never embedded in Git URLs, app bundles or build-user environments.

## Before deployment

1. Select a reviewed commit from Cat-Ghost-Community/NovAirRepairPanel; verify repository credentials in the root context.
2. Provide real domain/IP settings, DNS/ports and a strong real owner credential. Never use synthetic fixtures or sample passwords.
3. Verify storage capacity/permissions, key custody and recovery requirements. Keep original encryption and backup keys.
4. Validate actual target TLS, providers, branch permissions, supported business workflows and off-host restoration. CI does not certify those external conditions.

## Daily operations

Use sudo repaid for guarded update, rollback, service control, certificate/address changes, backups and doctor. Updates pin/build before downtime and create/rehearse a verified recovery set before cutover. Code rollback preserves current data and refuses incompatible schema rollback.

Restore only into a new offline destination first. Verify integrity, referenced objects, original keys and financial reconciliation before separately authorizing live activation. Clean reinstall resets active business data only with exact site-bound confirmation; originals and encrypted recovery remain private. Unknown/interrupted state blocks further mutation until the documented recovery command succeeds.

## Recovery and retention

- Preserve /etc/repaid/repaid.env, backup.env and the corresponding recovery sets under separate private key custody.
- Test actual restoration and verified second copies; same-disk copies do not establish off-host resilience.
- Approve service-user permissions and systemd write allowlists for external/mounted backup destinations.
- Do not automatically delete retired original/failed-reset evidence. Apply a reviewed retention policy.
- Never reset or rewrite disputed financial history to make a reconciliation check pass.

Runbooks: [recovery sets](docs/recovery-sets.md), [controlled activation](docs/recovery-activation.md), [attachment migration](docs/attachment-migration.md), [legacy credit migration](docs/legacy-credit-migration.md), [prepared offline releases](docs/network-independence/DEPLOYMENT.md).

## Existing installations using the legacy repository

Do not replace persistent paths or keys, or blindly re-run a new installation over an unmanaged tree. The old wizard intentionally rejects an unreviewed repository change. Use a reviewed checkout and an explicit operator-approved repository/configuration handover after backup/rehearsal; do not bypass that guard. Fresh installations use the new repository defaults.
