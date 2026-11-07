import Link from "next/link";
import { sessionCookie, getSessionByToken } from "@/lib/auth";
import { authenticate } from "@/lib/login";
import { HttpError } from "@/lib/api";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {readyApplicationPostgres} from '@/lib/db/pg-application';
import {getPostgresSessionByToken} from '@/lib/db/pg-app-auth';

export const dynamic = "force-dynamic";

async function login(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const cookieStore = await cookies();
  let token: string;
  try {
    token = await authenticate(email, password, cookieStore.get("repaid_session")?.value);
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    redirect(`/login?error=${error.status === 429 ? "rate" : "1"}&email=${encodeURIComponent(email)}`);
  }
  cookieStore.set(sessionCookie(token));
  redirect(postgresIntegration()?'/customers':'/');
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; email?: string }> }) {
  const params = await searchParams;
  // توکن کهنه/نامعتبر این‌جا به فرم ورود می‌رسد (بدون حلقه)؛ نشست معتبر مستقیم به خانه می‌رود
  const token=(await cookies()).get('repaid_session')?.value;
  const pg=postgresIntegration(),application=pg?await readyApplicationPostgres():null;
  const current=application?await getPostgresSessionByToken(application.database,application.schema,token):getSessionByToken(token);
  if (current) redirect(pg?'/customers':'/');
  return (
    <div className="flex min-h-dvh items-center justify-center bg-zinc-100 dark:bg-zinc-950 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white text-2xl font-bold">ت</span>
          <h1 className="mt-3 text-xl font-bold tracking-tight">تعمیرکار</h1>
          <p className="text-sm text-zinc-500">سیستم مدیریت تعمیرگاه لوازم الکترونیکی</p>
        </div>
        <div className="card card-pad">
          <form action={login} className="space-y-3">
            <div>
              <label htmlFor="email" className="label">ایمیل</label>
              <input id="email" name="email" type="email" required autoComplete="email" defaultValue={params.email} className="input" placeholder="email@shop.ir" dir="ltr" />
            </div>
            <div>
              <label htmlFor="password" className="label">گذرواژه</label>
              <input id="password" name="password" type="password" required autoComplete="current-password" className="input" placeholder="••••••••" dir="ltr" />
            </div>
            {params.error && (
              <p className="rounded-lg bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 text-sm px-3 py-2" role="alert">
                {params.error === "rate" ? "تلاش‌های ورود زیاد بوده است. پنج دقیقه دیگر دوباره تلاش کنید." : "ترکیب ایمیل و گذرواژه درست نیست. دوباره تلاش کنید."}
              </p>
            )}
            <button type="submit" className="btn-primary btn-lg w-full">ورود</button>
          </form>
        </div>
        <p className="mt-4 text-center text-xs text-zinc-400">
          مشتری هستید؟ <Link href="/track" className="text-brand-600 hover:underline">پیگیری تعمیر &larr;</Link>
        </p>
      </div>
    </div>
  );
}
