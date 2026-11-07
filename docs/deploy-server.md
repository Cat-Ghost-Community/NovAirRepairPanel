> Current managed installer: follow [README](../README.md) and [INSTALLER_STATUS.md](https://github.com/Cat-Ghost-Community/1beng/blob/511bf389172dff24a28b49a50e2cdf666ced433c/INSTALLER_STATUS.md). Older manual unit/archive commands below must not overwrite a managed `/opt/repaid/current` installation.

# راه‌اندازی «تعمیرکار» روی سرور

راهنمای کامل استقرار سامانه روی سرور اختصاصی/مجازی (Ubuntu/Debian)، با داکر، systemd،
reverse proxy و پشتیبان‌گیری. اجرای محلی هم در [README](../README.md) آمده است.

---

## ۱) پیش‌نیازها

| مورد | مقدار |
| --- | --- |
| Node.js | **۲۴** (نسخهٔ آزموده‌شده برای اجرای `node:sqlite`) |
| حافظه | حداقل ۱ گیگابایت (ساخت حدود ۱.۵ گیگابایت اوج مصرف دارد) |
| پورت | پیش‌فرض `3000` |
| فضای دیسک | خود برنامه ~۵۰۰ مگابایت + دیتابیس در `REPAID_DATA_DIR` |
| سیستم‌عامل | لینوکس x64/arm64، ویندوز، مک — یا ایمیج داکر |

> ⚠️ **مهم:** این سامانه تک‌نمونه‌ای است. دیتابیس یک فایل SQLite است و محدودیت ورود
> (۵ تلاش ناموفق) در حافظهٔ همان پروسه نگه داشته می‌شود؛ بنابراین **یک پروسهٔ Node** اجرا کنید
> (نه cluster/PM2 با `instances > 1`) و مقیاس افقی نکنید. برای چندکاربره سنگین، دیتابیس را به
> سرویس مدیریت‌شده (Turso/LiteFS) منتقل کنید.

## ۲) متغیرهای محیطی

فایل [.env.example](../.env.example) را ببینید. مهم‌ترین‌ها:

| متغیر | پیش‌فرض | توضیح |
| --- | --- | --- |
| `PORT` | `3000` | پورت گوش‌دادن |
| `HOSTNAME` | `0.0.0.0` | آدرس bind؛ پشت reverse proxy مقدار `127.0.0.1` امن‌تر است |
| `REPAID_DATA_DIR` | `./data` | پوشهٔ پایدار دیتابیس (مثلاً `/var/lib/repaid`) |
| `BUILD_STANDALONE` | – | با `1` خروجی self-contained برای داکر می‌سازد |

> اجرای SQLite روی فایل‌سیستم موقتی Netlify/Lambda پشتیبانی نمی‌شود و راه‌اندازی متوقف می‌شود.
> از دیسک محلی پایدار و راهنمای [DEPLOYMENT.md](../DEPLOYMENT.md) استفاده کنید.

## ۳) روش الف — اجرای مستقیم با Node

```bash
# روی سرور، با کاربر سرویس (مثلاً repaid)
sudo mkdir -p /opt/repaid /var/lib/repaid && sudo chown $USER /var/lib/repaid
git clone <repo-url> /opt/repaid && cd /opt/repaid

npm ci                     # نصب دقیق بر اساس lockfile
npm run build              # ساخت تولیدی
REPAID_DATA_DIR=/var/lib/repaid PORT=3000 HOSTNAME=127.0.0.1 npm run start
```

در تولید، حساب نمایشی و دادهٔ نمونه ساخته نمی‌شود. پیش از باز کردن دسترسی،
متغیرهای امن را تنظیم و `npm run setup` را مطابق [راهنمای فعلی استقرار](../DEPLOYMENT.md) اجرا کنید.
این راهنمای فعلی، مرجع تنظیم origin، کلید رمزگذاری، مهاجرت و بازیابی است.

### اجرای خودکار با systemd

```bash
sudo useradd --system --home /opt/repaid --shell /usr/sbin/nologin repaid
sudo chown -R repaid:repaid /opt/repaid /var/lib/repaid
sudo cp deploy/repaid.service /etc/systemd/system/repaid.service
sudo systemctl daemon-reload && sudo systemctl enable --now repaid
systemctl status repaid && journalctl -u repaid -f
```

## ۴) روش ب — داکر / Docker Compose

```bash
docker compose up -d --build       # http://SERVER_IP:3000
docker compose logs -f repaid
```

دادهٔ دیتابیس در volume `repaid-data` (مسیر `/data` داخل کانتینر) پایدار می‌ماند.
آپدیت نسخه: `git pull && docker compose up -d --build` — داده‌ها حفظ می‌شوند.

بدون compose:

```bash
docker build -t repaid .
docker run -d --name repaid -p 3000:3000 -v repaid-data:/data --restart unless-stopped repaid
```

## ۵) دامنه، HTTPS و reverse proxy

نمونهٔ آمادهٔ nginx در [deploy/nginx.conf](../deploy/nginx.conf) است:

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/repaid
sudo ln -s /etc/nginx/sites-available/repaid /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d repaid.example.com        # دریافت گواهی TLS
```

نکتهٔ کوکی نشست: پرچم `secure` روی کوکی خاموش است تا سامانه روی HTTP داخلی هم کار کند؛
برای دسترسی اینترنتی حتماً HTTPS (certbot/Cloudflare Tunnel) بگذارید.

> اگر با `nginx`/`Apache` اجرا می‌کنید، حتماً `X-Forwarded-For` را پاس بدهید تا محدودیت
> تلاش ورود و لاگ‌ها درست کار کنند (در نمونه تنظیم شده است).

## ۶) سلامت سرویس و پایش

```
GET /api/health      →  200 {"status":"ok","database":"ok","activeUsers":n,...}
```

این مسیر عمومی است (بدون ورود) و برای healthcheck داکر/nginx/نظارت بیرونی طراحی شده.
اگر دیتابیس در دسترس نباشد، پاسخ `503` برمی‌گردد.

```bash
curl -fsS http://127.0.0.1:3000/api/health
```

## ۷) آماده‌سازی و تست پیش از تحویل

```bash
npm run check:server    # tsc + تست‌های واحد + ساخت تولیدی
npm run smoke           # تست همهٔ بخش‌ها روی سرورِ در حال اجرا
```

`npm run smoke` (فایل [scripts/server-smoke.cjs](../scripts/server-smoke.cjs)) روی آدرس
`BASE_URL` (پیش‌فرض `http://127.0.0.1:3000`) تمام صفحه‌ها، API ها، ورود/خروج، محافظت
مسیرها بدون نشست و بکاپ دیتابیس را بررسی می‌کند و در صورت خطا کد خروج `1` می‌دهد.

## ۸) پشتیبان‌گیری و بازگردانی

- **از پنل:** تنظیمات ← پشتیبان‌گیری (`GET /api/backup`) فایل `.db` را دانلود می‌کند.
  پیش از خواندن فایل، `wal_checkpoint(TRUNCATE)` اجرا می‌شود تا همهٔ داده‌ها در فایل اصلی باشند.
- **از سرور:** برای کپی امن، ابتدا checkpoint بگیرید و سپس هر دو فایل را بردارید:

```bash
sqlite3 "$REPAID_DATA_DIR/repaid.db" "PRAGMA wal_checkpoint(TRUNCATE);"
cp "$REPAID_DATA_DIR/repaid.db" /backup/repaid-$(date +%F).db
```

- **بازگردانی:** سرویس را متوقف کنید، فایل‌های `repaid.db-wal` و `repaid.db-shm` را پاک کنید،
  فایل پشتیبان را جایگزین کنید و سرویس را بالا بیاورید.
- زمان‌بندی پیشنهادی: یک cron روزانه + نگه‌داری نسخه‌های ۳۰ روز اخیر.

## ۹) چک‌لیست استقرار

- [ ] Node 24 نصب است (`node -v`) یا از ایمیج داکر استفاده می‌شود.
- [ ] `REPAID_DATA_DIR` روی مسیری پایدار و پشتیبان‌گیری‌شدنی تنظیم شده است.
- [ ] `npm run build` بدون خطا تمام شده و `npm run smoke` سبز است.
- [ ] گذرواژهٔ حساب مالک تغییر داده شده و حساب‌های نمایشی حذف/غیرفعال شده‌اند.
- [ ] HTTPS فعال است و پورت برنامه از اینترنت بسته است (فقط 80/443 باز باشد).
- [ ] cron پشتیبان‌گیری روزانه ثبت شده و یک‌بار بازگردانی آزمایش شده است.
- [ ] پایش روی `GET /api/health` تنظیم شده است.

## ۱۰) محدودیت serverless

Netlify/Lambda با دیتابیس فایل‌محور این نسخه سازگار نیستند. مسیر قدیمی انتشار نمایشی حذف شده است.
برای بهره‌برداری، از دیسک پایدار و روش‌های استقرار اختصاصی استفاده کنید.
