"use client";

import { useState } from "react";
import { useToast } from "@/components/ui";
import { Icon } from "@/components/icon";

/** دریافت پشتیبان کامل دیتابیس + راهنمای بازگردانی */
export function BackupButton() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [lastAt, setLastAt] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/backup?mode=prepare",{method:'POST',cache:'no-store'});
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "خطا در تهیهٔ پشتیبان");
      }
      const prepared=await res.json(),url=new URL(prepared.download_url,window.location.origin);
      if(url.origin!==window.location.origin||url.pathname!=='/api/backup')throw new Error('نشانی دریافت معتبر نیست.');
      const a = document.createElement("a");
      a.href = url.href;
      a.download = `repaid-backup-${new Date().toISOString().slice(0, 10)}.db`;
      document.body.appendChild(a);a.click();a.remove();
      setLastAt(new Date().toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" }));
      toast("نسخه تأیید شد؛ دریافت فایل به مرورگر سپرده شد.");
    } catch (e: any) {
      toast(e.message ?? "خطا در تهیهٔ پشتیبان", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" onClick={download} disabled={busy}>
          <Icon name="download" size={16} /> {busy ? "در حال آماده‌سازی…" : "دریافت پشتیبان دیتابیس"}
        </button>
        {lastAt && <span className="text-xs text-zinc-500 dark:text-zinc-400">آخرین آماده‌سازی: ساعت {lastAt}</span>}
      </div>
      <ul className="space-y-1.5 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
        <li>خروجی شامل رکوردهای دیتابیس است. اگر نگهداری فایل‌های خصوصی فعال باشد، نسخهٔ همان فایل‌ها نیز جداگانه لازم است.</li>
        <li>پیش از بازگردانی، نسخه را در محیط جدا آزمایش کنید؛ دیتابیس جاری یا فایل‌های آن را بدون پشتیبان و برنامهٔ بازیابی جایگزین نکنید.</li>
        <li>خروجی دستی رمزنگاری نشده است. آن را خصوصی نگه دارید؛ برای نگهداری دوره‌ای از پشتیبان رمزنگاری‌شده و نسخهٔ خارج از سرور استفاده کنید.</li>
      </ul>
    </div>
  );
}
