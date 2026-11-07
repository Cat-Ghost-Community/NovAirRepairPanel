"use client";

import { useState } from "react";
import { useToast } from "@/components/ui";
import { DEFAULT_ALLOWED_EXT, BLOCKED_EXT } from "@/lib/chat-shared";

/**
 * تنظیمات گفت‌وگوی داخلی — محدودیت فایل و مهلت ویرایش پیام.
 * همهٔ مقادیر سمت سرور اعمال می‌شوند (آپلود و ویرایش با همین کلیدها کنترل می‌شوند).
 */
export function ChatSettings({
  values,
  canEdit,
}: {
  values: { max_file_mb: string; allowed_ext: string; edit_window_min: string };
  canEdit: boolean;
}) {
  const toast = useToast();
  const [maxFile, setMaxFile] = useState(values.max_file_mb || "10");
  const [exts, setExts] = useState(values.allowed_ext || DEFAULT_ALLOWED_EXT);
  const [editWindow, setEditWindow] = useState(values.edit_window_min || "15");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          values: {
            "chat.max_file_mb": maxFile,
            "chat.allowed_ext": exts,
            "chat.edit_window_min": editWindow,
          },
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "ذخیره ناموفق بود");
      toast("تنظیمات گفت‌وگو ذخیره شد");
    } catch (e: any) {
      toast(e?.message ?? "ذخیره ناموفق بود", "error");
    } finally {
      setBusy(false);
    }
  };

  const extList = exts
    .split(",")
    .map((e) => e.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean);

  if (!canEdit) {
    return (
      <div className="space-y-1.5 px-4 py-4 text-sm text-zinc-500 sm:px-5 dark:text-zinc-400">
        <p>حداکثر حجم فایل: {maxFile} مگابایت</p>
        <p>پسوندهای مجاز: {extList.slice(0, 12).join("، ")}{extList.length > 12 ? " و…" : ""}</p>
        <p>مهلت ویرایش پیام: {editWindow === "0" ? "بدون محدودیت" : `${editWindow} دقیقه`}</p>
        <p className="text-xs text-zinc-400">برای تغییر به مجوز «ویرایش تنظیمات» نیاز دارید.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-4 py-4 sm:px-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">حداکثر حجم فایل پیوست (مگابایت)</span>
          <input
            type="number"
            min={1}
            max={50}
            className="input"
            value={maxFile}
            onChange={(e) => setMaxFile(e.target.value)}
            aria-label="حداکثر حجم فایل پیوست"
          />
          <span className="mt-1 block text-xs text-zinc-400">بین ۱ تا ۵۰ مگابایت — سمت سرور هم همین محدودیت اعمال می‌شود.</span>
        </label>
        <label className="block">
          <span className="label">مهلت ویرایش پیام (دقیقه)</span>
          <input
            type="number"
            min={0}
            max={1440}
            className="input"
            value={editWindow}
            onChange={(e) => setEditWindow(e.target.value)}
            aria-label="مهلت ویرایش پیام"
          />
          <span className="mt-1 block text-xs text-zinc-400">صفر یعنی بدون محدودیت زمانی.</span>
        </label>
      </div>

      <div>
        <label className="label" htmlFor="chat-ext">پسوندهای مجاز فایل</label>
        <input
          id="chat-ext"
          className="input ltr-num"
          dir="ltr"
          value={exts}
          onChange={(e) => setExts(e.target.value)}
          placeholder={DEFAULT_ALLOWED_EXT}
        />
        <span className="mt-1 block text-xs text-zinc-400">
          جدا شده با ویرگول. پسوندهای اجرایی/اسکریپتی (مثل {BLOCKED_EXT.slice(0, 6).join("، ")}) همیشه مسدود هستند.
        </span>
        {extList.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {extList.map((e) => (
              <span key={e} className="chip ltr-num" dir="ltr">.{e}</span>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button className="btn-primary btn-sm" disabled={busy} onClick={() => void save()}>
          {busy ? "در حال ذخیره…" : "ذخیرهٔ تنظیمات گفت‌وگو"}
        </button>
      </div>
    </div>
  );
}
