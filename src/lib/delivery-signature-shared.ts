export const DELIVERY_CONSENT='تأیید می‌کنم دستگاه و لوازم همراه مندرج در قبض را تحویل گرفتم و از نتیجهٔ تعمیر و هزینهٔ نهایی اطلاع دارم.';
export const DELIVERY_SIGNATURE_DDL=`CREATE TABLE IF NOT EXISTS repair_delivery_requests(
 ticket_id INTEGER PRIMARY KEY REFERENCES repair_tickets(id),requested_by INTEGER NOT NULL REFERENCES users(id),
 requested_at TEXT NOT NULL DEFAULT (datetime('now')),expires_at INTEGER NOT NULL,fulfilled_at TEXT,signed_ip TEXT,consent_text TEXT
);`;
