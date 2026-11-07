"use client";

import Link from "next/link";

/** مرز خطای سراسری — به‌جای صفحه سفید، پیام فارسی و دکمه تلاش مجدد */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="card card-pad text-center max-w-md">
        <div className="text-4xl mb-3"></div>
        <h2 className="text-lg font-bold">مشکلی پیش آمد</h2>
        <p className="text-sm text-zinc-500 mt-1">
          هنگام بارگذاری این بخش خطایی رخ داد. می‌توانید دوباره تلاش کنید؛ اگر تکرار شد با پشتیبانی تماس بگیرید.
        </p>
        {error.digest && <p className="text-xs text-zinc-400 mt-2 font-mono" dir="ltr">{error.digest}</p>}
        <div className="flex gap-2 justify-center mt-4">
          <button className="btn-primary" onClick={reset}>تلاش مجدد</button>
          <Link href="/" className="btn-secondary">بازگشت به داشبورد</Link>
        </div>
      </div>
    </div>
  );
}
