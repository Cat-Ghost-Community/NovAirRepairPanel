#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# نصب یک‌مرحله‌ای «تعمیرکار» روی سرور تازهٔ Ubuntu/Debian (بدون داکر)
#
# روی خود سرور با کاربر root (یا sudo) اجرا کنید:
#
#   bash install-vps.sh
#
# متغیرهای قابل تنظیم (با export قبل از اجرا):
#   APP_DIR      مسیر کد        (پیش‌فرض: /opt/repaid)
#   DATA_DIR     مسیر دیتابیس   (پیش‌فرض: /var/lib/repaid)
#   SERVICE      نام سرویس/کاربر (پیش‌فرض: repaid)
#   DOMAIN       دامنه برای HTTPS (اختیاری؛ مثلاً repaid.example.com)
#   ARCHIVE      مسیر بستهٔ کد .tar.gz (اختیاری؛ اگر داده شود در APP_DIR استخراج می‌شود)
#   NODE_MAJOR   نسخهٔ Node      (پیش‌فرض: 24)
#
# نمونه:
#   ARCHIVE=/tmp/repaid-src.tar.gz DOMAIN=repaid.example.com bash install-vps.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/repaid}"
if [[ -f /etc/repaid/server.conf || -L "$APP_DIR/current" ]]; then
  echo 'Managed installation detected. Use sudo repaid; legacy installer cannot overwrite it.' >&2
  exit 1
fi
DATA_DIR="${DATA_DIR:-/var/lib/repaid}"
SERVICE="${SERVICE:-repaid}"
DOMAIN="${DOMAIN:-}"
ARCHIVE="${ARCHIVE:-}"
NODE_MAJOR="${NODE_MAJOR:-24}"
PORT="${PORT:-3000}"

log()  { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }
ok()   { printf "\033[1;32m✔ %s\033[0m\n" "$*"; }
die()  { printf "\033[1;31m✘ %s\033[0m\n" "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "این اسکریپت را با root یا sudo اجرا کنید."
command -v apt-get >/dev/null || die "این اسکریپت برای Ubuntu/Debian نوشته شده است."
[ -r /etc/repaid/repaid.env ] || die "ابتدا فایل امن /etc/repaid/repaid.env را طبق DEPLOYMENT.md بسازید؛ APP_ORIGIN و REPAID_ENCRYPTION_KEY الزامی‌اند."

# ── ۱) بسته‌های پایه ─────────────────────────────────────────────────────────
log "نصب بسته‌های پایه"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends ca-certificates curl gnupg git tar nginx ufw

# ── ۲) Node.js ───────────────────────────────────────────────────────────────
if ! command -v node >/dev/null || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt "$NODE_MAJOR" ]; then
  log "نصب Node.js ${NODE_MAJOR}.x (NodeSource)"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
ok "Node $(node -v) · npm $(npm -v)"

# ── ۳) کاربر سرویس و مسیرها ──────────────────────────────────────────────────
log "ساخت کاربر و مسیرهای سرویس"
id -u "$SERVICE" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE"
install -d -o "$SERVICE" -g "$SERVICE" -m 0755 "$APP_DIR"
install -d -o "$SERVICE" -g "$SERVICE" -m 0750 "$DATA_DIR"
install -d -o "$SERVICE" -g "$SERVICE" -m 0700 "$DATA_DIR/backup-work"

# ── ۴) کد برنامه ─────────────────────────────────────────────────────────────
if [ -n "$ARCHIVE" ]; then
  [ -f "$ARCHIVE" ] || die "بستهٔ کد پیدا نشد: $ARCHIVE"
  log "استخراج کد از $ARCHIVE در $APP_DIR"
  tar -xzf "$ARCHIVE" -C "$APP_DIR" --strip-components=1
elif [ ! -f "$APP_DIR/package.json" ]; then
  die "در $APP_DIR کدی نیست. یا ARCHIVE بدهید یا کد را آنجا قرار دهید."
fi
chown -R "$SERVICE:$SERVICE" "$APP_DIR"

# ── ۵) نصب و ساخت ────────────────────────────────────────────────────────────
log "npm ci و ساخت تولیدی (چند دقیقه طول می‌کشد)"
sudo -u "$SERVICE" env HOME="$APP_DIR" bash -lc "cd '$APP_DIR' && npm ci && npm run build"
ok "ساخت تولیدی تمام شد"

