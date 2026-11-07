#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $EUID == 0 && ${RUNNER_ENVIRONMENT:-} == github-hosted && ${REPAID_WIZARD_ACCEPTANCE:-} == 1 && ! -e /etc/repaid/server.conf ]]
PROJECT=$(pwd -P)
adversarial=$(mktemp -d /tmp/repaid-untrusted-bootstrap.XXXXXX)
cp setup.sh "$adversarial/setup.sh"; mkdir -p "$adversarial/deploy/wizard"
touch "$adversarial/deploy/wizard/core.sh"
printf '#!/usr/bin/env bash\ntouch "%s/UNSAFE"\n' "$adversarial" > "$adversarial/manage.sh"
bash "$adversarial/setup.sh" --plan
[[ ! -e $adversarial/UNSAFE ]]
echo 'PASS downloaded bootstrap refuses ambient modules beneath a shared writable directory'
# Only this disposable hosted VM; preserve installer disk admission reserves.
rm -rf -- /usr/local/lib/android /usr/share/dotnet /opt/ghc
cp -a .git /var/tmp/repaid-wizard-origin.git
chown -R root:root /var/tmp/repaid-wizard-origin.git
git --git-dir=/var/tmp/repaid-wizard-origin.git config core.bare true
git config --global url.file:///var/tmp/repaid-wizard-origin.git.insteadOf git@github.com:Cat-Ghost-Community/NovAirRepairPanel.git
install -d -m 0700 /root/repaid-wizard-fixture
python3 - <<'PY'
import json,os,secrets
for name,password,email in [('owner',secrets.token_urlsafe(32),'owner@example.invalid'),('new-owner',secrets.token_urlsafe(32),'new-owner@example.invalid'),('bad-owner','x','bad@example.invalid')]:
 with open('/root/repaid-wizard-fixture/'+name+'.json','x') as f:
  os.chmod(f.name,0o600);json.dump(dict(name='Fixture owner',email=email,password=password),f)
