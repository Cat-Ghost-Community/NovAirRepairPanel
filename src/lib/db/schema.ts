import type { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { ACCOUNTING_DDL } from "@/lib/accounting-schema";
import { RETURNS_DDL } from "@/lib/returns-schema";
import { prepareEmptyCreditReissues } from '@/lib/credit-reissue-schema';
import { INSTALLMENT_DDL,initializeInstallmentViews } from '@/lib/installment-schema';
import { SETTLED_PAYMENT } from '@/lib/payment-state';
import { initializeEffectiveInvoiceView } from "@/lib/invoice-obligation";
import { REPAIR_WORKFLOW_DDL } from '@/lib/repair-workflow-schema';
import { DAILY_REPORT_EVIDENCE_DDL } from '@/lib/daily-report-evidence';
import {CUSTOMER_CREDIT_DDL} from '@/lib/customer-credit-schema';
import {COMMISSION_CORRECTION_DDL} from '@/lib/commission-correction-schema';
import {GROWTH_INDEXES} from '@/lib/db/growth-indexes';
import {assertSqliteRuntime,assertTestDatabaseDirectory} from '@/lib/db/runtime';
import {BACKUP_DOWNLOAD_DDL} from '@/lib/db/backup-download-schema';
import {REPAIR_GROUP_RECEIPT_DDL} from '@/lib/repair-group-schema';
import {atomic} from '@/lib/db/transaction';
import {configurePersistentSqlite} from '@/lib/db/sqlite-config';

// Serverless deployments are rejected before opening any database. Never
// silently substitute a temporary directory for durable business persistence.
// روی سرور اختصاصی می‌توان محل داده را با REPAID_DATA_DIR جابه‌جا کرد
// (مثلاً /var/lib/repaid) تا داده‌ها مستقل از پوشهٔ برنامه و آپدیت‌ها بمانند.
const OVERRIDE_DIR = process.env.REPAID_DATA_DIR?.trim();
const DATA_DIR = OVERRIDE_DIR
    ? path.resolve(OVERRIDE_DIR)
    : path.join(process.cwd(), "data");
export const DB_PATH = path.join(DATA_DIR, "repaid.db");

let _db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  assertSqliteRuntime();
  assertTestDatabaseDirectory(DATA_DIR);
  if (_db?.isOpen) return _db;
  _db=null;
  // Resolve SQLite only when a request opens the DB, so Next.js can inspect
  // server modules during builds. The supported application runtime is Node 24.
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
  fs.mkdirSync(DATA_DIR, { recursive: true });
    const db = new DatabaseSync(DB_PATH);
    try {
      configurePersistentSqlite(db);
      atomic(db,()=>{
      db.exec(DDL);
      db.exec(ACCOUNTING_DDL);
      db.exec(RETURNS_DDL);
      db.exec(INSTALLMENT_DDL);
      db.exec(REPAIR_WORKFLOW_DDL);
      db.exec(DAILY_REPORT_EVIDENCE_DDL);
      db.exec(CUSTOMER_CREDIT_DDL);
      db.exec(COMMISSION_CORRECTION_DDL);
      db.exec(BACKUP_DOWNLOAD_DDL);
      // اجرای مهاجرت‌های افزایشی به‌صورت idempotent
      for (const [table, col, stmt] of MIGRATIONS) {
        const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
        if (!cols.some((c) => c.name === col)) db.exec(stmt);
      }
      // ایندکس‌هایی که به ستون‌های مهاجرت‌شده وابسته‌اند — فقط بعد از مهاجرت‌ها (idempotent)
      prepareEmptyCreditReissues(db);
      for (const stmt of POST_MIGRATIONS_SQL) {
        db.exec(stmt);
      }
      for(const statement of GROWTH_INDEXES)db.exec(statement);
      db.exec(REPAIR_GROUP_RECEIPT_DDL);
      initializeEffectiveInvoiceView(db);
      initializeInstallmentViews(db,SETTLED_PAYMENT);
      });
      _db = db;
      return _db;
    } catch (error) {
      if(db.isOpen)db.close();
      throw error;
    }
}

