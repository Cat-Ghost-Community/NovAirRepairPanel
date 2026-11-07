import { activeBranch, BRANCH_COOKIE } from "@/lib/branch";
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, audit } from "@/lib/api";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

/** خروجی اکسل لیست خرید یک تأمین‌کننده — برای فرستادن سفارش به تأمین‌کننده */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = requireSession(req);
    requirePerm(session, "suppliers.view");
    const { id } = await params;
    const supplierId = Number(id);
    const withDone = req.nextUrl.searchParams.get("done") === "1";
    const db = getDb();
    const branch=activeBranch(session,req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    const supplier = db.prepare("SELECT name FROM suppliers WHERE id = ?").get(supplierId) as any;
    if (!supplier) return Response.json({ error: "تأمین‌کننده یافت نشد." }, { status: 404 });

    const rows = db
      .prepare(
        `SELECT i.name, p.sku, i.qty, i.unit, i.est_cost, i.priority, i.status, i.note
         FROM supplier_purchase_items i
         LEFT JOIN parts p ON p.id = i.part_id
         WHERE i.supplier_id = ? AND (? IS NULL OR i.branch_id=?) ${withDone ? "AND i.status != 'cancelled'" : "AND i.status IN ('pending','ordered')"}
         ORDER BY CASE i.priority WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, i.id
         LIMIT 5000`
      )
      .all(supplierId,branch,branch) as any[];

    const PRIORITY: Record<string, string> = { urgent: "فوری", normal: "معمولی", low: "کم‌اهمیت" };
    const STATUS: Record<string, string> = {
      pending: "در انتظار خرید",
      ordered: "سفارش داده شد",
      purchased: "خریداری شد",
      cancelled: "لغو شد",
    };
    const fa: any[] = rows.map((r, idx) => ({
      "ردیف": idx + 1,
      "نام کالا": r.name,
      "کد کالا": r.sku ?? "",
      "تعداد": r.qty,
      "واحد": r.unit ?? "",
      "بهای تقریبی": r.est_cost,
      "جمع تقریبی": Number(r.est_cost) * Number(r.qty),
      "اولویت": PRIORITY[r.priority] ?? r.priority,
      "وضعیت": STATUS[r.status] ?? r.status,
      "یادداشت": r.note ?? "",
    }));
    const total = fa.reduce((sum, r) => sum + Number(r["جمع تقریبی"] ?? 0), 0);
    fa.push({
      "ردیف": "",
      "نام کالا": "جمع تقریبی",
      "کد کالا": "",
      "تعداد": "",
      "واحد": "",
      "بهای تقریبی": "",
      "جمع تقریبی": total,
      "اولویت": "",
      "وضعیت": "",
      "یادداشت": "مبالغ به ریال",
    });

    const ws = XLSX.utils.json_to_sheet(fa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "لیست خرید");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    audit(session, "export", "supplier_purchase_items", supplierId, null, { count: rows.length });
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="purchase-list-${supplierId}-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      },
    });
  } catch (e) {
    return fail(e);
  }
}
