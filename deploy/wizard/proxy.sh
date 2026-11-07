#!/usr/bin/env bash
# Adapted from exp's per-site Nginx/certbot menus; no global/default-site reset.
write_nginx() {
  local mode=$1 host available=/etc/nginx/sites-available/repaid enabled=/etc/nginx/sites-enabled/repaid tmp previous=''
  host=$(site_host); install -d -m 0755 /etc/nginx/sites-available /etc/nginx/sites-enabled /var/lib/repaid-acme/.well-known/acme-challenge || return 1
  [[ ! -L $available ]] || { fail 'Refusing a symlinked site configuration.'; return 1; }
  if [[ -e $available ]]; then grep -q '^# Managed by Repaid wizard$' "$available" || { fail 'Existing unmanaged Repaid Nginx site; review it before adoption.'; return 1; }; previous=$(mktemp /etc/repaid/nginx-before.XXXXXX); cp -- "$available" "$previous"; fi
  [[ ! -e $enabled && ! -L $enabled || -L $enabled && $(readlink -f "$enabled") == "$available" ]] || { fail 'Another site owns the enabled Repaid entry.'; return 1; }
  tmp=$(mktemp /etc/repaid/nginx-candidate.XXXXXX) || return 1
  {
    printf '%s\n' '# Managed by Repaid wizard'
    printf 'map $http_upgrade $repaid_connection_upgrade { default upgrade; "" close; }\n'
    printf 'server {\n listen 80;\n listen [::]:80;\n server_name %s;\n' "$host"
    printf ' location ^~ /.well-known/acme-challenge/ { root /var/lib/repaid-acme; default_type text/plain; }\n'
    if [[ $mode == tls ]]; then printf ' location / { return 308 https://$host$request_uri; }\n}\nserver {\n listen 443 ssl;\n listen [::]:443 ssl;\n server_name %s;\n' "$host"
      if [[ $SSL_TYPE == domain ]]; then printf ' ssl_certificate /etc/letsencrypt/live/%s/fullchain.pem;\n ssl_certificate_key /etc/letsencrypt/live/%s/privkey.pem;\n' "$DOMAIN" "$DOMAIN"
      else printf ' ssl_certificate /etc/repaid/tls/cert.pem;\n ssl_certificate_key /etc/repaid/tls/key.pem;\n'; fi
      cat <<EOF
 ssl_protocols TLSv1.2 TLSv1.3;
 client_max_body_size 25m;
 add_header X-Content-Type-Options nosniff always;
 add_header Referrer-Policy strict-origin-when-cross-origin always;
 add_header X-Repaid-Managed "1" always;
 location / {
   if (-f $MAINTENANCE_FILE) { return 503; }
   proxy_pass http://127.0.0.1:$APP_PORT;
   proxy_http_version 1.1;
   proxy_set_header Host \$host;
   proxy_set_header X-Real-IP \$remote_addr;
   proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
   proxy_set_header X-Forwarded-Proto \$scheme;
   proxy_set_header Upgrade \$http_upgrade;
   proxy_set_header Connection \$repaid_connection_upgrade;
   proxy_read_timeout 120s;
   proxy_buffering off;
 }
EOF
    else printf ' location / { return 503; }\n'; fi
    printf '}\n'
  } > "$tmp"
  [[ $? == 0 ]] || return 1
  install -o root -g root -m 0644 "$tmp" "$available" && rm -f -- "$tmp" || return 1
  [[ -L $enabled ]] || ln -s -- "$available" "$enabled" || return 1
  if ! nginx -t; then
    if [[ -n $previous ]]; then install -o root -g root -m 0644 "$previous" "$available"; else rm -f -- "$enabled" "$available"; fi
    [[ -z $previous ]] || rm -f -- "$previous"; fail 'Nginx validation failed; previous site restored.'; return 1
  fi
  [[ -z $previous ]] || rm -f -- "$previous"
  if systemctl is-active --quiet nginx; then systemctl reload nginx; else systemctl enable --now nginx; fi
}
public_health() {
  local host temporary status; host=$(site_host); temporary=$(mktemp -d /etc/repaid/proxy-check.XXXXXX) || return 1
  local -a trust=(); [[ $SSL_TYPE != ip ]] || trust=(--cacert /etc/repaid/tls/cert.pem)
  status=$(curl -sS --noproxy '*' --connect-timeout 5 --max-time 15 --resolve "$host:443:127.0.0.1" "${trust[@]}" -D "$temporary/headers" -o "$temporary/body" -w '%{http_code}' "https://$host/api/health") || status=failed
  if [[ $status == 200 ]] && tr -d '\r' < "$temporary/headers" | grep -Eiq '^X-Repaid-Managed: *1 *$' && "$NODE_BIN" -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit(v.status==="ok"&&v.database==="ok"?0:1)' "$temporary/body"; then
    [[ $temporary == /etc/repaid/proxy-check.* && ! -L $temporary ]] || return 1; rm -rf --one-file-system -- "$temporary"; return 0
  fi
  fail "HTTPS/proxy gate failed; private diagnosis retained: $temporary"; return 1
}
install_certificate_hook() {
  local hook=/etc/letsencrypt/renewal-hooks/deploy/repaid-nginx
  valid_domain "$DOMAIN" || return 1
  [[ ! -L $hook ]] || { fail 'Certificate hook symlink refused.'; return 1; }
  if [[ -e $hook ]] && ! grep -q '^# Managed by Repaid wizard$' "$hook"; then fail 'An unmanaged certificate hook already exists.'; return 1; fi
  install -d -o root -g root -m 0755 /etc/letsencrypt/renewal-hooks/deploy || return 1
  local tmp; tmp=$(mktemp /etc/repaid/cert-hook.XXXXXX) || return 1
  cat > "$tmp" <<EOF
#!/usr/bin/env bash
# Managed by Repaid wizard
set -euo pipefail
[[ \${RENEWED_LINEAGE:-} == /etc/letsencrypt/live/$DOMAIN ]] || exit 0
/usr/sbin/nginx -t
/usr/bin/systemctl reload nginx
EOF
  install -o root -g root -m 0750 "$tmp" "$hook" && rm -f -- "$tmp"
}
setup_tls() {
  "$NODE_BIN" "$WIZARD_ROOT/deploy/wizard/host.cjs" host-free "$(site_host)" || { fail 'Hostname conflict with another enabled site; nothing was reset.'; return 1; }
  if [[ $SSL_TYPE == domain ]]; then
    install_certificate_hook || return 1
    if [[ ! -s /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]]; then
      write_nginx http || return 1
      certbot certonly --webroot -w /var/lib/repaid-acme -d "$DOMAIN" --cert-name "$DOMAIN" --email "$CONTACT_EMAIL" --agree-tos --non-interactive || return 1
    fi
    systemctl enable --now certbot.timer || return 1
    openssl x509 -in "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" -noout -checkhost "$DOMAIN" -checkend 0 || { fail 'The domain certificate is expired or does not match this site.'; return 1; }
  else
    install -d -o root -g root -m 0700 /etc/repaid/tls || return 1
    if [[ ! -s /etc/repaid/tls/cert.pem || ! -s /etc/repaid/tls/key.pem ]]; then
      (umask 077; openssl req -x509 -newkey rsa:3072 -nodes -days 365 -subj "/CN=$SERVER_IP" -addext "subjectAltName=IP:$SERVER_IP" -keyout /etc/repaid/tls/key.pem -out /etc/repaid/tls/cert.pem) || return 1
    fi
    warn 'IP mode uses a self-signed certificate. Clients must explicitly trust it; this is not public CA verification.'
    openssl x509 -in /etc/repaid/tls/cert.pem -noout -checkip "$SERVER_IP" -checkend 0 || { fail 'The IP certificate is expired or does not match this site.'; return 1; }
  fi
  write_nginx tls
}
write_services() {
  local unit
  for unit in /etc/systemd/system/repaid.service /etc/systemd/system/repaid-backup.service /etc/systemd/system/repaid-backup-check.service /etc/systemd/system/repaid-backup.timer /etc/systemd/system/repaid-backup-check.timer; do
    [[ ! -L $unit ]] || return 1
    if [[ -f $unit ]] && ! grep -q '^# Managed by Repaid wizard$' "$unit"; then fail "Unmanaged service unit: $unit"; return 1; fi
  done
  cat > /etc/systemd/system/repaid.service <<EOF
# Managed by Repaid wizard
[Unit]
Description=Repaid business application
After=network-online.target
Wants=network-online.target
[Service]
Type=exec
User=$SERVICE
Group=$SERVICE
UMask=0077
WorkingDirectory=$APP_DIR/current
EnvironmentFile=$APP_ENV
Environment=PORT=$APP_PORT
Environment=NEXT_TELEMETRY_DISABLED=1
ExecStartPre=$NODE_BIN -e "const fs=require('node:fs'),p=require('node:path'),{DatabaseSync}=require('node:sqlite');const f=p.join(process.env.REPAID_DATA_DIR,'repaid.db'),s=fs.lstatSync(f);if(!s.isFile()||s.isSymbolicLink())process.exit(1);const d=new DatabaseSync(f,{readOnly:true});try{if(!d.prepare('SELECT 1 FROM users LIMIT 1').get())process.exitCode=1}finally{d.close()}"
ExecStart=$NODE_BIN $APP_DIR/current/node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port $APP_PORT
Restart=on-failure
RestartSec=5
TimeoutStopSec=60
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$DATA_DIR $APP_DIR/current/.next/cache $APP_DIR/current/.next/server/route-cache
[Install]
WantedBy=multi-user.target
EOF
  [[ $? == 0 ]] || return 1
  local name command paths
  for name in backup backup-check; do
    if [[ $name == backup ]]; then command="$APP_DIR/current/.database-tools/scheduled.cjs"; paths="$DATA_DIR $BACKUP_DIR"; else command="$APP_DIR/current/.database-tools/recovery-set.cjs check"; paths="$DATA_DIR"; fi
    cat > "/etc/systemd/system/repaid-$name.service" <<EOF
# Managed by Repaid wizard
[Unit]
Description=Repaid $name
After=network-online.target
[Service]
Type=oneshot
User=$SERVICE
Group=$SERVICE
UMask=0077
WorkingDirectory=$APP_DIR/current
EnvironmentFile=$APP_ENV
EnvironmentFile=$BACKUP_ENV
ExecStart=$NODE_BIN $command
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$paths
TimeoutStartSec=3600
EOF
    [[ $? == 0 ]] || return 1
  done
  for name in backup backup-check; do
    { printf '%s\n' '# Managed by Repaid wizard'; cat "$WIZARD_ROOT/deploy/repaid-$name.timer"; } > "/etc/systemd/system/repaid-$name.timer" || return 1
    chmod 0644 "/etc/systemd/system/repaid-$name.timer" || return 1
  done
  systemctl daemon-reload
}
