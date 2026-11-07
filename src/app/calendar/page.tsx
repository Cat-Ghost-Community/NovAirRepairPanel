import { requirePageAccess } from "@/lib/page-access";
import { getDb } from "@/lib/db/schema";
import { getSessionByToken, canUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { activeBranch,BRANCH_COOKIE } from '@/lib/branch';
import { redirect } from "next/navigation";
import { toJalaali, toGregorian, jalaaliMonthLength, jWeekdayIndexOfMonthStart } from "@/lib/jdate";
import { toFaDigits, fmtMoney } from "@/lib/format";
import { CalendarCells } from "./calendar-cells";

export const dynamic = "force-dynamic";

const J_MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];

type Ev = { kind: "check_in" | "check_out" | "installment" | "warranty"; date: string; jday: number; amount: number; title: string; href: string; status: string };

/** روز جلالی از تاریخ ISO میلادی */
function jdayOf(iso: string): number {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return 0;
  return toJalaali(y, m, d).jd;
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ jy?: string; jm?: string }> }) {
  await requirePageAccess("/calendar");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "finance.view")) redirect("/");

  const sp = await searchParams;
  const today = new Date();
  const tj = toJalaali(today.getFullYear(), today.getMonth() + 1, today.getDate());
  const jy = Number(sp.jy) || tj.jy;
  const jm = Number(sp.jm) || tj.jm;

  // بازه میلادی ماه جلالی — به‌جای binary search از نقطه میانی تقریبی استفاده می‌کنیم
  const approxG = toJalaali(today.getFullYear(), today.getMonth() + 1, today.getDate());
  void approxG;
  // تبدیل ابتدای ماه جلالی به میلادی: جستجوی محلی از روز مشابه ماه قبل/بعد
  function gOf(jd: number): { gy: number; gm: number; gd: number } {
    // فرمول تقریبی + اصلاح دقیق با toJalaali
    const guessGy = jy + 621;
    const mGuess = Math.min(12, Math.max(1, jm + 3)); // مرکز تقریبی ماه
    let best = { gy: guessGy, gm: mGuess, gd: 1 };
    // جستجو در بازه ۷۰ روز اطراف حدس اولیه
    const base = Date.UTC(guessGy, mGuess - 1, 1);
    for (let off = -35; off <= 35; off++) {
      const dt = new Date(base + off * 86400000);
      const jj = toJalaali(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
      if (jj.jy === jy && jj.jm === jm && jj.jd === jd) return { gy: dt.getUTCFullYear(), gm: dt.getUTCMonth() + 1, gd: dt.getUTCDate() };
      best = { gy: dt.getUTCFullYear(), gm: dt.getUTCMonth() + 1, gd: dt.getUTCDate() };
    }
    return best;
  }
  const gStart = gOf(1);
  const len = jalaaliMonthLength(jy, jm);
  const gEnd = gOf(len);
  const startISO = `${gStart.gy}-${String(gStart.gm).padStart(2, "0")}-${String(gStart.gd).padStart(2, "0")}`;
  const endISO = `${gEnd.gy}-${String(gEnd.gm).padStart(2, "0")}-${String(gEnd.gd).padStart(2, "0")}`;

  const db = getDb();
  const branch=activeBranch(session,cookieStore.get(BRANCH_COOKIE)?.value).branchId;
  const events: Ev[] = [];

  // چک‌های دریافتی/پرداختی
  const checks = db
    .prepare(`SELECT c.*, cu.first_name || ' ' || cu.last_name cust_name, s.name sup_name
              FROM checks c LEFT JOIN customers cu ON cu.id = c.customer_id LEFT JOIN suppliers s ON s.id = c.supplier_id
              WHERE c.due_date >= ? AND c.due_date <= ? AND c.status IN ('in_hand','in_bank') AND (? IS NULL OR c.branch_id=?) ORDER BY c.due_date,c.id LIMIT 500`)
    .all(startISO,endISO,branch,branch) as any[];
  for (const c of checks) {
    events.push({
      kind: c.kind === "received" ? "check_in" : "check_out",
      date: String(c.due_date).slice(0, 10),
      jday: jdayOf(String(c.due_date)),
      amount: c.amount,
      title: `${c.kind === "received" ? "چک دریافتی" : "چک پرداختی"} — ${c.cust_name ?? c.sup_name ?? c.payer_payee ?? "—"}`,
      href: "/checks",
      status: c.status,
    });
  }

  // اقساط
  const inst = db
    .prepare(`SELECT i.*, cu.first_name || ' ' || cu.last_name cust_name FROM effective_installments i
              LEFT JOIN customers cu ON cu.id = i.customer_id
              WHERE i.due_date >= ? AND i.due_date <= ? AND i.status != 'paid' AND i.legacy_review=0 AND (? IS NULL OR i.branch_id=?) LIMIT 500`)
    .all(startISO,endISO,branch,branch) as any[];
  for (const i of inst) {
    events.push({
      kind: "installment",
      date: String(i.due_date).slice(0, 10),
      jday: jdayOf(String(i.due_date)),
      amount: i.amount - (i.paid_amount ?? 0),
      title: `قسط ${toFaDigits(i.seq)} — ${i.cust_name ?? "مشتری"}`,
      href: i.invoice_id ? `/invoices/${i.invoice_id}` : "/installments",
      status: i.status,
    });
  }

  // پایان گارانتی‌ها
  const warr = db
    .prepare(`SELECT w.*, p.name part_name, cu.first_name || ' ' || cu.last_name cust_name FROM warranties w
              LEFT JOIN parts p ON p.id = w.part_id LEFT JOIN customers cu ON cu.id = w.customer_id
              LEFT JOIN invoices wi ON wi.id=w.invoice_id LEFT JOIN repair_tickets wt ON wt.id=w.ticket_id LEFT JOIN sales ws ON ws.id=w.sale_id
              WHERE w.end_date >= ? AND w.end_date <= ? AND w.status = 'active' AND (? IS NULL OR COALESCE(wi.branch_id,wt.branch_id,ws.branch_id)=?) ORDER BY w.end_date,w.id LIMIT 500`)
    .all(startISO,endISO,branch,branch) as any[];
  for (const w of warr) {
    events.push({
      kind: "warranty",
      date: String(w.end_date).slice(0, 10),
      jday: jdayOf(String(w.end_date)),
      amount: 0,
      title: `پایان گارانتی — ${w.part_name ?? w.cust_name ?? "کالا"}`,
      href: "/warranty",
      status: "active",
    });
  }

  // ماه قبل/بعد
  const prevM = jm === 1 ? { jy: jy - 1, jm: 12 } : { jy, jm: jm - 1 };
  const nextM = jm === 12 ? { jy: jy + 1, jm: 1 } : { jy, jm: jm + 1 };
  const todayJ = tj;

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-bold tracking-tight">تقویم سررسیدها</h1>
          <p className="text-sm text-zinc-500 mt-0.5">چک‌ها، اقساط و پایان گارانتی‌ها در یک نمای ماهانه</p>
        </div>
        <div className="flex items-center gap-1.5">
          <a className="btn-secondary btn-sm" href={`/calendar?jy=${prevM.jy}&jm=${prevM.jm}`}>→ ماه قبل</a>
          <span className="font-semibold text-[15px] px-2">{J_MONTHS[jm - 1]} {toFaDigits(jy)}</span>
          <a className="btn-secondary btn-sm" href={`/calendar?jy=${nextM.jy}&jm=${nextM.jm}`}>ماه بعد ←</a>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-zinc-500">
        <span className="flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" /> چک دریافتی</span>
        <span className="flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" /> چک پرداختی</span>
        <span className="flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500" /> قسط</span>
        <span className="flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-full bg-violet-500" /> پایان گارانتی</span>
      </div>

      <CalendarCells
        jy={jy}
        jm={jm}
        monthLen={len}
        firstWeekday={jWeekdayIndexOfMonthStart(jy, jm)}
        events={events}
        todayJm={todayJ.jm === jm && todayJ.jy === jy ? todayJ.jd : 0}
      />
    </div>
  );
}
