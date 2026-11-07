import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="card card-pad w-full max-w-md text-center">
        <h1 className="text-lg font-bold">صفحه در دسترس نیست</h1>
        <p className="mt-2 text-sm text-zinc-500">نشانی را بررسی کنید. ممکن است صفحه حذف شده باشد یا دسترسی لازم را نداشته باشید.</p>
        <Link href="/" className="btn-primary mt-4">بازگشت به داشبورد</Link>
      </div>
    </div>
  );
}
