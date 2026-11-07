import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, audit , assertRequestSession } from "@/lib/api";
import * as XLSX from "xlsx";
import { activeBranch, BRANCH_COOKIE } from "@/lib/branch";

export const dynamic = "force-dynamic";

/**
 * ورود/خروجی اکسل کالاها:
 * GET  → دانلود فایل اکسل همه کالاها (قابل ویرایش برای ویرایش گروهی)
 * POST → بارگذاری فایل اکسل: به‌روزرسانی قیمت/موجودی/کمینه بر اساس id یا barcode
 */
export async function GET(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "inventory.view");
    const db = getDb();
    const branch = activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    const rows = db
      .prepare(`SELECT p.id, p.barcode, p.name, p.category, p.unit, p.purchase_price, p.price, p.min_stock,
                COALESCE((SELECT SUM(qty) FROM inventory_stock s JOIN inventory_locations l ON l.id=s.location_id WHERE s.part_id = p.id AND (? IS NULL OR l.branch_id=?)), 0) stock
                FROM parts p WHERE p.is_active = 1 ORDER BY p.name`)
      .all(branch, branch) as any[];
    const fa = rows.map((r) => ({
      "شناسه": r.id, "بارکد": r.barcode ?? "", "نام کالا": r.name, "گروه": r.category ?? "",
      "واحد": r.unit, "قیمت خرید": r.purchase_price, "قیمت فروش": r.price,
      "حداقل موجودی": r.min_stock, "موجودی": r.stock,
    }));
    const ws = XLSX.utils.json_to_sheet(fa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "کالاها");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    audit(session, "export", "parts", null, null, { count: rows.length });
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="parts-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      },
    });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "inventory.edit");
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return Response.json({ error: "فایل اکسل انتخاب نشده است." }, { status: 400 });
    const buf = Buffer.from(await file.arrayBuffer());
    assertRequestSession(req);
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<any>(ws);

    const db = getDb();
    let updated = 0, skipped = 0;
    const errors: string[] = [];
    const upd = db.prepare("UPDATE parts SET purchase_price = COALESCE(?, purchase_price), price = COALESCE(?, price), min_stock = COALESCE(?, min_stock), barcode = COALESCE(?, barcode) WHERE id = ?");

    for (const r of rows) {
      const id = Number(r["شناسه"] ?? r.id ?? 0);
      if (!id) { skipped++; continue; }
      const exists = db.prepare("SELECT 1 FROM parts WHERE id = ?").get(id);
      if (!exists) { skipped++; continue; }
      const purchase = num(r["قیمت خرید"] ?? r.purchase_price);
      const price = num(r["قیمت فروش"] ?? r.price);
      const min = num(r["حداقل موجودی"] ?? r.min_stock);
      const barcode = str(r["بارکد"] ?? r.barcode);
      upd.run(purchase, price, min, barcode, id);
      updated++;
    }
    audit(session, "import", "parts", null, null, { updated, skipped });
    return Response.json({ ok: true, updated, skipped, errors });
  } catch (e) {
    return fail(e);
  }
}

function num(v: any): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}
function str(v: any): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
