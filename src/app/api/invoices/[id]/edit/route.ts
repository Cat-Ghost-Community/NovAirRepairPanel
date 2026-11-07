import { NextRequest } from "next/server";
import { requireSession, fail, ok, readJson } from "@/lib/api";
import { updateDraftInvoice } from "@/lib/invoice";
import { BRANCH_COOKIE } from "@/lib/branch";

export const dynamic = "force-dynamic";

/** ویرایش پیش‌نویس فاکتور — فقط تا قبل از ثبت نهایی */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = requireSession(req);
    const { id } = await params;
    const b = await readJson(req);
    const data = updateDraftInvoice(session, Number(id), {
      items: Array.isArray(b.items) ? b.items : undefined,
      end_discount: b.end_discount,
      notes: b.notes ?? null,
      external_number: b.external_number ?? null,
      employee_id: b.employee_id ?? null,
      due_date: b.due_date ?? null,
    }, req.cookies.get(BRANCH_COOKIE)?.value);
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
