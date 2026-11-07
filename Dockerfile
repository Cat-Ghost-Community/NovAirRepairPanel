# ── تصویر تولیدی «تعمیرکار» ───────────────────────────────────────────────────
# دیتابیس از node:sqlite استفاده می‌کند؛ اجرای تأییدشده با Node.js 24 است.
# ساخت:  docker build -t repaid .
# اجرا:   docker run -d -p 3000:3000 -v repaid-data:/data --name repaid repaid

# ---- مرحلهٔ ساخت ----
FROM node:24-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# خروجی self-contained برای اجرای سبک روی سرور
ENV BUILD_STANDALONE=1
RUN npm run build
RUN npm run db:build-tools

# ---- مرحلهٔ اجرا ----
FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    TZ=Asia/Tehran \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    WEB_CONCURRENCY=1 \
    HOSTNAME=0.0.0.0 \
    REPAID_DATA_DIR=/data

# کاربر غیرروت + پوشهٔ دادهٔ پایدار
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs \
 && mkdir -p /data/objects /backups /backup-work && chown -R nextjs:nodejs /data /backups /backup-work \
 && chmod 700 /data /data/objects /backups /backup-work

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.database-tools ./database-tools

USER nextjs
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