export const DDL = `
CREATE TABLE IF NOT EXISTS operation_receipts (
  actor_id INTEGER NOT NULL REFERENCES users(id), branch_id INTEGER NOT NULL REFERENCES branches(id),
  operation TEXT NOT NULL, operation_key TEXT NOT NULL, request_hash TEXT NOT NULL, result_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(actor_id, branch_id, operation, operation_key)
);
CREATE TABLE IF NOT EXISTS inventory_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT NOT NULL UNIQUE,
  part_id INTEGER NOT NULL REFERENCES parts(id), from_location INTEGER NOT NULL REFERENCES inventory_locations(id),
  to_location INTEGER NOT NULL REFERENCES inventory_locations(id), qty REAL NOT NULL CHECK(qty>0),
  branch_id INTEGER NOT NULL REFERENCES branches(id), to_branch_id INTEGER NOT NULL REFERENCES branches(id),
  user_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(from_location!=to_location)
);
CREATE TABLE IF NOT EXISTS login_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL CHECK(count > 0), window_start INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_login_attempts_window ON login_attempts(window_start);
CREATE TABLE IF NOT EXISTS branches (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, address TEXT, phone TEXT, city TEXT, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'technician', branch_id INTEGER REFERENCES branches(id), phone TEXT, is_active INTEGER DEFAULT 1, avatar_color TEXT DEFAULT '#0ea5e9', created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT DEFAULT (datetime('now')), expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tracking_tokens (token_hash TEXT PRIMARY KEY, ticket_id INTEGER NOT NULL REFERENCES repair_tickets(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_tracking_tokens_expires ON tracking_tokens(expires_at);
CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE, first_name TEXT, last_name TEXT, company TEXT, mobile TEXT, phone TEXT, email TEXT, address TEXT, city TEXT, country TEXT, postal_code TEXT, tax_id TEXT, dob TEXT, notes TEXT, tags TEXT DEFAULT '[]', is_vip INTEGER DEFAULT 0, is_blacklisted INTEGER DEFAULT 0, blacklist_reason TEXT, credit_limit INTEGER DEFAULT 0, payment_terms TEXT, is_company INTEGER DEFAULT 0, contact_person TEXT, is_archived INTEGER DEFAULT 0, branch_id INTEGER, created_by INTEGER, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT,
  national_id TEXT, job TEXT, referral_source TEXT, nickname TEXT, referrer_customer_id INTEGER, referrer_commission_type TEXT, referrer_commission_value REAL DEFAULT 0, is_colleague INTEGER DEFAULT 0, customer_type TEXT DEFAULT 'new', organization_name TEXT);
CREATE TABLE IF NOT EXISTS devices (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL REFERENCES customers(id), type TEXT NOT NULL, brand TEXT, model TEXT, model_number TEXT, sku TEXT, serial TEXT, imei TEXT, imei2 TEXT, mac TEXT, asset_tag TEXT, color TEXT, ram TEXT, storage TEXT, cpu TEXT, gpu TEXT, os TEXT, os_version TEXT, carrier TEXT, battery_health INTEGER, condition TEXT, purchase_date TEXT, warranty_until TEXT, notes TEXT, specs TEXT DEFAULT '{}', is_archived INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT,
  is_blacklisted INTEGER DEFAULT 0, blacklist_reason TEXT, next_service_date TEXT, service_interval_days INTEGER);
CREATE INDEX IF NOT EXISTS idx_devices_customer ON devices(customer_id);
CREATE TABLE IF NOT EXISTS repair_statuses (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, category TEXT, color TEXT, icon TEXT, description TEXT, allowed_next TEXT DEFAULT '[]', is_open INTEGER DEFAULT 1, sort INTEGER DEFAULT 0, sla_hours INTEGER, notify_customer INTEGER DEFAULT 0, customer_visible INTEGER DEFAULT 1, technician_visible INTEGER DEFAULT 1, required_fields TEXT, is_system INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS repair_tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT UNIQUE, branch_id INTEGER NOT NULL REFERENCES branches(id), customer_id INTEGER NOT NULL REFERENCES customers(id), device_id INTEGER NOT NULL REFERENCES devices(id), repair_type TEXT, priority TEXT DEFAULT 'normal', source TEXT DEFAULT 'walk-in', technician_id INTEGER REFERENCES users(id), technician2_id INTEGER REFERENCES users(id), status_id INTEGER NOT NULL REFERENCES repair_statuses(id), substatus TEXT, problem TEXT, condition_notes TEXT, accessories TEXT, security_type TEXT, security_value_enc TEXT, security_hint TEXT, estimated_completion TEXT, ready_at TEXT, completed_at TEXT, delivered_at TEXT, is_warranty INTEGER DEFAULT 0, original_ticket_id INTEGER, tags TEXT DEFAULT '[]', qc_status TEXT, qc_notes TEXT, checklist TEXT DEFAULT '[]', inspection TEXT DEFAULT '{}', diagnosis TEXT, diagnosis_outcome TEXT, root_cause TEXT, diagnostic_fee INTEGER DEFAULT 0, estimate_id INTEGER, delivered_by INTEGER, cancel_reason TEXT, custom_answers TEXT, group_receipt_id INTEGER, created_by INTEGER, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_tickets_customer ON repair_tickets(customer_id);
CREATE INDEX IF NOT EXISTS idx_tickets_device ON repair_tickets(device_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON repair_tickets(status_id);
CREATE INDEX IF NOT EXISTS idx_tickets_technician ON repair_tickets(technician_id);
CREATE INDEX IF NOT EXISTS idx_tickets_branch ON repair_tickets(branch_id);
CREATE INDEX IF NOT EXISTS idx_tickets_created ON repair_tickets(created_at);

/* تاریخچهٔ ارجاع دستگاه به تعمیرکار — فقط افزودنی؛ حذف/بازنویسی در گردش عادی ممنوع */
CREATE TABLE IF NOT EXISTS repair_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES repair_tickets(id) ON DELETE CASCADE,
  action TEXT NOT NULL,                 -- assign | reassign
  from_user_id INTEGER,                 -- تعمیرکار قبلی (null در ارجاع اول)
  to_user_id INTEGER NOT NULL,          -- تعمیرکار جدید
  reason TEXT,                          -- دلیل (برای ارجاع مجدد پس از شروع تعمیر الزامی)
  user_id INTEGER NOT NULL,             -- مدیر انجام‌دهنده
  actor_name TEXT,                      -- نام تاریخی مدیر (اسنپ‌شات — اگر نام کاربر بعداً عوض شود)
  branch_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_repair_assignments_ticket ON repair_assignments(ticket_id, id);
CREATE INDEX IF NOT EXISTS idx_repair_assignments_to ON repair_assignments(to_user_id, created_at);
CREATE TABLE IF NOT EXISTS repair_status_history (id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL, from_status INTEGER, to_status INTEGER NOT NULL, user_id INTEGER, note TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS repair_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL, user_id INTEGER, body TEXT NOT NULL, kind TEXT DEFAULT 'internal', created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS repair_attachments (id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER, customer_id INTEGER, device_id INTEGER, expense_id INTEGER, filename TEXT, mime TEXT, size INTEGER, phase TEXT, data BLOB, uploaded_by INTEGER, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS time_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL, user_id INTEGER, started_at TEXT, paused_at TEXT, ended_at TEXT, minutes_active INTEGER DEFAULT 0, is_manual INTEGER DEFAULT 0, note TEXT);
CREATE TABLE IF NOT EXISTS services (id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT, name TEXT NOT NULL, category TEXT, description TEXT, price INTEGER DEFAULT 0, cost INTEGER DEFAULT 0, duration_min INTEGER, warranty_days INTEGER DEFAULT 90, is_active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS suppliers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, company TEXT, phone TEXT, email TEXT, address TEXT, tax_id TEXT, payment_terms TEXT, credit_limit INTEGER DEFAULT 0, bank_info TEXT, contact_person TEXT, notes TEXT, is_archived INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS parts (id INTEGER PRIMARY KEY AUTOINCREMENT, sku, barcode TEXT, name TEXT NOT NULL, category TEXT, brand TEXT, compatibility TEXT, description TEXT, unit TEXT DEFAULT 'pcs', purchase_price INTEGER DEFAULT 0, avg_cost INTEGER DEFAULT 0, price INTEGER DEFAULT 0, wholesale_price INTEGER, min_stock INTEGER DEFAULT 0, reorder_point INTEGER, max_stock INTEGER, preferred_supplier_id INTEGER, location TEXT, shelf TEXT, bin TEXT, track_serial INTEGER DEFAULT 0, warranty_days INTEGER DEFAULT 0, condition TEXT DEFAULT 'new', is_active INTEGER DEFAULT 1, notes TEXT, image TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS inventory_locations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, branch_id INTEGER, is_default INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS inventory_stock (id INTEGER PRIMARY KEY AUTOINCREMENT, part_id INTEGER NOT NULL REFERENCES parts(id), location_id INTEGER NOT NULL REFERENCES inventory_locations(id), qty INTEGER DEFAULT 0, reserved INTEGER DEFAULT 0, UNIQUE(part_id, location_id));
CREATE TABLE IF NOT EXISTS inventory_movements (id INTEGER PRIMARY KEY AUTOINCREMENT, part_id INTEGER NOT NULL, location_id INTEGER, qty INTEGER NOT NULL, type TEXT NOT NULL, ref_type TEXT, ref_id INTEGER, unit_cost INTEGER, note TEXT, user_id INTEGER, branch_id INTEGER, created_at TEXT DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_movements_part ON inventory_movements(part_id);
CREATE TABLE IF NOT EXISTS serialized_parts (id INTEGER PRIMARY KEY AUTOINCREMENT, part_id INTEGER NOT NULL, serial TEXT UNIQUE, imei TEXT, batch TEXT, warranty_until TEXT, supplier_id INTEGER, purchase_date TEXT, cost INTEGER, location_id INTEGER, status TEXT DEFAULT 'in_stock', ticket_id INTEGER, sale_id INTEGER, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS purchase_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT UNIQUE, supplier_id INTEGER NOT NULL, branch_id INTEGER, date TEXT, expected_date TEXT, status TEXT DEFAULT 'draft', items_total INTEGER DEFAULT 0, discount INTEGER DEFAULT 0, tax INTEGER DEFAULT 0, shipping INTEGER DEFAULT 0, total INTEGER DEFAULT 0, notes TEXT, created_by INTEGER, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS purchase_order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, po_id INTEGER NOT NULL, part_id INTEGER, name TEXT, qty INTEGER, received_qty INTEGER DEFAULT 0, unit_cost INTEGER, total INTEGER);
CREATE TABLE IF NOT EXISTS goods_receipts (id INTEGER PRIMARY KEY AUTOINCREMENT, po_id INTEGER, number TEXT, received_by INTEGER, notes TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS supplier_purchase_items (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_id INTEGER NOT NULL REFERENCES suppliers(id), part_id INTEGER REFERENCES parts(id), name TEXT NOT NULL, qty INTEGER DEFAULT 1, unit TEXT, est_cost INTEGER DEFAULT 0, note TEXT, priority TEXT DEFAULT 'normal', status TEXT DEFAULT 'pending', branch_id INTEGER, created_by INTEGER, po_id INTEGER, created_at TEXT DEFAULT (datetime('now')), done_at TEXT);
CREATE INDEX IF NOT EXISTS idx_supplier_purchase_supplier ON supplier_purchase_items(supplier_id, status);
/* تعرفهٔ تعمیرات — مدیر برای هر نوع دستگاه/ایراد، اجرت و گارانتی ثابت تعیین می‌کند */
CREATE TABLE IF NOT EXISTS repair_tariffs (id INTEGER PRIMARY KEY AUTOINCREMENT, device_type TEXT NOT NULL, brand TEXT, title TEXT NOT NULL, labor_price INTEGER DEFAULT 0, duration_min INTEGER, warranty_days INTEGER DEFAULT 90, notes TEXT, is_active INTEGER DEFAULT 1, created_by INTEGER, updated_by INTEGER, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_repair_tariffs_active ON repair_tariffs(is_active, device_type);
CREATE TABLE IF NOT EXISTS ticket_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL, kind TEXT NOT NULL, ref_id INTEGER,
  name TEXT NOT NULL, qty REAL DEFAULT 1, unit_price INTEGER DEFAULT 0, cost INTEGER DEFAULT 0,
  consumed INTEGER DEFAULT 0, warranty_days INTEGER DEFAULT 0, added_by INTEGER, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS estimates (id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT UNIQUE, ticket_id INTEGER, customer_id INTEGER NOT NULL, device_id INTEGER, version INTEGER DEFAULT 1, parent_id INTEGER, status TEXT DEFAULT 'draft', subtotal INTEGER DEFAULT 0, discount INTEGER DEFAULT 0, tax INTEGER DEFAULT 0, total INTEGER DEFAULT 0, deposit INTEGER DEFAULT 0, valid_until TEXT, notes TEXT, terms TEXT, public_token TEXT UNIQUE, approved_at TEXT, rejected_at TEXT, rejection_reason TEXT, created_by INTEGER, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS estimate_items (id INTEGER PRIMARY KEY AUTOINCREMENT, estimate_id INTEGER NOT NULL, kind TEXT, ref_id INTEGER, name TEXT, qty REAL DEFAULT 1, unit_price INTEGER, total INTEGER, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT UNIQUE, customer_id INTEGER NOT NULL, ticket_id INTEGER, sale_id INTEGER, branch_id INTEGER, status TEXT DEFAULT 'draft', date TEXT, due_date TEXT, subtotal INTEGER DEFAULT 0, discount INTEGER DEFAULT 0, tax INTEGER DEFAULT 0, total INTEGER DEFAULT 0, paid INTEGER DEFAULT 0, notes TEXT, terms TEXT, revision INTEGER DEFAULT 1, created_by INTEGER, created_at TEXT DEFAULT (datetime('now')), type TEXT DEFAULT 'repair', supplier_id INTEGER, employee_id INTEGER, external_number TEXT, confirmed_at TEXT, confirmed_by INTEGER, stock_posted INTEGER DEFAULT 0, cancelled_at TEXT, cancel_reason TEXT, client_key TEXT, purchase_order_id INTEGER);
CREATE TABLE IF NOT EXISTS invoice_items (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL, kind TEXT, ref_id INTEGER, name TEXT, qty REAL DEFAULT 1, unit_price INTEGER, cost INTEGER DEFAULT 0, total INTEGER, sort INTEGER DEFAULT 0, sku TEXT, line_discount INTEGER DEFAULT 0, employee_id INTEGER);
CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT UNIQUE, customer_id INTEGER NOT NULL, invoice_id INTEGER, ticket_id INTEGER, sale_id INTEGER, amount INTEGER NOT NULL, method TEXT DEFAULT 'cash', reference TEXT, notes TEXT, branch_id INTEGER, user_id INTEGER, direction TEXT DEFAULT 'in', created_at TEXT DEFAULT (datetime('now')), supplier_id INTEGER);
CREATE TABLE IF NOT EXISTS refunds (id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT UNIQUE, payment_id INTEGER, invoice_id INTEGER, sale_id INTEGER, customer_id INTEGER, amount INTEGER, reason TEXT, method TEXT, user_id INTEGER, branch_id INTEGER, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, amount INTEGER NOT NULL, date TEXT, vendor TEXT, method TEXT, branch_id INTEGER, description TEXT, attachment_id INTEGER, user_id INTEGER, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sales (id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT UNIQUE, customer_id INTEGER, branch_id INTEGER, subtotal INTEGER DEFAULT 0, discount INTEGER DEFAULT 0, tax INTEGER DEFAULT 0, total INTEGER DEFAULT 0, paid INTEGER DEFAULT 0, status TEXT DEFAULT 'completed', notes TEXT, user_id INTEGER, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sale_items (id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER NOT NULL, kind TEXT, ref_id INTEGER, name TEXT, qty REAL DEFAULT 1, unit_price INTEGER, cost INTEGER DEFAULT 0, total INTEGER);
CREATE TABLE IF NOT EXISTS warranties (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT DEFAULT 'repair', ticket_id INTEGER, invoice_id INTEGER, sale_id INTEGER, part_id INTEGER, customer_id INTEGER, start_date TEXT, end_date TEXT, days INTEGER DEFAULT 90, terms TEXT, covered TEXT, excluded TEXT, status TEXT DEFAULT 'active', created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS warranty_claims (id INTEGER PRIMARY KEY AUTOINCREMENT, warranty_id INTEGER NOT NULL, ticket_id INTEGER, reason TEXT, status TEXT DEFAULT 'open', resolution TEXT, cost INTEGER DEFAULT 0, user_id INTEGER, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS complaints (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER, ticket_id INTEGER, category TEXT, description TEXT, priority TEXT DEFAULT 'normal', status TEXT DEFAULT 'open', assigned_to INTEGER, resolution TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS appointments (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER, device_id INTEGER, repair_type TEXT, preferred_at TEXT, notes TEXT, status TEXT DEFAULT 'requested', branch_id INTEGER, technician_id INTEGER, ticket_id INTEGER, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT, body TEXT, priority TEXT DEFAULT 'normal', link TEXT, read INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER, customer_id INTEGER, direction TEXT DEFAULT 'out', channel TEXT DEFAULT 'sms', body TEXT, status TEXT DEFAULT 'queued', user_id INTEGER, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS message_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, event TEXT UNIQUE, channel TEXT DEFAULT 'sms', subject TEXT, body TEXT, is_active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT NOT NULL, entity TEXT, entity_id INTEGER, before TEXT, after TEXT, ip TEXT, branch_id INTEGER, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS customer_events (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, ticket_id INTEGER, type TEXT, title TEXT, detail TEXT, user_id INTEGER, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, value INTEGER DEFAULT 0);

/* ================= امکانات ویژه بازار ایران ================= */

/* چک‌های دریافتی و پرداختی */
CREATE TABLE IF NOT EXISTS checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT, kind TEXT NOT NULL, -- received | issued
  amount INTEGER NOT NULL, issue_date TEXT, due_date TEXT NOT NULL, bank_name TEXT, branch TEXT,
  cheque_serial TEXT, sayad_id TEXT, payer_payee TEXT, customer_id INTEGER, supplier_id INTEGER,
  invoice_id INTEGER, status TEXT DEFAULT 'in_hand', -- in_hand | passed | bounced | transferred_spend | deposited | returned_to_bank
  bank_account_id INTEGER, spent_to TEXT, description TEXT, user_id INTEGER, branch_id INTEGER, created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_checks_due ON checks(due_date);

/* حساب‌های بانکی */
CREATE TABLE IF NOT EXISTS bank_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, bank_name TEXT, account_number TEXT, card_number TEXT, sheba TEXT, branch TEXT, current_balance INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now'))
);

/* تراکنش‌های بانکی: واریز/برداشت/انتقال/کارتخوان */
CREATE TABLE IF NOT EXISTS bank_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER REFERENCES bank_accounts(id), type TEXT NOT NULL, -- deposit | withdraw | transfer_in | transfer_out | pos_settlement
  amount INTEGER NOT NULL, to_account_id INTEGER, ref TEXT, description TEXT, date TEXT, user_id INTEGER, created_at TEXT DEFAULT (datetime('now'))
);

/* اقساط */
CREATE TABLE IF NOT EXISTS installments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, invoice_id INTEGER, ticket_id INTEGER,
  seq INTEGER NOT NULL, amount INTEGER NOT NULL, paid_amount INTEGER DEFAULT 0, due_date TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- pending | partially_paid | paid | overdue
  reminder_days_before INTEGER DEFAULT 3, notes TEXT, paid_at TEXT, user_id INTEGER, created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_installments_due ON installments(due_date);

/* حقوق و دستمزد کارمندان */
CREATE TABLE IF NOT EXISTS payroll_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id), salary_type TEXT DEFAULT 'fixed', -- fixed | percent | mixed
  fixed_monthly INTEGER DEFAULT 0, percent_repair REAL DEFAULT 0, percent_parts REAL DEFAULT 0, percent_services REAL DEFAULT 0,
  percent_only_labor INTEGER DEFAULT 0, pay_period TEXT DEFAULT 'monthly', is_active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS payroll_deductions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, reason TEXT, -- absence | late | violation | mistake | other
  date TEXT NOT NULL, notes TEXT, created_by INTEGER, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS payroll_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, period_from TEXT, period_to TEXT,
  base_salary INTEGER DEFAULT 0, earned_commission INTEGER DEFAULT 0, deductions INTEGER DEFAULT 0, net_payable INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending', -- pending | approved | paid
  paid_at TEXT, created_at TEXT DEFAULT (datetime('now'))
);

/* سوالات پذیرش سفارشی */
CREATE TABLE IF NOT EXISTS intake_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, type TEXT DEFAULT 'text', -- text | textarea | select | multiselect | boolean | number | date
  options TEXT DEFAULT '[]', is_required INTEGER DEFAULT 0, show_on_receipt INTEGER DEFAULT 1, sort INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS intake_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL, question_id INTEGER NOT NULL, answer TEXT
);

/* لیست سیاه دستگاه‌ها */
CREATE TABLE IF NOT EXISTS device_blacklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT, device_id INTEGER, serial TEXT, imei TEXT, reason TEXT, created_by INTEGER, created_at TEXT DEFAULT (datetime('now'))
);

/* الگوهای پذیرش (برای پذیرش سریع دستگاه تکراری) */
CREATE TABLE IF NOT EXISTS repair_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, device_type TEXT, brand TEXT, model TEXT,
  repair_type TEXT, problem TEXT, services TEXT DEFAULT '[]', parts TEXT DEFAULT '[]', est_duration_hours INTEGER, est_cost INTEGER, use_count INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
);

/* پشتیبان‌گیری */
CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL, size INTEGER, kind TEXT DEFAULT 'manual', -- manual | auto | email
  destination TEXT, status TEXT DEFAULT 'done', created_by INTEGER, created_at TEXT DEFAULT (datetime('now'))
);

/* دسترسی‌های ریز per-user — اولویت بر نقش */
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  perm TEXT NOT NULL,
  effect TEXT NOT NULL DEFAULT 'allow' CHECK(effect IN ('allow','deny')),
  PRIMARY KEY(user_id, perm)
);

/* گزارش‌های ذخیره‌شده گزارش‌ساز */
CREATE TABLE IF NOT EXISTS saved_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, source TEXT NOT NULL, config TEXT, user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

/* ادغام مشتری‌های تکراری */
CREATE TABLE IF NOT EXISTS merge_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, master_id INTEGER, merged_id INTEGER, moved_counts TEXT, user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

/* چیدمان شخصی‌سازی‌شده ویجت‌های داشبورد برای هر کاربر */
CREATE TABLE IF NOT EXISTS dashboard_layouts (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  layout TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT DEFAULT (datetime('now'))
);

-- گزارش پایان روز کاری هر کارمند
CREATE TABLE IF NOT EXISTS daily_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_date TEXT NOT NULL,
  summary TEXT DEFAULT '',
  achievements TEXT DEFAULT '',
  blockers TEXT DEFAULT '',
  tomorrow TEXT DEFAULT '',
  mood INTEGER DEFAULT 3,
  worked_minutes INTEGER DEFAULT 0,
  ticket_count INTEGER DEFAULT 0,
  tickets_json TEXT DEFAULT '[]',
  shift_start TEXT DEFAULT '',
  shift_end TEXT DEFAULT '',
  signature_data TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  submitted_at TEXT,
  reviewed_by INTEGER,
  review_note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, report_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_reports_date ON daily_reports(report_date);
CREATE INDEX IF NOT EXISTS idx_daily_reports_user ON daily_reports(user_id);

/* ================= چت سازمانی ================= */
CREATE TABLE IF NOT EXISTS chat_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'direct',            -- direct | group | channel
  title TEXT,
  description TEXT,
  avatar_color TEXT,
  dm_key TEXT UNIQUE,                              -- کلید یکتای مکالمهٔ خصوصی (جلوگیری از ساخت مکالمهٔ تکراری)
  entity_type TEXT,                                -- repair | customer | purchase_order | part | invoice | warranty | branch
  entity_id INTEGER,
  branch_id INTEGER,
  history_for_new_members INTEGER DEFAULT 0,       -- آیا عضو تازه پیام‌های قبل از عضویت را می‌بیند؟
  created_by INTEGER,
  last_message_at TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_last ON chat_conversations(last_message_at);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_entity ON chat_conversations(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS chat_members (
  conversation_id INTEGER NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',             -- owner | admin | member
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  left_at TEXT,                                    -- خروج نرم — تاریخچهٔ پیام‌ها حفظ می‌شود
  last_read_message_id INTEGER DEFAULT 0,
  joined_msg_id INTEGER DEFAULT 0,                 -- مرز دقیق تاریخچه: آخرین شناسهٔ پیام هنگام عضویت
  pinned INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  muted_until TEXT,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id, left_at);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_id INTEGER REFERENCES users(id),          -- NULL = پیام سیستمی
  kind TEXT NOT NULL DEFAULT 'text',               -- text | system
  body TEXT DEFAULT '',
  search_text TEXT DEFAULT '',                     -- نسخهٔ نرمال‌شده برای جست‌وجوی فارسی (بدون تغییر متن اصلی)
  reply_to_id INTEGER,
  client_key TEXT,                                 -- شناسهٔ یکتای کلاینت — جلوگیری از ارسال تکراری
  pinned INTEGER DEFAULT 0,
  edited_at TEXT,
  deleted_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages(conversation_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_client_key ON chat_messages(conversation_id, client_key) WHERE client_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER REFERENCES chat_messages(id) ON DELETE CASCADE,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  data BLOB NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_attachments_message ON chat_attachments(message_id);

CREATE TABLE IF NOT EXISTS chat_reactions (
  message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS chat_mentions (
  message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, user_id)
);

/* حضور: هر بار که کاربر از چت استفاده می‌کند به‌روز می‌شود (مبنای آنلاین/آخرین فعالیت) */
CREATE TABLE IF NOT EXISTS chat_presence (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

/* «در حال نوشتن…» — گذرا؛ با TTL پاک می‌شود */
CREATE TABLE IF NOT EXISTS chat_typing (
  conversation_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (conversation_id, user_id)
);

/* جریان رویدادها برای همگام‌سازی چند-تب/چند-کاربر (cursor = id) */
CREATE TABLE IF NOT EXISTS chat_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  actor_id INTEGER,
  type TEXT NOT NULL,
  payload TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_events_conv ON chat_events(conversation_id, id);
`;

