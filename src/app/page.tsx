import { requirePageAccess } from "@/lib/page-access";
import {TehranGreeting} from '@/components/tehran-greeting';
import { getDb } from "@/lib/db/schema";
import { getSessionByToken, canUser, ROLE_LABELS } from "@/lib/auth";
import { BRANCH_COOKIE, activeBranch, branchWhere } from "@/lib/branch";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Icon } from "@/components/icon";
import { fmtMoney, fmtDate, faNum, toFaDigits, rialToDisplay, getCurrencyUnit } from "@/lib/format";
import Link from "next/link";
import { StatusBadge, PriorityBadge, Avatar, EmptyState } from "@/components/ui";
import { DashboardCharts } from "@/components/dashboard-charts";
import { statusFa } from "@/lib/status-fa";
import { CASH_EVENTS_CTE, INVOICE_BALANCES_CTE, SETTLED_PAYMENT } from "@/lib/payment-state";
import { Panel, KpiTile, MiniStat, WIDGET_SPAN, type Tone } from "./dashboard-parts";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  await requirePageAccess("/");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  const user = session.user;
  // One request-scoped clock snapshot keeps the greeting, date and age windows consistent.
  const serverNow = new Date().getTime();
  const db = getDb();

  const role = user.role;
  const isOwnerLike = ["owner", "admin"].includes(role);
  const isTech = role === "technician";
  const isReception = role === "reception" || role === "sales";
  const isAccountant = role === "accountant";

  // محدودهٔ شعبه: مدیران «همه شعب» یا شعبهٔ انتخابی، بقیه قفل روی شعبهٔ خودشان
  const scope = activeBranch(session, cookieStore.get(BRANCH_COOKIE)?.value);
  const bw = (alias: string) => branchWhere(scope, alias);
  const jalaliToday = new Intl.DateTimeFormat("fa-IR", { timeZone:"Asia/Tehran", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(serverNow));
  const branchName =
    scope.branchId == null
      ? "همهٔ شعبه‌ها"
      : String((db.prepare("SELECT name FROM branches WHERE id = ?").get(scope.branchId) as any)?.name ?? "شعبه");

  const statuses = db.prepare("SELECT id, name, color FROM repair_statuses").all() as any[];
  const st = (name: string) => statuses.find((s) => s.name === name)?.id;
  const sid = (n: string) => st(n) ?? -1;

  const openStatuses = db.prepare("SELECT id FROM repair_statuses WHERE is_open = 1").all() as any[];
  const openIds = openStatuses.map((s) => s.id);

  const inStatuses = (names: string[]) => {
    const ids = names.map(sid).filter((i) => i > 0);
    return ids.length ? `(${ids.join(",")})` : "(-1)";
  };

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const today = todayStart.toISOString().slice(0, 19).replace("T", " ");
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const month = monthStart.toISOString().slice(0, 19).replace("T", " ");

  const q1 = (sql: string, params: (string | number | null)[] = []) => (db.prepare(sql).get(...params) as any);
  const scopeParams = [scope.branchId, scope.branchId];

  // Core counts — همه شمارش‌های وضعیت در یک کوئری GROUP BY
  const statusCounts = new Map(
    (db.prepare(`SELECT t.status_id, COUNT(*) c FROM repair_tickets t WHERE ${bw("t").sql} GROUP BY t.status_id`).all(...bw("t").params) as any[]).map((r) => [r.status_id, r.c])
  );
  const cnt = (name: string) => statusCounts.get(sid(name)) ?? 0;
  const repairsToday = q1(`SELECT COUNT(*) c FROM repair_tickets t WHERE ${bw("t").sql} AND t.created_at >= ?`, [...bw("t").params, today]).c;
  const activeCount = q1(`SELECT COUNT(*) c FROM repair_tickets t WHERE ${bw("t").sql} AND t.status_id IN ${openStatuses.length ? `(${openIds.join(",")})` : "(-1)"}`, bw("t").params).c;
  const diagnosing = cnt("Diagnosing");
  const awaitingApproval = cnt("Waiting for Customer Approval");
  const waitingParts = cnt("Waiting for Parts");
  const readyPickup = cnt("Ready for Pickup");
  const delivered30 = q1(`SELECT COUNT(*) c FROM repair_tickets t WHERE ${bw("t").sql} AND status_id = ${sid("Delivered")} AND completed_at >= datetime('now','-30 days')`, bw("t").params).c;
  const warrantyRepairs = q1(`SELECT COUNT(*) c FROM repair_tickets t WHERE ${bw("t").sql} AND is_warranty = 1 AND status_id IN ${inStatuses(["Warranty", "In Repair", "Quality Control"])}`, bw("t").params).c;
  const devicesInShop = activeCount;
  const newCustomers30 = q1(`SELECT COUNT(*) c FROM customers c WHERE created_at >= datetime('now','-30 days') AND (? IS NULL OR EXISTS (SELECT 1 FROM customer_branch_access a WHERE a.customer_id=c.id AND a.branch_id=?))`, scopeParams).c;

  // delayed = estimated_completion in past & still open
  const delayed = q1(
    `SELECT COUNT(*) c FROM repair_tickets t WHERE ${bw("t").sql} AND t.estimated_completion IS NOT NULL AND t.estimated_completion < datetime('now') AND t.status_id IN ${inStatuses(["Diagnosing","Waiting for Diagnosis","Waiting for Customer Approval","Approved","Waiting for Parts","In Repair","Quality Control"])}`, bw("t").params
  ).c;

  // Money
  const salesToday = q1(`SELECT COALESCE(SUM(total),0) v FROM sales s WHERE ${bw("s").sql} AND status!='cancelled' AND created_at >= ?`, [...bw("s").params, today]).v;
  const paymentsToday = q1(`${CASH_EVENTS_CTE} SELECT COALESCE(SUM(inflow),0) v FROM cash_events e WHERE ${bw("e").sql} AND event_at>=?`, [...bw("e").params, today]).v;
  // Operational billing, not recognized revenue: an invoiced sale is counted only once.
  const salesMonth = q1(`SELECT COALESCE(SUM(total),0) v FROM sales s WHERE ${bw("s").sql} AND status!='cancelled' AND created_at>=? AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.sale_id=s.id AND i.status NOT IN ('draft','cancelled'))`, [...bw("s").params, month]).v;
  const invMonth = q1(`SELECT COALESCE(SUM(total),0) v FROM effective_invoices i WHERE ${bw("i").sql} AND created_at>=? AND type!='purchase' AND status NOT IN ('draft','cancelled')`, [...bw("i").params, month]).v;
  const revenueMonth = salesMonth + invMonth;
  const expensesMonth = q1(`SELECT COALESCE(SUM(amount),0) v FROM expenses e WHERE ${bw("e").sql} AND date>=date(?)`, [...bw("e").params, month]).v;
  const invoicePosition = q1(`${INVOICE_BALANCES_CTE} SELECT COALESCE(SUM(MAX(total-settled_paid,0)),0) v,COUNT(*) c FROM invoice_balances i WHERE ${bw("i").sql} AND type!='purchase' AND status NOT IN ('draft','cancelled') AND total>settled_paid`, bw("i").params);
  const receivables = invoicePosition.v;
  const unpaidInvoices = invoicePosition.c;

  // Inventory
  const lowStock = db.prepare(
    `SELECT p.id, p.name, COALESCE(SUM(s.qty),0) qty, p.min_stock, p.reorder_point
     FROM parts p LEFT JOIN inventory_stock s ON s.part_id = p.id AND (? IS NULL OR s.location_id IN (SELECT id FROM inventory_locations WHERE branch_id=?))
     WHERE p.is_active = 1 GROUP BY p.id
     HAVING qty > 0 AND qty <= COALESCE(p.reorder_point, p.min_stock, 0) ORDER BY qty ASC LIMIT 5`
  ).all(...scopeParams) as any[];
  const outOfStock = db.prepare(
    `SELECT p.id, p.name FROM parts p LEFT JOIN inventory_stock s ON s.part_id = p.id AND (? IS NULL OR s.location_id IN (SELECT id FROM inventory_locations WHERE branch_id=?))
     WHERE p.is_active = 1 GROUP BY p.id HAVING COALESCE(SUM(s.qty),0) = 0 LIMIT 5`
  ).all(...scopeParams) as any[];
  const openPOs = q1(`SELECT COUNT(*) c FROM purchase_orders p WHERE ${bw("p").sql} AND status IN ('draft','sent','partially_received')`, bw("p").params).c;

  // سررسیدهای ۷ روز آینده (چک/قسط/گارانتی) — فقط برای کاربران مالی
  const canFinancial = canUser(session, "finance.view");
  const upcomingDue: Array<{ kind: string; title: string; href: string; jdate: string }> = [];
  if (canFinancial) {
    const g7 = new Date(serverNow + 7 * 86400000);
    const g7ISO = `${g7.getFullYear()}-${String(g7.getMonth() + 1).padStart(2, "0")}-${String(g7.getDate()).padStart(2, "0")}`;
    const todayISO = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`;
    const fmtJ = (iso: string) => { const [,month,day] = fmtDate(iso).split("/"); return day && month ? `${day}/${month}` : "—"; };
    const cks = db.prepare(
      `SELECT c.*, cu.first_name || ' ' || cu.last_name cn, s.name sn FROM checks c
       LEFT JOIN customers cu ON cu.id = c.customer_id LEFT JOIN suppliers s ON s.id = c.supplier_id
       WHERE c.due_date >= ? AND c.due_date <= ? AND c.status IN ('in_hand','in_bank') AND (? IS NULL OR c.branch_id=?) ORDER BY c.due_date LIMIT 6`
    ).all(todayISO,g7ISO,scope.branchId,scope.branchId) as any[];
    for (const c of cks) upcomingDue.push({ kind: c.kind === "received" ? "check_in" : "check_out", title: `${c.kind === "received" ? "چک دریافتی" : "چک پرداختی"} — ${c.cn ?? c.sn ?? "—"}`, href: "/checks", jdate: fmtJ(String(c.due_date)) });
    const inst = db.prepare(
      `SELECT i.*, cu.first_name || ' ' || cu.last_name cn FROM effective_installments i LEFT JOIN customers cu ON cu.id = i.customer_id
       WHERE i.due_date >= ? AND i.due_date <= ? AND i.status != 'paid' AND i.legacy_review=0 AND (? IS NULL OR i.branch_id=?) ORDER BY i.due_date LIMIT 6`
    ).all(todayISO,g7ISO,scope.branchId,scope.branchId) as any[];
    for (const i of inst) upcomingDue.push({ kind: "installment", title: `قسط — ${i.cn ?? "مشتری"}`, href: i.invoice_id ? `/invoices/${i.invoice_id}` : "/installments", jdate: fmtJ(String(i.due_date)) });
    const warr = db.prepare(
      `SELECT w.*, p.name pn FROM warranties w LEFT JOIN parts p ON p.id = w.part_id
       LEFT JOIN invoices wi ON wi.id=w.invoice_id LEFT JOIN repair_tickets wt ON wt.id=w.ticket_id LEFT JOIN sales ws ON ws.id=w.sale_id
       WHERE w.end_date >= ? AND w.end_date <= ? AND w.status = 'active' AND (? IS NULL OR COALESCE(w.branch_id,wi.branch_id,wt.branch_id,ws.branch_id)=?) ORDER BY w.end_date LIMIT 6`
    ).all(todayISO,g7ISO,scope.branchId,scope.branchId) as any[];
    for (const w of warr) upcomingDue.push({ kind: "warranty", title: `پایان گارانتی — ${w.pn ?? "کالا"}`, href: "/warranty", jdate: fmtJ(String(w.end_date)) });
    upcomingDue.sort((a, b) => a.jdate.localeCompare(b.jdate, "fa"));
  }

  const revSeries = db.prepare(
    `${CASH_EVENTS_CTE} SELECT date(event_at) d, COALESCE(SUM(inflow),0) v FROM cash_events e WHERE ${bw("e").sql} AND event_at>=datetime('now','-29 days') GROUP BY d ORDER BY d`
  ).all(...bw("e").params) as any[];
  const repairSeries = db.prepare(
    `SELECT date(created_at) d, COUNT(*) c FROM repair_tickets t WHERE ${bw("t").sql} AND created_at>=datetime('now','-29 days') GROUP BY d ORDER BY d`
  ).all(...bw("t").params) as any[];

  // Work queues per role
  let queue: any[] = [];
  let queueTitle = "پذیرش‌های فعال";
  if (isTech) {
    queueTitle = "پذیرش‌های من";
    queue = db.prepare(
      `SELECT t.id, t.number, t.priority, t.problem, t.estimated_completion, s.name status_name, s.color status_color,
              c.first_name, c.last_name, d.brand, d.model, d.type
       FROM repair_tickets t
       JOIN repair_statuses s ON s.id = t.status_id
       JOIN customers c ON c.id = t.customer_id
       JOIN devices d ON d.id = t.device_id
       WHERE ${bw("t").sql} AND (t.technician_id = ? OR t.technician2_id=?) AND s.is_open = 1
       ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.estimated_completion
       LIMIT 8`
    ).all(...bw("t").params, user.id,user.id) as any[];
  } else if (isReception) {
    queueTitle = "نیاز به توجه";
    queue = db.prepare(
      `SELECT t.id, t.number, t.priority, t.problem, s.name status_name, s.color status_color,
              c.first_name, c.last_name, d.brand, d.model, d.type
       FROM repair_tickets t
       JOIN repair_statuses s ON s.id = t.status_id
       JOIN customers c ON c.id = t.customer_id
       JOIN devices d ON d.id = t.device_id
       WHERE ${bw("t").sql} AND t.status_id IN ${inStatuses(["Waiting for Customer Approval", "Ready for Pickup"])}
       ORDER BY t.ready_at DESC, t.updated_at DESC LIMIT 8`
    ).all(...bw("t").params) as any[];
  } else {
    queue = db.prepare(
      `SELECT t.id, t.number, t.priority, t.problem, t.estimated_completion, s.name status_name, s.color status_color,
              c.first_name, c.last_name, d.brand, d.model, d.type, u.name tech_name, u.avatar_color
       FROM repair_tickets t
       JOIN repair_statuses s ON s.id = t.status_id
       JOIN customers c ON c.id = t.customer_id
       JOIN devices d ON d.id = t.device_id
       LEFT JOIN users u ON u.id = t.technician_id
       WHERE ${bw("t").sql} AND s.is_open = 1
       ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.estimated_completion
       LIMIT 8`
    ).all(...bw("t").params) as any[];
  }

  // Unclaimed devices
  const unclaimed = q1(
    `SELECT COUNT(*) c FROM repair_tickets t WHERE ${bw("t").sql} AND status_id = ${sid("Ready for Pickup")} AND ready_at IS NOT NULL AND ready_at < datetime('now','-3 days')`, bw("t").params
  ).c;

  type KpiRow = { label: string; value: string | number; href: string; icon: string; tone: Tone; alert?: boolean };
  const kpis: KpiRow[] = isTech
    ? [
        { label: "ارجاع‌شده به من", value: queue.length, href: "/repairs?mine=1", icon: "user-check", tone: "brand" },
        { label: "در حال عیب‌یابی", value: diagnosing, href: "/repairs?status=Diagnosing", icon: "search", tone: "purple" },
        { label: "انتظار قطعه", value: waitingParts, href: "/repairs?status=Waiting+for+Parts", icon: "package-search", tone: "amber" },
        { label: "سررسید گذشته", value: delayed, href: "/repairs?delayed=1", icon: "clock", tone: "red", alert: delayed > 0 },
      ]
    : isReception
    ? [
        { label: "پذیرش‌های امروز", value: repairsToday, href: "/repairs", icon: "wrench", tone: "brand" },
        { label: "در انتظار تأیید", value: awaitingApproval, href: "/repairs?status=Waiting+for+Customer+Approval", icon: "clipboard-clock", tone: "amber" },
        { label: "آماده تحویل", value: readyPickup, href: "/repairs?status=Ready+for+Pickup", icon: "package-check", tone: "emerald", alert: readyPickup > 0 },
        { label: "فاکتورهای پرداخت‌نشده", value: unpaidInvoices, href: "/invoices?status=unpaid", icon: "receipt", tone: "red" },
      ]
    : isAccountant
    ? [
        { label: "صورتحساب ماه", value: fmtMoney(revenueMonth), href: "/finance", icon: "trending-up", tone: "emerald" },
        { label: "هزینه‌ها (ماه)", value: fmtMoney(expensesMonth), href: "/expenses", icon: "banknote-down", tone: "amber" },
        { label: "مطالبات", value: fmtMoney(receivables), href: "/invoices?status=unpaid", icon: "banknote", tone: "red", alert: receivables > 0 },
        { label: "دریافتی امروز", value: fmtMoney(paymentsToday), href: "/payments", icon: "hand-coins", tone: "brand" },
      ]
    : [
        { label: "پذیرش‌های فعال", value: activeCount, href: "/repairs/board", icon: "wrench", tone: "brand" },
        { label: "صورتحساب ماه", value: fmtMoney(revenueMonth), href: "/finance", icon: "trending-up", tone: "emerald" },
        { label: "هزینه‌ها (ماه)", value: fmtMoney(expensesMonth), href: "/expenses", icon: "banknote-down", tone: "amber" },
        { label: "مطالبات", value: fmtMoney(receivables), href: "/invoices?status=unpaid", icon: "banknote", tone: "red", alert: receivables > 0 },
      ];

  const secondaryKpis = [
    { label: "پذیرش‌های امروز", value: repairsToday },
    { label: "تحویل‌شده (۳۰ روز)", value: delivered30 },
    { label: "دستگاه‌های در تعمیرگاه", value: devicesInShop },
    { label: "تعمیرات گارانتی", value: warrantyRepairs },
    { label: "تحویل‌نشده ۳ روز+", value: unclaimed, alert: unclaimed > 0 },
    { label: "مشتریان جدید (۳۰ روز)", value: newCustomers30 },
    { label: "سفارش‌های خرید باز", value: openPOs },
    { label: "کالاهای کم‌موجود", value: lowStock.length + outOfStock.length, alert: lowStock.length + outOfStock.length > 0 },
  ];

  // دسترسی سریع — فقط میان‌برهایی که کاربر مجوزشان را دارد (لینک بی‌دسترسی نمایش داده نمی‌شود)
  const quickActions = [
    { href: "/repairs/new", label: "پذیرش جدید", icon: "wrench", perm: "repairs.create" },
    { href: "/customers/new", label: "مشتری جدید", icon: "user-plus", perm: "customers.create" },
    { href: "/pos", label: "فروش جدید", icon: "cart", perm: "sales.create" },
    { href: "/payments/new", label: "ثبت پرداخت", icon: "banknote", perm: "payments.create" },
    { href: "/expenses/new", label: "هزینه جدید", icon: "banknote-down", perm: "expenses.manage" },
    { href: "/purchase-orders/new", label: "سفارش خرید", icon: "truck", perm: "purchasing.manage" },
  ].filter((a) => canUser(session, a.perm));

  // ——— داده ویجت‌های جدید ———
  const statusDist = db.prepare(
    `SELECT s.name, s.color, COUNT(t.id) c FROM repair_statuses s
     JOIN repair_tickets t ON t.status_id = s.id WHERE ${bw("t").sql} GROUP BY s.id ORDER BY c DESC LIMIT 6`
  ).all(...bw("t").params) as Array<{ name: string; color: string; c: number }>;
  const statusTotal = statusDist.reduce((a, s) => a + s.c, 0);

  const recentPayments = db.prepare(
    `SELECT p.id, p.amount, p.method, p.direction, COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'') cn
     FROM payments p LEFT JOIN customers c ON c.id = p.customer_id
     WHERE ${bw("p").sql} AND ${SETTLED_PAYMENT} ORDER BY p.created_at DESC LIMIT 6`
  ).all(...bw("p").params) as Array<{ id: number; amount: number; method: string; direction: string; cn: string | null }>;

  const totalRepairs = q1(`SELECT COUNT(*) c FROM repair_tickets t WHERE ${bw("t").sql}`, bw("t").params).c;
  const deliveredTotal = q1(`SELECT COUNT(*) c FROM repair_tickets t JOIN repair_statuses s ON s.id=t.status_id WHERE ${bw("t").sql} AND s.name='Delivered'`, bw("t").params).c;
  const totalCustomers = q1(`SELECT COUNT(*) c FROM customers c WHERE is_archived=0 AND (? IS NULL OR EXISTS (SELECT 1 FROM customer_branch_access a WHERE a.customer_id=c.id AND a.branch_id=?))`, scopeParams).c;
  const totalDevices = q1(`SELECT COUNT(*) c FROM devices d WHERE is_archived=0 AND (? IS NULL OR EXISTS (SELECT 1 FROM device_branch_access a WHERE a.device_id=d.id AND a.branch_id=?))`, scopeParams).c;
  const avgRepairRow = q1(
    `SELECT AVG(julianday(t.completed_at) - julianday(t.created_at)) v FROM repair_tickets t
     JOIN repair_statuses s ON s.id = t.status_id WHERE ${bw("t").sql} AND s.name = 'Delivered' AND t.completed_at IS NOT NULL`, bw("t").params
  );
  const avgRepairDays = Math.round((avgRepairRow.v ?? 0) * 10) / 10;
  const successRate = totalRepairs > 0 ? Math.round((deliveredTotal / totalRepairs) * 100) : 0;

  // چیدمان ثابت و نقش‌محور — شخصی‌سازی داشبورد حذف شده است
  const layout = DASHBOARD_LAYOUT[role] ?? DASHBOARD_LAYOUT.default;
  void scope.all;

  // ——— محتوای هر ویجت (سمت سرور رندر می‌شود) ———
  const widgetContent: Record<WidgetId, React.ReactNode> = {
    charts: (
      <Panel title="روند ۳۰ روز گذشته" icon="trending-up" tone="brand">
        <DashboardCharts
          revenue={revSeries.map((r) => ({ d: r.d, v: rialToDisplay(r.v) }))}
          repairs={repairSeries.map((r) => ({ d: r.d, c: r.c }))}
          unit={getCurrencyUnit() === "rial" ? "ریال" : "تومان"}
        />
      </Panel>
    ),
    queue: (
      <Panel title={queueTitle} icon="wrench" tone="brand" href="/repairs" hrefLabel="همه" badge={faNum(queue.length)} scroll bodyClassName="min-w-0">
        {queue.length === 0 ? (
          <EmptyState icon="award" title="نوبتی وجود ندارد" body="در حال حاضر پذیرش بازی نیست. پذیرش‌های جدید همین‌جا نمایش داده می‌شوند." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="sticky top-0 z-10 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <tr>
                  <th className="th">شماره</th>
                  <th className="th">مشتری</th>
                  <th className="th hidden md:table-cell">دستگاه</th>
                  <th className="th hidden lg:table-cell">ایراد</th>
                  <th className="th">وضعیت</th>
                  <th className="th hidden sm:table-cell">اولویت</th>
                  {!isTech && <th className="th hidden xl:table-cell">تعمیرکار</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {queue.map((t) => (
                  <tr key={t.id} className="row-hover">
                    <td className="td">
                      <Link href={`/repairs/${t.id}`} className="font-mono text-[13px] font-semibold text-brand-600 hover:underline">{t.number}</Link>
                    </td>
                    <td className="td whitespace-nowrap">{t.first_name} {t.last_name}</td>
                    <td className="td hidden md:table-cell whitespace-nowrap">{t.brand} {t.model}</td>
                    <td className="td hidden lg:table-cell max-w-[220px] truncate text-zinc-500">{t.problem}</td>
                    <td className="td"><StatusBadge name={t.status_name} color={t.status_color} /></td>
                    <td className="td hidden sm:table-cell"><PriorityBadge p={t.priority} /></td>
                    {!isTech && (
                      <td className="td hidden xl:table-cell">
                        {t.tech_name ? <span className="inline-flex items-center gap-1.5"><Avatar name={t.tech_name} color={t.avatar_color} size={22} />{t.tech_name.split(" ")[0]}</span> : <span className="text-zinc-400">ارجاع‌نشده</span>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    ),
    secondary: (
      <Panel title="نگاه امروز" icon="calendar" tone="zinc">
        <div className="grid grid-cols-2 gap-2.5">
          {secondaryKpis.map((k) => (
            <div
              key={k.label}
              className={`rounded-lg border p-2.5 ${
                k.alert ? "border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10" : "border-zinc-200 dark:border-zinc-800"
              }`}
            >
              <div className="text-lg font-semibold tabular-nums">{k.value}</div>
              <div className="text-xs leading-tight text-zinc-500 dark:text-zinc-400">{k.label}</div>
            </div>
          ))}
        </div>
      </Panel>
    ),
    money: (isOwnerLike || isAccountant) ? (
      <Panel title="پول امروز" icon="banknote" tone="emerald" href="/finance" hrefLabel="مالی">
        <div className="flex h-full flex-col justify-between gap-4">
          <div className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800/70">
            <div className="flex items-center justify-between gap-2 py-2"><span className="text-zinc-500 dark:text-zinc-400">فروش صندوق</span><span className="font-medium tabular-nums">{fmtMoney(salesToday)}</span></div>
            <div className="flex items-center justify-between gap-2 py-2"><span className="text-zinc-500 dark:text-zinc-400">دریافتی‌ها</span><span className="font-medium tabular-nums">{fmtMoney(paymentsToday)}</span></div>
            <div className="flex items-center justify-between gap-2 py-2"><span className="text-zinc-500 dark:text-zinc-400">فروش و فاکتور ماه (بدون تکرار)</span><span className="font-medium tabular-nums">{fmtMoney(revenueMonth)}</span></div>
            <div className="flex items-center justify-between gap-2 py-2"><span className="text-zinc-500 dark:text-zinc-400">مطالبات</span><span className="font-medium tabular-nums text-amber-600 dark:text-amber-400">{fmtMoney(receivables)}</span></div>
          </div>
          <div className="flex items-center justify-between border-t border-zinc-200 pt-3 text-[12px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <span>ورودی نقدی امروز</span>
            <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{fmtMoney(paymentsToday)}</span>
          </div>
        </div>
      </Panel>
    ) : null,
    upcoming: canFinancial && upcomingDue.length > 0 ? (
      <Panel title="سررسیدهای ۷ روز آینده" icon="calendar-days" tone="amber" href="/calendar" hrefLabel="تقویم" badge={faNum(upcomingDue.length)} scroll>
        <div className="space-y-2">
          {upcomingDue.map((e, i) => (
            <Link key={i} href={e.href} className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2.5 text-sm transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60">
              <span className="flex items-center gap-2 truncate">
                <i className={`inline-block w-2 h-2 rounded-full shrink-0 ${e.kind === "check_in" ? "bg-emerald-500" : e.kind === "check_out" ? "bg-red-500" : e.kind === "installment" ? "bg-amber-500" : "bg-violet-500"}`} />
                <span className="truncate">{e.title}</span>
              </span>
              <span className="text-xs text-zinc-400 shrink-0">{e.jdate}</span>
            </Link>
          ))}
        </div>
      </Panel>
    ) : null,
    inventory: (
      <Panel title="هشدارهای انبار" icon="package-minus" tone="red" href="/parts?filter=low" hrefLabel="همه" badge={faNum(outOfStock.length + lowStock.length)} scroll>
        <div className="space-y-2">
          {outOfStock.map((p) => (
            <Link key={p.id} href={`/parts/${p.id}`} className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm dark:border-red-500/30 dark:bg-red-500/10">
              <span className="truncate">{p.name}</span>
              <span className="badge-red">اتمام موجودی</span>
            </Link>
          ))}
          {lowStock.map((p) => (
            <Link key={p.id} href={`/parts/${p.id}`} className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
              <span className="truncate">{p.name}</span>
              <span className="badge-amber">{faNum(p.qty)} عدد باقی‌مانده</span>
            </Link>
          ))}
          {lowStock.length === 0 && outOfStock.length === 0 && (
            <p className="py-2 text-sm text-zinc-400">سطح موجودی سالم است</p>
          )}
        </div>
      </Panel>
    ),
    quick: (
      <Panel title="دسترسی سریع" icon="sliders" tone="zinc" bodyClassName="p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-3 lg:grid-cols-6">
          {quickActions.map((a, i) => (
            <Link key={a.href} href={a.href} className={`${i === 0 ? "btn-primary" : "btn-secondary"} min-w-0 justify-start gap-1.5 px-2.5`}>
              <Icon name={a.icon} size={15} className="shrink-0 opacity-70" />
              <span className="truncate">{a.label}</span>
            </Link>
          ))}
          {quickActions.length === 0 && (
            <p className="col-span-full py-1 text-xs text-zinc-500">برای نقش شما میان‌بری تعریف نشده است — از منوی کنار استفاده کنید.</p>
          )}
        </div>
      </Panel>
    ),
    statusChart: (
      <Panel title="وضعیت پذیرش‌ها" icon="clipboard" tone="purple" href="/repairs/board" hrefLabel="تابلو" badge={faNum(statusDist.length)} scroll>
        <div className="space-y-2">
          {statusDist.map((s) => {
            const pct = statusTotal > 0 ? Math.round((s.c / statusTotal) * 100) : 0;
            return (
              <Link key={s.name} href={`/repairs?status=${encodeURIComponent(s.name)}`} className="block group">
                <div className="flex items-center justify-between text-[13px] mb-1">
                  <span className="flex items-center gap-2 truncate">
                    <i className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                    <span className="truncate">{statusFa(s.name)}</span>
                  </span>
                  <span className="text-zinc-500 shrink-0">{faNum(s.c)} ({faNum(pct)}٪)</span>
                </div>
                <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                  <div className="h-full rounded-full transition-all group-hover:opacity-80" style={{ width: `${pct}%`, background: s.color }} />
                </div>
              </Link>
            );
          })}
          {statusDist.length === 0 && <p className="py-2 text-sm text-zinc-400">هنوز پذیرشی ثبت نشده است</p>}
        </div>
      </Panel>
    ),
    recentPayments: (
      <Panel title="آخرین پرداخت‌ها" icon="banknote" tone="emerald" href="/payments" hrefLabel="همه" badge={faNum(recentPayments.length)} scroll>
        <div className="space-y-2">
          {recentPayments.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
              <span className="flex items-center gap-2 truncate">
                <i className={`inline-block w-2 h-2 rounded-full shrink-0 ${p.direction === "in" ? "bg-emerald-500" : "bg-red-500"}`} />
                <span className="truncate">{p.cn ?? "بدون مشتری"}</span>
              </span>
              <span className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-zinc-400">{methodFa(p.method)}</span>
                <span className={`font-medium ${p.direction === "in" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                  {p.direction === "in" ? "+" : "−"}{fmtMoney(p.amount)}
                </span>
              </span>
            </div>
          ))}
          {recentPayments.length === 0 && <p className="py-2 text-sm text-zinc-400">هنوز پرداختی ثبت نشده است</p>}
        </div>
      </Panel>
    ),
    shopStats: (
      <Panel title="آمار کلی تعمیرگاه" icon="bar-chart" tone="brand">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {[
            { label: "کل پذیرش‌ها", value: faNum(totalRepairs), icon: "wrench" },
            { label: "تحویل‌شده", value: faNum(deliveredTotal), icon: "check-circle" },
            { label: "مشتریان", value: faNum(totalCustomers), icon: "users" },
            { label: "دستگاه‌ها", value: faNum(totalDevices), icon: "phone" },
            { label: "میانگین زمان تعمیر", value: avgRepairDays > 0 ? `${faNum(avgRepairDays)} روز` : "—", icon: "timer" },
            { label: "نرخ تعمیر موفق", value: successRate > 0 ? `${faNum(successRate)}٪` : "—", icon: "trending-up" },
          ].map((s) => (
            <MiniStat key={s.label} icon={s.icon} label={s.label} value={s.value} />
          ))}
        </div>
      </Panel>
    ),
  };

  // ویجت‌های بدون محتوا برای این نقش (مثل بخش مالی برای تعمیرکار) نمایش داده نمی‌شوند
  const visibleWidgets = layout.filter((id) => widgetContent[id] != null);

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 space-y-5">
      <div className="page-head">
        <div className="min-w-0">
          <h1 className="text-lg font-bold tracking-tight sm:text-xl">
            <TehranGreeting serverNow={serverNow}/>، {user.name.split(" ")[0]}
          </h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-zinc-500 dark:text-zinc-400">
            <span>{jalaliToday}</span>
            <span className="text-zinc-300 dark:text-zinc-600">·</span>
            <span className="chip">{ROLE_LABELS[role] ?? role}</span>
            <span className="chip">{scope.branchId == null ? "همهٔ شعبه‌ها" : branchName}</span>
            <span className={delayed > 0 ? "text-amber-600 dark:text-amber-400" : ""}>
              {delayed > 0 ? `${toFaDigits(delayed)} پذیرش از تاریخ وعده گذشته` : "همه‌چیز امروز مرتب است"}
            </span>
          </p>
        </div>
      </div>

      {/* شاخص‌های نقش */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <KpiTile key={k.label} href={k.href} icon={k.icon} label={k.label} value={k.value} tone={k.tone} alert={k.alert} />
        ))}
      </div>

      {/* چیدمان نقش‌محور روی شبکهٔ ۶ ستونی — با چیدمان dense هیچ خانهٔ خالی نمی‌ماند */}
      <div className="grid items-stretch gap-4 lg:grid-cols-6 lg:[grid-auto-flow:row_dense]">
        {visibleWidgets.map((id) => (
          <div key={id} className={`min-w-0 ${WIDGET_SPAN[id] ?? "lg:col-span-2"}`}>
            {widgetContent[id]}
          </div>
        ))}
      </div>
    </div>
  );
}

