import { getDb } from "@/lib/db/schema";
import { multiplyRial, percentRial, sumRial } from "@/lib/money";
import { atomic } from "@/lib/db/transaction";
import { captureFinancialDocument } from "@/lib/accounting-events";
import { PAYROLL_SOURCE_JOINS,PAYROLL_BRANCH_SQL } from "@/lib/payroll-scope";
import {isRepairService} from './charge-category';

/**
 * حقوق و دستمزد تعمیرکاران:
 * - ثابت (ماهانه/هفتگی/روزانه)
 * - درصدی از اجرت‌ها و/یا قطعات
 * - تلفیقی (ثابت + درصدی)
 * محاسبه پورسانت فقط بعد از تحویل نهایی دستگاه انجام می‌شود.
 */

export type PayrollProfile = {
  user_id: number;
  salary_type: "fixed" | "percent" | "mixed";
  fixed_monthly: number; // ریال
  percent_repair: number; // درصد از اجرت‌ها
  percent_parts: number; // درصد از قطعات
  percent_only_labor: number; // فقط سهم از اجرت (بدون قطعه)
  pay_period: "monthly" | "weekly" | "daily";
  is_active: number;
};

export function getProfile(userId: number): PayrollProfile | undefined {
  return getDb().prepare("SELECT * FROM payroll_profiles WHERE user_id = ?").get(userId) as any;
}

export function upsertProfile(p: Partial<PayrollProfile> & { user_id: number }) {
  const db = getDb();
  db.prepare(
    `INSERT INTO payroll_profiles(user_id, salary_type, fixed_monthly, percent_repair, percent_parts, percent_only_labor, pay_period, is_active)
     VALUES(@user_id, @salary_type, @fixed_monthly, @percent_repair, @percent_parts, @percent_only_labor, @pay_period, @is_active)
     ON CONFLICT(user_id) DO UPDATE SET
       salary_type = excluded.salary_type, fixed_monthly = excluded.fixed_monthly,
       percent_repair = excluded.percent_repair, percent_parts = excluded.percent_parts,
       percent_only_labor = excluded.percent_only_labor, pay_period = excluded.pay_period, is_active = excluded.is_active`
  ).run({
    salary_type: "fixed",
    fixed_monthly: 0,
    percent_repair: 0,
    percent_parts: 0,
    percent_only_labor: 0,
    pay_period: "monthly",
    is_active: 1,
    ...p,
  });
}

/** محاسبه پورسانت یک تعمیر پس از تحویل — از ticket_items استفاده می‌کند */
export function computeTechnicianCommission(ticketId: number, actorId?: number) {
  const db = getDb();
  return atomic(db, () => {
  const ticket = db.prepare("SELECT technician_id, delivered_at,branch_id FROM repair_tickets WHERE id = ?").get(ticketId) as any;
  if (!ticket?.technician_id || !ticket?.delivered_at) return;
  const profile = getProfile(ticket.technician_id);
  if (!profile || profile.is_active === 0 || profile.salary_type === "fixed") return;

  const items = db.prepare("SELECT kind,qty,unit_price FROM ticket_items WHERE ticket_id=? AND consumed=1").all(ticketId) as { kind: string; qty: number; unit_price: number }[];
  const laborTotal = sumRial(items.filter(i => isRepairService(i.kind)).map(i => multiplyRial(i.unit_price, i.qty)));
  const partsTotal = sumRial(items.filter(i => i.kind === "part").map(i => multiplyRial(i.unit_price, i.qty)));

  let commission = 0;
  if (profile.percent_repair > 0) commission = percentRial(laborTotal, profile.percent_repair);
  if (!profile.percent_only_labor && profile.percent_parts > 0) commission = sumRial([commission, percentRial(partsTotal, profile.percent_parts)]);

  if (commission > 0) {
    const result=db.prepare(
      `INSERT INTO payroll_runs(user_id, period_from, period_to, base_salary, earned_commission, deductions, net_payable, status, source_ticket_id,branch_id)
       VALUES(?,?,?,0,?,0,?,'pending',?,?)
       ON CONFLICT(source_ticket_id) WHERE source_ticket_id IS NOT NULL DO NOTHING`
    ).run(ticket.technician_id, ticket.delivered_at, ticket.delivered_at, commission, commission, ticketId,ticket.branch_id);
    if(result.changes){
      const id=Number(result.lastInsertRowid);
      captureFinancialDocument(db,"commission",id,"accrual",actorId,Number(ticket.branch_id));
      db.prepare("INSERT INTO audit_logs(user_id,action,entity,entity_id,after,branch_id) VALUES(?,'accrue','commission',?,?,?)")
        .run(actorId??null,id,JSON.stringify({ticket_id:ticketId,amount:commission}),ticket.branch_id);
    }
  }
  });
}

/** گزارش حقوق یک کارمند در بازه */
export function payrollReport(userId: number, fromISO: string, toISO: string, branchId?:number|null) {
  const db = getDb();
  const profile = getProfile(userId);
  const commission = db.prepare(
    `SELECT COALESCE(SUM(p.effective_commission),0) c FROM payroll_runs r JOIN users u ON u.id=r.user_id JOIN commission_positions p ON p.run_id=r.id ${PAYROLL_SOURCE_JOINS}
      WHERE r.user_id = ? AND r.status != 'cancelled' AND date(r.period_from) BETWEEN ? AND ? ${branchId==null?"":`AND ${PAYROLL_BRANCH_SQL}=?`}`
  ).get(userId, fromISO, toISO,...(branchId==null?[]:[branchId])) as any;
  const deductions = db.prepare(
    `SELECT COALESCE(SUM(amount),0) c FROM payroll_deductions WHERE user_id = ? AND date BETWEEN ? AND ? ${branchId==null?'':'AND branch_id=?'}`
  ).get(userId, fromISO, toISO,...(branchId==null?[]:[branchId])) as any;
  const base = profile?.fixed_monthly ?? 0;
  return {
    profile,
    base_salary: base,
    commission: commission.c,
    deductions: deductions.c,
    net: base + commission.c - deductions.c,
  };
}

/** ثبت کسر حقوق (غیبت، تأخیر، تخلف، اشتباه عملیاتی، ...) */
export function addDeduction(userId: number, amount: number, reason: string, date: string, notes: string | null, createdBy: number,branchId:number) {
  getDb().prepare(
    "INSERT INTO payroll_deductions(user_id, amount, reason, date, notes, created_by,branch_id) VALUES(?,?,?,?,?,?,?)"
  ).run(userId, amount, reason, date, notes, createdBy,branchId);
}

export const DEDUCTION_REASONS_FA: Record<string, string> = {
  absence: "غیبت",
  late: "تأخیر در حضور",
  violation: "تخلف",
  mistake: "اشتباه عملیاتی",
  other: "سایر",
};
