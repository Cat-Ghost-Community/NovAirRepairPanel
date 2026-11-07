#!/usr/bin/env bash
renew_ip_certificate() {
  load_config || return 1
  [[ $SSL_TYPE == ip ]] || { fail 'Self-signed rotation applies only to IP mode.'; return 1; }
  warn 'Certificate trust rotates; clients must verify and trust the new fingerprint.'
  local REPAID_NEW_DOMAIN='' REPAID_NEW_SERVER_IP=$SERVER_IP REQUESTED_IP_RENEWAL=1
  change_address
}
restore_address() {
  local previous=$1
  [[ $previous == /etc/repaid/address-before.* && ! -L $previous && $(readlink -f "$previous") == "$previous" ]] || return 1
  local item; for item in server.conf app.env nginx; do assert_root_file "$previous/$item" || return 1; done
  cp -p -- "$previous/server.conf" "$CONFIG_FILE" && cp -p -- "$previous/app.env" "$APP_ENV" && cp -p -- "$previous/nginx" /etc/nginx/sites-available/repaid || return 1
  if [[ -f $previous/hook ]]; then cp -p -- "$previous/hook" /etc/letsencrypt/renewal-hooks/deploy/repaid-nginx || return 1; else rm -f -- /etc/letsencrypt/renewal-hooks/deploy/repaid-nginx; fi
  if [[ -f $previous/cert.pem ]]; then cp -p -- "$previous/cert.pem" /etc/repaid/tls/cert.pem && cp -p -- "$previous/key.pem" /etc/repaid/tls/key.pem || return 1; fi
  local ADDRESS_RECOVERY_ALLOWED=1; load_config || return 1
  nginx -t && systemctl reload nginx && systemctl restart "$SERVICE" && backend_health && rm -f -- "$MAINTENANCE_FILE" || return 1
  public_health || { touch "$MAINTENANCE_FILE"; return 1; }
  rm -f -- /etc/repaid/address-pending
}
address_recover() {
  local previous ADDRESS_RECOVERY_ALLOWED=1
  require_root && require_linux && site_lock || return 1
  assert_secret_file /etc/repaid/address-pending || return 1
  IFS= read -r previous < /etc/repaid/address-pending || return 1
  confirm_exact RECOVER 'restore the saved address/proxy configuration; business data is preserved' && restore_address "$previous"
}
change_address() (
  require_root && require_linux && load_config && site_lock && installed_database_ready || exit 1
  local previous old_ip=$SERVER_IP domain ip email ready=0
  show_banner 'Change Domain / IP'
  printf '  Existing: %s\n  Database, accounts, keys and unrelated sites are preserved.\n' "$(origin)"
  if [[ -n ${REPAID_NEW_DOMAIN:-} || -n ${REPAID_NEW_SERVER_IP:-} ]]; then domain=${REPAID_NEW_DOMAIN:-}; ip=${REPAID_NEW_SERVER_IP:-}
  else [[ ${HAS_TTY:-0} == 1 ]] || { fail 'Provide REPAID_NEW_DOMAIN or REPAID_NEW_SERVER_IP.'; exit 1; }; domain=$(ask 'New domain (leave empty for IP mode)') || exit 1; ip=''; fi
  if [[ -n $domain ]]; then
    valid_domain "$domain" || { fail 'Invalid new domain.'; exit 1; }
    email=$(ask_validated 'Certificate contact email' "${REPAID_NEW_ADMIN_EMAIL:-$CONTACT_EMAIL}" valid_email 'A valid certificate email is required.') || exit 1
    SSL_TYPE=domain; DOMAIN=${domain,,}; SERVER_IP=''; CONTACT_EMAIL=$email
  else ip=$(ask_validated 'New server IPv4' "$ip" valid_ip 'A valid IPv4 address is required.') || exit 1; SSL_TYPE=ip; DOMAIN=''; SERVER_IP=$ip; fi
  "$NODE_BIN" "$WIZARD_ROOT/deploy/wizard/host.cjs" host-free "$(site_host)" || exit 1
  confirm_exact ADDRESS "change site address to $(origin)" || exit 1
  assert_root_file /etc/nginx/sites-available/repaid || exit 1
  grep -q '^# Managed by Repaid wizard$' /etc/nginx/sites-available/repaid || exit 1
  previous=$(mktemp -d /etc/repaid/address-before.XXXXXX) || exit 1
  cp -p -- "$CONFIG_FILE" "$previous/server.conf" && cp -p -- "$APP_ENV" "$previous/app.env" && cp -p -- /etc/nginx/sites-available/repaid "$previous/nginx" || exit 1
  if [[ -f /etc/letsencrypt/renewal-hooks/deploy/repaid-nginx ]]; then assert_root_file /etc/letsencrypt/renewal-hooks/deploy/repaid-nginx && cp -p -- /etc/letsencrypt/renewal-hooks/deploy/repaid-nginx "$previous/hook" || exit 1; fi
  [[ ! -e /etc/repaid/address-pending && ! -L /etc/repaid/address-pending ]] || exit 1
  (set -o noclobber; printf '%s\n' "$previous" > /etc/repaid/address-pending) || exit 1
  touch "$MAINTENANCE_FILE"; chmod 0644 "$MAINTENANCE_FILE"
  trap 'exit 130' INT; trap 'exit 143' TERM
  trap 'code=$?; if [[ $ready == 0 ]]; then touch "$MAINTENANCE_FILE"; restore_address "$previous" || { fail "Address recovery requires review: $previous"; exit 1; }; fail "Address change failed; original configuration restored. Private evidence: $previous"; fi; exit "$code"' EXIT
  # IP certificates are specific to their SAN; retain the old pair privately first.
  if [[ $SSL_TYPE == ip && ( $SERVER_IP != "$old_ip" || ${REQUESTED_IP_RENEWAL:-0} == 1 ) && -e /etc/repaid/tls/cert.pem ]]; then
    cp -p -- /etc/repaid/tls/cert.pem "$previous/cert.pem" && cp -p -- /etc/repaid/tls/key.pem "$previous/key.pem" || exit 1
    # Keep an IP certificate for each address; switching back can reuse that pair.
    install -d -o root -g root -m 0700 /etc/repaid/tls/retained || exit 1
    cp -p -- /etc/repaid/tls/cert.pem "/etc/repaid/tls/retained/$(date +%s)-cert.pem" || exit 1
    (umask 077; openssl req -x509 -newkey rsa:3072 -nodes -days 365 -subj "/CN=$SERVER_IP" -addext "subjectAltName=IP:$SERVER_IP" -keyout /etc/repaid/tls/key.pem -out /etc/repaid/tls/cert.pem) || exit 1
  fi
  "$NODE_BIN" "$WIZARD_ROOT/deploy/wizard/host.cjs" change-origin "$APP_ENV" "$(origin)" "$(id -g "$SERVICE")" && setup_tls && save_config && systemctl restart "$SERVICE" && backend_health || exit 1
  rm -f -- "$MAINTENANCE_FILE"; public_health || exit 1
  rm -f -- /etc/repaid/address-pending || exit 1
  ready=1; info "Address verified: $(origin). Database and keys preserved."
)
