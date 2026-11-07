# NovAirRepairPanel

Next.js, React, TypeScript and Tailwind. Persian RTL, branch controls, repair workflows, inventory and accounting.

> **Linux deployment only.** Windows/demo launchers are retired. The installer is verified separately from commercial readiness: outstanding financial/PostgreSQL release gates still apply. Overall product status remains **NOT READY FOR PRODUCTION**. See [release status](https://github.com/Cat-Ghost-Community/NovAirRepairPanel/blob/8f713549ba7584edb301f31082b111a44ca8c901/FINAL_REPORT.md).

## Requirements

| Component | This project's actual requirement |
|---|---|
| OS | Ubuntu **22.04 / 24.04 LTS**, Debian **12 / 13**, real systemd |
| Architecture | x64 or arm64 |
| Node.js | **24.x**; wizard provisions checksum-verified **24.16.0** when needed |
| npm | Matching npm supplied with the selected Node runtime |
| Database | Built-in Node SQLite on durable local storage; production PostgreSQL migration remains gated |
| Memory | Minimum **3 GiB RAM + swap** for builds; **4 GiB RAM recommended** |
| Disk | Minimum **12 GiB free**, plus business data and retained backups |
| Access | Root/sudo, repository access, package/Node download access during preparation |
| Domain mode | Correct DNS and reachable TCP **80/443** |

The reference project's Node18/20, PostgreSQL14 and Ubuntu20.04 requirements do not apply. This wizard uses **systemd**, not PM2/Prisma; one web process serves one business with multiple branches. It does not reset the firewall, upgrade the whole OS, change swap or steal another site's port.

## 1. One-command installation

Download the bootstrap, then run the interactive wizard. No manual clone, release checkout or Node installation is needed. Use the **Copy** button on the code block. This repository is currently **private**.

### Public repository

Only works if the repository is made public:

```bash
curl -fsSL https://raw.githubusercontent.com/Cat-Ghost-Community/NovAirRepairPanel/main/setup.sh \
  -o "$HOME/novair-setup.sh" && sudo bash "$HOME/novair-setup.sh"
```

### Private repository (current)

Create a [fine-grained GitHub token](https://github.com/settings/personal-access-tokens/new) for **this repository only**, with **Contents: Read-only**. This command asks for it without placing the secret in shell history or curl's command arguments:

```bash
read -rsp 'GitHub token: ' TOKEN; printf '\n'
printf 'Authorization: Bearer %s\n' "$TOKEN" | curl -fsSL -H @- \
  https://raw.githubusercontent.com/Cat-Ghost-Community/NovAirRepairPanel/main/setup.sh \
  -o "$HOME/novair-setup.sh" && sudo bash "$HOME/novair-setup.sh"
unset TOKEN
```

The first prompt authorizes the download. If anonymous Git access fails, the wizard asks for the same token again, with hidden input, and stores it in a generated **root-owned, mode 600** file for later release fetches. Its path is saved with installation settings; the secret is never put in the repository URL. Enter **q** to cancel. Failed authentication removes the newly created credential file and does not start installation. Public repositories need no token. Network and invalid-release failures are never reported as successful installation.

The bootstrap resolves `main` to one exact commit before launching the installer. To review before execution, download without the `&& sudo bash ...` suffix, inspect the saved file, then run it. For a fixed reviewed release, replace `main` in the URL with its 40-character commit and run `sudo bash "$HOME/novair-setup.sh" --ref REVIEWED_SHA`.

### What the wizard asks

1. **Domain or IPv4.** Domain mode obtains Let's Encrypt TLS. IP mode uses a self-signed certificate requiring explicit client trust.
2. **Certificate contact email**, for domain TLS. This does not grant admin access.
3. **Paths and private port.** Separate code/data/backup paths; collisions are checked without displacing other applications.
4. **Company owner:** email, name and a repeated hidden password of 12-1024 characters. No demo/default account is created.
5. **Review and confirmation.** Installation is complete only after backend/database, HTTPS and initial encrypted recovery verification succeed.

Keep the terminal open. Run the downloaded file rather than piping it into Bash, so interactive prompts retain the terminal. Existing installations offer update, management, doctor or protected clean reinstall; the bootstrap does not authorize a data reset. For daily updates, use the [management instructions](#update-and-code-rollback).

### SSH deploy key / unattended installation

Existing SSH installations remain supported. Add a read-only deploy key to **Settings > Deploy keys**, verify [GitHub's host fingerprints](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints), and use:

```bash
sudo REPAID_SSH_IDENTITY_FILE=/root/.ssh/repaid_github bash "$HOME/novair-setup.sh"
```

For unattended private HTTPS, prepare an ordinary root-owned credential file with mode **600**, then run:

```bash
sudo REPAID_GITHUB_TOKEN_FILE=/root/repaid-github-token bash "$HOME/novair-setup.sh"
```

Without a terminal, missing credentials fail explicitly; no hidden prompt or default owner is used. Preserve the credential file for future updates. Existing `repaid` service/data names and `REPAID_*` options remain compatible. SMS, payment and email credentials must be configured through the application's supported private settings.


## 3. What gets installed

| Item | Default location / behavior |
|---|---|
| Required packages/runtime | Git, curl, OpenSSL, Nginx, Certbot, build tools; verified Node24 |
| Application | `/opt/repaid/releases/COMMIT-SUFFIX`, atomic `/opt/repaid/current` link |
| Build isolation | Separate unprivileged builder; no production secrets/data in builds |
| Private database/attachments | `/var/lib/repaid` |
| Encrypted recovery sets | `/var/backups/repaid` |
| Site configuration | `/etc/repaid/server.conf` |
| App/backup secrets | `/etc/repaid/repaid.env`, `/etc/repaid/backup.env` |
| Process supervision | `repaid.service`, one loopback listener behind Nginx |
| Scheduled backup/check | `repaid-backup.timer`, `repaid-backup-check.timer` |
| TLS renewal | `certbot.timer`; managed Nginx validation/reload hook |
| Management command | `/usr/local/bin/repaid` |
| Private deployment log | `/var/log/repaid/deploy.log` |

Protect encryption and backup keys with separate recovery custody. A same-disk backup does **not** prove off-host recovery.

## 4. Domain/IP and unattended setup

From the reviewed checkout, with repository access configured:

```bash
# Read-only plan.
DOMAIN=repairs.example.com ADMIN_EMAIL=ops@example.com bash setup.sh --plan

# Domain: DNS/port 80 must already work.
DOMAIN=repairs.example.com ADMIN_EMAIL=ops@example.com \
REPAID_SSH_IDENTITY_FILE=/root/.ssh/repaid_github bash setup.sh --ref "$RELEASE"

# IP: replace documentation address with your actual reachable IPv4.
SSL_TYPE=ip SERVER_IP=192.0.2.10 \
REPAID_SSH_IDENTITY_FILE=/root/.ssh/repaid_github bash setup.sh --ref "$RELEASE"
```

For unattended first installation, supply a **root-owned chmod600** `REPAID_OWNER_FILE` containing JSON keys `email`, `name`, `password`, and add `--yes`. Create it privately using an editor/secret manager; never put the real password into shell history.

```bash
DOMAIN=repairs.example.com ADMIN_EMAIL=ops@example.com \
REPAID_OWNER_FILE=/root/repaid-owner.json REPAID_SSH_IDENTITY_FILE=/root/.ssh/repaid_github \
  bash setup.sh --yes --ref "$RELEASE"
```

Unattended setup still requires explicit domain/contact or IP settings. Re-running setup preserves users, data, keys and paths and delegates to guarded updating. Unmanaged existing directories are refused rather than overwritten.

## 5. Daily management

```bash
sudo repaid                 # guided panel
sudo repaid --status
sudo repaid --doctor
sudo repaid --logs
sudo repaid --services
sudo repaid --ssl
sudo repaid --backups
```

The reference-style panel includes smart update, code rollback, protected environment editing, recovery, TLS/domain/IP changes, logs/status, Nginx validation, service control and clean reinstall. Small terminals use a compact menu.

### Update and code rollback

```bash
sudo repaid --smart-update --ref REVIEWED_BRANCH_OR_COMMIT
sudo repaid --rollback
```

Updates pin the fetched commit, build before downtime, verify every privileged management source against Git, create an encrypted complete snapshot and rehearse on a restored copy before cutover. A failed candidate is not reported as successful.

For an older management version already using this repository, use the new **reviewed root-owned checkout**: `bash /root/repaid-source/manage.sh --smart-update --ref REVIEWED_SHA`. Afterwards `sudo repaid` follows the active release automatically.

An existing installation configured for the legacy `1beng` repository needs a separately reviewed repository handover, with backup and original keys preserved. Its guard intentionally rejects a silent repository change. Do not run a fresh installation over that data; follow [deployment handover guidance](https://github.com/Cat-Ghost-Community/NovAirRepairPanel/blob/8f713549ba7584edb301f31082b111a44ca8c901/DEPLOYMENT.md).

Rollback preserves **current business data** and rejects incompatible schema rollback. It never silently restores an older database over newer transactions. Keys, owner credentials and provider settings are retained. Source installation/build needs prepared package/Git access; an uncached offline build is not promised. See [prepared offline releases](https://github.com/Cat-Ghost-Community/NovAirRepairPanel/blob/8f713549ba7584edb301f31082b111a44ca8c901/docs/network-independence/DEPLOYMENT.md).

### Backup, offline restore and scheduling

```bash
sudo repaid --backup-only
sudo repaid --backups
sudo repaid --backup-interval 30
```

Recovery Center creates encrypted database-plus-attachment sets, verifies current/retained sets, shows schedules/logs and restores to a **new offline directory**. It never activates restored data over the live business. Review integrity, keys and financial reconciliation before a separately approved cutover.

Intervals are 5-60 minutes, compatible with the existing two-hour freshness gate. Updates refuse to kill active backup jobs. Configure verified second-copy/off-host storage using the real backup settings; the wizard does not invent a remote destination.

For a mounted off-host target, also approve its service-user permissions and systemd `ReadWritePaths` explicitly; do not broadly disable service hardening. Verify an actual restored second copy before treating it as disaster recovery.

### TLS and address changes

```bash
sudo repaid --ssl
sudo REPAID_NEW_DOMAIN=repairs.example.com REPAID_NEW_ADMIN_EMAIL=ops@example.com \
  repaid --change-address
sudo repaid --renew-ip           # IP mode only; clients must trust the new fingerprint
sudo repaid --address-recover    # interrupted address change
```

Let's Encrypt needs correct DNS, reachable HTTP challenges and CA connectivity. Renewal validates/reloads Nginx through the managed deploy hook. Self-signed IP certificates are never called publicly trusted.

Address changes retain private rollback configuration and preserve keys/database. Failed validation restores the original proxy/environment. Interrupted changes leave a recovery marker and block other mutations. Other sites and firewall rules are not reset.

Updates, address changes and resets use a controlled maintenance window; zero downtime is not promised. Certificate-authority access is required for issuance/renewal even though normal browser assets are first-party.

### Clean reinstall: fresh active data, retained recovery

```bash
sudo repaid --clean-reinstall-plan
sudo repaid --clean-reinstall
sudo repaid --reinstall-recover   # interrupted reset only
```

**This resets ACTIVE business data, users and sessions.** First, a complete encrypted snapshot is verified and restoration rehearsed. The original database/attachments are retained in a root-only sibling archive. A fresh database/new owner is initialized and independently backed up before reopening access. Infrastructure secrets/TLS remain intact so historical recovery stays possible.

This is **not secure erasure**, deletion of financial evidence or a PostgreSQL database/role drop. Archives are never automatically deleted. Mounted, symlinked, overlapping or unsupported data layouts are blocked and need a reviewed migration.

Existing installs default to **Update**, never wipe. `CLEAN_INSTALL=1`, `FORCE_ENV=1` and generic `--yes` do not bypass safeguards. Deliberate automation needs the explicit action, new private owner file and exact site-bound confirmation:

```bash
sudo REPAID_REINSTALL_CONFIRM='WIPE https://repairs.example.com' \
  REPAID_OWNER_FILE=/root/new-owner.json repaid --clean-reinstall
```

Failed initialization restores the retained original when safe. A power interruption/SIGKILL leaves `/etc/repaid/reinstall.json`; review and use `--reinstall-recover` with exact `RECOVER https://SITE` confirmation. Unknown configuration/data changes block recovery rather than overwriting evidence. Ordinary code rollback cannot undo a successful reset.

Do not automatically retry a clean reset after an uncertain result. Inspect its journal/retained evidence first; each explicitly confirmed reset is a new operation.

## Installer settings

| Setting | Default | Meaning |
|---|---|---|
| `--ref` / `REPAID_REF` | `main` | Reviewed branch or 40-character commit; pin production releases |
| `--repo` / `REPAID_REPO` | This repository's SSH URL | GitHub SSH/HTTPS; no embedded credentials |
| `REPAID_SSH_IDENTITY_FILE` | Root SSH configuration | Root-only dedicated deploy key |
| `REPAID_GITHUB_TOKEN_FILE` | Empty | Root-only HTTPS token file |
| `DOMAIN`, `ADMIN_EMAIL` | Prompted | Domain and certificate contact |
| `SSL_TYPE`, `SERVER_IP` | Prompted | Explicit IP/self-signed mode |
| `REPAID_APP_DIR` | `/opt/repaid` | Dedicated code/release root |
| `REPAID_DATA_DIR` | `/var/lib/repaid` | Durable private data |
| `REPAID_BACKUP_DIR` | `/var/backups/repaid` | Encrypted recovery storage |
| `REPAID_PORT` |3000 | Preferred private port; collision-aware selection |
| `REPAID_OWNER_FILE` | Prompted secret | Root-only owner JSON for unattended setup/reset |
| `--yes` | Off | Routine confirmations; never implicit wipe authorization |

Changing installed persistent paths, encryption/backup keys or the database engine needs a separate rehearsed migration/recovery procedure, not an ordinary environment edit.

## Troubleshooting and verification

| Problem | First checks |
|---|---|
| Private download/clone denied | Root deploy key/verified known_hosts or scoped token; no anonymous private raw URL |
| Build rejected | Private deploy log, disk/memory reserve, matching Node/npm, package access |
| ACME fails | DNS A/AAAA, port 80, CA connectivity, other Nginx sites; never disable TLS verification |
| Maintenance 503 | Doctor/service logs and any reinstall/address recovery marker |
| Backup stale/invalid | Recovery Center, original keys, free disk, schedules and actual second-copy verification |
| Missing original data/secrets | Stop and recover/adopt deliberately; do not repeatedly initialize empty replacement data |

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run check:network
# Disposable fixtures only, never production credentials/data:
npm run test:network
npm run test:postgres
npm run test:postgres:http
```

Exact evidence/limitations: [wizard report](https://github.com/Cat-Ghost-Community/NovAirRepairPanel/blob/8f713549ba7584edb301f31082b111a44ca8c901/WIZARD_IMPLEMENTATION_REPORT.md). Also see [deployment/recovery](https://github.com/Cat-Ghost-Community/NovAirRepairPanel/blob/8f713549ba7584edb301f31082b111a44ca8c901/DEPLOYMENT.md), [architecture](https://github.com/Cat-Ghost-Community/NovAirRepairPanel/blob/8f713549ba7584edb301f31082b111a44ca8c901/ARCHITECTURE.md), [financial rules](https://github.com/Cat-Ghost-Community/NovAirRepairPanel/blob/8f713549ba7584edb301f31082b111a44ca8c901/FINANCIAL_RULES.md), [PostgreSQL migration](https://github.com/Cat-Ghost-Community/NovAirRepairPanel/blob/8f713549ba7584edb301f31082b111a44ca8c901/POSTGRES_MIGRATION_MASTER_TRACKER.md) and [network isolation](https://github.com/Cat-Ghost-Community/NovAirRepairPanel/blob/8f713549ba7584edb301f31082b111a44ca8c901/docs/network-independence/TEST_REPORT.md). Synthetic test approvals never authorize disputed historical financial corrections.
