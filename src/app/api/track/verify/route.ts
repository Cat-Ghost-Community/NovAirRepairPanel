import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { fail, ok, readJson } from "@/lib/api";
import { issueTrackingToken, trackingRateLimit } from "@/lib/tracking";

export async function POST(req: NextRequest) {
  try {
    const b = await readJson(req);
    const ticket = String(b?.ticket ?? "").trim();
    if (!ticket || ticket.length > 80) return Response.json({ error: "شماره پذیرش و موبایل را بررسی کنید." }, { status: 400 });
    trackingRateLimit(`verify:${ticket.toUpperCase()}`, 10);
    const db = getDb();
    const t = db
      .prepare(
        `SELECT t.id, t.number, c.mobile, c.phone FROM repair_tickets t JOIN customers c ON c.id = t.customer_id
         WHERE UPPER(t.number) = UPPER(?)`
      )
      .get(ticket) as any;

    // تبدیل ارقام فارسی/عربی به انگلیسی قبل از حذف نویسه‌های غیرعددی —
    // وگرنه ورودی «۰۹۱۲…» کاملاً خالی می‌شود و تطبیق همیشه شکست می‌خورد
    const faDigits = "۰۱۲۳۴۵۶۷۸۹";
    const arDigits = "٠١٢٣٤٥٦٧٨٩";
    const toEn = (v: unknown) =>
      String(v ?? "").replace(/[۰-۹٠-٩]/g, (d) => {
        const i = faDigits.indexOf(d);
        return String(i >= 0 ? i : arDigits.indexOf(d));
      });
    const digits = toEn(b.phone).replace(/\D/g, "");
    const normalize = (value: string) => value.startsWith("0098") ? "0" + value.slice(4) : value.startsWith("98") ? "0" + value.slice(2) : value;
    const stored = toEn(t?.mobile ?? t?.phone).replace(/\D/g, "");
    if (!t || !stored || normalize(digits) !== normalize(stored)) {
      return Response.json({ error: "شماره پذیرش و موبایل مطابقت ندارند." }, { status: 403 });
    }

    // stable scoped token for this ticket
    const token = issueTrackingToken(t.id);
    return ok({ token, number: t.number });
  } catch (e) {
    return fail(e);
  }
}
