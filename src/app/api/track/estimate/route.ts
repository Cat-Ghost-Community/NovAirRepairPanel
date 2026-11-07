import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { fail, ok, readJson } from "@/lib/api";
import { transitionTicket, addCustomerEvent } from "@/lib/repair";
import { atomic } from "@/lib/db/transaction";
import {limitPublicEstimate,trustedClientIp} from '@/lib/public-request-security';
import { signatureValidationError } from "@/lib/signature-validation";

export async function POST(req: NextRequest) {
  try {
    const b = await readJson(req);
    const db = getDb();
    limitPublicEstimate(req,String(b.token??''));
    return atomic(db, () => {
    const est = db.prepare("SELECT * FROM estimates WHERE public_token = ?").get(String(b.token ?? "")) as any;
    if (!est) return Response.json({ error: "این لینک برآورد نامعتبر است." }, { status: 404 });
    if (est.status !== "sent" && est.status !== "viewed") {
      return Response.json({ error: "پاسخ این برآورد قبلاً ثبت شده است." }, { status: 409 });
    }
    if (est.valid_until && String(est.valid_until).slice(0,10) < new Date().toISOString().slice(0,10)) return Response.json({ error: "مهلت تأیید این برآورد پایان یافته است. از تعمیرگاه برآورد تازه بخواهید." }, { status: 410 });

    if (b.action === "approve") {
      // ─── اعتبارسنجی امضای حقوقی ───
      const signature = String(b.signature ?? "");
      const signedName = String(b.signed_name ?? "").trim();
      const signatureError=signatureValidationError(signature,true);
      if(signatureError)return Response.json({error:signatureError},{status:400});
      if (signedName.length < 3 || signedName.length > 120) {
        return Response.json({ error: "نام و نام‌خانوادگی امضاکننده الزامی است." }, { status: 400 });
      }
      if (signature.length > 500_000) {
        return Response.json({ error: "حجم امضا بیش از حد مجاز است." }, { status: 400 });
      }

      db.prepare(
        `UPDATE estimates SET status = 'approved', approved_at = datetime('now'),
         signature_data = ?, signed_name = ?, signed_at = datetime('now'), signed_ip = ?, signed_ua = ?
         WHERE id = ?`
      ).run(signature, signedName, trustedClientIp(req), req.headers.get("user-agent")?.slice(0, 300) ?? null, est.id);

      const ticket = db.prepare("SELECT * FROM repair_tickets WHERE id = ?").get(est.ticket_id) as any;
      if (ticket) {
        transitionTicket(ticket.id, "Approved", null as any, `برآورد توسط مشتری آنلاین تأیید و امضا شد — امضاکننده: ${signedName}`);
      }
      addCustomerEvent(est.customer_id, "estimate", `برآورد ${est.number} توسط مشتری تأیید شد`, null, null, est.ticket_id);
      db.prepare("INSERT INTO audit_logs(action,entity,entity_id) VALUES('portal_approve','estimate',?)").run(est.id);
      return ok({ ok: true, signed: true });
    }

    if (b.action === "reject") {
      db.prepare("UPDATE estimates SET status = 'rejected', rejected_at = datetime('now'), rejection_reason = ? WHERE id = ?")
        .run(String(b.reason ?? "") || null, est.id);
      const ticket = db.prepare("SELECT * FROM repair_tickets WHERE id = ?").get(est.ticket_id) as any;
      if (ticket) {
        transitionTicket(ticket.id, "Cancelled", null as any, "رد برآورد توسط مشتری");
      }
      addCustomerEvent(est.customer_id, "estimate", `برآورد ${est.number} توسط مشتری رد شد`, String(b.reason ?? "").slice(0,2000), null, est.ticket_id);
      db.prepare("INSERT INTO audit_logs(action,entity,entity_id) VALUES('portal_reject','estimate',?)").run(est.id);
      return ok({ ok: true });
    }

    return Response.json({ error: "عملیات نامشخص." }, { status: 400 });
    });
  } catch (e) {
    return fail(e);
  }
}
