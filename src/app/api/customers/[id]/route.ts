import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, fail, ok, readJson, audit, HttpError, requirePerm,validate } from "@/lib/api";
import { addCustomerEvent } from "@/lib/repair";
import { CUSTOMER_TYPES, customerTypeValue } from "@/lib/customer-type";
import { atomic } from '@/lib/db/transaction';
import { activeBranch,BRANCH_COOKIE } from '@/lib/branch';
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresCustomersHttp} from '@/lib/db/pg-http';
import {postgresOperationalHttp} from '@/lib/db/pg-operational-http';
import {assertBranchProfileWrite,assertBranchResource} from '@/lib/branch-access';
import {customerSalutation} from '@/lib/customer-identity';
import {requireReceptionCustomerName} from '@/lib/reception-validation';

export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;if(postgresIntegration())return req.nextUrl.searchParams.get('view')==='merge_history'?postgresOperationalHttp(req,'customer-profile',Number(id)):postgresCustomersHttp(req,Number(id));
  try{const session=requireSession(req);requirePerm(session,'customers.view');const number=Number(id);if(!Number.isSafeInteger(number)||number<1)throw new HttpError(400,'شناسه معتبر نیست.');assertBranchResource(getDb(),session,req.cookies.get(BRANCH_COOKIE)?.value,'customer',number);const customer=getDb().prepare('SELECT * FROM customers WHERE id=? AND is_archived=0').get(number);if(!customer)throw new HttpError(404,'مشتری یافت نشد.');return ok({customer});}catch(error){return fail(error);}
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if(postgresIntegration())return postgresOperationalHttp(req,'customer-profile',Number((await params).id));
  try {
    const session = requireSession(req);
    requirePerm(session, "customers.edit");
    const { id } = await params;
    const customerId = Number(id);
    const b = await readJson(req);
    const db = getDb();
    assertBranchProfileWrite(db,session,req.cookies.get(BRANCH_COOKIE)?.value,'customer',customerId);
    const before = db.prepare("SELECT * FROM customers WHERE id = ?").get(customerId) as any;
    if (!before) return Response.json({ error: "مشتری یافت نشد." }, { status: 404 });

    if (b.action === "blacklist") {
      db.prepare("UPDATE customers SET is_blacklisted = 1, blacklist_reason = ? WHERE id = ?").run(b.reason ?? null, customerId);
      audit(session, "update", "customer", customerId, { is_blacklisted: 0 }, { is_blacklisted: 1 });
      addCustomerEvent(customerId, "note", "مشتری به لیست سیاه اضافه شد", b.reason ?? null, session.user.id);
      return ok({ ok: true });
    }
    if (b.action === "unblacklist") {
      db.prepare("UPDATE customers SET is_blacklisted = 0, blacklist_reason = NULL WHERE id = ?").run(customerId);
      audit(session, "update", "customer", customerId, { is_blacklisted: 1 }, { is_blacklisted: 0 });
      addCustomerEvent(customerId, "note", "خروج از لیست سیاه", null, session.user.id);
      return ok({ ok: true });
    }
    if (b.action === "archive") {
      db.prepare("UPDATE customers SET is_archived = 1 WHERE id = ?").run(customerId);
      audit(session, "archive", "customer", customerId, { is_archived: 0 }, { is_archived: 1 });
      return ok({ ok: true });
    }
    if (b.action === "update") {
      if(Object.hasOwn(b,'expected_updated_at')&&b.expected_updated_at!==(before.updated_at??null))throw new HttpError(409,'اطلاعات مشتری تغییر کرده است؛ صفحه را تازه کنید.');
      requireReceptionCustomerName({...before,...b});
      const fields = ["salutation", "first_name", "last_name", "company", "mobile", "phone", "email", "address", "city", "tax_id", "notes", "postal_code", "is_colleague", "customer_type", "organization_name", "national_id", "job", "referral_source", "nickname"];
      for(const key of fields.filter(key=>!['is_colleague','salutation'].includes(key)))if(Object.hasOwn(b,key)){
        if(b[key]!=null&&typeof b[key]!=='string')throw new HttpError(400,'مشخصات مشتری معتبر نیست.');
        validate.maxLength(b[key],key==='notes'?2000:key==='address'?1000:key==='email'?254:['first_name','last_name'].includes(key)?60:160,'مشخصات مشتری');
        if(typeof b[key]==='string')b[key]=b[key].trim();
      }
      if(Object.hasOwn(b,'salutation'))b.salutation=customerSalutation(b.salutation);
      if(Object.hasOwn(b,'mobile'))b.mobile=validate.mobile(b.mobile)||null;
      if(b.email&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email))throw new HttpError(400,'ایمیل معتبر نیست.');
      // اعتبارسنجی نوع مشتری + همگام‌سازی: نوع همکار ⇄ فلگ is_colleague
      if (b.customer_type !== undefined) {
        b.customer_type = customerTypeValue(b.customer_type);
        if (!CUSTOMER_TYPES.includes(b.customer_type)) throw new HttpError(400, "نوع مشتری نامعتبر است.");
        if (b.customer_type === "colleague") b.is_colleague = true;
        else if (!("is_colleague" in b)) b.is_colleague = false;
      }
      const sets: string[] = [];
      const vals: any[] = [];
      for (const f of fields) {
        if (f in b) { sets.push(`${f} = ?`); vals.push(f === "is_colleague" ? (b[f] ? 1 : 0) : (b[f] ?? null)); }
      }
      if (sets.length === 0) return ok({ ok: true });
      sets.push("updated_at = ?");
      vals.push(new Date().toISOString(),customerId,before.updated_at??null);
      atomic(db,()=>{
      const result=db.prepare(`UPDATE customers SET ${sets.join(", ")} WHERE id = ? AND updated_at IS ?`).run(...vals);
      if(result.changes!==1)throw new HttpError(409,'اطلاعات مشتری هم‌زمان تغییر کرده است؛ صفحه را تازه کنید.');
      audit(session, "update", "customer", customerId, before, b);
      });
      return ok({ ok: true });
    }
    if (b.action === "merge_into" && b.target_id) {
      return atomic(db,()=>{
      const targetId = validate.id(b.target_id);
      if(targetId===customerId)throw new HttpError(400,'حساب مبدأ و مقصد نباید یکسان باشند.');
      const target = db.prepare("SELECT id,branch_id FROM customers WHERE id = ? AND is_archived=0").get(targetId);
      if (!target) return Response.json({ error: "حساب مقصد ادغام یافت نشد." }, { status: 404 });
      if(before.is_archived || before.branch_id!==target.branch_id)throw new HttpError(409,"ادغام بین شعبه‌ها یا تکرار ادغامِ بایگانی‌شده مجاز نیست؛ بررسی مدیر شرکت لازم است.");
      const scope=activeBranch(session,req.cookies.get(BRANCH_COOKIE)?.value);
      if(scope.branchId!=null&&(before.branch_id!==scope.branchId||target.branch_id!==scope.branchId))throw new HttpError(404,'حساب مبدأ یا مقصد در شعبهٔ مجاز یافت نشد.');
      // A profile merge must not rewrite frozen accounting parties or leave partial operational moves.
      if(db.prepare("SELECT 1 FROM checks WHERE customer_id=? LIMIT 1").get(customerId))throw new HttpError(409,"ادغام مشتری دارای سابقهٔ چک به اصلاح تأییدشده نیاز دارد.");
      const financial=db.prepare(`SELECT 1 WHERE EXISTS(SELECT 1 FROM installments WHERE customer_id=?)
       OR EXISTS(SELECT 1 FROM installment_schedules WHERE customer_id=?)
       OR EXISTS(SELECT 1 FROM payments WHERE customer_id=?)
       OR EXISTS(SELECT 1 FROM invoices WHERE customer_id=? AND status!='draft')
       OR EXISTS(SELECT 1 FROM sales WHERE customer_id=?)
       OR EXISTS(SELECT 1 FROM credit_notes WHERE customer_id=?)
       OR EXISTS(SELECT 1 FROM accounting_lines WHERE customer_id=?)
       OR EXISTS(SELECT 1 FROM accounting_events WHERE json_extract(payload_json,'$.document.customer_id')=?)
       OR EXISTS(SELECT 1 FROM repair_tickets t JOIN inventory_movements m ON ((m.ref_type='ticket' AND m.ref_id=t.id) OR (m.ref_type='ticket_item' AND m.ref_id IN(SELECT id FROM ticket_items WHERE ticket_id=t.id))) WHERE t.customer_id=? AND m.qty<0)`).get(...Array(9).fill(customerId));
      if(financial)throw new HttpError(409,'ادغام مشتری دارای سابقهٔ مالی یا اقساط به فرایند اصلاحِ تأییدشده نیاز دارد؛ هیچ سابقه‌ای جابه‌جا نشد.');
      // move all related records
      db.prepare("UPDATE devices SET customer_id = ? WHERE customer_id = ?").run(targetId, customerId);
      db.prepare("UPDATE repair_tickets SET customer_id = ? WHERE customer_id = ?").run(targetId, customerId);
      db.prepare("UPDATE invoices SET customer_id = ? WHERE customer_id = ?").run(targetId, customerId);
      db.prepare("UPDATE payments SET customer_id = ? WHERE customer_id = ?").run(targetId, customerId);
      db.prepare("UPDATE sales SET customer_id = ? WHERE customer_id = ?").run(targetId, customerId);
      db.prepare("UPDATE warranties SET customer_id = ? WHERE customer_id = ?").run(targetId, customerId);
      db.prepare("UPDATE estimates SET customer_id = ? WHERE customer_id = ?").run(targetId, customerId);
      db.prepare("UPDATE customer_events SET customer_id = ? WHERE customer_id = ?").run(targetId, customerId);
      db.prepare("UPDATE customers SET is_archived = 1, notes = COALESCE(notes, '') || ? WHERE id = ?")
        .run(` [Merged from customer #${customerId} by ${session.user.name}]`, customerId);
      audit(session, "merge", "customer", customerId, { into: targetId }, null);
      addCustomerEvent(targetId, "note", `Customer #${customerId} merged into this profile`, null, session.user.id);
      return ok({ ok: true, target: targetId });
      });
    }
    return Response.json({ error: "عملیات نامشخص." }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}
