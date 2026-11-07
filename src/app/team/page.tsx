import { activeBranch, BRANCH_COOKIE } from "@/lib/branch";
import { requirePageAccess } from "@/lib/page-access";
import { getDb } from "@/lib/db/schema";
import { Avatar, EmptyState } from "@/components/ui";
import { Pagination } from "@/components/pagination";
import { resolvePaging } from "@/lib/pagination";
import { ROLE_LABELS, ROLE_PERMISSIONS, getSessionByToken, canUser } from "@/lib/auth";
import { PERM_FA } from "@/lib/status-fa";
import { fmtDate, toFaDigits } from "@/lib/format";
import { PermissionsEditor } from "./permissions-editor";
import { AddUserButton, UserActions } from "./users-manager";
import { FilterForm, FilterField, NativeSelect } from "@/components/select";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function TeamPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageAccess("/team");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "team.view")) redirect("/");
  const sp = await searchParams;
  const db = getDb();
  // فیلتر وضعیت: پیش‌فرض فقط کاربران فعال؛ کاربران غیرفعال هم قابل مشاهده و فعال‌سازی هستند
  const status = sp.status === "inactive" ? "inactive" : sp.status === "all" ? "all" : "active";
  const branch = activeBranch(session,cookieStore.get(BRANCH_COOKIE)?.value).branchId;
  const branchWhere = " AND (:teamBranch IS NULL OR u.branch_id=:teamBranch)";
  const statusWhere = status === "active" ? " AND u.is_active = 1" : status === "inactive" ? " AND u.is_active = 0" : "";
  const scopedWhere = statusWhere + branchWhere;
  const administrative = ["owner", "admin"].includes(session.user.role);
  const canManageAccounts = administrative && canUser(session, "settings.edit");
  const canManagePermissions = administrative && canUser(session, "team.manage");
  const total = Number(db.prepare(`SELECT COUNT(*) total FROM users u WHERE 1=1${scopedWhere}`).get({teamBranch:branch})?.total ?? 0);
  const paging = resolvePaging(sp, total);
  const branchStaff = new Map(db.prepare(`SELECT branch_id,COUNT(*) count FROM users u WHERE 1=1${scopedWhere} GROUP BY branch_id`).all({teamBranch:branch}).map(row => [Number(row.branch_id), Number(row.count)]));
  const users = db
    .prepare(
      `SELECT u.id,u.name,u.email,u.role,u.branch_id,u.phone,u.is_active,u.avatar_color,u.created_at, b.name branch_name,
        (SELECT COUNT(*) FROM repair_tickets t WHERE t.technician_id = u.id AND (:teamBranch IS NULL OR t.branch_id=:teamBranch) AND t.status_id IN (SELECT id FROM repair_statuses WHERE is_open = 1)) open_repairs
       FROM users u LEFT JOIN branches b ON b.id = u.branch_id WHERE 1=1${scopedWhere} ORDER BY u.name,u.id LIMIT ? OFFSET ?`
    )
    .all({teamBranch:branch},paging.perPage,paging.offset) as any[];

  const branches = db.prepare("SELECT * FROM branches WHERE (? IS NULL OR id=?) ORDER BY name").all(branch,branch) as any[];
  const activeCount = Number((db.prepare("SELECT COUNT(*) c FROM users WHERE is_active = 1 AND (? IS NULL OR branch_id=?)").get(branch,branch) as any).c);
  const inactiveCount = Number((db.prepare("SELECT COUNT(*) c FROM users WHERE is_active = 0 AND (? IS NULL OR branch_id=?)").get(branch,branch) as any).c);

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight">کارکنان و نقش‌ها</h1>
          <p className="text-sm text-zinc-500 mt-0.5">{toFaDigits(activeCount)} کاربر فعال{inactiveCount > 0 ? <> · {toFaDigits(inactiveCount)} غیرفعال</> : null} در {toFaDigits(branches.length)} شعبه</p>
        </div>
        {canManageAccounts && <AddUserButton branches={branches.map((b: any) => ({ id: b.id, name: b.name }))} />}
      </div>

      <FilterForm action="/team">
        <FilterField label="وضعیت">
          <NativeSelect
            size="sm"
            name="status"
            ariaLabel="وضعیت کاربر"
            defaultValue={status}
            options={[
              { value: "active", label: `فعال (${toFaDigits(activeCount)})` },
              { value: "inactive", label: `غیرفعال (${toFaDigits(inactiveCount)})` },
              { value: "all", label: "همه" },
            ]}
          />
        </FilterField>
      </FilterForm>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="th">عضو</th><th className="th">نقش</th><th className="th">شعبه</th>
              <th className="th hidden sm:table-cell">پذیرش‌های باز</th><th className="th hidden md:table-cell">مشتری از</th><th className="th">عملیات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {users.map((u) => (
              <tr key={u.id} className="row-hover">
                <td className="td">
                  <span className="flex items-center gap-2.5">
                    <Avatar name={u.name} color={u.avatar_color} />
                    <span><span className="font-medium">{u.name}</span><span className="block text-xs text-zinc-400">{u.email}</span></span>
                  </span>
                </td>
                <td className="td"><span className="badge-blue">{ROLE_LABELS[u.role] ?? u.role}</span></td>
                <td className="td text-zinc-500">{u.branch_name ?? "همه"}</td>
                <td className="td hidden sm:table-cell">{u.open_repairs > 0 ? <span className="badge-amber">{toFaDigits(u.open_repairs)}</span> : "۰"}</td>
                <td className="td hidden md:table-cell text-zinc-400">{fmtDate(u.created_at)}</td>
                <td className="td">
                  {canManageAccounts ? <UserActions user={{ id: u.id, name: u.name, role: u.role, branch_id: u.branch_id, is_active: u.is_active }} branches={branches.map((b: any) => ({ id: b.id, name: b.name }))} /> : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && <EmptyState icon="users" title="کاربری یافت نشد" body="فیلتر وضعیت را تغییر دهید یا با مجوز مدیر، کاربر جدید اضافه کنید." />}
      </div>
      <Pagination base="/team" sp={sp} page={paging.page} totalPages={paging.totalPages} total={total} perPage={paging.perPage} unit="کاربر" />

      {canManagePermissions && <PermissionsEditor users={users.map((u) => ({ id: u.id, name: u.name, role: ROLE_LABELS[u.role] ?? u.role }))} currentUserRole={session.user.role} />}

      <section className="card card-pad">
        <h2 className="section-title mb-3">دسترسی‌های نقش (پیش‌فرض)</h2>
        <p className="text-xs text-zinc-400 mb-3">دسترسی‌ها در سمت سرور روی همه مسیرهای API اعمال می‌شود — رابط کاربری فقط بخش‌های غیرمجاز را پنهان می‌کند.</p>
        <div className="space-y-3">
          {Object.entries(ROLE_PERMISSIONS).map(([role, perms]) => (
            <div key={role} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
              <div className="text-[13px] font-semibold mb-1.5">{ROLE_LABELS[role] ?? role}</div>
              <div className="flex flex-wrap gap-1">
                {perms.slice(0, 14).map((p) => <span key={p} className="chip">{PERM_FA[p] ?? p}</span>)}
                {perms.length > 14 && <span className="chip">+{toFaDigits(perms.length - 14)} مورد دیگر</span>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card card-pad">
        <h2 className="section-title mb-3">شعبه‌ها</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {branches.map((b) => {
            const staff = branchStaff.get(Number(b.id)) ?? 0;
            return (
              <div key={b.id} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
                <div className="font-medium">{b.name} <span className="badge-gray ml-1">{b.code}</span></div>
                <div className="text-xs text-zinc-400 mt-1">{b.address}, {b.city} · {b.phone}</div>
                <div className="text-xs text-zinc-500 mt-1">{toFaDigits(staff)} کارکنان</div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
