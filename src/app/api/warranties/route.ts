import {atomic} from "@/lib/db/transaction";
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, ok, fail, readJson, audit, HttpError } from "@/lib/api";
import { activeBranch, BRANCH_COOKIE, recordBranchId } from "@/lib/branch";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "warranty.view");
    const db = getDb();
    const status = req.nextUrl.searchParams.get("status") ?? "";
    const branch = activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    const rows = db.prepare(`SELECT w.* FROM warranties w LEFT JOIN repair_tickets t ON t.id=w.ticket_id
      LEFT JOIN invoices i ON i.id=w.invoice_id LEFT JOIN sales s ON s.id=w.sale_id LEFT JOIN customers c ON c.id=w.customer_id
      WHERE (? IS NULL OR COALESCE(w.branch_id,t.branch_id,i.branch_id,s.branch_id,c.branch_id,(SELECT MIN(a.branch_id) FROM customer_branch_access a WHERE a.customer_id=w.customer_id HAVING COUNT(*)=1))=?)
      AND (?='' OR w.status=?) ORDER BY w.created_at DESC LIMIT 200`).all(branch, branch, status, status);
    return ok({ warranties: rows });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "warranty.create");
    const body = await readJson(req);
    const { kind, ticket_id, invoice_id, sale_id, part_id, customer_id, terms, covered, excluded } = body;
    const db = getDb();
    return atomic(db,()=>{
    const sources=[ticket_id?db.prepare("SELECT branch_id,customer_id FROM repair_tickets WHERE id=?").get(Number(ticket_id)):null,
      invoice_id?db.prepare("SELECT branch_id,customer_id FROM invoices WHERE id=?").get(Number(invoice_id)):null,
      sale_id?db.prepare("SELECT branch_id,customer_id FROM sales WHERE id=?").get(Number(sale_id)):null].filter(Boolean);
    if(sources.some(row=>row!.branch_id!==sources[0]!.branch_id || (customer_id!=null && row!.customer_id!==Number(customer_id))))throw new HttpError(400,"اسناد گارانتی باید متعلق به همین مشتری و یک شعبه باشند.");
    const branch=sources[0]?.branch_id??recordBranchId(session,req.cookies.get(BRANCH_COOKIE)?.value);

    // اگر مدت گارانتی مشخص نشده باشد، از گارانتی ثبت‌شده روی اقلام پذیرش (تعرفه/خدمت) گرفته می‌شود
    let days = Number(body.days) || 0;
    if (!days && ticket_id) {
      const row = db.prepare("SELECT COALESCE(MAX(warranty_days),0) w FROM ticket_items WHERE ticket_id = ?").get(Number(ticket_id)) as any;
      days = Number(row?.w ?? 0);
    }
    if (!days) days = 90;

    const today = new Date().toISOString().slice(0, 10);
    const endDate = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

    const id = db
      .prepare(
        `INSERT INTO warranties(kind, ticket_id, invoice_id, sale_id, part_id, customer_id, start_date, end_date, days, terms, covered, excluded,branch_id)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        kind ?? "repair",
        ticket_id ? Number(ticket_id) : null,
        invoice_id ? Number(invoice_id) : null,
        sale_id ? Number(sale_id) : null,
        part_id ? Number(part_id) : null,
        customer_id ? Number(customer_id) : null,
        today,
        endDate,
        days,
        terms ?? "گارانتی تعمیر مطابق شرایط استاندارد",
        covered ?? null,
        excluded ?? null,branch
      ).lastInsertRowid as number;
    audit(session, "create", "warranty", id, null, { kind, days,branch_id:branch });
    return ok({ id, end_date: endDate });
    });
  } catch (e) {
    return fail(e);
  }
}
