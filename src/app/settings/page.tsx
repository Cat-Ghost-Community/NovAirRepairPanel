import {RepairWorkflowSettings} from './repair-workflow-settings';
import { requirePageAccess } from "@/lib/page-access";
import { getDb } from "@/lib/db/schema";
import { getSetting } from "@/lib/repair";
import { toFaDigits } from "@/lib/format";
import { SettingsShell, type ShellItem } from "./settings-shell";
import { SettingsSection, SettingsStat } from "./section";
import { SettingsForm } from "./settings-form";
import { StatusList } from "./status-list";
import { QuestionsManager } from "./questions-manager";
import { BlacklistManager } from "./blacklist-manager";
import { BackupButton } from "./backup-button";
import { AccessFlagsSection } from "./access-flags";
import { BranchManager } from "./branch-manager";
import { ServicesManager } from "./services-manager";
import { ChatSettings } from "./chat-settings";
import { getSessionByToken, canUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { activeBranch, BRANCH_COOKIE, canSwitchBranch } from "@/lib/branch";
export const dynamic = "force-dynamic";

const DEVICE_TYPE_FA: Record<string, string> = {
  mobile: "موبایل", laptop: "لپ‌تاپ", desktop: "دسکتاپ", tablet: "تبلت",
  console: "کنسول بازی", smartwatch: "ساعت هوشمند", printer: "پرینتر",
  network: "تجهیزات شبکه", other: "سایر",
};

/** فهرست بخش‌های تنظیمات — همین ترتیب در ناوبری و صفحه رندر می‌شود */
const SECTIONS: ShellItem[] = [
  { id: "biz", title: "نمایه کسب‌وکار و مالیات", icon: "settings", group: "کسب‌وکار", keywords: "نام کسب‌وکار، مالیات، ارزش افزوده، واحد پول، شماره‌گذاری، پیش‌شماره، عیب‌یابی، سقف اعتبار، آدرس عمومی" },
  { id: "branches", title: "شعبه‌ها", icon: "landmark", group: "کسب‌وکار", keywords: "شعبه، آدرس، تلفن، شهر، فعال" },
  { id: "repair-routing", title: "مسیر پذیرش و ارجاع", icon: "clipboard", group: "گردش کار تعمیر", keywords: "مدیر سرپرست صف آزاد تعمیرکار" },
  { id: "workflow", title: "وضعیت‌های گردش کار تعمیر", icon: "clipboard", group: "گردش کار تعمیر", keywords: "وضعیت، رنگ، انتقال، پیامک، SLA" },
  { id: "intake", title: "سوالات سفارشی پذیرش", icon: "list", group: "گردش کار تعمیر", keywords: "سوال، پذیرش، سفارشی، فرم" },
  { id: "devices", title: "انواع دستگاه", icon: "package", group: "گردش کار تعمیر", keywords: "دستگاه، موبایل، لپ‌تاپ، فیلدهای اختصاصی، IMEI" },
  { id: "services", title: "فهرست خدمات", icon: "tags", group: "کاتالوگ", keywords: "خدمت، اجرت، قیمت، مدت، گارانتی" },
  { id: "access", title: "دسترسی‌های ریز", icon: "shield", group: "دسترسی و محدودیت‌ها", keywords: "دسترسی، مخفی‌کردن قیمت، تعمیرکار، بهای تمام‌شده" },
  { id: "chat", title: "گفتگوی داخلی", icon: "chat", group: "دسترسی و محدودیت‌ها", keywords: "چت، گفتگو، فایل، پیوست، ویرایش پیام، حجم فایل، پسوند" },
  { id: "blacklist", title: "لیست سیاه دستگاه‌ها", icon: "circle-x", group: "دسترسی و محدودیت‌ها", keywords: "لیست سیاه، بلک‌لیست، سریال، IMEI، سرقت" },
  { id: "backup", title: "پشتیبان‌گیری", icon: "database", group: "داده‌ها", keywords: "پشتیبان، بکاپ، دانلود، دیتابیس" },
];

export default async function SettingsPage() {
  await requirePageAccess("/settings");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "settings.view")) redirect("/");
  const db = getDb();
  const branch = activeBranch(session,cookieStore.get(BRANCH_COOKIE)?.value).branchId;
  const keys = ["business_name", "currency_unit", "tax_rate", "vat_enabled", "duty_rate", "round_to", "invoice_prefix", "ticket_prefix", "invoice_suffix", "ticket_suffix", "diagnostic_fee", "default_credit_limit", "public_base_url", "postal_api_url"];
  const values: Record<string, string> = {};
  for (const k of keys) values[k] = getSetting(k,k==="ticket_prefix"?"R":k==="invoice_prefix"?"INV-":"");

  const statuses = db.prepare("SELECT * FROM repair_statuses ORDER BY sort, id").all() as any[];
  // شمار پذیرش‌های فعلی هر وضعیت — برای نمایش «اکنون: N پذیرش» در نقشهٔ گردش کار
  const statusCounts: Record<string, number> = Object.fromEntries(
    (
      db
        .prepare("SELECT rs.name, COUNT(t.id) c FROM repair_statuses rs LEFT JOIN repair_tickets t ON t.status_id = rs.id AND (? IS NULL OR t.branch_id=?) GROUP BY rs.name")
        .all(branch,branch) as any[]
    ).map((r) => [String(r.name), Number(r.c)])
  );
  const deviceTypes = Object.keys(DEVICE_TYPE_FA);
  const canEdit = canSwitchBranch(session.user.role) && canUser(session, "settings.edit");
  const canAccessFlags = canEdit && canUser(session, "team.manage");

  // خلاصهٔ بالای صفحه
  const branchCount = Number((db.prepare("SELECT COUNT(*) c FROM branches WHERE is_active = 1 AND (? IS NULL OR id=?)").get(branch,branch) as any).c ?? 0);
  const serviceCount = Number((db.prepare("SELECT COUNT(*) c FROM services WHERE COALESCE(is_active,1) = 1").get() as any).c ?? 0);
  const flagCount = Number((db.prepare("SELECT COUNT(*) c FROM settings WHERE key LIKE 'flag:%' AND value = '1'").get() as any).c ?? 0);
  const currencyFa = (values.currency_unit || "toman") === "rial" ? "ریال" : "تومان";

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="page-head">
        <div>
          <h1 className="page-title">تنظیمات</h1>
          <p className="page-sub">
            هر بخش را از فهرست کنار (در موبایل: نوار بالای صفحه) باز کنید — تغییرها بلافاصله در همهٔ اسناد و روندهای کار اعمال می‌شوند.
          </p>
        </div>
        {!canEdit && <span className="badge-amber">دسترسی ویرایش تنظیمات برای شما فعال نیست — فقط مشاهده</span>}
      </div>

      <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <SettingsStat href="#biz" icon="settings" tone="brand" label="کسب‌وکار" value={values.business_name?.trim() || "تنظیم نشده"} />
        <SettingsStat href="#biz" icon="banknote" tone="emerald" label="واحد پول و مالیات" value={`${currencyFa} · ${toFaDigits(values.tax_rate || "0")}٪`} />
        <SettingsStat href="#branches" icon="landmark" tone="zinc" label="شعبهٔ فعال" value={toFaDigits(branchCount)} />
        <SettingsStat href="#workflow" icon="clipboard" tone="purple" label="وضعیت گردش کار" value={toFaDigits(statuses.length)} />
        <SettingsStat href="#services" icon="tags" tone="amber" label="خدمات فعال" value={toFaDigits(serviceCount)} />
        <SettingsStat href="#access" icon="shield" tone="red" label="محدودیت فعال" value={toFaDigits(flagCount)} />
      </div>

      <SettingsShell
        items={SECTIONS}
        panes={Object.fromEntries([
          <SettingsSection
            key="biz"
            id="biz"
            index={1}
            icon="settings"
            title="نمایه کسب‌وکار و مالیات"
            desc="نام کسب‌وکار، واحد پول، نرخ مالیات و پیش‌فرض‌های اسناد. این مقادیر در فاکتور، برآورد، پیامک و پورتال مشتری استفاده می‌شوند."
          >
            <fieldset disabled={!canEdit} className="min-w-0"><SettingsForm values={{ ...values }} /></fieldset>
          </SettingsSection>,

          <SettingsSection
            key="branches"
            id="branches"
            index={2}
            icon="landmark"
            tone="zinc"
            title="شعبه‌ها"
            desc="پذیرش‌ها، انبار و گزارش‌ها به شعبه گره می‌خورند؛ کاربران هر شعبه فقط دادهٔ شعبهٔ خودشان را می‌بینند."
          >
            <BranchManager canEdit={canEdit} />
          </SettingsSection>,

          <SettingsSection key="repair-routing" id="repair-routing" index={3} icon="clipboard" title="مسیر پذیرش و ارجاع" desc="روش کار فعلی، ارجاع مدیریتی یا صف آزاد را برای هر شعبه انتخاب کنید.">
            <RepairWorkflowSettings canEdit={canEdit} branches={db.prepare('SELECT id,name FROM branches WHERE is_active=1 AND (? IS NULL OR id=?) ORDER BY name LIMIT 200').all(branch,branch).map(row=>({id:Number(row.id),name:String(row.name)}))} />
          </SettingsSection>,

          <SettingsSection
            key="workflow"
            id="workflow"
            index={4}
            icon="clipboard"
            tone="purple"
            title="وضعیت‌های گردش کار تعمیر"
            desc="کارت‌ها فقط بین وضعیت‌های متصل جابجا می‌شوند — این کار از پرش‌های اتفاقی جلوگیری می‌کند. رنگ‌ها در تابلو، لیست‌ها و پورتال مشتری اعمال می‌شوند."
          >
            <fieldset disabled={!canEdit} className="min-w-0 px-4 py-4 sm:px-5">
              <StatusList
                statuses={JSON.parse(JSON.stringify(statuses.map((s: any) => ({ id: s.id, name: s.name, color: s.color, category: s.category, allowed_next: JSON.parse(s.allowed_next ?? "[]"), notify: !!s.notify_customer, sla: s.sla_hours }))))}
                counts={statusCounts}
              />
            </fieldset>
          </SettingsSection>,

          <SettingsSection
            key="intake"
            id="intake"
            index={5}
            icon="list"
            title="سوالات سفارشی پذیرش"
            desc="علاوه بر فیلدهای استاندارد، سوال دلخواه خود را به فرم پذیرش اضافه کنید — نوع تاریخ با تقویم شمسی است."
          >
            <fieldset disabled={!canEdit} className="min-w-0"><QuestionsManager /></fieldset>
          </SettingsSection>,

          <SettingsSection
            key="devices"
            id="devices"
            index={6}
            icon="package"
            tone="zinc"
            title="انواع دستگاه"
            desc="هر نوع دستگاه هنگام پذیرش فقط فیلدهای مرتبط خودش را نشان می‌دهد (مثلاً IMEI برای موبایل، CPU/RAM برای کامپیوتر)."
          >
            <div className="flex flex-wrap gap-1.5 px-4 py-4 sm:px-5">
              {deviceTypes.map((t) => <span key={t} className="chip">{DEVICE_TYPE_FA[t]}</span>)}
            </div>
          </SettingsSection>,

          <SettingsSection
            key="services"
            id="services"
            index={7}
            icon="tags"
            tone="amber"
            title="فهرست خدمات"
            desc="خدمات در برآورد، فاکتور و اقلام اجرت استفاده می‌شوند؛ مبالغ بر پایهٔ واحد پول فعال نمایش داده می‌شوند."
          >
            <ServicesManager canEdit={canEdit} />
          </SettingsSection>,

          <SettingsSection
            key="access"
            id="access"
            index={8}
            icon="shield"
            tone="red"
            title="دسترسی‌های ریز"
            desc="محدودیت‌های نمایشی برای نقش‌های عملیاتی؛ مدیران و صاحبان کسب‌وکار همیشه کامل می‌بینند."
          >
            {canAccessFlags ? (
              <AccessFlagsSection />
            ) : (
              <p className="px-4 py-4 text-sm text-zinc-500 sm:px-5 dark:text-zinc-400">
                این تنظیمات سراسری فقط در دسترس مدیر شرکت است.
              </p>
            )}
          </SettingsSection>,

          <SettingsSection
            key="blacklist"
            id="blacklist"
            index={10}
            icon="circle-x"
            tone="amber"
            title="لیست سیاه دستگاه‌ها"
            desc="دستگاه‌هایی که نمی‌خواهید دوباره پذیرش شوند (سرقتی، مشکل‌ساز و…). هنگام پذیرش، با سریال/IMEI هشدار خودکار نمایش داده می‌شود."
          >
            <BlacklistManager />
          </SettingsSection>,

          <SettingsSection
            key="backup"
            id="backup"
            index={11}
            icon="database"
            tone="zinc"
            title="پشتیبان‌گیری"
            desc="نسخهٔ تأییدشدهٔ دیتابیس را دریافت کنید؛ فایل‌های خصوصی و بازیابی آزمایشی نیز بخشی از برنامهٔ پشتیبان‌اند."
          >
            <div className="px-4 py-4 sm:px-5">
              <fieldset disabled={!canEdit} className="min-w-0"><BackupButton /></fieldset>
            </div>
          </SettingsSection>,

          <SettingsSection
            key="chat"
            id="chat"
            index={9}
            icon="chat"
            title="گفتگوی داخلی"
            desc="محدودیت‌های ارسال فایل و ویرایش پیام در چت سازمانی. این مقادیر سمت سرور اعمال می‌شوند."
          >
            <ChatSettings
              canEdit={canEdit}
              values={{
                max_file_mb: getSetting("chat.max_file_mb", "10"),
                allowed_ext: getSetting("chat.allowed_ext", ""),
                edit_window_min: getSetting("chat.edit_window_min", "15"),
              }}
            />
          </SettingsSection>,
        ].map(pane=>[String(pane.key),pane]))}
      />
    </div>
  );
}