PY
python3 scripts/wizard-private-git-acceptance.py
SSL_TYPE=ip SERVER_IP=127.0.0.1 REPAID_OWNER_FILE=/root/repaid-wizard-fixture/owner.json bash setup.sh --yes --ref "$GITHUB_SHA"
repaid --backup-interval 15 --yes
systemctl is-active --quiet repaid-backup.timer
systemctl cat repaid-backup.timer | grep 'OnUnitActiveSec=15min'
repaid --backup-only
before=$(openssl x509 -in /etc/repaid/tls/cert.pem -noout -serial)
repaid --renew-ip --yes
[[ $(openssl x509 -in /etc/repaid/tls/cert.pem -noout -serial) != "$before" ]]
curl -fsS --cacert /etc/repaid/tls/cert.pem https://127.0.0.1/api/health
echo 'PASS installed service, real scheduled encrypted backup, interval and self-signed trust rotation'
python3 - <<'PY'
import json,ssl,urllib.request,http.cookiejar
context=ssl.create_default_context(cafile='/etc/repaid/tls/cert.pem')
client=urllib.request.build_opener(urllib.request.HTTPSHandler(context=context),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def call(route,body):
 request=urllib.request.Request('https://127.0.0.1'+route,data=json.dumps(body).encode(),headers={'Content-Type':'application/json','Origin':'https://127.0.0.1'})
 return json.load(client.open(request))
owner=json.load(open('/root/repaid-wizard-fixture/owner.json'))
call('/api/auth/login',dict(email=owner['email'],password=owner['password']))
assert call('/api/customers',dict(first_name='Pre-reset witness',mobile='09129990070'))['id']>0
PY
if repaid --clean-reinstall --yes; then echo 'Unscoped --yes incorrectly authorized reset' >&2; exit 1; fi
if REPAID_REINSTALL_CONFIRM='WIPE https://127.0.0.1' REPAID_OWNER_FILE=/root/repaid-wizard-fixture/bad-owner.json repaid --clean-reinstall; then echo 'Invalid owner initialization incorrectly succeeded' >&2; exit 1; fi
python3 - <<'PY'
import sqlite3
db=sqlite3.connect('file:/var/lib/repaid/repaid.db?mode=ro',uri=True)
assert db.execute("SELECT COUNT(*) FROM customers WHERE first_name='Pre-reset witness'").fetchone()[0]==1
PY
REPAID_REINSTALL_CONFIRM='WIPE https://127.0.0.1' REPAID_OWNER_FILE=/root/repaid-wizard-fixture/new-owner.json repaid --clean-reinstall
python3 - <<'PY'
import hashlib,json,pathlib,sqlite3
db=sqlite3.connect('file:/var/lib/repaid/repaid.db?mode=ro',uri=True)
assert db.execute('SELECT COUNT(*) FROM customers').fetchone()[0]==0
assert db.execute("SELECT email FROM users WHERE role='owner'").fetchone()[0]=='new-owner@example.invalid'
states=list(pathlib.Path('/var/backups/repaid').glob('clean-reinstall-*/completed.json'));assert len(states)==1
state=json.load(open(states[0]));old=pathlib.Path(state['retired'])/'repaid.db'
assert hashlib.file_digest(open(old,'rb'),'sha256').hexdigest()==state['original_database_sha256']
original=sqlite3.connect('file:'+str(old)+'?mode=ro',uri=True)
assert original.execute("SELECT COUNT(*) FROM customers WHERE first_name='Pre-reset witness'").fetchone()[0]==1
PY
repaid --doctor
echo 'PASS failed reset rollback, fresh active owner/data, exact retained original database and encrypted recovery'
# Real interrupted filesystem phase: leave the durable marker, then recover through the installed CLI.
bash -euo pipefail <<'SH'
source /opt/repaid/current/manage.sh
DEPLOY_LOG=/var/log/repaid/deploy.log
load_config; site_lock; pause_backup_timers; touch "$MAINTENANCE_FILE"; systemctl stop "$SERVICE"
release=$(readlink -f "$APP_DIR/current"); snapshot_before_update "$release"; run_app "$release" deployment rehearse "$BACKUP_SET"
"$NODE_BIN" "$WIZARD_ROOT/deploy/wizard/reinstall-state.cjs" prepare "$REINSTALL_MARKER" "$CONFIG_FILE" "$APP_ENV" "$BACKUP_ENV" "$DATA_DIR" "$BACKUP_DIR" "$BACKUP_SET" "$(id -u "$SERVICE")" "$(id -g "$SERVICE")"
"$NODE_BIN" "$WIZARD_ROOT/deploy/wizard/reinstall-state.cjs" reset "$REINSTALL_MARKER"
SH
if repaid --doctor; then echo 'Interrupted reset was not blocked' >&2; exit 1; fi
REPAID_REINSTALL_CONFIRM='RECOVER https://127.0.0.1' repaid --reinstall-recover
repaid --doctor
echo 'PASS durable interrupted-reset recovery and mutation guard'

# Actual ACME test CA, actual HTTP-01 challenges and trusted TLS; no validation skipping.
CA=/root/repaid-pebble
mkdir -m 0700 "$CA"
git clone --depth=1 --branch v2.10.1 https://github.com/letsencrypt/pebble.git "$CA/source"
[[ $(git -C "$CA/source" rev-parse HEAD) == b1e1ca4f3c30abb64111adaca4544bc5374cc306 ]]
curl -fSL --proto '=https' --proto-redir '=https' https://github.com/letsencrypt/pebble/releases/download/v2.10.1/pebble-linux-amd64.tar.gz -o "$CA/pebble.tar.gz"
echo "4f2fcb5bca8c85c9cf73ad140fccfc0d2be40bd81ab99879c79b7b8a0b4f70ed  $CA/pebble.tar.gz" | sha256sum -c -
mkdir "$CA/bin"; tar -xzf "$CA/pebble.tar.gz" -C "$CA/bin"
PEBBLE=$(find "$CA/bin" -type f -name pebble -print -quit); [[ -n $PEBBLE ]]
chmod 0755 "$PEBBLE"
python3 - "$CA" <<'PY'
import json,sys
p=sys.argv[1];config=json.load(open(p+'/source/test/config/pebble-config.json'));config['pebble']['httpPort']=80;config['pebble']['tlsPort']=443
json.dump(config,open(p+'/config.json','w'))
PY
printf '\n127.0.0.1 repaid-wizard.test broken-wizard.test\n' >> /etc/hosts
(cd "$CA/source"; PEBBLE_VA_NOSLEEP=1 "$PEBBLE" -config "$CA/config.json") > "$CA/server.log" 2>&1 &
PEBBLE_PID=$!
trap 'kill "$PEBBLE_PID" 2>/dev/null || true' EXIT
for attempt in {1..30}; do
  if ! kill -0 "$PEBBLE_PID" 2>/dev/null; then tail -n 30 "$CA/server.log"; exit 1; fi
  curl -fsS --cacert "$CA/source/test/certs/pebble.minica.pem" https://localhost:14000/dir >/dev/null && break
  sleep 1
done
curl -fsS --cacert "$CA/source/test/certs/pebble.minica.pem" https://localhost:15000/roots/0 -o /usr/local/share/ca-certificates/repaid-pebble-root.crt
cp "$CA/source/test/certs/pebble.minica.pem" /usr/local/share/ca-certificates/repaid-pebble-api.crt
update-ca-certificates
printf 'server = https://localhost:14000/dir\n' > /etc/letsencrypt/cli.ini
REPAID_NEW_DOMAIN=repaid-wizard.test REPAID_NEW_ADMIN_EMAIL=ops@example.invalid repaid --change-address --yes
before=$(openssl x509 -in /etc/letsencrypt/live/repaid-wizard.test/fullchain.pem -noout -serial)
certbot renew --cert-name repaid-wizard.test --force-renewal --no-random-sleep-on-renew
after=$(openssl x509 -in /etc/letsencrypt/live/repaid-wizard.test/fullchain.pem -noout -serial)
[[ $before != "$after" ]]
served=''
for attempt in {1..20}; do
  # Nginx reload is asynchronous: wait for the new worker to serve the new leaf.
  served=$(openssl s_client -connect 127.0.0.1:443 -servername repaid-wizard.test -verify_hostname repaid-wizard.test -verify_return_error </dev/null 2>/dev/null | openssl x509 -noout -serial) || served=''
  [[ $served != "$after" ]] || break
  sleep 0.25
done
[[ $served == "$after" ]] || { printf 'Certificate propagation failed: before=%s after=%s served=%s\n' "$before" "$after" "$served"; exit 1; }
curl -fsS --resolve repaid-wizard.test:443:127.0.0.1 https://repaid-wizard.test/api/health
echo 'PASS real HTTP-01 ACME issuance, renewal and automatically served renewed certificate'
kill "$PEBBLE_PID"; wait "$PEBBLE_PID" || true
if REPAID_NEW_DOMAIN=broken-wizard.test REPAID_NEW_ADMIN_EMAIL=ops@example.invalid repaid --change-address --yes; then echo 'Unavailable ACME provider incorrectly succeeded' >&2; exit 1; fi
curl -fsS --resolve repaid-wizard.test:443:127.0.0.1 https://repaid-wizard.test/api/health
repaid --doctor
echo 'PASS unavailable-CA failure restores original domain/proxy/environment and healthy business data'
