import type { Metadata } from "next";
import "@fontsource-variable/estedad";
import "./globals.css";
import { ToastProvider } from "@/components/ui";
import { Shell } from "@/components/shell";
import { Toaster } from "sonner";
import { effectivePermissions, getSessionByToken } from "@/lib/auth";
import { BRANCH_COOKIE, activeBranch, canSwitchBranch } from "@/lib/branch";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db/schema";
import { ensureDefaultStatuses } from "@/lib/repair";
import { initCurrencyUnit } from "@/lib/currency-server";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { canUser } from "@/lib/auth";
import { isPublicPage, pagePermission } from "@/lib/page-permissions";
import {postgresIntegration} from "@/lib/db/pg-integration-config";
import {postgresShellState} from "@/lib/db/pg-shell";
import {hasPerm} from "@/lib/perms-shared";
import type {Session} from "@/lib/auth";
import {currentPrintSettings} from '@/lib/print-settings-server';
import {DocumentPrintStyles} from '@/components/document-print';

// فونت متغیر Estedad (self-host از fontsource) — بدون درخواست شبکه در runtime
// متغیر --font-vazir حفظ شده تا همه ارجاعات قبلی کار کنند
const vazir = { variable: "--font-vazir" };

export const metadata: Metadata = {
  title: "تعمیرکار — سیستم مدیریت تعمیرگاه",
  description: "پلتفرم جامع مدیریت تعمیرگاه لوازم الکترونیکی",
};

// Every route depends on request-time authentication and SQLite-backed data.
// Shared authentication and persisted state must resolve at request time.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolve request state before touching runtime-only services. During any
  // static-generation probe this marks the route dynamic before SQLite opens.
  const cookieStore = await cookies();
  const pathname = (await headers()).get("x-repaid-path") ?? "/";
  const pg=postgresIntegration();
  let session:Session|null,branches:Array<{id:number;name:string}>,perms:string[],scope:{branchId:number|null}|null;
  if(pg){
    const state=await postgresShellState(cookieStore.get("repaid_session")?.value,cookieStore.get(BRANCH_COOKIE)?.value);
    ({session,branches,scope}=state);perms=state.permissions;
    if(!isPublicPage(pathname)){if(!session)redirect("/login");if(!hasPerm(perms,pagePermission(pathname)))notFound();}
  }else{
    ensureDefaultStatuses();initCurrencyUnit();session=getSessionByToken(cookieStore.get("repaid_session")?.value);
    if(!isPublicPage(pathname)){if(!session)redirect("/login");if(!canUser(session,pagePermission(pathname)))notFound();}
    const db=getDb(),directoryBranch=session&&canSwitchBranch(session.user.role)?null:session?.user.branch_id??-1;
    branches=(db.prepare("SELECT id,name FROM branches WHERE is_active=1 AND (? IS NULL OR id=?)").all(directoryBranch,directoryBranch) as Array<{id:number;name:string}>).map(b=>({id:Number(b.id),name:String(b.name)}));
    perms=session?effectivePermissions(session.user.role,session.user.id):[];
    scope=session?activeBranch(session,cookieStore.get(BRANCH_COOKIE)?.value):null;
  }

  return (
    <html lang="fa" dir="rtl" className={`${vazir.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        <DocumentPrintStyles settings={await currentPrintSettings()}/>
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:right-2 focus:z-[100] focus:rounded-lg focus:bg-brand-600 focus:px-3 focus:py-2 focus:text-white">
          پرش به محتوای اصلی
        </a>
        {session ? (
          <ToastProvider>
            <Shell
              integrationMode={!!pg}
              user={session.user}
              branches={branches}
              perms={perms}
              activeBranchId={scope?.branchId ?? null}
              canSwitchBranch={session ? canSwitchBranch(session.user.role) : false}
            >
              {children}
            </Shell>
            <Toaster position="bottom-right" dir="rtl" richColors closeButton />
          </ToastProvider>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
