import { activeBranch, BRANCH_COOKIE, recordBranchId } from "@/lib/branch";
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, fail, ok, readJson, audit, requirePerm, validate } from "@/lib/api";

const PURCHASE_PRIORITIES = ["low", "normal", "urgent"];

/** لیست خرید یک تأمین‌کننده: چه چیزهایی باید از این تأمین‌کننده خریده شود */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = requireSession(req);
    requirePerm(session, "suppliers.view");
    const { id } = await params;
    const withDone = req.nextUrl.searchParams.get("done") === "1";
    const db = getDb();
    const branch=activeBranch(session,req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    const items = db
      .prepare(
        `SELECT i.*, p.sku, u.name created_by_name
         FROM supplier_purchase_items i
         LEFT JOIN parts p ON p.id = i.part_id
         LEFT JOIN users u ON u.id = i.created_by
         WHERE i.supplier_id = ? AND (? IS NULL OR i.branch_id=?) ${withDone ? "" : "AND i.status NOT IN ('purchased','cancelled')"}
         ORDER BY CASE i.status WHEN 'pending' THEN 0 WHEN 'ordered' THEN 1 ELSE 2 END,
                  CASE i.priority WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                  i.created_at DESC
         LIMIT 1000`
      )
      .all(Number(id),branch,branch) as any[];
    const summary = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END),0) pending,
           COALESCE(SUM(CASE WHEN status = 'ordered' THEN 1 ELSE 0 END),0) ordered,
           COALESCE(SUM(CASE WHEN status = 'purchased' THEN 1 ELSE 0 END),0) purchased,
           COALESCE(SUM(CASE WHEN status IN ('pending','ordered') THEN est_cost * qty ELSE 0 END),0) est_total
         FROM supplier_purchase_items WHERE supplier_id = ? AND (? IS NULL OR branch_id=?)`
      )
      .get(Number(id),branch,branch) as any;
    return ok({ items: JSON.parse(JSON.stringify(items)), summary: JSON.parse(JSON.stringify(summary)) });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = requireSession(req);
    requirePerm(session, "suppliers.manage");
    const { id } = await params;
    const supplierId = Number(id);
    const b = await readJson(req);
    const db = getDb();
    const branch=activeBranch(session,req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    const supplier = db.prepare("SELECT id FROM suppliers WHERE id = ?").get(supplierId) as any;
    if (!supplier) return Response.json({ error: "تأمین‌کننده یافت نشد." }, { status: 404 });

    const name = validate.maxLength(validate.required(b.name, "نام کالا"), 160, "نام کالا");
    const qty = Math.max(1, Math.round(Number(b.qty) || 1));
    const estCost = validate.amount(b.est_cost ?? 0, "بهای تقریبی");
    const priority = PURCHASE_PRIORITIES.includes(b.priority) ? String(b.priority) : "normal";
    const unit = b.unit ? validate.maxLength(b.unit, 20, "واحد") : null;
    const note = b.note ? validate.maxLength(b.note, 300, "یادداشت") : null;
    let partId: number | null = null;
    if (b.part_id) {
      const part = db.prepare("SELECT id FROM parts WHERE id = ?").get(Number(b.part_id)) as any;
      partId = part ? Number(part.id) : null;
    }

    const rowId = db
      .prepare(
        `INSERT INTO supplier_purchase_items(supplier_id, part_id, name, qty, unit, est_cost, note, priority, branch_id, created_by)
         VALUES(?,?,?,?,?,?,?,?,?,?)`
      )
      .run(supplierId, partId, name, qty, unit, estCost, note, priority, recordBranchId(session,req.cookies.get(BRANCH_COOKIE)?.value), session.user.id)
      .lastInsertRowid as number;

    audit(session, "create", "supplier_purchase_item", Number(rowId), null, { supplier_id: supplierId, name, qty, priority });
    return ok({ id: Number(rowId) });
  } catch (e) {
    return fail(e);
  }
}
