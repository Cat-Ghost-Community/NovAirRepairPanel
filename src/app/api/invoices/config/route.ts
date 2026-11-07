import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok } from "@/lib/api";
import { activeBranch } from "@/lib/branch";
import { BRANCH_COOKIE } from "@/lib/branch";
import { canUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** تنظیمات مؤثر مالی برای فرم فاکتور — کلاینت فقط برای «نمایش» از همین فرمول استفاده می‌کند */
export async function GET(req: NextRequest) {
  try {
    const session = requireSession(req);
    if (!canUser(session, "purchasing.manage")) requirePerm(session, "invoices.view");
    const db = getDb();
    const get = (k: string, d = "0") => Number((db.prepare("SELECT value FROM settings WHERE key = ?").get(k) as any)?.value ?? d) || 0;
    const vatEnabled = String((db.prepare("SELECT value FROM settings WHERE key = 'vat_enabled'").get() as any)?.value ?? "1") !== "0";
    const branch = activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value);
    const businessName = (db.prepare("SELECT value FROM settings WHERE key = 'business_name'").get() as any)?.value ?? "RePaird";
    return ok({
      tax_rate: vatEnabled ? get("tax_rate") : 0,
      duty_rate: get("duty_rate"),
      round_to: get("round_to"),
      vat_configured: (db.prepare("SELECT 1 FROM settings WHERE key = 'tax_rate'").get() as any) ? true : false,
      business_name: businessName,
      branch_id: branch.branchId,
      can_edit_price: canUser(session, "invoices.edit"),
      can_pay: canUser(session, "payments.create"),
      can_purchase: canUser(session, "purchasing.manage"),
      can_invoice: canUser(session, "invoices.create"),
    });
  } catch (e) {
    return fail(e);
  }
}
