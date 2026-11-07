import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok, readJson, audit, HttpError, validate } from "@/lib/api";
import {activeBranch,BRANCH_COOKIE,canSwitchBranch} from "@/lib/branch";
import {canUser} from "@/lib/auth";
import {atomic} from "@/lib/db/transaction";
import {REPORT_SOURCE_PERMISSIONS as SOURCE_PERMISSIONS} from "@/lib/report-access";

export const dynamic = "force-dynamic";

/**
 * گزارش‌ساز سفارشی — منابع داده امن (whitelist) با ستون‌ها، فیلتر و مرتب‌سازی.
 * SQL از پیش تعریف‌شده برای هر منبع؛ ورودی کاربر فقط پارامتر است (بدون SQL injection).
 */
type Source = {
  key: string;
  label: string;
  sql: string;
  cols: Array<{ key: string; label?: string; type?: "money" | "date" | "num" }>;
  filters: Array<{ key: string; label: string; type: "text" | "date" | "money"; col: string }>;
  defaultSort: string;
};

const DATE_FROM = "2020-01-01";
const DATE_TO = "2099-12-31";
const SOURCE_BRANCH:Record<string,string>={repairs:"t.branch_id",invoices:"i.branch_id",sales:"sa.branch_id",payments:"p.branch_id",customers:"c.branch_id"};

