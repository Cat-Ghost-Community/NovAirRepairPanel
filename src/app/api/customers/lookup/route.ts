import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok } from "@/lib/api";
import { activeBranch, BRANCH_COOKIE } from "@/lib/branch";

export async function GET(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "customers.view");
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    if (q.length < 2) return ok({ customers: [] });
    const like = `%${q}%`;
    const db = getDb();
    const branch = activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    return ok({
      customers: db
        .prepare(
          `SELECT id, first_name, last_name, company, mobile, email, price_type, is_vip FROM customers WHERE is_archived = 0 AND (? IS NULL OR id IN (SELECT customer_id FROM customer_branch_access WHERE branch_id=?)) AND
           ((COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) LIKE ? OR mobile LIKE ? OR email LIKE ?)
           ORDER BY created_at DESC LIMIT 6`
        )
        .all(branch, branch, like, like, like) as any[],
    });
  } catch (e) {
    return fail(e);
  }
}