type WidgetId =
  | "charts"
  | "queue"
  | "secondary"
  | "money"
  | "upcoming"
  | "inventory"
  | "quick"
  | "statusChart"
  | "recentPayments"
  | "shopStats";

/** ترتیب ویجت‌های هر نقش — «دسترسی سریع» همیشه اول، بعد کار جاری، بعد هشدارها و مالی، آخر آمار */
const DASHBOARD_LAYOUT: Record<string, WidgetId[]> = {
  // صاحب کسب‌وکار، مدیر سیستم و مدیر
  default: ["quick", "queue", "money", "charts", "statusChart", "upcoming", "inventory", "secondary", "recentPayments", "shopStats"],
  // حسابدار: پول و سررسیدها جلوتر
  accountant: ["quick", "queue", "money", "charts", "recentPayments", "upcoming", "shopStats"],
  // تعمیرکار: صف کار و وضعیت‌ها، بدون بخش مالی
  technician: ["quick", "queue", "secondary", "statusChart", "shopStats"],
  // پذیرش: صف کار، آماده‌تحویل‌ها و سررسیدهای کاری
  reception: ["quick", "queue", "secondary", "upcoming", "recentPayments", "statusChart"],
  // انباردار: هشدارهای انبار اول
  inventory: ["quick", "inventory", "queue", "secondary", "statusChart", "shopStats"],
};

const METHOD_FA: Record<string, string> = { cash: "نقدی", pos: "کارتخوان", card: "کارت", transfer: "حواله", check: "چک", credit: "نسیه" };
function methodFa(m: string) { return METHOD_FA[m] ?? m; }