const SOURCES: Source[] = [
  {
    key: "repairs",
    label: "پذیرش‌ها",
    sql: `SELECT t.number AS 'شماره', c.first_name || ' ' || c.last_name AS 'مشتری', d.brand || ' ' || d.model AS 'دستگاه',
      s.name AS 'وضعیت', u.name AS 'تعمیرکار', t.problem AS 'ایراد', t.created_at AS 'تاریخ', t.estimated_completion AS 'تحویل تخمینی',
      b.name AS 'شعبه'
      FROM repair_tickets t
      JOIN customers c ON c.id = t.customer_id
      JOIN devices d ON d.id = t.device_id
      JOIN repair_statuses s ON s.id = t.status_id
      LEFT JOIN users u ON u.id = t.technician_id
      LEFT JOIN branches b ON b.id = t.branch_id
      WHERE date(t.created_at) BETWEEN @from AND @to`,
    cols: [
      { key: "شماره" }, { key: "مشتری" }, { key: "دستگاه" }, { key: "وضعیت" }, { key: "تعمیرکار" },
      { key: "ایراد" }, { key: "تاریخ", type: "date" }, { key: "تحویل تخمینی", type: "date" }, { key: "شعبه" },
    ],
    filters: [
      { key: "customer", label: "مشتری", type: "text", col: "c.first_name || ' ' || c.last_name" },
      { key: "status", label: "وضعیت", type: "text", col: "s.name" },
      { key: "device", label: "دستگاه", type: "text", col: "d.brand || ' ' || d.model" },
    ],
    defaultSort: "تاریخ",
  },
  {
    key: "invoices",
    label: "فاکتورها",
    sql: `SELECT i.number AS 'شماره', c.first_name || ' ' || c.last_name AS 'مشتری', i.status AS 'وضعیت',
      i.total AS 'مبلغ کل', i.paid AS 'پرداخت‌شده', (i.total - i.paid) AS 'مانده', i.date AS 'تاریخ', i.due_date AS 'موعد'
      FROM effective_invoices i JOIN customers c ON c.id = i.customer_id
      WHERE date(i.date) BETWEEN @from AND @to`,
    cols: [
      { key: "شماره" }, { key: "مشتری" }, { key: "وضعیت" }, { key: "مبلغ کل", type: "money" },
      { key: "پرداخت‌شده", type: "money" }, { key: "مانده", type: "money" }, { key: "تاریخ", type: "date" }, { key: "موعد", type: "date" },
    ],
    filters: [
      { key: "customer", label: "مشتری", type: "text", col: "c.first_name || ' ' || c.last_name" },
      { key: "status", label: "وضعیت", type: "text", col: "i.status" },
    ],
    defaultSort: "تاریخ",
  },
  {
    key: "sales",
    label: "فروش‌ها",
    sql: `SELECT sa.number AS 'شماره', c.first_name || ' ' || c.last_name AS 'مشتری', sa.total AS 'مبلغ',
      sa.status AS 'وضعیت', date(sa.created_at) AS 'تاریخ', u.name AS 'فروشنده'
      FROM sales sa
      LEFT JOIN customers c ON c.id = sa.customer_id
      LEFT JOIN users u ON u.id = sa.user_id
      WHERE date(sa.created_at) BETWEEN @from AND @to`,
    cols: [
      { key: "شماره" }, { key: "مشتری" }, { key: "مبلغ", type: "money" }, { key: "وضعیت" },
      { key: "تاریخ", type: "date" }, { key: "فروشنده" },
    ],
    filters: [{ key: "customer", label: "مشتری", type: "text", col: "c.first_name || ' ' || c.last_name" }],
    defaultSort: "تاریخ",
  },
  {
    key: "payments",
    label: "دریافت‌ها و پرداخت‌ها",
    sql: `SELECT p.number AS 'شماره سند', c.first_name || ' ' || c.last_name AS 'شخص', p.amount AS 'مبلغ',
      p.method AS 'روش', p.direction AS 'نوع', p.created_at AS 'تاریخ', u.name AS 'کاربر'
      FROM payments p
      LEFT JOIN customers c ON c.id = p.customer_id
      LEFT JOIN users u ON u.id = p.user_id
      WHERE date(p.created_at) BETWEEN @from AND @to`,
    cols: [
      { key: "شماره سند" }, { key: "شخص" }, { key: "مبلغ", type: "money" }, { key: "روش" },
      { key: "نوع" }, { key: "تاریخ", type: "date" }, { key: "کاربر" },
    ],
    filters: [{ key: "person", label: "شخص", type: "text", col: "c.first_name || ' ' || c.last_name" }],
    defaultSort: "تاریخ",
  },
  {
    key: "parts",
    label: "قطعات و موجودی",
    sql: `SELECT p.name AS 'کالا', p.category AS 'گروه', p.price AS 'قیمت فروش',
      p.purchase_price AS 'قیمت خرید', p.reorder_point AS 'نقطه سفارش', p.barcode AS 'بارکد'
      FROM parts p WHERE p.is_active = 1`,
    cols: [
      { key: "کالا" }, { key: "گروه" }, { key: "قیمت فروش", type: "money" },
      { key: "قیمت خرید", type: "money" }, { key: "نقطه سفارش", type: "num" }, { key: "بارکد" },
    ],
    filters: [{ key: "name", label: "کالا", type: "text", col: "p.name" }],
    defaultSort: "کالا",
  },
  {
    key: "customers",
    label: "مشتریان",
    sql: `SELECT c.first_name || ' ' || c.last_name AS 'نام', c.mobile AS 'موبایل', c.city AS 'شهر',
      (SELECT COUNT(*) FROM repair_tickets t WHERE t.customer_id = c.id AND (@branch IS NULL OR t.branch_id=@branch)) AS 'تعداد پذیرش',
      (SELECT COALESCE(SUM(e.amount),0) FROM party_balance_events e WHERE e.kind='customer' AND e.party_id=c.id AND (@branch IS NULL OR e.branch_id=@branch)) AS 'مانده حساب',
      c.created_at AS 'تاریخ عضویت'
      FROM customers c WHERE c.is_archived = 0`,
    cols: [
      { key: "نام" }, { key: "موبایل" }, { key: "شهر" }, { key: "تعداد پذیرش", type: "num" },
      { key: "مانده حساب", type: "money" }, { key: "تاریخ عضویت", type: "date" },
    ],
    filters: [
      { key: "name", label: "نام", type: "text", col: "c.first_name || ' ' || c.last_name" },
      { key: "city", label: "شهر", type: "text", col: "c.city" },
    ],
    defaultSort: "نام",
  },
];

export async function GET(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "reports.view");
    const db = getDb();
    const branch=activeBranch(session,req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    const sources = SOURCES.filter(s=>canUser(session,SOURCE_PERMISSIONS[s.key])).map((s) => ({ key: s.key, label: s.label, cols: s.cols.map((c) => ({ ...c, label: c.label ?? c.key })), filters: s.filters }));
    const saved = (db.prepare("SELECT * FROM saved_reports WHERE (? IS NULL OR branch_id=?) ORDER BY id DESC LIMIT 50").all(branch,branch) as any[]).filter(r=>SOURCE_PERMISSIONS[r.source] && canUser(session,SOURCE_PERMISSIONS[r.source]));
    return ok({ sources, saved });
  } catch (e) {
    return fail(e);
  }
}

