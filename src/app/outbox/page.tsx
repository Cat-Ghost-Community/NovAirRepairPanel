import { requirePageAccess } from "@/lib/page-access";
import { getDb } from "@/lib/db/schema";
import { OutboxClient } from "./outbox-client";
import { getSessionByToken, canUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function OutboxPage() {
  await requirePageAccess("/outbox");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "communication.send")) redirect("/");
  const db = getDb();
  const canConfigure=["owner","admin"].includes(session.user.role) && canUser(session,"settings.edit");
  const smsSettings = db
    .prepare("SELECT key, value FROM settings WHERE key IN ('sms_provider','sms_api_key','sms_sender','sms_webhook_url')")
    .all() as any[];
  const values: Record<string, string> = {};
  for (const r of smsSettings) values[r.key] = r.value;
  values.has_sms_api_key = values.sms_api_key ? "1" : "0";
  delete values.sms_api_key;
  if(!canConfigure) delete values.sms_webhook_url;

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">صف ارسال پیام</h1>
        <p className="text-sm text-zinc-500 mt-0.5">پیام‌های اطلاع‌رسانی مشتریان؛ پس از تنظیم درگاه، ارسال را از همین صف انجام دهید.</p>
      </div>
      <OutboxClient initialSettings={{ ...values }} canConfigure={canConfigure} />
    </div>
  );
}
