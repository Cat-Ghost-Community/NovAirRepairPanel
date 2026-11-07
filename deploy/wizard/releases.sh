#!/usr/bin/env bash
# Immutable candidate builds replace exp's in-place PM2 mutation. SQLite permits
# one live web process, so public maintenance precedes the stop/backup/cutover.
ensure_packages() {
  step 'Installing required system packages (no PostgreSQL/Redis/PM2)'
  DEBIAN_FRONTEND=noninteractive apt-get update || return 1
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends -o Dpkg::Options::=--force-confold \
    ca-certificates curl git xz-utils openssl nginx certbot build-essential python3 iproute2 util-linux nano
}
ensure_node() {
  local version=24.16.0 arch archive temporary expected destination
  case $(uname -m) in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) fail 'Node24 installer supports x64/arm64.'; return 1;; esac
  if [[ -x /usr/bin/node && $(/usr/bin/node --version) == v$version ]]; then NODE_BIN=/usr/bin/node; return; fi
  archive="node-v$version-linux-$arch.tar.xz"; destination="$APP_DIR/runtime/node-v$version-linux-$arch"
  if [[ -x $destination/bin/node && ! -L $destination && -f $destination/REPAID_SHA256 && $($destination/bin/node --version) == v$version ]]; then NODE_BIN="$destination/bin/node"; return; fi
  [[ ! -e $destination && ! -L $destination ]] || { fail 'Unidentified Node runtime; refusing overwrite.'; return 1; }
  temporary=$(mktemp -d /var/tmp/repaid-node.XXXXXX); chmod 700 "$temporary"
  curl -fsSL --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 600 --retry 2 "https://nodejs.org/dist/v$version/SHASUMS256.txt" -o "$temporary/sums" || return 1
  expected=$(awk -v name="$archive" '$2==name {print $1}' "$temporary/sums")
  [[ $expected =~ ^[0-9a-f]{64}$ ]] || { fail 'Official Node checksum unavailable.'; return 1; }
  curl -fsSL --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 600 --retry 2 "https://nodejs.org/dist/v$version/$archive" -o "$temporary/$archive" || return 1
  (cd "$temporary" && printf '%s  %s\n' "$expected" "$archive" | sha256sum -c -) || return 1
  install -d -o root -g root -m 0755 "$destination"
  tar -xJf "$temporary/$archive" --strip-components=1 --no-same-owner -C "$destination" || return 1
  printf '%s\n' "$expected" > "$destination/REPAID_SHA256"; NODE_BIN="$destination/bin/node"
  [[ $($NODE_BIN --version) == v$version ]] || return 1
  [[ $temporary == /var/tmp/repaid-node.* && ! -L $temporary ]] || return 1; rm -rf --one-file-system -- "$temporary"
}
ensure_identities() {
  local account home
  for account in "$SERVICE" "$BUILD_USER"; do
    if [[ $account == "$SERVICE" ]]; then home=$DATA_DIR; else home=/var/lib/repaid-build; fi
    groupadd --system -f "$account" || return 1
    if id "$account" >/dev/null 2>&1; then
      [[ $(id -u "$account") != 0 && $(getent passwd "$account" | cut -d: -f6) == "$home" ]] || { fail "Existing account $account belongs to another installation."; return 1; }
    else useradd --system --gid "$account" --home-dir "$home" --no-create-home --shell /usr/sbin/nologin "$account" || return 1; fi
    install -d -o "$account" -g "$account" -m 0700 "$home" || return 1
  done
  install -d -o "$SERVICE" -g "$SERVICE" -m 0700 "$DATA_DIR/objects" "$DATA_DIR/backup-work" "$DATA_DIR/restores" "$BACKUP_DIR"
}
resource_preflight() {
  local available memory parent=$APP_DIR
  while [[ ! -d $parent ]]; do parent=$(dirname "$parent"); done
  available=$(df -Pk "$parent" | awk 'NR==2 {print $4}')
  [[ $available =~ ^[0-9]+$ ]] && ((available >= 12582912)) || { fail 'At least 12 GiB free disk is required for candidate build, backup and unchanged reserves.'; return 1; }
  memory=$(awk '/MemTotal:|SwapTotal:/ {n+=$2} END {print n}' /proc/meminfo)
  ((memory >= 3145728)) || { fail 'Provide at least 3 GiB RAM+swap for building (4 GiB RAM recommended). No swap was changed.'; return 1; }
}
configure_git_auth() {
  export GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND='ssh -o BatchMode=yes -o StrictHostKeyChecking=yes'
  unset GIT_TRACE GIT_TRACE_PACKET GIT_TRACE_CURL GIT_CURL_VERBOSE GIT_TRACE2 GIT_TRACE2_EVENT GIT_TRACE2_PERF
  if [[ -n ${SSH_IDENTITY_FILE:-} ]]; then
    valid_path "$SSH_IDENTITY_FILE" && assert_secret_file "$SSH_IDENTITY_FILE" || return 1
    [[ $GIT_REPO == git@github.com:* ]] || { fail 'An SSH identity file requires the SSH repository URL.'; return 1; }
    export GIT_SSH_COMMAND="ssh -i $SSH_IDENTITY_FILE -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes"
  fi
  if [[ -n ${GITHUB_TOKEN_FILE:-} ]]; then
    valid_path "$GITHUB_TOKEN_FILE" && assert_secret_file "$GITHUB_TOKEN_FILE" || return 1
    [[ $GIT_REPO == https://github.com/* ]] || { fail 'A token file requires the HTTPS repository URL; use a deploy key for SSH.'; return 1; }
    export REPAID_GITHUB_TOKEN_FILE=$GITHUB_TOKEN_FILE GIT_ASKPASS="$WIZARD_ROOT/deploy/wizard/git-askpass.sh"
    [[ -x $GIT_ASKPASS && ! -L $GIT_ASKPASS ]] || return 1
  fi
}
fetch_release() {
  local cache="$APP_DIR/repository.git" sha line ref
  if [[ ! -d $cache ]]; then git init --bare "$cache" >/dev/null; fi
  [[ ! -L $cache ]] || return 1
  configure_git_auth || return 1
  if [[ $GIT_REF =~ ^[0-9a-f]{40}$ ]]; then sha=$GIT_REF
  else
    line=$(git -c credential.helper= ls-remote --exit-code "$GIT_REPO" "refs/heads/$GIT_REF") || { fail 'Repository access failed. Review the root deploy key/known_hosts or private HTTPS token file.'; return 1; }
    IFS=$'\t' read -r sha ref <<< "$line"; [[ $sha =~ ^[0-9a-f]{40}$ && $ref == "refs/heads/$GIT_REF" ]] || return 1
  fi
  git -c credential.helper= --git-dir="$cache" fetch --depth=1 "$GIT_REPO" "$sha" || return 1
  [[ $(git --git-dir="$cache" rev-parse FETCH_HEAD) == "$sha" ]] || return 1
  RELEASE_SHA=$sha
}
verify_control_sources() {
  local candidate=$1 control parent list count=0
  # npm/build hooks run as the builder, never as root. Do not promote any
  # hook-modified management code into the next root-executed release.
  [[ ! -L $candidate/deploy && ! -L $candidate/deploy/wizard ]] || return 1
  list=$(mktemp "$APP_DIR/.control-list.XXXXXX") || return 1
  git --git-dir="$APP_DIR/repository.git" ls-tree -rz --name-only "$RELEASE_SHA" -- setup.sh install.sh deploy.sh manage.sh deploy/wizard deploy/repaid-backup.timer deploy/repaid-backup-check.timer > "$list" || { rm -f -- "$list"; return 1; }
  while IFS= read -r -d '' control; do
    parent=${control%/*}; while [[ $parent != "$control" && $parent != . ]]; do [[ ! -L $candidate/$parent ]] || { rm -f -- "$list"; return 1; }; [[ $parent == */* ]] || break; parent=${parent%/*}; done
    [[ -f $candidate/$control && ! -L $candidate/$control ]] || { rm -f -- "$list"; return 1; }
    git --git-dir="$APP_DIR/repository.git" show "$RELEASE_SHA:$control" | cmp -s - "$candidate/$control" || { rm -f -- "$list"; fail 'Build changed privileged management sources; candidate rejected.'; return 1; }
    ((count+=1))
  done < "$list"
  rm -f -- "$list"; ((count>=8))
}
build_candidate() {
  local suffix candidate npm_cli
  suffix=$(openssl rand -hex 6); candidate="$APP_DIR/releases/$RELEASE_SHA-$suffix"
  install -d -o root -g "$SERVICE" -m 0751 "$APP_DIR/releases"
  mkdir -- "$candidate" || return 1; git --git-dir="$APP_DIR/repository.git" archive "$RELEASE_SHA" | tar -x --no-same-owner -C "$candidate" || return 1
  [[ -f $candidate/manage.sh && -f $candidate/package-lock.json && -f $candidate/deploy/wizard/core.sh ]] || { fail 'Selected revision has no compatible Repaid installer.'; return 1; }
  chown -Rh "$BUILD_USER:$BUILD_USER" "$candidate" || return 1
  npm_cli="$(dirname "$NODE_BIN")/../lib/node_modules/npm/bin/npm-cli.js"
  if [[ ! -f $npm_cli ]]; then npm_cli=/usr/share/nodejs/npm/bin/npm-cli.js; fi
  [[ -f $npm_cli ]] || { fail 'npm for the selected Node24 runtime is missing.'; return 1; }
  step "Building isolated candidate ${RELEASE_SHA:0:12}"
  (cd "$candidate" && runuser -u "$BUILD_USER" -- env -i \
    PATH="$(dirname "$NODE_BIN"):/usr/bin:/bin" HOME=/var/lib/repaid-build USER="$BUILD_USER" LANG=C.UTF-8 \
    NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 REPAID_DEMO_MODE=0 NEXT_BUILD_CPUS=1 \
    NODE_OPTIONS=--max-old-space-size=2048 "$NODE_BIN" "$npm_cli" ci --include=dev) >> "$DEPLOY_LOG" 2>&1 || { fail "Dependency install failed; active release unchanged. See $DEPLOY_LOG"; return 1; }
  (cd "$candidate" && runuser -u "$BUILD_USER" -- env -i \
    PATH="$(dirname "$NODE_BIN"):/usr/bin:/bin" HOME=/var/lib/repaid-build USER="$BUILD_USER" LANG=C.UTF-8 \
    NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 REPAID_DEMO_MODE=0 NEXT_BUILD_CPUS=1 \
    NODE_OPTIONS=--max-old-space-size=2048 "$NODE_BIN" "$npm_cli" run build && \
    runuser -u "$BUILD_USER" -- env -i PATH="$(dirname "$NODE_BIN"):/usr/bin:/bin" HOME=/var/lib/repaid-build \
    "$NODE_BIN" "$npm_cli" run db:build-tools) >> "$DEPLOY_LOG" 2>&1 || { fail "Build failed; active release unchanged. See $DEPLOY_LOG"; return 1; }
  [[ -f $candidate/.next/BUILD_ID && -f $candidate/.database-tools/deployment.cjs ]] || return 1
  [[ ! -e $candidate/data/repaid.db ]] || { fail 'Build unexpectedly opened a database; candidate rejected.'; return 1; }
  verify_control_sources "$candidate" || return 1
  printf '%s\n' "$RELEASE_SHA" > "$candidate/RELEASE_SHA" || return 1
  chown -Rh "root:$SERVICE" "$candidate" || return 1
  find -P "$candidate" -type d -exec chmod 0750 {} + || return 1
  find -P "$candidate" -type f -exec chmod g+rX,g-w,o-rwx {} + || return 1
  local cache
  for cache in .next/cache .next/server/route-cache; do
    [[ ! -L $candidate/$cache ]] || { fail 'Unexpected runtime cache symlink.'; return 1; }
    mkdir -p "$candidate/$cache" && chown -Rh "$SERVICE:$SERVICE" "$candidate/$cache" || return 1
  done
  CANDIDATE=$candidate
}
snapshot_before_update() {
  local release=$1 output
  output="$BACKUP_DIR/pre-deploy-$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 6).rpset"
  run_app "$release" recovery-set snapshot "$DATA_DIR/repaid.db" "$output" >> "$DEPLOY_LOG" 2>&1 || return 1
  BACKUP_SET=$output; info "Verified pre-update recovery set: $output"
}
pause_backup_timers() {
  systemctl stop repaid-backup.timer repaid-backup-check.timer || return 1
  local unit state
  for unit in repaid-backup.service repaid-backup-check.service; do
    state=$(systemctl show "$unit" --property=ActiveState --value) || return 1
    case $state in inactive|failed) ;; *) systemctl start repaid-backup.timer repaid-backup-check.timer; fail 'A backup/check is running; retry update after it finishes. No active job was killed.'; return 1;; esac
  done
}
resume_backup_timers() { systemctl start repaid-backup.timer repaid-backup-check.timer; }
smart_update() {
  require_root && require_linux && load_config && site_lock && resource_preflight || return 1
  [[ -z ${REQUESTED_REPO:-} || $REQUESTED_REPO == "$GIT_REPO" ]] || { fail 'Repository changes require a separate reviewed installation.'; return 1; }
  [[ -z ${REQUESTED_REF:-} ]] || { GIT_REF=$REQUESTED_REF; validate_config || return 1; }
  local old before after
  old=$(readlink -f "$APP_DIR/current"); assert_release "$old" || return 1
  fetch_release || return 1; confirm_exact UPDATE "deploy reviewed commit $RELEASE_SHA" || return 1
  build_candidate || return 1
  pause_backup_timers || return 1
  touch "$MAINTENANCE_FILE"; chmod 0644 "$MAINTENANCE_FILE"
  systemctl stop "$SERVICE" || return 1
  if ! snapshot_before_update "$old" || ! run_app "$CANDIDATE" deployment rehearse "$BACKUP_SET" >> "$DEPLOY_LOG" 2>&1; then
    systemctl start "$SERVICE" && backend_health && resume_backup_timers && rm -f -- "$MAINTENANCE_FILE"
    fail 'Update blocked during backup/rehearsal. Previous release retained.'; return 1
  fi
  before=$(run_app "$old" deployment inspect | "$NODE_BIN" -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).schema_sha256') || return 1
  PREVIOUS_RELEASE=$old; PREVIOUS_SCHEMA=$before; save_config || return 1
  run_app "$CANDIDATE" deployment migrate --apply >> "$DEPLOY_LOG" 2>&1 || { systemctl start "$SERVICE"; fail 'Atomic schema application failed; maintenance remains for review.'; return 1; }
  activate_link "$CANDIDATE" && write_services && systemctl start "$SERVICE" || return 1
  if ! backend_health; then
    systemctl stop "$SERVICE" || return 1
    after=$(run_app "$CANDIDATE" deployment inspect | "$NODE_BIN" -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).schema_sha256') || return 1
    if [[ $after == "$before" ]]; then activate_link "$old" && systemctl start "$SERVICE" && backend_health && resume_backup_timers && rm -f -- "$MAINTENANCE_FILE"; fi
    fail 'Candidate failed. No database was restored; schema-changing recovery requires review. Check service logs.'; return 1
  fi
  resume_backup_timers && rm -f -- "$MAINTENANCE_FILE" || return 1
  public_health || { touch "$MAINTENANCE_FILE"; fail 'HTTPS proxy verification failed; maintenance retained.'; return 1; }
  info "Healthy release active: $RELEASE_SHA"
}
rollback_code() {
  require_root && require_linux && load_config && site_lock || return 1
  [[ -n ${PREVIOUS_RELEASE:-} && -n ${PREVIOUS_SCHEMA:-} ]] || { fail 'No prior managed release recorded.'; return 1; }
  assert_release "$PREVIOUS_RELEASE" || return 1
  local current schema_now; current=$(readlink -f "$APP_DIR/current")
  confirm_exact ROLLBACK 'roll back code only, preserving all current data' || return 1
  pause_backup_timers || return 1
  touch "$MAINTENANCE_FILE"; systemctl stop "$SERVICE" || return 1
  schema_now=$(run_app "$current" deployment inspect | "$NODE_BIN" -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).schema_sha256') || return 1
  if [[ $schema_now != "$PREVIOUS_SCHEMA" ]]; then systemctl start "$SERVICE"; fail 'Schema differs from the previous release. Automatic rollback blocked; no database was replaced.'; return 1; fi
  snapshot_before_update "$current" || return 1
  activate_link "$PREVIOUS_RELEASE" && systemctl start "$SERVICE" && backend_health || return 1
  resume_backup_timers && rm -f -- "$MAINTENANCE_FILE" || return 1; info 'Previous code active; customer data preserved.'
}
