import {insertRegisteredDevice} from '@/lib/device-registration';
import {requireAssignmentAuthority,changeRepairAssignment,repairWorkflow} from '@/lib/repair-workflow';
import {assertBranchResource} from '@/lib/branch-access';
import { NextRequest } from "next/server";
import { getDb, nextSeq } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok, readJson, audit, HttpError,validate,assertRequestSession } from "@/lib/api";
import crypto from "node:crypto";
import { BRANCH_COOKIE, recordBranchId } from "@/lib/branch";
import { atomic } from "@/lib/db/transaction";
import {durableJsonResponse} from '@/lib/idempotency';
import {createGroupCashReceipt,validateGroupCash} from '@/lib/repair-group-receipt';

export const dynamic = "force-dynamic";

/**
 * پذیرش گروهی: چند دستگاه از یک مشتری همزمان پذیرش می‌شوند
 * و همه با یک group_receipt_id مشترک ثبت می‌شوند تا قبض پذیرش واحد چاپ شود.
 */
export async function POST(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "repairs.create");
    const b = await readJson(req);
    const deposit=b.deposit==null?0:validate.amount(b.deposit);
    if(deposit>0)throw new HttpError(409,'ثبت بیعانهٔ بدون رسید تأییدشده مجاز نیست؛ از دریافت نقدی گروه یا بخش دریافت وجه استفاده کنید. پذیرش و وجهی ثبت نشد.');
    const db = getDb();
    if(b.cash_receipt!=null){validateGroupCash(session,b.cash_receipt);if(!req.headers.get('idempotency-key'))throw new HttpError(400,'شناسهٔ یکتای ثبت قبض و وجه الزامی است.');}

    if (!b.customer_id || !Array.isArray(b.devices) || b.devices.length === 0 || b.devices.length > 100) {
      return Response.json({ error: "مشتری و حداقل یک دستگاه لازم است." }, { status: 400 });
    }

    const groupId = `G-${crypto.randomBytes(16).toString("hex").toUpperCase()}`;
    const statusNew = db.prepare("SELECT id FROM repair_statuses WHERE is_open=1 ORDER BY sort,id LIMIT 1").get() as any;
    if(!statusNew)throw new HttpError(409,'وضعیت پذیرش فعال تعریف نشده است؛ ابتدا تنظیمات وضعیت تعمیر را کامل کنید.');
    const branch = recordBranchId(session, req.cookies.get(BRANCH_COOKIE)?.value);
    if (b.branch_id != null && Number(b.branch_id) !== branch) throw new HttpError(403, "شعبه ثبت باید با شعبه فعال یکسان باشد.");
    const technicianFor=(item:{technician_id?:unknown})=>{const value=item.technician_id??b.technician_id;return value==null?null:validate.id(value);};
    for(const item of b.devices){
      if(!item||typeof item!=='object'||Array.isArray(item))throw new HttpError(400,'اطلاعات هر دستگاه باید معتبر باشد.');
      if(item.device_id!=null)validate.id(item.device_id);
      for(const [field,label,max] of [['brand','برند',200],['model','مدل',200],['serial','سریال',200],['imei','شناسهٔ دستگاه',32],['type','نوع دستگاه',100],['problem','شرح ایراد',8000],['condition_notes','وضعیت ظاهری',4000],['accessories','لوازم همراه',2000]] as const){if(item[field]!=null&&(typeof item[field]!=='string'||item[field].length>max))throw new HttpError(400,`${label} باید متن معتبر و حداکثر ${max} نویسه باشد.`);}
      const target=technicianFor(item);if(target!=null)requireAssignmentAuthority(db,session,branch,target);
    }
    const created: Array<{ id: number; number: string }> = [];

    const work=()=>atomic(db, () => {
    if(db.prepare('SELECT 1 FROM repair_tickets WHERE group_receipt_id=? LIMIT 1').get(groupId))throw new HttpError(409,'شناسهٔ قبض تکراری است؛ ثبت را دوباره انجام دهید.');
    for (const item of b.devices) {
      let deviceId = item.device_id;
      if(deviceId)assertBranchResource(db,session,req.cookies.get(BRANCH_COOKIE)?.value,'device',deviceId);
      if (deviceId && !db.prepare("SELECT id FROM devices WHERE id=? AND customer_id=?").get(deviceId,b.customer_id)) throw new HttpError(400, "دستگاه متعلق به مشتری انتخاب‌شده نیست.");
      if (!deviceId) {
        deviceId=insertRegisteredDevice(db,Number(b.customer_id),item.type==='phone'?'mobile':item.type??'other',item,branch);
      }
      let number = nextSeq("ticket", "R");
      while (db.prepare("SELECT 1 FROM repair_tickets WHERE number = ?").get(number)) {
        number = nextSeq("ticket", "R");
      }
      const id = db
        .prepare(`INSERT INTO repair_tickets(number, branch_id, customer_id, device_id, repair_type, priority, source, technician_id, status_id, problem, condition_notes, accessories, group_receipt_id, created_by)
                  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(
          number, branch, b.customer_id, deviceId, item.repair_type ?? null, item.priority ?? "normal",
          item.source ?? "walk-in", null, statusNew.id, item.problem ?? null,
          item.condition_notes ?? null, item.accessories ?? null, groupId, session.user.id
        ).lastInsertRowid as number;
      db.prepare("INSERT INTO repair_status_history(ticket_id, from_status, to_status, user_id, note) VALUES(?,?,?,?,?)")
        .run(id, null, statusNew.id, session.user.id, "پذیرش گروهی ثبت شد");
      const target=technicianFor(item);
      if(target!=null)changeRepairAssignment(db,session,{ticketId:id,targetId:target,expect:null,version:0,workflowRevision:repairWorkflow(db,branch).revision});
      created.push({ id, number });
    }

    const receipt=b.cash_receipt==null?null:createGroupCashReceipt(db,session,groupId,validate.id(b.customer_id),branch,b.cash_receipt);
    audit(session, "create", "repair_group", null, null, { group: groupId, count: created.length,payment_id:receipt?.id??null });
    return ok({ group_id: groupId, tickets: created,...(receipt?{receipt}:{} ) });
    });
    return atomic(db,()=>{assertRequestSession(req);requirePerm(session,'repairs.create');assertBranchResource(db,session,req.cookies.get(BRANCH_COOKIE)?.value,'customer',validate.id(b.customer_id));const key=req.headers.get('idempotency-key');return key?durableJsonResponse(db,{actorId:session.user.id,branchId:branch,operation:'repair_group_create',scope:'business',key,payload:b},work):work();});
  } catch (e) {
    return fail(e);
  }
}
