import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresRepairWorkHttp} from '@/lib/db/pg-repair-work-http';
import { requireRepairAccess } from "@/lib/repair-access";
import { atomic } from "@/lib/db/transaction";
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, fail, ok, readJson, audit, requirePerm , assertRequestSession } from "@/lib/api";
import { transitionTicket, StatusError } from "@/lib/repair";
import { statusFa } from "@/lib/status-fa";
import { revalidatePath } from "next/cache";
import { durableJsonResponse } from '@/lib/idempotency';
import { cancellationPosition } from '@/lib/repair-cancellation';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if(postgresIntegration())return postgresRepairWorkHttp(req,Number((await params).id),'status');
  try {
    const session = requireSession(req);
    requirePerm(session, "repairs.status");
    const { id } = await params;
    requireRepairAccess(session, Number(id), req.cookies.get("repaid_branch")?.value);
    const ticketId = Number(id);
    const contentType = req.headers.get("content-type") ?? "";
    let status: string | undefined;
    let note: string | undefined;
    let body: any = null;
    if (contentType.includes("application/json")) {
      body = await readJson(req);
      status = body.status;
      note = body.note;
    } else {
      const form = await req.formData();
      status = String(form.get("status") ?? "");
      note=String(form.get('note')??'');
    }
    assertRequestSession(req);
    requireRepairAccess(session,ticketId,req.cookies.get("repaid_branch")?.value);
    if (!status) return Response.json({ error: "وضعیت مشخص نشده است." }, { status: 400 });

    const db = getDb();
    const ticket = db.prepare("SELECT * FROM repair_tickets WHERE id = ?").get(ticketId) as any;
    if (!ticket) return Response.json({ error: "پذیرش یافت نشد." }, { status: 404 });

    if(status.toLowerCase()==='delivered')return Response.json({error:'تحویل نهایی باید با امضای مشتری در صفحهٔ پیگیری تأیید شود.'},{status:409});
    const execute=()=>{atomic(db, () => {
    transitionTicket(ticketId, status!, session.user.id, note);
    audit(session, "status_change", "repair_ticket", ticketId, { status: ticket.status_id }, { status });
    });return ok({ok:true,financial_review:status!.toLowerCase()==='cancelled'?cancellationPosition(db,ticketId).requiresReview:false});};
    const response=status.toLowerCase()==='cancelled'?durableJsonResponse(db,{actorId:session.user.id,branchId:Number(ticket.branch_id),operation:'repair_cancellation',scope:'business',key:req.headers.get('idempotency-key'),payload:{ticket_id:ticketId,status,note}},execute):execute();

    // If form post (no JS), redirect back
    if (!contentType.includes("application/json")) {
      return Response.redirect(new URL(`/repairs/${ticketId}`, req.url), 303);
    }
    revalidatePath(`/repairs/${ticketId}`);
    return response;
  } catch (e: any) {
    if (e instanceof StatusError) {
      // ترجمه پیام دامنه به فارسی
      const m = e.message.match(/A ticket in "(.+?)" cannot move to "(.+?)"\./);
      if (m) {
        return Response.json(
          { error: `انتقال از وضعیت «${statusFa(m[1])}» به «${statusFa(m[2])}» مجاز نیست — ابتدا وضعیت‌های میانی مجاز را طی کنید.` },
          { status: 400 }
        );
      }
      const un = e.message.match(/Unknown status "(.+?)"\./);
      if (un) return Response.json({ error: `وضعیت «${un[1]}» تعریف نشده است.` }, { status: 400 });
      if (e.message === "Repair ticket not found.") return Response.json({ error: "پذیرش یافت نشد." }, { status: 404 });
      return Response.json({ error: e.message }, { status: 400 });
    }
    return fail(e);
  }
}
