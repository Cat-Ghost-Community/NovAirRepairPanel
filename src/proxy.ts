import { NextRequest, NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/request-security";
import {postgresIntegration,postgresIntegrationRoute} from '@/lib/db/pg-integration-config';
import {browserContentSecurityPolicy,isPublicFont} from '@/lib/network-policy';

// «/api/track» عمومی است: وریفای شماره/پذیرش و تأیید برآورد با توکن عمومی —
// بدون این، مشتریِ لاگین‌نکرده در صفحه پیگیری به /login ریدایرکت می‌شود و فرم همیشه شکست می‌خورد.
// «/api/health» هم عمومی است: healthcheck داکر/nginx/systemd نباید به /login ریدایرکت شود.
const PUBLIC_PREFIXES = ["/login", "/track", "/api/auth", "/api/track", "/api/health", "/_next", "/favicon", "/icon"];

/** پروکسی لبه (جانشین middleware در Next 16) — فقط حضور توکن را می‌بیند و به صفحهٔ ورود می‌فرستد. */
export function proxy(req: NextRequest) {
  const nonce=Buffer.from(crypto.randomUUID()).toString('base64'),csp=browserContentSecurityPolicy(nonce);
  const response=routeRequest(req,nonce,csp);
  response.headers.set('Content-Security-Policy',csp);
  response.headers.set('X-Content-Type-Options','nosniff');
  response.headers.set('X-Frame-Options','DENY');
  response.headers.set('Referrer-Policy','strict-origin-when-cross-origin');
  if(!isPublicFont(req.nextUrl.pathname)&&!req.nextUrl.pathname.startsWith('/_next/'))response.headers.set('Cache-Control','private, no-store');
  return response;
}
function routeRequest(req:NextRequest,nonce:string,csp:string){
  if (!isSameOriginMutation(req)) {
    return NextResponse.json({ error: "درخواست از منبع غیرمجاز رد شد." }, { status: 403 });
  }
  const { pathname } = req.nextUrl;
  const pg=postgresIntegration();
  if(pg&&!postgresIntegrationRoute(pathname,req.method))return NextResponse.json({error:'این بخش هنوز برای آزمون PostgreSQL مهاجرت نکرده است.',code:'PG_MIGRATION_PENDING'},{status:503});
  if(pg&&pathname==='/')return NextResponse.redirect(new URL('/customers',req.url));
  const isPublic = isPublicFont(pathname)||PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const token = req.cookies.get("repaid_session")?.value;

  // مهم: پروکسی فقط presence توکن را می‌بیند (به DB دسترسی ندارد). تصمیم «توکن معتبر است یا نه»
  // یک‌جا در خود /login گرفته می‌شود (نشست معتبر → خانه، نامعتبر → فرم ورود)؛
  // این‌جا هرگز از /login به جای دیگری ریدایرکت نمی‌کنیم تا با ریدایرکت صفحات محافظت‌شده
  // روی توکن کهنه، حلقهٔ بی‌نهایت / ↔ /login ساخته نشود.
  if (!token && !isPublic) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "نشست شما منقضی شده است. لطفاً دوباره وارد شوید." }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce',nonce);
  requestHeaders.set('Content-Security-Policy',csp);
  requestHeaders.set("x-repaid-path", pathname);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (pathname.startsWith("/api/")) response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
