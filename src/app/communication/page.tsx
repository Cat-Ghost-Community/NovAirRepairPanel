import { activeBranch, BRANCH_COOKIE } from "@/lib/branch";
import { requirePageAccess } from "@/lib/page-access";
import { getDb } from "@/lib/db/schema";
import { fmtDateTime, toFaDigits } from "@/lib/format";
import { statusFa } from "@/lib/status-fa";
import { EmptyState } from "@/components/ui";
import { Icon } from "@/components/icon";
import { TemplateEditor, SendMessageButton } from "./communication-client";
import { getSessionByToken, canUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const MSG_STATUS: Record<string, string> = { queued: "در صف", sent: "ارسال‌شده", failed: "ناموفق", delivered: "تحویل‌شده" };
const EVENT_FA: Record<string, string> = {
  ticket_created: "ثبت پذیرش", diagnosing_started: "شروع عیب‌یابی", estimate_ready: "برآورد آماده شد",
  waiting_for_parts: "در انتظار قطعه", in_repair: "در حال تعمیر", ready_for_pickup: "آماده تحویل",
  delivered: "تحویل شد", warranty_created: "گارانتی صادر شد",
};
const CHANNEL_ICON: Record<string, string> = { sms: "chat", email: "mail", whatsapp: "chat", system: "bell" };

export default async function CommunicationPage() {
  await requirePageAccess("/communication");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "communication.send")) redirect("/");
  const db = getDb();
  const branch = activeBranch(session,cookieStore.get(BRANCH_COOKIE)?.value).branchId;
  const messages = db
    .prepare(
      `SELECT m.*, t.number ticket_number, c.first_name, c.last_name
       FROM messages m
       LEFT JOIN repair_tickets t ON t.id = m.ticket_id
       LEFT JOIN customers c ON c.id = m.customer_id
       WHERE m.channel='sms' AND (? IS NULL OR COALESCE(m.branch_id,t.branch_id,c.branch_id,(SELECT MIN(a.branch_id) FROM customer_branch_access a WHERE a.customer_id=m.customer_id HAVING COUNT(*)=1))=?) ORDER BY m.created_at DESC LIMIT 100`
    )
    .all(branch,branch) as any[];
  const templates = db.prepare("SELECT * FROM message_templates WHERE channel='sms' ORDER BY event").all() as any[];
  const customers = (db.prepare("SELECT id, first_name, last_name, mobile FROM customers WHERE (? IS NULL OR id IN (SELECT customer_id FROM customer_branch_access WHERE branch_id=?)) ORDER BY first_name LIMIT 500").all(branch,branch) as any[]).map((c) => ({ id: c.id, first_name: c.first_name, last_name: c.last_name, mobile: c.mobile }));

  const queued = messages.filter((m) => m.direction === "out" && m.status === "queued").length;

  const templateRows = templates.map((t) => ({
    id: t.id as number,
    event: t.event as string,
    event_fa: EVENT_FA[t.event] ?? statusFa(t.event),
    channel: t.channel as string,
    subject: (t.subject ?? null) as string | null,
    body: t.body as string,
    is_active: t.is_active as number,
  }));

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold tracking-tight">مرکز ارتباطات</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {toFaDigits(queued)} پیام در صف ارسال است. تغییر وضعیت پذیرش‌هایی که اطلاع‌رسانی آن‌ها فعال است، به‌صورت خودکار پیام مشتری را اینجا صف می‌کند.
          </p>
        </div>
        <SendMessageButton customers={customers} />
      </div>

      <section className="card">
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800"><h2 className="section-title">سابقه پیام‌ها</h2></div>
        {messages.length === 0 ? (
          <EmptyState icon="chat" title="هنوز پیامی نیست" body="اطلاعیه‌های مشتریان (آماده شدن برآورد، آماده تحویل و…) هنگام ارسال اینجا نمایش داده می‌شود." />
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60 max-h-96 overflow-y-auto">
            {messages.map((m) => (
              <div key={m.id} className="px-5 py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px]">
                    <Icon name={CHANNEL_ICON[m.channel] ?? "chat"} size={14} className="inline align-[-2px] opacity-60" />
                    <span className="font-medium">{m.first_name ? `${m.first_name} ${m.last_name}` : "مشتری"}</span>
                    {m.ticket_number && <span className="text-zinc-400"> · {m.ticket_number}</span>}
                    <span className={`mr-2 ${m.direction === "in" ? "badge-blue" : "badge-gray"}`}>{m.direction === "in" ? "دریافت شد" : MSG_STATUS[m.status] ?? m.status}</span>
                  </div>
                  <p className="mt-1 text-[13px] text-zinc-600 break-words dark:text-zinc-300">{m.body}</p>
                </div>
                <span className="text-xs text-zinc-400 whitespace-nowrap">{fmtDateTime(m.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="section-title">قالب پیام‌ها</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            متغیرها: {"{{customer_name}} {{ticket}} {{device}} {{status}} {{amount}} {{link}} {{shop}}"}
          </p>
        </div>
        <TemplateEditor templates={templateRows} canManage={["owner","admin"].includes(session.user.role) && canUser(session,"communication.manage")} />
      </section>
    </div>
  );
}
