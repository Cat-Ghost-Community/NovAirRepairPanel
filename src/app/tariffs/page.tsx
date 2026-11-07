import { requirePageAccess } from "@/lib/page-access";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionByToken, canUser } from "@/lib/auth";
import { TariffsClient } from "./tariffs-client";

export const dynamic = "force-dynamic";

export default async function TariffsPage() {
  await requirePageAccess("/tariffs");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "repairs.view")) redirect("/");
  const canManage = canUser(session, "settings.edit");

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="page-head">
        <div>
          <h1 className="page-title">تعرفه تعمیرات</h1>
          <p className="page-sub">
            اجرت، مدت و گارانتی هر نوع دستگاه/ایراد را یک‌بار تعیین کنید؛ بعد در پذیرش، برآورد و فاکتور با یک انتخاب استفاده می‌شود.
          </p>
        </div>
      </div>
      <TariffsClient canManage={canManage} />
    </div>
  );
}