/**
 * ایندکس‌ها/ساختارهایی که به ستون‌های «مهاجرت‌شده» وابسته‌اند و باید بعد از MIGRATIONS اجرا شوند.
 * مرتبه مهم است: DDL → MIGRATIONS → POST_MIGRATIONS_SQL.
 */
export const POST_MIGRATIONS_SQL: string[] = [
  'CREATE INDEX IF NOT EXISTS idx_payroll_deduction_branch ON payroll_deductions(branch_id,user_id,date)',
  "CREATE TRIGGER IF NOT EXISTS payroll_deduction_branch_locked BEFORE UPDATE OF branch_id,user_id ON payroll_deductions WHEN NEW.branch_id IS NOT OLD.branch_id OR NEW.user_id IS NOT OLD.user_id BEGIN SELECT RAISE(ABORT,'Deduction financial ownership is immutable'); END",
  "CREATE INDEX IF NOT EXISTS idx_devices_branch_customer ON devices(branch_id,customer_id,id)",
  "CREATE INDEX IF NOT EXISTS idx_complaints_branch ON complaints(branch_id,id)",
  "CREATE INDEX IF NOT EXISTS idx_warranties_branch ON warranties(branch_id,id)",
  "CREATE INDEX IF NOT EXISTS idx_messages_branch_status ON messages(branch_id,status,id)",
  `CREATE VIEW IF NOT EXISTS customer_branch_access AS
    SELECT id customer_id,branch_id FROM customers WHERE branch_id IS NOT NULL
    UNION SELECT c.id,t.branch_id FROM customers c JOIN repair_tickets t ON t.customer_id=c.id WHERE c.branch_id IS NULL AND t.branch_id IS NOT NULL
    UNION SELECT c.id,i.branch_id FROM customers c JOIN invoices i ON i.customer_id=c.id WHERE c.branch_id IS NULL AND i.branch_id IS NOT NULL AND i.type!='purchase'
    UNION SELECT c.id,s.branch_id FROM customers c JOIN sales s ON s.customer_id=c.id WHERE c.branch_id IS NULL AND s.branch_id IS NOT NULL
    UNION SELECT c.id,p.branch_id FROM customers c JOIN payments p ON p.customer_id=c.id WHERE c.branch_id IS NULL AND p.branch_id IS NOT NULL AND p.supplier_id IS NULL
    UNION SELECT c.id,a.branch_id FROM customers c JOIN appointments a ON a.customer_id=c.id WHERE c.branch_id IS NULL AND a.branch_id IS NOT NULL`,
  `CREATE VIEW IF NOT EXISTS device_branch_access AS
    SELECT id device_id,branch_id FROM devices WHERE branch_id IS NOT NULL
    UNION SELECT d.id,c.branch_id FROM devices d JOIN customers c ON c.id=d.customer_id WHERE d.branch_id IS NULL AND c.branch_id IS NOT NULL
    UNION SELECT d.id,t.branch_id FROM devices d JOIN customers c ON c.id=d.customer_id JOIN repair_tickets t ON t.device_id=d.id WHERE d.branch_id IS NULL AND c.branch_id IS NULL AND t.branch_id IS NOT NULL
    UNION SELECT d.id,a.branch_id FROM devices d JOIN customers c ON c.id=d.customer_id JOIN appointments a ON a.device_id=d.id WHERE d.branch_id IS NULL AND c.branch_id IS NULL AND a.branch_id IS NOT NULL
    UNION SELECT d.id,MIN(access.branch_id) FROM devices d JOIN customers c ON c.id=d.customer_id JOIN customer_branch_access access ON access.customer_id=c.id WHERE d.branch_id IS NULL AND c.branch_id IS NULL GROUP BY d.id HAVING COUNT(DISTINCT access.branch_id)=1`,
  "CREATE INDEX IF NOT EXISTS idx_saved_reports_branch_user ON saved_reports(branch_id,user_id,id)",
  "CREATE INDEX IF NOT EXISTS idx_daily_reports_branch_date ON daily_reports(branch_id,report_date,user_id)",
  "CREATE INDEX IF NOT EXISTS idx_notifications_branch_user ON notifications(branch_id,user_id,read,id)",
  "CREATE INDEX IF NOT EXISTS idx_device_blacklist_branch ON device_blacklist(branch_id,id)",
  `CREATE TRIGGER IF NOT EXISTS daily_reports_capture_branch AFTER INSERT ON daily_reports WHEN NEW.branch_id IS NULL BEGIN
    UPDATE daily_reports SET branch_id=(SELECT branch_id FROM users WHERE id=NEW.user_id) WHERE id=NEW.id; END`,
  "DROP TRIGGER IF EXISTS notifications_capture_branch",
  `CREATE TRIGGER IF NOT EXISTS notifications_capture_branch_v2 AFTER INSERT ON notifications WHEN NEW.branch_id IS NULL AND NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.role IN ('owner','admin')) BEGIN
    UPDATE notifications SET branch_id=(SELECT branch_id FROM users WHERE id=NEW.user_id) WHERE id=NEW.id; END`,
  `CREATE TRIGGER IF NOT EXISTS device_blacklist_capture_branch AFTER INSERT ON device_blacklist WHEN NEW.branch_id IS NULL BEGIN
    UPDATE device_blacklist SET branch_id=COALESCE((SELECT c.branch_id FROM devices d JOIN customers c ON c.id=d.customer_id WHERE d.id=NEW.device_id),(SELECT branch_id FROM users WHERE id=NEW.created_by)) WHERE id=NEW.id; END`,
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_source_line ON inventory_movements(ref_type,ref_id,source_line_id,type) WHERE source_line_id IS NOT NULL",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_ticket_consumption ON inventory_movements(ref_id) WHERE ref_type='ticket_item' AND type='repair_consumption'",
  "CREATE TRIGGER IF NOT EXISTS cancelled_repair_items BEFORE INSERT ON ticket_items WHEN EXISTS(SELECT 1 FROM repair_tickets t JOIN repair_statuses s ON s.id=t.status_id WHERE t.id=NEW.ticket_id AND s.name='Cancelled') BEGIN SELECT RAISE(ABORT,'Cancelled repair requires a reviewed correction before new work'); END",
  "CREATE TRIGGER IF NOT EXISTS inventory_movement_immutable BEFORE UPDATE ON inventory_movements BEGIN SELECT RAISE(ABORT,'Inventory movement history is immutable'); END",
  "CREATE TRIGGER IF NOT EXISTS inventory_movement_no_delete BEFORE DELETE ON inventory_movements BEGIN SELECT RAISE(ABORT,'Inventory movement history is immutable'); END",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_active_return ON credit_notes(return_id) WHERE status IN ('draft','approved','posted')",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_replacement ON credit_notes(replaces_note_id) WHERE replaces_note_id IS NOT NULL",
  "CREATE TRIGGER IF NOT EXISTS return_extended_cost_locked BEFORE UPDATE OF extended_cost ON inventory_movements WHEN OLD.extended_cost IS NOT NEW.extended_cost BEGIN SELECT RAISE(ABORT,'Documented movement cost is immutable'); END",
  "CREATE TRIGGER IF NOT EXISTS return_valuation_locked BEFORE UPDATE OF cost_amount,valuation_json ON business_return_lines WHEN OLD.cost_amount IS NOT NULL AND (NEW.cost_amount IS NOT OLD.cost_amount OR NEW.valuation_json IS NOT OLD.valuation_json) BEGIN SELECT RAISE(ABORT,'Documented return valuation is immutable'); END",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_return_refund_reference ON return_settlements(return_id,document_reference) WHERE document_reference IS NOT NULL",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_transfer_movement ON inventory_movements(ref_id,type) WHERE ref_type='inventory_transfer'",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_operation_business_key ON operation_receipts(actor_id,operation,operation_key) WHERE scope='business'",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_transactions_check ON bank_transactions(check_id) WHERE check_id IS NOT NULL",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_checks_payment ON checks(payment_id) WHERE payment_id IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS idx_refunds_payment ON refunds(payment_id)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_source_ticket ON payroll_runs(source_ticket_id) WHERE source_ticket_id IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)",
  "CREATE INDEX IF NOT EXISTS idx_invoices_type ON invoices(type, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_invoices_supplier ON invoices(supplier_id)",
  "CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_client_key ON invoices(client_key) WHERE client_key IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id, sort, id)",
  "CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id)",
  "CREATE INDEX IF NOT EXISTS idx_checks_invoice ON checks(invoice_id)",
];

