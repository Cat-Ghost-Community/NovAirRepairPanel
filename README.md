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

## 1. Private repository access: SSH deploy key

This repository is **currently private**. Anonymous raw downloads/clones will fail. Configure access as **root**, the identity used for release fetches, rather than only in your personal SSH account.

```bash
sudo -i
install -d -m 700 /root/.ssh
# Choose a new filename. Never overwrite an existing key.
ssh-keygen -t ed25519 -f /root/.ssh/repaid_github -C 'repaid-server-readonly'
cat /root/.ssh/repaid_github.pub
```

GitHub: **repository > Settings > Deploy keys > Add deploy key**. Paste the public key; read-only access is enough. Never commit the private key.

Verify the server fingerprint against [GitHub's official fingerprints](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints), then test:

```bash
ssh -i /root/.ssh/repaid_github -o IdentitiesOnly=yes -T git@github.com
```

The successful GitHub greeting normally exits with code **1**, not 0 ([official explanation](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/testing-your-ssh-connection?platform=linux)). Do not disable host-key checking. A passphrase-protected key needs an unlocked agent in the root shell used for future updates:

```bash
eval "$(ssh-agent -s)"
ssh-add /root/.ssh/repaid_github
```

## 2. One-command installation

**Private repository: complete the SSH deploy-key setup above first.** Run this command in the root shell opened with `sudo -i`. Git must be installed, and `/root/repaid-source` must not already exist.

Use the **Copy** icon in the upper-right corner of the code block to copy the complete command. It clones the private repository, selects the CI-verified source commit and starts the interactive Linux wizard.

```bash
GIT_SSH_COMMAND='ssh -i /root/.ssh/repaid_github -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes' \
  git clone --branch main git@github.com:Cat-Ghost-Community/NovAirRepairPanel.git /root/repaid-source && \
  cd /root/repaid-source && \
  git checkout --detach cc3f42dbb207f65cfff51fd49d0a8462664cc3f1 && \
  REPAID_SSH_IDENTITY_FILE=/root/.ssh/repaid_github bash setup.sh --ref cc3f42dbb207f65cfff51fd49d0a8462664cc3f1
```

Keep the terminal open and follow the wizard. Each step runs only after the previous step succeeds. No token is embedded in the command, and SSH host-key verification remains enabled.

**Already installed?** Use the [management/update instructions](#update-and-code-rollback) instead of cloning over an existing installation. The pinned installer checks passed; this is not a commercial production-readiness certificate. For a newer reviewed release, replace both commit references together.

The wizard asks for:

1. **Domain or IPv4.** Domain mode obtains Let's Encrypt TLS. IP mode uses a self-signed certificate requiring explicit client trust; no public IP is guessed.
2. **Certificate contact email**, for domain TLS. This does not grant admin access.
3. **Paths and private port.** Safe defaults or custom separate code/data/backup paths. Port collisions are checked without displacing other applications.
4. **Real company owner:** email, name and a repeated hidden password of 12-1024 characters. No demo/default account is created.
5. **Review and confirmation.** Installation is not reported complete until backend/database, HTTPS and initial encrypted recovery verification succeed.

SMTP, SMS and payment credentials are not invented. Configure this project's actual domestic integrations through their supported settings/private environment.

If Git is not yet installed, copy the reviewed `setup.sh` to the server using SSH/SCP and run that saved bootstrap with the same repository/ref/key options. It installs Git before fetching its complete module set. Node, build tools and application services do not require manual package installation.

### Public repository: download bootstrap first

**Only after repository visibility becomes public**, no-auth download works:

```bash
RELEASE=cc3f42dbb207f65cfff51fd49d0a8462664cc3f1
curl -fSL --proto '=https' --proto-redir '=https' \
  "https://raw.githubusercontent.com/Cat-Ghost-Community/NovAirRepairPanel/$RELEASE/setup.sh" -o /tmp/repaid-setup.sh &&
# Review the downloaded file before sudo.
sudo bash /tmp/repaid-setup.sh --repo https://github.com/Cat-Ghost-Community/NovAirRepairPanel.git --ref "$RELEASE"
```

Do not pipe `manage.sh` alone into Bash: it requires its version-matched `deploy/wizard/` modules. Saving the bootstrap first also permits interactive questions.

### Private HTTPS alternative: token file

Use a fine-grained GitHub token scoped to this repository with **Contents: Read-only**. Keep it root-only, never in a repository URL, command argument, committed environment or pasted history line.

```bash
sudo -i
umask 077
read -rsp 'GitHub read-only token: ' TOKEN; printf '\n'
printf '%s\n' "$TOKEN" > /root/repaid-github-token
unset TOKEN
RELEASE=cc3f42dbb207f65cfff51fd49d0a8462664cc3f1
HEADER=$(mktemp /root/repaid-curl.XXXXXX)
printf 'header = "Authorization: Bearer %s"\n' "$(cat /root/repaid-github-token)" > "$HEADER"
curl -fSL --proto '=https' --proto-redir '=https' --config "$HEADER" \
  "https://raw.githubusercontent.com/Cat-Ghost-Community/NovAirRepairPanel/$RELEASE/setup.sh" -o /root/repaid-setup.sh || { rm -f -- "$HEADER"; exit 1; }
rm -f -- "$HEADER"
# Review the bootstrap.
REPAID_GITHUB_TOKEN_FILE=/root/repaid-github-token bash /root/repaid-setup.sh \
  --repo https://github.com/Cat-Ghost-Community/NovAirRepairPanel.git --ref "$RELEASE"
```

The bootstrap and subsequent Git fetches use private askpass authentication. Authenticating only the initial curl does **not** authorize later Git requests. Key/token **paths**, not secret contents, are retained for updates. Expired credentials fail explicitly.

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
