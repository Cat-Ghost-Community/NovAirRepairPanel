import {requireAssignmentAuthority,changeRepairAssignment,repairWorkflow} from '@/lib/repair-workflow';
import {repairReadAssignedOnly} from '@/lib/repair-workflow';
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresRepairsHttp} from '@/lib/db/pg-repair-http';
import { NextRequest } from "next/server";
import { captureFinancialDocument } from "@/lib/accounting-events";
import { getDb, nextSeq } from "@/lib/db/schema";
import {requireReceptionCustomerName} from '@/lib/reception-validation';
import { requireSession, requirePerm, fail, ok, readJson, audit, validate, HttpError } from "@/lib/api";
import { getStatusByName, addCustomerEvent, encryptSecret, notifyUser } from "@/lib/repair";
import { BRANCH_COOKIE, recordBranchId, activeBranch, branchWhere } from "@/lib/branch";
import { atomic } from "@/lib/db/transaction";

export async function GET(req: NextRequest) {
  if(postgresIntegration())return postgresRepairsHttp(req);
  try {
    const session = requireSession(req);
    requirePerm(session, "repairs.view");
    const db = getDb();
    const sp = req.nextUrl.searchParams;
    const mine = sp.get("mine");
    const status = sp.get("status");
    const q = sp.get("q");
    const limit = Math.min(500, Math.max(1, Math.floor(Number(sp.get("limit")) || 100)));

    let sql = `SELECT t.id,t.number,t.customer_id,t.device_id,t.branch_id,t.technician_id,t.status_id,t.priority,t.created_at,t.problem, s.name status_name, s.color status_color, c.first_name, c.last_name, c.mobile,
      d.brand, d.model, d.type, u.name tech_name, u.avatar_color
      FROM repair_tickets t
      JOIN repair_statuses s ON s.id = t.status_id
      JOIN customers c ON c.id = t.customer_id
      JOIN devices d ON d.id = t.device_id
      LEFT JOIN users u ON u.id = t.technician_id WHERE 1=1`;
    const params: any[] = [];
    const scope = branchWhere(activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value), "t");
    sql += ` AND ${scope.sql}`;
    params.push(...scope.params);
    if (mine === "1" || (repairReadAssignedOnly(session))) {
      sql += " AND (t.technician_id = ? OR t.technician2_id = ?)"; params.push(session.user.id, session.user.id);
    }
    if (status) { sql += " AND s.name = ?"; params.push(status); }
    if (q) {
      sql += " AND (t.number LIKE ? OR c.first_name || ' ' || c.last_name LIKE ? OR d.brand || ' ' || d.model LIKE ? OR d.imei LIKE ? OR d.serial LIKE ?)";
      const like = `%${q}%`;
      params.push(like, like, like, like, like);
    }
    sql += " ORDER BY t.created_at DESC,t.id DESC LIMIT ?";
    params.push(limit);
    return ok({ tickets: db.prepare(sql).all(...params) as any[] });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  if(postgresIntegration())return postgresRepairsHttp(req);
  try {
    const session = requireSession(req);
    requirePerm(session, "repairs.create");
    const b = await readJson(req);
    const db = getDb();

    if (!b.customer_id || !b.device_id) {
      return Response.json({ error: "مشتری و دستگاه الزامی هستند." }, { status: 400 });
    }
    const device = db.prepare("SELECT * FROM devices WHERE id = ?").get(b.device_id) as any;
    if (!device || device.customer_id !== b.customer_id) {
      return Response.json({ error: "این دستگاه متعلق به این مشتری نیست." }, { status: 400 });
    }
    const customer = db.prepare('SELECT first_name,last_name FROM customers WHERE id=?').get(b.customer_id) as {first_name:string;last_name:string}|undefined;
    if(!customer)throw new HttpError(404,'مشتری یافت نشد.');
    requireReceptionCustomerName(customer);

    const statusNew = getStatusByName("New") ?? getStatusByName("Received");
    const branch = recordBranchId(session, req.cookies.get(BRANCH_COOKIE)?.value);
    if (b.branch_id != null && Number(b.branch_id) !== branch) throw new HttpError(403, "شعبه ثبت پذیرش باید با شعبه فعال یکسان باشد.");
    if (!statusNew) throw new HttpError(503, "وضعیت‌های پذیرش تنظیم نشده‌اند. با مدیر سامانه تماس بگیرید.");
    const deposit = validate.amount(b.deposit ?? 0, "بیعانه");
    if (deposit > 0) requirePerm(session, "payments.create");
    if (b.technician_id) {
      requireAssignmentAuthority(db,session,branch,Number(b.technician_id));
      const technician = db.prepare("SELECT id FROM users WHERE id=? AND is_active=1 AND role='technician' AND branch_id=?").get(b.technician_id, branch);
      if (!technician) throw new HttpError(400, "تعمیرکار فعال این شعبه را انتخاب کنید.");
    }
    return atomic(db, () => {
    let number = nextSeq("ticket", "R");
    while (db.prepare("SELECT 1 FROM repair_tickets WHERE number = ?").get(number)) {
      number = nextSeq("ticket", "R");
    }

    const answers = b.custom_answers && typeof b.custom_answers === "object" ? JSON.stringify(b.custom_answers) : null;
    const groupId = b.group_receipt_id ?? null;
    // هزینه عیب‌یابی: اگر ثبت‌کننده مقداری وارد نکرده باشد، پیش‌فرض تنظیمات سایت اعمال می‌شود
    const diagFee =
      b.diagnostic_fee != null && b.diagnostic_fee !== ""
        ? validate.amount(b.diagnostic_fee, "هزینه عیب‌یابی")
        : Math.max(0, Math.round(Number((db.prepare("SELECT value FROM settings WHERE key = 'diagnostic_fee'").get() as any)?.value ?? 0) || 0));
    const id = db
      .prepare(
        `INSERT INTO repair_tickets(number, branch_id, customer_id, device_id, repair_type, priority, source, technician_id, status_id, problem, condition_notes, accessories, security_type, security_value_enc, security_hint, estimated_completion, diagnostic_fee, tags, inspection, checklist, custom_answers, group_receipt_id, created_by)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        number, branch, b.customer_id, b.device_id, b.repair_type ?? null, b.priority ?? "normal",
        b.source ?? "حضوری", null, statusNew!.id,
        b.problem ?? null, b.condition_notes ?? null, b.accessories ?? null,
        b.security_type ?? null, b.security_value ? encryptSecret(String(b.security_value)) : null, b.security_hint ?? null,
        b.estimated_completion ?? null, diagFee, JSON.stringify(b.tags ?? []),
        JSON.stringify(b.inspection ?? {}), JSON.stringify(b.checklist ?? []), answers, groupId, session.user.id
      ).lastInsertRowid as number;

    if(b.technician_id)changeRepairAssignment(db,session,{ticketId:id,targetId:Number(b.technician_id),expect:null,version:0,workflowRevision:repairWorkflow(db,branch).revision});
    // بیعانه: ثبت سند دریافت در صورت ورود مبلغ
    const dep = deposit;
    if (dep > 0) {
      const payNo = nextSeq("payment", "PMT-");
      const receipt=db.prepare(
        `INSERT INTO payments(number, customer_id, ticket_id, amount, method, notes, branch_id, user_id, direction)
         VALUES(?,?,?,?,?,?,?,?,'in')`
      ).run(payNo, b.customer_id, id, dep, "cash", "بیعانه هنگام پذیرش", branch, session.user.id);
      const paymentId=Number(receipt.lastInsertRowid);
      captureFinancialDocument(db,"payment",paymentId,"receipt",session.user.id,branch);
      audit(session, "create", "payment", paymentId, null, { kind: "deposit", amount: dep, ticket_id:id,branch_id:branch });
    }

    db.prepare("INSERT INTO repair_status_history(ticket_id, from_status, to_status, user_id, note) VALUES(?,?,?,?,?)").run(
      id, null, statusNew!.id, session.user.id, "پذیرش ثبت شد"
    );
    audit(session, "create", "repair_ticket", id, null, { number });
    addCustomerEvent(b.customer_id, "repair", `پذیرش ${number} ثبت شد`, b.problem ?? null, session.user.id, id);
    if (b.technician_id) notifyUser(b.technician_id, "پذیرش جدید", `پذیرش ${number} به شما ارجاع شد.`, `/repairs/${id}`);

    return ok({ id, number });
    });
  } catch (e) {
    return fail(e);
  }
}