/** اجرای گزارش: { source, from, to, sort, desc, filters: {key: value}, cols: [کلیدهای انتخابی] } */
export async function POST(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "reports.view");
    const b = await readJson(req);
    const src = SOURCES.find((s) => s.key === b.source);
    if (!src) return fail(new Error("منبع داده نامعتبر است"));
    requirePerm(session,SOURCE_PERMISSIONS[src.key]);

    let sql = src.sql;
    const params: Record<string, any> = {};
    const branchColumn=SOURCE_BRANCH[src.key];
    if(branchColumn){const predicate=src.key==="customers"?"c.id IN (SELECT customer_id FROM customer_branch_access WHERE branch_id=@branch)":`${branchColumn}=@branch`;sql+=` AND (@branch IS NULL OR ${predicate})`;params.branch=activeBranch(session,req.cookies.get(BRANCH_COOKIE)?.value).branchId;}
    // node:sqlite: پارامتر نامی بدون placeholder در SQL خطا می‌دهد — فقط پارامترهای موجود را بفرست
    if (src.sql.includes("@from")) params.from = /^\d{4}-\d{2}-\d{2}$/.test(b.from ?? "") ? b.from : DATE_FROM;
    if (src.sql.includes("@to")) params.to = /^\d{4}-\d{2}-\d{2}$/.test(b.to ?? "") ? b.to : DATE_TO;

    // فیلترها — فقط فیلترهای whitelist منبع
    for (const f of src.filters) {
      const v = b.filters?.[f.key];
      if (v && String(v).trim()) {
        sql += ` AND ${f.col} LIKE @f_${f.key}`;
        params[`f_${f.key}`] = `%${String(v).trim()}%`;
      }
    }

    // مرتب‌سازی — فقط ستون‌های whitelist
    const sortCol = src.cols.find((c) => c.key === (b.sort || src.defaultSort))?.key ?? src.defaultSort;
    sql += ` ORDER BY "${sortCol}" ${b.desc ? "DESC" : "ASC"}`;
    sql += " LIMIT 1000";

    const rows = getDb().prepare(sql).all(params) as any[];

    // انتخاب ستون‌ها
    const wanted: string[] = Array.isArray(b.cols) && b.cols.length ? b.cols : src.cols.map((c) => c.key);
    const colDefs = src.cols.filter((c) => wanted.includes(c.key));
    const table = rows.map((r: any) => {
      const o: Record<string, any> = {};
      for (const c of colDefs) o[c.key] = r[c.key] ?? null;
      return o;
    });

    return ok({ cols: colDefs, rows: table, total: table.length });
  } catch (e) {
    return fail(e);
  }
}

/** ذخیره گزارش سفارشی */
export async function PUT(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "reports.view");
    const b = await readJson(req);
    if (!b.name?.trim()) return fail(new Error("نام گزارش الزامی است"));
    if(!SOURCE_PERMISSIONS[b.source])throw new HttpError(400,"منبع گزارش معتبر نیست.");
    requirePerm(session,SOURCE_PERMISSIONS[b.source]);
    validate.maxLength(b.name,160,"نام گزارش");
    const db = getDb();
    return atomic(db,()=>{
    const branch=activeBranch(session,req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    const id = db.prepare("INSERT INTO saved_reports(name, source, config, user_id,branch_id) VALUES(?,?,?,?,?)")
      .run(b.name.trim(), b.source, JSON.stringify({ from: b.from, to: b.to, filters: b.filters, cols: b.cols, sort: b.sort, desc: !!b.desc }), session.user.id,branch)
      .lastInsertRowid as number;
    audit(session, "create", "saved_report", id, null, { name: b.name });
    return ok({ id });
    });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "reports.view");
    const id = validate.id(req.nextUrl.searchParams.get("id"));
    const db=getDb(),branch=activeBranch(session,req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    return atomic(db,()=>{
    const row=db.prepare("SELECT branch_id,user_id FROM saved_reports WHERE id=?").get(id);
    if(!row || (branch!=null && row.branch_id!==branch) || (!canSwitchBranch(session.user.role) && row.user_id!==session.user.id))throw new HttpError(404,"گزارش در محدودهٔ مجاز یافت نشد.");
    db.prepare("DELETE FROM saved_reports WHERE id = ?").run(id);
    audit(session,"delete","saved_report",id);
    return ok({ done: true });
    });
  } catch (e) {
    return fail(e);
  }
}