/* ALTERهای افزایشی — باید جدا و idempotent اجرا شوند */
const MIGRATIONS: Array<[string, string, string]> = [
  ['repair_tickets','assignment_version','ALTER TABLE repair_tickets ADD COLUMN assignment_version INTEGER NOT NULL DEFAULT 0'],
  ['repair_assignments','workflow_revision','ALTER TABLE repair_assignments ADD COLUMN workflow_revision INTEGER'],
  ['repair_assignments','assignment_version','ALTER TABLE repair_assignments ADD COLUMN assignment_version INTEGER'],
  ['repair_assignments','from_helper_id','ALTER TABLE repair_assignments ADD COLUMN from_helper_id INTEGER'],
  ['repair_assignments','to_helper_id','ALTER TABLE repair_assignments ADD COLUMN to_helper_id INTEGER'],
  ["messages", "branch_id", "ALTER TABLE messages ADD COLUMN branch_id INTEGER REFERENCES branches(id)"],
  ["devices", "branch_id", "ALTER TABLE devices ADD COLUMN branch_id INTEGER REFERENCES branches(id)"],
  ["complaints", "branch_id", "ALTER TABLE complaints ADD COLUMN branch_id INTEGER REFERENCES branches(id)"],
  ["warranties", "branch_id", "ALTER TABLE warranties ADD COLUMN branch_id INTEGER REFERENCES branches(id)"],
  ["saved_reports", "branch_id", "ALTER TABLE saved_reports ADD COLUMN branch_id INTEGER REFERENCES branches(id)"],
  ["daily_reports", "branch_id", "ALTER TABLE daily_reports ADD COLUMN branch_id INTEGER REFERENCES branches(id)"],
  ['payroll_deductions','branch_id','ALTER TABLE payroll_deductions ADD COLUMN branch_id INTEGER REFERENCES branches(id)'],
  ['repair_attachments','object_key','ALTER TABLE repair_attachments ADD COLUMN object_key TEXT'],
  ['repair_attachments','object_sha256','ALTER TABLE repair_attachments ADD COLUMN object_sha256 TEXT'],
  ['chat_attachments','object_key','ALTER TABLE chat_attachments ADD COLUMN object_key TEXT'],
  ['chat_attachments','object_sha256','ALTER TABLE chat_attachments ADD COLUMN object_sha256 TEXT'],
  ["notifications", "branch_id", "ALTER TABLE notifications ADD COLUMN branch_id INTEGER REFERENCES branches(id)"],
  ["device_blacklist", "branch_id", "ALTER TABLE device_blacklist ADD COLUMN branch_id INTEGER REFERENCES branches(id)"],
  ['installments','schedule_id','ALTER TABLE installments ADD COLUMN schedule_id INTEGER REFERENCES installment_schedules(id)'],
  ['installments','schedule_term_id','ALTER TABLE installments ADD COLUMN schedule_term_id INTEGER REFERENCES installment_schedule_terms(id)'],
  ['credit_notes','replaces_note_id','ALTER TABLE credit_notes ADD COLUMN replaces_note_id INTEGER REFERENCES credit_notes(id)'],
  ['parts','quantity_precision','ALTER TABLE parts ADD COLUMN quantity_precision INTEGER NOT NULL DEFAULT 6 CHECK(quantity_precision BETWEEN 0 AND 6)'],
  ['inventory_stock','carrying_value',"ALTER TABLE inventory_stock ADD COLUMN carrying_value INTEGER CHECK(carrying_value IS NULL OR (typeof(carrying_value)='integer' AND carrying_value>=0))"],
  ['inventory_stock','valuation_json','ALTER TABLE inventory_stock ADD COLUMN valuation_json TEXT'],
  ['inventory_movements','valuation_json','ALTER TABLE inventory_movements ADD COLUMN valuation_json TEXT'],
  ['inventory_movements','source_line_id','ALTER TABLE inventory_movements ADD COLUMN source_line_id INTEGER'],
  ['inventory_movements','extended_cost','ALTER TABLE inventory_movements ADD COLUMN extended_cost INTEGER CHECK(extended_cost IS NULL OR (typeof(extended_cost)=\'integer\' AND extended_cost>=0))'],
  ['business_return_lines','cost_amount','ALTER TABLE business_return_lines ADD COLUMN cost_amount INTEGER CHECK(cost_amount IS NULL OR (typeof(cost_amount)=\'integer\' AND cost_amount>=0))'],
  ['business_return_lines','valuation_json','ALTER TABLE business_return_lines ADD COLUMN valuation_json TEXT'],
  ['business_returns','disposition_reference','ALTER TABLE business_returns ADD COLUMN disposition_reference TEXT'],
  ['business_returns','zero_credit_approved_by','ALTER TABLE business_returns ADD COLUMN zero_credit_approved_by INTEGER REFERENCES users(id)'],
  ['business_returns','zero_credit_reference','ALTER TABLE business_returns ADD COLUMN zero_credit_reference TEXT'],
  ['business_return_lines','rejection_release_reference','ALTER TABLE business_return_lines ADD COLUMN rejection_release_reference TEXT'],
  ['return_settlements','document_reference','ALTER TABLE return_settlements ADD COLUMN document_reference TEXT'],
  ['refunds','return_id','ALTER TABLE refunds ADD COLUMN return_id INTEGER REFERENCES business_returns(id)'],
  ['customer_events','branch_id','ALTER TABLE customer_events ADD COLUMN branch_id INTEGER REFERENCES branches(id)'],
  ["payroll_runs", "branch_id", "ALTER TABLE payroll_runs ADD COLUMN branch_id INTEGER REFERENCES branches(id)"],
  ["operation_receipts", "scope", "ALTER TABLE operation_receipts ADD COLUMN scope TEXT NOT NULL DEFAULT 'branch' CHECK(scope IN ('branch','business'))"],
  ["checks", "settled_at", "ALTER TABLE checks ADD COLUMN settled_at TEXT"],
  ["bank_transactions", "check_id", "ALTER TABLE bank_transactions ADD COLUMN check_id INTEGER REFERENCES checks(id)"],
  ["checks", "payment_id", "ALTER TABLE checks ADD COLUMN payment_id INTEGER REFERENCES payments(id)"],
  ["payroll_runs", "source_ticket_id", "ALTER TABLE payroll_runs ADD COLUMN source_ticket_id INTEGER REFERENCES repair_tickets(id)"],
  ["inventory_locations", "warehouse_type", "ALTER TABLE inventory_locations ADD COLUMN warehouse_type TEXT DEFAULT 'main'"],
  ["inventory_locations", "keeper", "ALTER TABLE inventory_locations ADD COLUMN keeper TEXT"],
  ["customers", "national_id", "ALTER TABLE customers ADD COLUMN national_id TEXT"],
  ["customers", "job", "ALTER TABLE customers ADD COLUMN job TEXT"],
  ["customers", "referral_source", "ALTER TABLE customers ADD COLUMN referral_source TEXT"],
  ["customers", "nickname", "ALTER TABLE customers ADD COLUMN nickname TEXT"],
  ["customers", "referrer_customer_id", "ALTER TABLE customers ADD COLUMN referrer_customer_id INTEGER"],
  ["customers", "referrer_commission_type", "ALTER TABLE customers ADD COLUMN referrer_commission_type TEXT"],
  ["customers", "referrer_commission_value", "ALTER TABLE customers ADD COLUMN referrer_commission_value REAL DEFAULT 0"],
  ["customers", "is_colleague", "ALTER TABLE customers ADD COLUMN is_colleague INTEGER DEFAULT 0"],
  ["customers", "customer_type", "ALTER TABLE customers ADD COLUMN customer_type TEXT DEFAULT 'new'"],
  ["customers", "organization_name", "ALTER TABLE customers ADD COLUMN organization_name TEXT"],
  // امضای دیجیتال مشتری روی برآورد — الزامات حقوقی: تصویر امضا، نام، زمان، IP و مرورگر
  ["estimates", "signature_data", "ALTER TABLE estimates ADD COLUMN signature_data TEXT"],
  ["estimates", "signed_name", "ALTER TABLE estimates ADD COLUMN signed_name TEXT"],
  ["estimates", "signed_at", "ALTER TABLE estimates ADD COLUMN signed_at TEXT"],
  ["estimates", "signed_ip", "ALTER TABLE estimates ADD COLUMN signed_ip TEXT"],
  ["estimates", "signed_ua", "ALTER TABLE estimates ADD COLUMN signed_ua TEXT"],
  // ارسال پستی دستگاه پس از اتمام کار
  ["repair_tickets", "postal_tracking", "ALTER TABLE repair_tickets ADD COLUMN postal_tracking TEXT"],
  ["repair_tickets", "postal_sent_at", "ALTER TABLE repair_tickets ADD COLUMN postal_sent_at TEXT"],
  // امضای تحویل حضوری — مشتری تأیید می‌کند دستگاه را سالم تحویل گرفته
  ["repair_tickets", "delivery_signature", "ALTER TABLE repair_tickets ADD COLUMN delivery_signature TEXT"],
  ["repair_tickets", "delivery_signed_name", "ALTER TABLE repair_tickets ADD COLUMN delivery_signed_name TEXT"],
  ["repair_tickets", "delivery_signed_at", "ALTER TABLE repair_tickets ADD COLUMN delivery_signed_at TEXT"],
  ["devices", "is_blacklisted", "ALTER TABLE devices ADD COLUMN is_blacklisted INTEGER DEFAULT 0"],
  ["devices", "blacklist_reason", "ALTER TABLE devices ADD COLUMN blacklist_reason TEXT"],
  ["devices", "next_service_date", "ALTER TABLE devices ADD COLUMN next_service_date TEXT"],
  ["devices", "service_interval_days", "ALTER TABLE devices ADD COLUMN service_interval_days INTEGER"],
  ["repair_tickets", "custom_answers", "ALTER TABLE repair_tickets ADD COLUMN custom_answers TEXT"],
  ["repair_tickets", "group_receipt_id", "ALTER TABLE repair_tickets ADD COLUMN group_receipt_id TEXT"],
  ["parts", "price_type", "ALTER TABLE parts ADD COLUMN price_type TEXT DEFAULT 'general'"],
  ["customers", "price_type", "ALTER TABLE customers ADD COLUMN price_type TEXT DEFAULT 'general'"],
  ["dashboard_layouts", "layout", "ALTER TABLE dashboard_layouts ADD COLUMN layout TEXT NOT NULL DEFAULT '[]'"],
  // اتصال هر قلم لیست خرید به سفارش خریدی که از آن ساخته شده (برای جلوگیری از سفارش دوباره)
  ["supplier_purchase_items", "po_id", "ALTER TABLE supplier_purchase_items ADD COLUMN po_id INTEGER"],
  // گارانتی هر قلم پذیرش — از تعرفه/خدمت پر می‌شود و مبنای گارانتی پذیرش است
  ["ticket_items", "warranty_days", "ALTER TABLE ticket_items ADD COLUMN warranty_days INTEGER DEFAULT 0"],
  // مرز دقیق تاریخچهٔ چت برای عضو جدید (به‌جای مقایسهٔ ثانیه‌ای زمان عضویت)
  ["chat_members", "joined_msg_id", "ALTER TABLE chat_members ADD COLUMN joined_msg_id INTEGER DEFAULT 0"],
  // نام تاریخی مسئول ارجاع — تا «مسیر تعمیر» با تغییر نام کاربر هم قابل خواندن بماند
  ["repair_assignments", "actor_name", "ALTER TABLE repair_assignments ADD COLUMN actor_name TEXT"],
  // ---- فاکتور یکپارچه: نوع + طرف حساب تأمین‌کننده + مسئول + ثبت‌نهایی + یکتایی ارسال دوباره ----
  ["invoices", "type", "ALTER TABLE invoices ADD COLUMN type TEXT DEFAULT 'repair'"],
  ["invoices", "supplier_id", "ALTER TABLE invoices ADD COLUMN supplier_id INTEGER"],
  ["invoices", "employee_id", "ALTER TABLE invoices ADD COLUMN employee_id INTEGER"],
  ["invoices", "external_number", "ALTER TABLE invoices ADD COLUMN external_number TEXT"],
  ["invoices", "confirmed_at", "ALTER TABLE invoices ADD COLUMN confirmed_at TEXT"],
  ["invoices", "confirmed_by", "ALTER TABLE invoices ADD COLUMN confirmed_by INTEGER"],
  ["invoices", "stock_posted", "ALTER TABLE invoices ADD COLUMN stock_posted INTEGER DEFAULT 0"],
  ["invoices", "cancelled_at", "ALTER TABLE invoices ADD COLUMN cancelled_at TEXT"],
  ["invoices", "cancel_reason", "ALTER TABLE invoices ADD COLUMN cancel_reason TEXT"],
  ["invoices", "client_key", "ALTER TABLE invoices ADD COLUMN client_key TEXT"],
  ["invoices", "purchase_order_id", "ALTER TABLE invoices ADD COLUMN purchase_order_id INTEGER"],
  ["invoice_items", "sku", "ALTER TABLE invoice_items ADD COLUMN sku TEXT"],
  ["invoice_items", "line_discount", "ALTER TABLE invoice_items ADD COLUMN line_discount INTEGER DEFAULT 0"],
  ["invoice_items", "employee_id", "ALTER TABLE invoice_items ADD COLUMN employee_id INTEGER"],
  ["payments", "supplier_id", "ALTER TABLE payments ADD COLUMN supplier_id INTEGER"],
  ["daily_reports", "revision", "ALTER TABLE daily_reports ADD COLUMN revision INTEGER NOT NULL DEFAULT 0"],
];

export function nextSeq(key: string, prefix: string, pad = 4): string {
  const db = getDb();
  db.prepare("INSERT INTO counters(key, value) VALUES(?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1").run(key);
  const row = db.prepare("SELECT value FROM counters WHERE key = ?").get(key) as { value: number };
  return `${prefix}${String(row.value).padStart(pad, "0")}`;
}
