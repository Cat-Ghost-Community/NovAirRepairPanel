#!/usr/bin/env bash
REINSTALL_MARKER=/etc/repaid/reinstall.json
reinstall_plan() {
  load_config || return 1
  show_banner 'Clean Reinstall - Review'
  printf '  Site: %s\n  Active data to reset: %s\n  Verified release: %s\n' "$(origin)" "$DATA_DIR" "$(readlink -f "$APP_DIR/current")"
  printf '  A verified encrypted backup and restored-copy rehearsal are mandatory.\n'
  printf '  Original data is retained offline in a root-only sibling archive.\n'
  printf '  New owner account; all previous sessions/users disappear from ACTIVE data.\n'
  printf '  Infrastructure keys, TLS and historical recovery evidence are preserved.\n'
  printf '  This is not secure erasure. No generic --yes/CLEAN_INSTALL bypass.\n'
}
reinstall_recover() {
  local REINSTALL_RECOVERY_ALLOWED=1 release
  require_root && require_linux && load_config && site_lock || return 1
  [[ -f $REINSTALL_MARKER ]] || { fail 'No interrupted clean reinstall exists.'; return 1; }
  confirm_target_reset RECOVER || return 1
  release=$(readlink -f "$APP_DIR/current"); assert_release "$release" || return 1
  touch "$MAINTENANCE_FILE"; systemctl stop "$SERVICE" || return 1
  "$NODE_BIN" "$WIZARD_ROOT/deploy/wizard/reinstall-state.cjs" recover "$REINSTALL_MARKER" && systemctl start "$SERVICE" && backend_health && resume_backup_timers && rm -f -- "$MAINTENANCE_FILE"
}
confirm_target_reset() {
  local expected="$1 $(origin)" value
  if [[ ${HAS_TTY:-0} == 1 ]]; then printf '  Type exactly %s: ' "$expected" >&3; IFS= read -r -u 3 value || return 1
  else value=${REPAID_REINSTALL_CONFIRM:-}; fi
  [[ $value == "$expected" ]] || { fail 'Exact site-bound confirmation required; --yes does not authorize a data reset.'; return 1; }
}
clean_reinstall() (
  require_root && require_linux && load_config && site_lock && resource_preflight || exit 1
  [[ ${INSTALL_STATE:-} == installed ]] || { fail 'Only a completed managed installation can be reset.'; exit 1; }
  reinstall_plan && confirm_target_reset WIPE || exit 1
  local release owner_email owner_name owner_password confirmation committed=0
  release=$(readlink -f "$APP_DIR/current"); assert_release "$release" && installed_database_ready || exit 1
  if [[ -n ${REPAID_OWNER_FILE:-} ]]; then assert_secret_file "$REPAID_OWNER_FILE" || exit 1
  else collect_owner_credentials || exit 1; fi
  pause_backup_timers || exit 1
  touch "$MAINTENANCE_FILE"; chmod 0644 "$MAINTENANCE_FILE"
  trap 'exit 130' INT; trap 'exit 143' TERM
  trap 'code=$?; if [[ $committed == 0 ]]; then if [[ -f $REINSTALL_MARKER ]]; then "$NODE_BIN" "$WIZARD_ROOT/deploy/wizard/reinstall-state.cjs" recover "$REINSTALL_MARKER" || { fail "Recovery requires review: $REINSTALL_MARKER; maintenance retained."; exit 1; }; fi; systemctl start "$SERVICE" && backend_health && resume_backup_timers && rm -f -- "$MAINTENANCE_FILE" || exit 1; fi; exit "$code"' EXIT
  systemctl stop "$SERVICE" || exit 1
  snapshot_before_update "$release" && run_app "$release" deployment rehearse "$BACKUP_SET" >> "$DEPLOY_LOG" 2>&1 || exit 1
  "$NODE_BIN" "$WIZARD_ROOT/deploy/wizard/reinstall-state.cjs" prepare "$REINSTALL_MARKER" "$CONFIG_FILE" "$APP_ENV" "$BACKUP_ENV" "$DATA_DIR" "$BACKUP_DIR" "$BACKUP_SET" "$(id -u "$SERVICE")" "$(id -g "$SERVICE")" || exit 1
  "$NODE_BIN" "$WIZARD_ROOT/deploy/wizard/reinstall-state.cjs" reset "$REINSTALL_MARKER" || exit 1
  if [[ -n ${REPAID_OWNER_FILE:-} ]]; then
    "$NODE_BIN" -e 'const fs=require("fs"),v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));for(const k of ["email","password","name"]){if(typeof v[k]!=="string"||v[k].includes("\0"))throw Error("Invalid owner input");process.stdout.write(v[k]+"\0")}' "$REPAID_OWNER_FILE" | run_app "$release" deployment bootstrap >> "$DEPLOY_LOG" 2>&1 || exit 1
  else printf '%s\0%s\0%s\0' "$owner_email" "$owner_password" "$owner_name" | run_app "$release" deployment bootstrap >> "$DEPLOY_LOG" 2>&1 || exit 1; fi
  unset owner_password confirmation
  systemctl start "$SERVICE" && backend_health && run_app "$release" scheduled >> "$DEPLOY_LOG" 2>&1 && run_app "$release" recovery-set check >> "$DEPLOY_LOG" 2>&1 && nginx -t || exit 1
  "$NODE_BIN" "$WIZARD_ROOT/deploy/wizard/reinstall-state.cjs" commit "$REINSTALL_MARKER" || exit 1
  committed=1
  resume_backup_timers && rm -f -- "$MAINTENANCE_FILE" || exit 1
  public_health || { touch "$MAINTENANCE_FILE"; fail 'Fresh data retained; proxy needs review. No historical data was reactivated.'; exit 1; }
  info 'Clean active installation verified. Original data, encrypted recovery and key custody retained privately.'
)
