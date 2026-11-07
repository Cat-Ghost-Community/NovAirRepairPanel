#!/usr/bin/env bash
# Repaid management console, adapted from the user's exp/manage.sh.
set -uo pipefail
set +x
umask 077
WIZARD_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=deploy/wizard/core.sh
. "$WIZARD_ROOT/deploy/wizard/core.sh"
. "$WIZARD_ROOT/deploy/wizard/proxy.sh"
. "$WIZARD_ROOT/deploy/wizard/releases.sh"
. "$WIZARD_ROOT/deploy/wizard/install.sh"
. "$WIZARD_ROOT/deploy/wizard/reinstall.sh"
. "$WIZARD_ROOT/deploy/wizard/address.sh"
REQUESTED_REF=''; REQUESTED_REPO=''; ASSUME_YES=0
REQUESTED_INTERVAL=''
usage() {
  printf '%s\n' 'Repaid - One Command setup and management' \
    'sudo bash setup.sh [--ref BRANCH_OR_SHA] [--repo GITHUB_URL] [--yes]' \
    'sudo repaid [--smart-update|--rollback|--status|--doctor|--backup-only|--backups|--ssl|--logs|--services]' \
    'bash setup.sh --plan  (read-only; set DOMAIN and ADMIN_EMAIL, or SSL_TYPE=ip SERVER_IP=...)' \
    'sudo repaid [--clean-reinstall-plan|--clean-reinstall|--reinstall-recover]' \
    'sudo repaid [--change-address|--address-recover|--renew-ip]' \
    'sudo repaid --backup-interval MINUTES  (5-60; preserves freshness checks)' \
    'Clean active data requires exact WIPE https://SITE confirmation; --yes never bypasses it.' \
    'No automatic financial correction or database engine switch.'
}
view_status() { load_config || return 1; print_plan; systemctl --no-pager --full status "$SERVICE" || true; systemctl list-timers --no-pager 'repaid-*'; }
doctor() {
  load_config || return 1; assert_root_file "$APP_ENV" && assert_root_file "$BACKUP_ENV" || return 1
  local release; release=$(readlink -f "$APP_DIR/current"); assert_release "$release" && nginx -t || return 1
  # Inspect without startup/DDL before any HTTP route can call getDb.
  run_app "$release" deployment inspect --require-existing --integrity || return 1
  backend_health && run_app "$release" recovery-set check || return 1
  df -h "$DATA_DIR" "$BACKUP_DIR"; info 'Local health checked. External TLS, key recovery and off-host failure domains need target verification.'
}
backup_only() { load_config && site_lock || return 1; run_app "$(readlink -f "$APP_DIR/current")" scheduled; }
backup_menu() {
  load_config || return 1
  local choice input output reason release; release=$(readlink -f "$APP_DIR/current")
  while true; do
    show_banner 'Recovery Center'
    printf '  Restore always prepares a separate offline copy.\n\n'
    menu_item 1 'Create complete encrypted backup'
    menu_item 2 'Verify latest backup and configured second copy'
    menu_item 3 'Verify a retained recovery set'
    menu_item 4 'Restore to a NEW OFFLINE directory' 'Never replaces or activates over live data.'
    menu_item 5 'View backup schedule and recent logs'
    menu_item 6 'Change backup interval (5-60 minutes)'
    menu_item 0 'Back'
    choice=$(ask_choice 'Choice' 0 '0 1 2 3 4 5 6') || return $?
    case $choice in
      1) backup_only || return 1;;
      2) run_app "$release" recovery-set check || return 1;;
      3) input=$(ask 'Absolute recovery-set directory'); run_app "$release" recovery-set verify "$input" || return 1;;
      4) input=$(ask 'Recovery-set directory'); output=$(ask 'New offline restore directory'); reason=$(ask 'Documented recovery reason'); confirm_exact RESTORE 'prepare a separate offline copy' || continue
         run_app "$release" recovery-set restore "$input" "$output" "$reason" || return 1;;
      5) systemctl list-timers --no-pager 'repaid-backup*'; journalctl -u repaid-backup -n 20 --no-pager;;
      6) REQUESTED_INTERVAL=$(ask 'Interval in minutes (5-60)' 60); backup_interval || return 1;;
      0) return;; *) warn 'Invalid choice';;
    esac
    pause_screen || return 0
  done
}
backup_interval() {
  load_config && site_lock || return 1
  [[ ${REQUESTED_INTERVAL:-} =~ ^[1-9][0-9]?$ ]] && ((REQUESTED_INTERVAL>=5&&REQUESTED_INTERVAL<=60)) || { fail 'Backup interval must be 5-60 minutes.'; return 1; }
  confirm_exact SCHEDULE 'change backup interval; check/freshness timers remain enabled' || return 1
  local directory=/etc/systemd/system/repaid-backup.timer.d file tmp previous=''
  file=$directory/interval.conf
  [[ ! -L $directory && ! -L $file ]] || return 1
  [[ ! -e $file ]] || { grep -q '^# Managed by Repaid wizard$' "$file" || { fail 'Unmanaged schedule override; review it first.'; return 1; }; previous=$(mktemp /etc/repaid/timer-before.XXXXXX); cp -p -- "$file" "$previous" || return 1; }
  install -d -o root -g root -m 0755 "$directory" || return 1
  tmp=$(mktemp "$directory/.interval.XXXXXX") || return 1
  printf '# Managed by Repaid wizard\n[Timer]\nOnCalendar=\nOnBootSec=5min\nOnUnitActiveSec=%smin\nRandomizedDelaySec=120\n' "$REQUESTED_INTERVAL" > "$tmp"
  chmod 0644 "$tmp" && mv -f -- "$tmp" "$file" || return 1
  if ! systemctl daemon-reload || ! systemctl restart repaid-backup.timer; then
    if [[ -n $previous ]]; then cp -p -- "$previous" "$file"; else rm -f -- "$file"; fi
    systemctl daemon-reload; systemctl restart repaid-backup.timer; fail 'Schedule change failed; previous schedule restored.'; return 1
  fi
  [[ -z $previous ]] || rm -f -- "$previous"
  systemctl is-active --quiet repaid-backup.timer && info "Encrypted backup interval: $REQUESTED_INTERVAL minutes."
}
configuration_menu() {
  load_config || return 1
  show_banner 'Environment Variables'
  printf '  Site: %s\n  Application environment: %s\n  Backup environment: %s\n' "$CONFIG_FILE" "$APP_ENV" "$BACKUP_ENV"
  local choice file saved
  menu_item 1 'Edit application environment' 'Encryption key, data path and site origin are protected.'
  menu_item 2 'Edit backup environment' 'Backup key and storage paths are protected.'
  menu_item 0 'Back'
  choice=$(ask_choice 'Choice' 0 '0 1 2') || return $?; case $choice in 1) file=$APP_ENV;; 2) file=$BACKUP_ENV;; 0) return;; *) return 1;; esac
  confirm_exact EDIT 'edit private configuration; no secrets are written to the deployment log' && site_lock || return 1
  saved=$(mktemp -d /etc/repaid/editor.XXXXXX) || return 1
  cp -p "$APP_ENV" "$saved/app.env" && cp -p "$BACKUP_ENV" "$saved/backup.env" || return 1
  if ! nano "$file" || ! "$NODE_BIN" "$WIZARD_ROOT/deploy/wizard/host.cjs" validate-edit "$APP_ENV" "$BACKUP_ENV" "$saved/app.env" "$saved/backup.env" "$DATA_DIR" "$BACKUP_DIR" "$(origin)" "$(id -g "$SERVICE")"; then
    cp -p "$saved/app.env" "$APP_ENV" && cp -p "$saved/backup.env" "$BACKUP_ENV" || return 1
    fail "Rejected change restored. Private evidence retained: $saved"; return 1
  fi
  [[ $saved == /etc/repaid/editor.* && ! -L $saved ]] || return 1; rm -rf --one-file-system -- "$saved"
  info 'Configuration saved. Restart via Application Service (10) to apply it; keys and persistent data paths retained.'
}
ssl_menu() {
  load_config || return 1; local choice
  show_banner 'SSL Certificate'
  menu_item 1 'Inspect certificate and expiry'
  menu_item 3 'Change domain / IP' 'Preserve data and keys; recover original proxy on failure.'
  if [[ $SSL_TYPE == domain ]]; then menu_item 2 'Renew current domain certificate'; else menu_item 2 'Rotate self-signed IP certificate' 'Clients must verify and trust the new fingerprint.'; fi
  menu_item 0 'Back'
  local choices='0 1 2 3'
  choice=$(ask_choice 'Choice' 0 "$choices") || return $?
  case $choice in
    1) if [[ $SSL_TYPE == domain ]]; then openssl x509 -in "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" -noout -dates -subject -fingerprint -sha256; else openssl x509 -in /etc/repaid/tls/cert.pem -noout -dates -subject -fingerprint -sha256; fi;;
    2) if [[ $SSL_TYPE == ip ]]; then renew_ip_certificate; else confirm_exact RENEW 'renew the current domain certificate' && site_lock && certbot renew --cert-name "$DOMAIN" && nginx -t && systemctl reload nginx; fi;;
    3) change_address;;
    0) return;; *) fail 'Invalid choice';;
  esac
}
installed_database_ready() {
  local release; release=$(readlink -f "$APP_DIR/current") || return 1
  assert_release "$release" && run_app "$release" deployment inspect --require-existing
}
service_menu() {
  load_config || return 1; local choice
  show_banner 'Application Service'
  menu_item 1 'Service status'
  menu_item 2 'Restart and verify' 'One web process; public access resumes only after health checks.'
  menu_item 3 'Stop and keep maintenance mode'
  menu_item 4 'Start, verify and resume access'
  menu_item 0 'Back'
  choice=$(ask_choice 'Choice' 0 '0 1 2 3 4') || return $?
  case $choice in
    1) view_status;;
    2) confirm_exact RESTART 'restart the application' && site_lock && installed_database_ready && { touch "$MAINTENANCE_FILE" && systemctl restart "$SERVICE" && backend_health && resume_backup_timers && rm -f -- "$MAINTENANCE_FILE"; };;
    3) confirm_exact STOP 'stop application access' && site_lock && { touch "$MAINTENANCE_FILE" && systemctl stop "$SERVICE"; };;
    4) site_lock && installed_database_ready && systemctl start "$SERVICE" && backend_health && resume_backup_timers && rm -f -- "$MAINTENANCE_FILE";; 0) return;; *) fail 'Invalid choice';;
  esac
}
render_main_menu() {
  local COMPACT_MENU=0; (($(terminal_height)>=42)) || COMPACT_MENU=1
  show_banner 'Management Panel'
  printf '  %s%s%s\n  %s\n' "$C" "$(origin)" "$NC" "$APP_DIR"
  printf '  SSL: %s  |  Service: %s\n\n' "$SSL_TYPE" "${1:-unknown}"
  printf '  %s%sMain Menu%s\n\n' "$W" "$BOLD" "$NC"
  menu_item 1 '🔄  Smart Update' 'Build · backup · rehearse · health check'
  menu_item 2 '↩   Code Rollback' 'Guarded previous release; customer data is preserved.'
  menu_item 3 '⚙   Environment Variables' 'Protected configuration editor'
  menu_item 4 '🗄   Recovery Center' 'Encrypted backup · verify · offline restore'
  menu_item 5 '🔒  SSL Certificate'
  menu_item 6 '📋  Application Logs'
  menu_item 7 '📊  System Status'
  menu_item 8 '🩺  System Doctor' 'Database integrity · backup freshness'
  menu_item 9 '🌐  Nginx Check / Reload'
  menu_item 10 '⏯   Application Service'
  menu_item 11 '⌨   Install system command (sudo repaid)'
  menu_item 12 '⚠   Clean Reinstall' 'Verified backup · fresh active data · retained original archive'
  divider; menu_item 0 'Exit'; printf '\n'
}
main_menu() {
  require_root && require_linux && load_config || return 1
  local choice
  while true; do
    load_config || return 1
    render_main_menu "$(systemctl is-active "$SERVICE" 2>/dev/null || true)"
    choice=$(ask_choice 'Choose an option' 0 '0 1 2 3 4 5 6 7 8 9 10 11 12') || return $?
    case $choice in
      1) smart_update || warn 'Update did not complete; inspect the reported stage.';;
      2) rollback_code || warn 'Rollback not applied.';; 3) configuration_menu || warn 'Configuration not changed.';; 4) backup_menu || warn 'Recovery operation failed.';; 5) ssl_menu || warn 'TLS operation failed.';;
      6) journalctl -u "$SERVICE" -n 100 --no-pager;; 7) view_status;; 8) doctor || warn 'Doctor found a failed gate.';;
      9) site_lock && nginx -t && systemctl reload nginx;; 10) service_menu || warn 'Service action did not complete.';;
      11) install_command;; 12) clean_reinstall || warn 'Clean reinstall did not complete; inspect recovery state.';; 0) return;; *) warn 'Invalid choice';;
    esac
    if [[ -e /proc/$$/fd/9 ]]; then flock -u 9; exec 9>&-; fi
    pause_screen || return 0
  done
}
main() {
  local action=menu
  while (($#)); do
    case $1 in --help|-h) usage; return;; --version) printf 'Repaid management %s\n' "$WIZARD_VERSION"; return;;
      --ref) [[ $# -ge 2 ]] || return 1; REQUESTED_REF=$2; shift;; --repo) [[ $# -ge 2 ]] || return 1; REQUESTED_REPO=$2; shift;; --yes) ASSUME_YES=1;;
      --backup-interval) [[ $# -ge 2 ]] || return 1; REQUESTED_INTERVAL=$2; action=backup-interval; shift;;
      --install-wizard|--smart-update|--rollback|--status|--doctor|--backup-only|--backups|--ssl|--logs|--services|--plan|--clean-reinstall-plan|--clean-reinstall|--reinstall-recover|--change-address|--address-recover|--renew-ip) action=${1#--};;
      *) fail "Unknown option: $1"; return 1;; esac; shift
  done
  open_terminal
  if [[ ${CLEAN_INSTALL:-0} == 1 || ${FORCE_ENV:-0} == 1 ]]; then fail 'Legacy wipe/forced-secret-reset flags are unsupported; existing data and keys are preserved.'; return 1; fi
  if [[ $action == plan ]]; then gather_settings && print_plan; return $?; fi
  require_root && require_linux || return 1
  export PATH=/usr/sbin:/usr/bin:/sbin:/bin
  DEPLOY_LOG=/var/log/repaid/deploy.log; install -d -o root -g root -m 0700 /var/log/repaid
  case $action in renew-ip) renew_ip_certificate;; address-recover) address_recover;; change-address) change_address;; backup-interval) backup_interval;; clean-reinstall-plan) reinstall_plan;; clean-reinstall) clean_reinstall;; reinstall-recover) reinstall_recover;; install-wizard) fresh_install;; smart-update) smart_update;; rollback) rollback_code;; status) view_status;; doctor) doctor;; backup-only) backup_only;; backups) backup_menu;; ssl) ssl_menu;; logs) journalctl -u "$SERVICE" -n 100 --no-pager;; services) service_menu;; menu) main_menu;; esac
}
if [[ ${BASH_SOURCE[0]} == "$0" ]]; then main "$@"; fi
