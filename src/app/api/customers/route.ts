import {customerSalutation} from '@/lib/customer-identity';
import {requireReceptionCustomerName} from '@/lib/reception-validation';
import { NextRequest } from "next/server";
import { getDb, nextSeq } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok, readJson, audit, validate, HttpError } from "@/lib/api";
import { addCustomerEvent } from "@/lib/repair";
import { customerTypeValue } from "@/lib/customer-type";
import { activeBranch, BRANCH_COOKIE, recordBranchId } from "@/lib/branch";
import {atomic} from "@/lib/db/transaction";
import {assertBranchProfileWrite} from "@/lib/branch-access";
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresCustomersHttp} from '@/lib/db/pg-http';

export async function GET(req: NextRequest) {
  if(postgresIntegration())return postgresCustomersHttp(req);
  try {
    const session = requireSession(req);
    requirePerm(session, "customers.view");
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    const db = getDb();
    const branch = activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    if (q) {
      const like = `%${q}%`;
      return ok({
        customers: db
          .prepare(
            `SELECT id, first_name, last_name, company, mobile, email, code, salutation, is_vip, is_blacklisted, customer_type, organization_name FROM customers WHERE is_archived = 0 AND (? IS NULL OR id IN (SELECT customer_id FROM customer_branch_access WHERE branch_id=?)) AND
             ((COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) LIKE ? OR company LIKE ? OR mobile LIKE ? OR email LIKE ? OR code LIKE ?)
             ORDER BY created_at DESC LIMIT 8`
          )
          .all(branch, branch, like, like, like, like, like) as any[],
      });
    }
    return ok({ customers: db.prepare("SELECT * FROM customers WHERE is_archived = 0 AND (? IS NULL OR id IN (SELECT customer_id FROM customer_branch_access WHERE branch_id=?)) ORDER BY created_at DESC LIMIT 50").all(branch, branch) as any[] });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  if(postgresIntegration())return postgresCustomersHttp(req);
  try {
    const session = requireSession(req);
    requirePerm(session, "customers.create");
    const b = await readJson(req);
    const db = getDb();
    return atomic(db,()=>{
    const branchId = recordBranchId(session, req.cookies.get(BRANCH_COOKIE)?.value);
    const lookupBranch = activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    requireReceptionCustomerName(b);
    b.salutation=customerSalutation(b.salutation);

    // اعتبارسنجی سرور
    const mobile = validate.mobile(b.mobile);
    if (mobile) b.mobile = mobile;
    if (b.email && b.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email.trim())) {
      throw new HttpError(400, "ایمیل معتبر نیست.");
    }
    validate.maxLength(b.first_name, 60, "نام");
    validate.maxLength(b.last_name, 60, "نام خانوادگی");
    validate.maxLength(b.notes, 2000, "توضیحات");

    const dupes: any[] = [];
    if (b.mobile) dupes.push(...(db.prepare("SELECT id, first_name, last_name, mobile FROM customers WHERE mobile = ? AND is_archived = 0 AND (? IS NULL OR id IN (SELECT customer_id FROM customer_branch_access WHERE branch_id=?))").all(b.mobile, lookupBranch, lookupBranch) as any[]));
    if (b.email) dupes.push(...(db.prepare("SELECT id, first_name, last_name, email FROM customers WHERE email = ? AND is_archived = 0 AND (? IS NULL OR id IN (SELECT customer_id FROM customer_branch_access WHERE branch_id=?))").all(b.email, lookupBranch, lookupBranch) as any[]));
    if (b.national_id) dupes.push(...(db.prepare("SELECT id, first_name, last_name, mobile FROM customers WHERE national_id = ? AND is_archived = 0 AND (? IS NULL OR id IN (SELECT customer_id FROM customer_branch_access WHERE branch_id=?))").all(String(b.national_id), lookupBranch, lookupBranch) as any[]));
    if (b.postal_code) validate.maxLength(b.postal_code, 20, "کد پستی");
    b.customer_type = customerTypeValue(b.customer_type);
    if (!b.customer_type) throw new HttpError(400, "نوع مشتری معتبر نیست.");
    if (b.organization_name) validate.maxLength(b.organization_name, 120, "نام سازمان");
    // همگام‌سازی: نوع همکار ⇄ فلگ is_colleague
    if (b.customer_type === "colleague") b.is_colleague = true;
    else if (b.customer_type && b.customer_type !== "colleague" && b.is_colleague === undefined) b.is_colleague = false;
    if (dupes.length > 0 && !b.force) {
      return Response.json({ duplicate: true, error: "مشتری با همین تلفن/ایمیل/کد ملی قبلاً ثبت شده است.", duplicates: dupes }, { status: 409 });
    }

    // پورسانت معرف: ثبت روی خود مشتری معرف
    if (b.referrer_customer_id && b.referrer_commission_type) {
      assertBranchProfileWrite(db,session,req.cookies.get(BRANCH_COOKIE)?.value,"customer",b.referrer_customer_id);
      db.prepare("UPDATE customers SET referrer_commission_type = ?, referrer_commission_value = ? WHERE id = ?")
        .run(b.referrer_commission_type, b.referrer_commission_value ?? 0, Number(b.referrer_customer_id));
    }

    const name = [b.first_name, b.last_name].filter(Boolean).join(" ") || b.company;
    const code = nextSeq("customer", "C");
    // سقف اعتبار: اگر کاربر مقداری نداده باشد، پیش‌فرض تنظیمات سایت اعمال می‌شود (۰ = بدون محدودیت)
    const creditLimit =
      b.credit_limit != null && b.credit_limit !== ""
        ? Math.max(0, Math.round(Number(b.credit_limit) || 0))
        : Math.max(0, Math.round(Number((db.prepare("SELECT value FROM settings WHERE key = 'default_credit_limit'").get() as any)?.value ?? 0) || 0));
    const id = db
      .prepare(
        `INSERT INTO customers(code, first_name, last_name, company, mobile, phone, email, address, city, tax_id, tags, is_vip, is_blacklisted, is_company, contact_person, credit_limit, notes, national_id, job, referral_source, nickname, referrer_customer_id, postal_code, is_colleague, customer_type, organization_name, created_by, branch_id, salutation)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        code, b.first_name ?? null, b.last_name ?? null, b.company || null, b.mobile ?? null, b.phone ?? null,
        b.email ?? null, b.address ?? null, b.city ?? null, b.tax_id ?? null, JSON.stringify(b.tags ?? []),
        b.is_vip ? 1 : 0, 0, b.company ? 1 : 0, b.contact_person ?? null, creditLimit, b.notes ?? null,
        b.national_id ?? null, b.job ?? null, b.referral_source ?? null, b.nickname ?? null, b.referrer_customer_id ?? null, b.postal_code ?? null, b.is_colleague ? 1 : 0, b.customer_type ?? "regular", b.organization_name ?? null, session.user.id, branchId, b.salutation
      ).lastInsertRowid as number;
    audit(session, "create", "customer", id, null, { name, mobile: b.mobile,branch_id:branchId });
    addCustomerEvent(id, "customer", "مشتری ثبت شد", name, session.user.id);
    return ok({ id, code });
    });
  } catch (e) {
    return fail(e);
  }
}