# ── ۶) سرویس systemd ─────────────────────────────────────────────────────────
log "ثبت سرویس systemd: $SERVICE"
cat > "/etc/systemd/system/${SERVICE}.service" <<UNIT
[Unit]
Description=Repaid — سامانه مدیریت تعمیرگاه (Next.js)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE}
Group=${SERVICE}
UMask=0077
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=TZ=Asia/Tehran
Environment=PORT=${PORT}
Environment=HOSTNAME=127.0.0.1
Environment=REPAID_DATA_DIR=${DATA_DIR}
Environment=REPAID_BACKUP_WORK_DIR=${DATA_DIR}/backup-work
EnvironmentFile=/etc/repaid/repaid.env
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=${DATA_DIR}
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE}

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now "$SERVICE"
sleep 2

# ── ۷) بررسی سلامت ───────────────────────────────────────────────────────────
log "بررسی سلامت سرویس"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    ok "health: $(curl -fsS http://127.0.0.1:${PORT}/api/health)"
    break
  fi
  [ "$i" -eq 30 ] && { journalctl -u "$SERVICE" -n 40 --no-pager || true; die "سرویس بالا نیامد"; }
  sleep 1
done

# ── ۸) nginx + HTTPS ─────────────────────────────────────────────────────────
SERVER_NAME="${DOMAIN:-_}"
log "پیکربندی nginx (server_name=${SERVER_NAME})"
cat > "/etc/nginx/sites-available/${SERVICE}" <<NGINX
upstream ${SERVICE}_app { server 127.0.0.1:${PORT}; keepalive 32; }

server {
    listen 80;
    listen [::]:80;
    server_name ${SERVER_NAME};

    client_max_body_size 25m;
    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    location /_next/static/ {
        proxy_pass http://${SERVICE}_app;
        proxy_cache_valid 200 30d;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location = /api/health { proxy_pass http://${SERVICE}_app; access_log off; }

    location / {
        proxy_pass http://${SERVICE}_app;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
        proxy_buffering off;
    }
}
NGINX

ln -sfn "/etc/nginx/sites-available/${SERVICE}" "/etc/nginx/sites-enabled/${SERVICE}"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
systemctl enable nginx >/dev/null 2>&1 || true

# ── ۹) فایروال ───────────────────────────────────────────────────────────────
log "فایروال: فقط 22/80/443"
ufw allow 22/tcp >/dev/null 2>&1 || true
ufw allow 80/tcp >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
yes | ufw enable >/dev/null 2>&1 || true

# ── ۱۰) گواهی TLS (اختیاری) ──────────────────────────────────────────────────
if [ -n "$DOMAIN" ]; then
  log "گرفتن گواهی HTTPS برای $DOMAIN"
  apt-get install -y --no-install-recommends certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect \
    || printf "\033[1;33m⚠ certbot ناموفق بود — احتمالاً DNS دامنه به این سرور اشاره نمی‌کند. بعداً دستی اجرا کنید: sudo certbot --nginx -d %s\033[0m\n" "$DOMAIN"
else
  printf "\033[1;33m⚠ دامنه تنظیم نشد؛ سایت روی HTTP بالا آمده. برای HTTPS دوباره با DOMAIN=… اجرا کنید.\033[0m\n"
fi

# ── پایان ────────────────────────────────────────────────────────────────────
cat <<DONE

────────────────────────────────────────────
✅ نصب تمام شد
   سرویس : systemctl status ${SERVICE}
   لاگ    : journalctl -u ${SERVICE} -f
   سلامت : curl -s http://127.0.0.1:${PORT}/api/health
   داده   : ${DATA_DIR}/repaid.db

گام بعدی (امنیت):
   ۱. طبق DEPLOYMENT.md حساب مالک را با npm run setup و اسرار خصوصی بسازید.
   ۲. آمادگی سرویس را در /api/health/ready و ورود واقعی بررسی کنید.
   ۳. پشتیبان‌گیری خارج از سرور و آزمون بازیابی را طبق DEPLOYMENT.md تنظیم کنید.
────────────────────────────────────────────
DONE
