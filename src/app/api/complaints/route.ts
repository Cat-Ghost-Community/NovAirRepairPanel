import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresComplaintsHttp} from '@/lib/db/pg-complaints-http';
import {atomic} from "@/lib/db/transaction";
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, ok, fail, readJson, audit, HttpError } from "@/lib/api";
import { activeBranch, BRANCH_COOKIE, recordBranchId } from "@/lib/branch";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if(postgresIntegration())return postgresComplaintsHttp(req);
  try {
    const session = requireSession(req);
    requirePerm(session, "complaints.view");
    const db = getDb();
    const status = req.nextUrl.searchParams.get("status") ?? "";
    const branch = activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    const rows = db.prepare(`SELECT x.* FROM complaints x LEFT JOIN repair_tickets t ON t.id=x.ticket_id
      LEFT JOIN customers c ON c.id=x.customer_id WHERE (? IS NULL OR COALESCE(x.branch_id,t.branch_id,c.branch_id,(SELECT MIN(a.branch_id) FROM customer_branch_access a WHERE a.customer_id=x.customer_id HAVING COUNT(*)=1))=?)
      AND (?='' OR x.status=?) ORDER BY x.created_at DESC LIMIT 200`).all(branch, branch, status, status);
    return ok({ complaints: rows });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  if(postgresIntegration())return postgresComplaintsHttp(req);
  try {
    const session = requireSession(req);
    requirePerm(session, "complaints.manage");
    const body = await readJson(req);
    const { customer_id, ticket_id, category, description, priority } = body;
    if (!customer_id || !description) {
      return Response.json({ error: "مشتری و شرح شکایت الزامی است." }, { status: 400 });
    }
    const db = getDb();
    return atomic(db,()=>{
    const ticket=ticket_id?db.prepare("SELECT branch_id,customer_id FROM repair_tickets WHERE id=?").get(Number(ticket_id)):undefined;
    if(ticket && ticket.customer_id!==Number(customer_id))throw new HttpError(400,"پذیرش به این مشتری تعلق ندارد.");
    const branch=ticket?.branch_id??recordBranchId(session,req.cookies.get(BRANCH_COOKIE)?.value);
    const id = db
      .prepare(
        "INSERT INTO complaints(customer_id, ticket_id, category, description, priority, assigned_to,branch_id) VALUES(?,?,?,?,?,?,?)"
      )
      .run(
        Number(customer_id),
        ticket_id ? Number(ticket_id) : null,
        category ?? "سایر",
        String(description).trim(),
        priority ?? "normal",
        session.user.id,branch
      ).lastInsertRowid as number;
    audit(session, "create", "complaint", id, null, { customer_id, category,branch_id:branch });
    return ok({ id });
    });
  } catch (e) {
    return fail(e);
  }
}
