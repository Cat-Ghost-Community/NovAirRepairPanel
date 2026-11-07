import { requirePageAccess } from "@/lib/page-access";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { canUser, getSessionByToken } from "@/lib/auth";
import { InvoiceForm } from "./invoice-form";

export const dynamic = "force-dynamic";

/** صدور فاکتور جدید (خرید/فروش/تعمیر) یا ویرایش پیش‌نویس */
export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageAccess("/invoices/new");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "invoices.create") && !canUser(session, "purchasing.manage")) redirect("/invoices");
  const sp = await searchParams;
  const type = sp.type === "purchase" || sp.type === "sale" || sp.type === "repair" ? sp.type : null;
  const editId = sp.edit && /^\d+$/.test(sp.edit) ? Number(sp.edit) : null;
  const initialSaleId = sp.from_sale && /^\d+$/.test(sp.from_sale) ? Number(sp.from_sale) : null;
  const initialPoId = sp.po && /^\d+$/.test(sp.po) ? Number(sp.po) : null;
  if (editId != null && !canUser(session, "invoices.edit") && !canUser(session, "invoices.create")) redirect("/invoices");
  if (initialSaleId != null && !canUser(session, "invoices.create")) redirect("/invoices");
  if (initialPoId != null && !canUser(session, "purchasing.manage")) redirect("/invoices");
  return (
    <div className="h-full">
      <InvoiceForm initialType={type} editId={editId} initialSaleId={initialSaleId} initialPoId={initialPoId} />
    </div>
  );
}
