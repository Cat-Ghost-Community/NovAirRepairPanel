export const NOTIFICATION_DELIVERY_DDL=`
CREATE TABLE IF NOT EXISTS notification_delivery_state(user_id INTEGER PRIMARY KEY REFERENCES users(id),baseline_id INTEGER NOT NULL CHECK(baseline_id>=0));
CREATE TABLE IF NOT EXISTS notification_deliveries(user_id INTEGER NOT NULL REFERENCES users(id),notification_id INTEGER NOT NULL REFERENCES notifications(id),delivered_at TEXT NOT NULL DEFAULT (datetime('now')),PRIMARY KEY(user_id,notification_id));
`;
