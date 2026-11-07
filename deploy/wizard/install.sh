#!/usr/bin/env bash
gather_settings() {
  APP_DIR=${REPAID_APP_DIR:-/opt/repaid}; DATA_DIR=${REPAID_DATA_DIR:-/var/lib/repaid}; BACKUP_DIR=${REPAID_BACKUP_DIR:-/var/backups/repaid}
  GIT_REPO=${REQUESTED_REPO:-${REPAID_REPO:-$GIT_REPO_DEFAULT}}; GIT_REF=${REQUESTED_REF:-${REPAID_REF:-$GIT_REF_DEFAULT}}; APP_PORT=${REPAID_PORT:-3000}
  DOMAIN=${DOMAIN:-}; SERVER_IP=${SERVER_IP:-}; CONTACT_EMAIL=${ADMIN_EMAIL:-}; SSL_TYPE=${SSL_TYPE:-}
  valid_repo "$GIT_REPO" && valid_ref "$GIT_REF" || { fail 'Review REPAID_REPO/REPAID_REF: use the private GitHub repository and a valid branch or commit.'; return 1; }
  wizard_step 1 3 'Domain or IP mode'
  printf '  %sOption A:%s Enter your domain name.\n' "$C" "$NC"
  printf '            Trusted Let\047s Encrypt TLS; DNS must point here.\n'
  printf '  %sOption B:%s Leave domain empty for IPv4 mode.\n' "$C" "$NC"
  printf '            No DNS needed; clients must trust your certificate.\n'
  printf '  %sEnter q at a setup prompt to cancel.%s\n\n' "$DIM" "$NC"
  if [[ -z $SSL_TYPE ]]; then
    if [[ -n $DOMAIN ]]; then SSL_TYPE=domain
    elif [[ -n $SERVER_IP ]]; then SSL_TYPE=ip
    elif [[ ${HAS_TTY:-0} == 1 ]]; then
      local chosen domain_chosen=0
      while true; do
        chosen=$(ask 'Domain name (leave empty for IP mode)') || return 130
        [[ $chosen != q && $chosen != Q ]] || return 130
        if [[ -z $chosen ]]; then SSL_TYPE=ip; break; fi
        if valid_domain "$chosen"; then DOMAIN=$chosen; SSL_TYPE=domain; domain_chosen=1; break; fi
        warn 'Enter a valid domain such as repairs.example.com; exclude https:// and paths.'
      done
    else fail 'Provide DOMAIN and ADMIN_EMAIL, or SSL_TYPE=ip and SERVER_IP. No address is guessed for unattended installation.'; return 1; fi
  fi
  if [[ $SSL_TYPE == domain ]]; then
    if [[ ${domain_chosen:-0} != 1 ]]; then DOMAIN=$(ask_validated 'Domain pointing to this server' "$DOMAIN" valid_domain 'Use a valid domain without https:// or a path.') || return $?; fi
  elif [[ $SSL_TYPE == ip ]]; then
    SERVER_IP=$(ask_validated 'Server IPv4 address' "$SERVER_IP" valid_ip 'Enter the reachable IPv4 address, for example 192.0.2.10; no port or URL.') || return $?
  else fail 'SSL_TYPE must be domain or ip.'; return 1; fi
  wizard_step 2 3 'Certificate and contact'
  if [[ $SSL_TYPE == domain ]]; then
    printf '  Certificate contact only; this email does not grant admin access.\n'
    CONTACT_EMAIL=$(ask_validated 'SSL notification/contact email' "$CONTACT_EMAIL" valid_email 'A valid email is required for domain TLS.') || return $?
  else
    printf '  IP mode uses self-signed TLS. No certificate contact email is required.\n'
    printf '  Browser trust is manual; public CA verification is not claimed.\n'
  fi
  wizard_step 3 3 'Review installation settings'
  printf '  Code, private business data and encrypted backups stay separate.\n'
  printf '\n  Code:    %s\n  Data:    %s\n  Backups: %s\n  Port:    %s (loopback only)\n\n' "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR" "$APP_PORT"
  if [[ ${HAS_TTY:-0} == 1 ]]; then
    local settings
    menu_item 1 'Keep current storage and port settings (recommended)'
    menu_item 2 'Customize storage locations and preferred port'
    menu_item 0 'Cancel'
    settings=$(ask_choice 'Settings' 1 '0 1 2') || return $?
    [[ $settings != 0 ]] || return 130
    if [[ $settings == 2 ]]; then
      APP_DIR=$(ask_validated 'Code root' "$APP_DIR" valid_app_path 'Use a dedicated directory under /opt, /srv or /var/www.') || return $?
      DATA_DIR=$(ask_validated 'Private data directory' "$DATA_DIR" valid_path 'Use an absolute ordinary directory outside the code root.') || return $?
      BACKUP_DIR=$(ask_validated 'Encrypted backup directory' "$BACKUP_DIR" valid_path 'Use an absolute ordinary directory outside the code root.') || return $?
      APP_PORT=$(ask_validated 'Preferred local application port' "$APP_PORT" valid_port 'Use a port from 1024 to 65535; other applications will not be displaced.') || return $?
    fi
  fi
  validate_config
}
print_plan() {
  divider
  printf '  Source: %s\n  Ref: %s\n  Address: %s\n  Code: %s/releases\n  SQLite/objects: %s\n  Encrypted recovery: %s\n' "$GIT_REPO" "$GIT_REF" "$(origin)" "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR"
  printf '  One loopback web process; dedicated build identity; no demo data.\n'
  printf '  No database wipe, key regeneration or unrelated Nginx/firewall reset.\n'
  divider
}
existing_installation() {
  printf '  %sExisting Installation Found%s\n\n' "$W" "$NC"
  printf '  %s\n  Existing data, users and keys will be preserved.\n\n' "$APP_DIR"
  menu_item 1 'Update / re-deploy (default)' 'Build and verify before replacing the active release.'
  menu_item 2 'Open Management Panel'
  menu_item 3 'Run System Doctor'
  menu_item 4 'Clean Reinstall' 'Reset active business data only after backup and exact site confirmation.'
  menu_item 0 'Cancel'
  local choice; choice=$(ask_choice 'Choice' 1 '0 1 2 3 4') || return $?
  case $choice in 1) smart_update;; 2) main_menu;; 3) doctor;; 4) clean_reinstall;; 0) info 'Cancelled; no installation changes applied.';; esac
}
collect_owner_credentials() {
  printf '\n  %sCompany owner account%s\n' "$W" "$NC"; divider
  printf '  This account manages all branches. No default password is created.\n'
  owner_email=$(ask_validated 'Company owner email' '' valid_email 'Enter a valid owner email.') || return $?
  owner_name=$(ask_validated 'Owner name' 'مدیر سامانه' valid_owner_name 'Enter a name of 1-120 characters.') || return $?
  while true; do
    owner_password=$(ask_secret 'Owner password (12-1024 characters)') || return 130
    # Match bootstrap's JavaScript string-length rules, including Unicode,
    # without exposing the password in process arguments or environment.
    if ! printf '%s' "$owner_password" | "$NODE_BIN" -e 'const value=require("node:fs").readFileSync(0,"utf8");process.exit(value.length>=12&&value.length<=1024?0:1)'; then warn 'Use a password of 12-1024 characters.'; continue; fi
    confirmation=$(ask_secret 'Repeat password') || return 130
    [[ $owner_password == "$confirmation" ]] && break
    warn 'Passwords differ. Please try again; no account has been created.'
  done
}
show_install_complete() {
  show_banner 'Installation Complete'
  printf '  %s%sYour Repaid installation is healthy.%s\n\n' "$G" "$BOLD" "$NC"
  printf '  Site URL:       %s\n  Code directory: %s/current\n  Private data:   %s\n  Recovery sets:  %s\n\n' "$(origin)" "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR"
  divider
  printf '  %sUseful commands%s\n\n' "$W" "$NC"
  printf '  sudo repaid                 # management panel\n  sudo repaid --logs          # application logs\n  sudo repaid --doctor        # database and recovery checks\n\n'
  if [[ $SSL_TYPE == ip ]]; then warn 'Self-signed TLS: verify and trust the certificate on each client. Public CA trust is not enabled.'; fi
  printf '  Next: sign in with your owner account; configure branches and staff.\n'
  printf '  Retain /etc/repaid/repaid.env and backup.env under separate, private key custody.\n'
  printf '  Note: Off-host recovery and commercial accounting acceptance require separate verification.\n'
}
fresh_install() {
  require_root && require_linux && site_lock || return 1
  show_banner 'Setup Wizard'
  if [[ -f $CONFIG_FILE ]]; then
    load_config || return 1
    if [[ ${INSTALL_STATE:-} == installed ]]; then
      if [[ ${HAS_TTY:-0} == 1 && ${ASSUME_YES:-0} != 1 ]]; then existing_installation; else smart_update; fi
      return $?
    fi
    [[ ${INSTALL_STATE:-} == provisioning ]] || { fail 'Unknown installation state; inspect saved configuration.'; return 1; }
    info 'Resuming incomplete setup with original keys and data.'
  else
    gather_settings || return 1; print_plan
    local folder
    for folder in "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR"; do
      [[ ! -L $folder && $(readlink -m "$folder") == "$folder" ]] || { fail 'Symlinked installation roots require manual review.'; return 1; }
      if [[ -d $folder && -n $(find "$folder" -mindepth 1 -maxdepth 1 -print -quit) ]]; then fail "Existing unmanaged directory: $folder. No data or keys overwritten; see adoption guidance."; return 1; fi
    done
    for folder in /etc/systemd/system/repaid.service /etc/systemd/system/repaid-backup.service /etc/systemd/system/repaid-backup-check.service /etc/systemd/system/repaid-backup.timer /etc/systemd/system/repaid-backup-check.timer /etc/nginx/sites-available/repaid /etc/nginx/sites-enabled/repaid /usr/local/bin/repaid; do
      [[ ! -e $folder && ! -L $folder ]] || { fail "Existing unmanaged service/site/command: $folder"; return 1; }
    done
    confirm_exact INSTALL 'install this configuration' || return 1
    INSTALL_STATE=provisioning; PREVIOUS_RELEASE=''; PREVIOUS_SCHEMA=''; save_config || return 1
  fi
  progress_step 1 8 'Prepare host, storage and private service accounts'
  install -d -o root -g root -m 0755 "$APP_DIR"
  resource_preflight && ensure_packages && ensure_identities && ensure_node || return 1
  local parent=$DATA_DIR filesystem
  filesystem=$(findmnt -no FSTYPE -T "$parent") || return 1
  case $filesystem in nfs*|cifs|smb*|fuse.sshfs) fail 'SQLite requires local durable storage, not a shared network filesystem.'; return 1;; esac
  APP_PORT=$(select_app_port) || return 1; save_config || return 1
  progress_step 2 8 'Preserve encryption keys and protected configuration'
  "$NODE_BIN" "$WIZARD_ROOT/deploy/wizard/host.cjs" env-init "$APP_ENV" "$BACKUP_ENV" "$DATA_DIR" "$BACKUP_DIR" "$(origin)" "$(id -g "$SERVICE")" || return 1
  assert_root_file "$APP_ENV" && assert_root_file "$BACKUP_ENV" || return 1
  progress_step 3 8 'Fetch and build the pinned release; details stay in the private log'
  fetch_release && build_candidate || return 1
  progress_step 4 8 'Verify or create the company owner'
  local users owner_email owner_name owner_password confirmation
  users=$(run_app "$CANDIDATE" deployment inspect | "$NODE_BIN" -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).users') || return 1
  if [[ $users == 0 ]]; then
    if [[ -n ${REPAID_OWNER_FILE:-} ]]; then
      assert_secret_file "$REPAID_OWNER_FILE" || return 1
      "$NODE_BIN" -e 'const fs=require("fs"),v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));for(const k of ["email","password","name"]){if(typeof v[k]!=="string"||v[k].includes("\0"))throw Error("Invalid owner input");process.stdout.write(v[k]+"\0")}' "$REPAID_OWNER_FILE" | run_app "$CANDIDATE" deployment bootstrap >> "$DEPLOY_LOG" 2>&1 || return 1
    else
      [[ ${HAS_TTY:-0} == 1 ]] || { fail 'For unattended setup provide a private REPAID_OWNER_FILE; no default password is created.'; return 1; }
      collect_owner_credentials || return $?
      printf '%s\0%s\0%s\0' "$owner_email" "$owner_password" "$owner_name" | run_app "$CANDIDATE" deployment bootstrap >> "$DEPLOY_LOG" 2>&1 || return 1
      unset owner_password confirmation
    fi
  else info 'Existing owner retained; no account or password reset.'; fi
  progress_step 5 8 'Configure this application service and TLS proxy'
  touch "$MAINTENANCE_FILE"; chmod 0644 "$MAINTENANCE_FILE"
  if [[ -f /etc/systemd/system/repaid.service ]]; then
    grep -q '^# Managed by Repaid wizard$' /etc/systemd/system/repaid.service || { fail 'An unmanaged service appeared; no process stopped.'; return 1; }
    systemctl stop "$SERVICE" || return 1
  fi
  activate_link "$CANDIDATE" && write_services && setup_tls || return 1
  progress_step 6 8 'Start one web process and verify its database health'
  systemctl enable --now "$SERVICE" && backend_health || return 1
  progress_step 7 8 'Create and independently verify the initial encrypted recovery set'
  run_app "$CANDIDATE" scheduled >> "$DEPLOY_LOG" 2>&1 && run_app "$CANDIDATE" recovery-set check >> "$DEPLOY_LOG" 2>&1 || { fail 'Initial complete backup verification failed; maintenance remains.'; return 1; }
  systemctl enable --now repaid-backup.timer repaid-backup-check.timer || return 1
  progress_step 8 8 'Install management command and verify HTTPS'
  install_command || return 1
  rm -f -- "$MAINTENANCE_FILE" || return 1
  public_health || { touch "$MAINTENANCE_FILE"; fail 'Local HTTPS did not verify; installation is not reported complete.'; return 1; }
  INSTALL_STATE=installed; save_config || return 1
  info "Installation healthy: $(origin)"
  show_install_complete
}
install_command() {
  local release; release=$(readlink -f "$APP_DIR/current"); assert_release "$release" || return 1
  [[ ! -L /usr/local/bin/repaid ]] || { fail 'Refusing an existing command symlink.'; return 1; }
  cat > /usr/local/bin/repaid <<EOF
#!/usr/bin/env bash
# Managed by Repaid wizard
exec bash "$APP_DIR/current/manage.sh" "\$@"
EOF
  chmod 0755 /usr/local/bin/repaid; chown root:root /usr/local/bin/repaid
}
