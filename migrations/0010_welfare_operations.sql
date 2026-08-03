ALTER TABLE welfare_redemptions ADD COLUMN location_id TEXT NOT NULL DEFAULT '';
ALTER TABLE welfare_redemptions ADD COLUMN quantity REAL NOT NULL DEFAULT 1;
ALTER TABLE welfare_redemptions ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash';
ALTER TABLE welfare_redemptions ADD COLUMN cashier_line_user_id TEXT NOT NULL DEFAULT '';
ALTER TABLE welfare_redemptions ADD COLUMN point_type TEXT NOT NULL DEFAULT '';
ALTER TABLE welfare_redemptions ADD COLUMN point_change REAL NOT NULL DEFAULT 0;
ALTER TABLE welfare_redemptions ADD COLUMN mother_point_insert_id TEXT NOT NULL DEFAULT '';
ALTER TABLE welfare_redemptions ADD COLUMN remark TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS welfare_point_logs (
  id TEXT PRIMARY KEY,
  redemption_id TEXT NOT NULL DEFAULT '',
  line_user_id TEXT NOT NULL DEFAULT '',
  shop_id INTEGER NOT NULL DEFAULT 0,
  point_type TEXT NOT NULL DEFAULT 'system_point',
  point_change REAL NOT NULL DEFAULT 0,
  event_name TEXT NOT NULL DEFAULT '',
  event_content TEXT NOT NULL DEFAULT '',
  mother_insert_id TEXT NOT NULL DEFAULT '',
  raw_response TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'success', 'failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_welfare_point_logs_line_time
  ON welfare_point_logs(line_user_id, created_at);

CREATE TABLE IF NOT EXISTS welfare_ai_inquiries (
  id TEXT PRIMARY KEY,
  line_user_id TEXT NOT NULL DEFAULT '',
  member_id TEXT NOT NULL DEFAULT '',
  source_language TEXT NOT NULL DEFAULT 'zh-TW',
  target_language TEXT NOT NULL DEFAULT 'zh-TW',
  question TEXT NOT NULL DEFAULT '',
  answer TEXT NOT NULL DEFAULT '',
  intent TEXT NOT NULL DEFAULT '',
  related_vendor_id TEXT NOT NULL DEFAULT '',
  related_offer_id TEXT NOT NULL DEFAULT '',
  raw_ai_json TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_welfare_ai_inquiries_line_time
  ON welfare_ai_inquiries(line_user_id, created_at);

CREATE TABLE IF NOT EXISTS welfare_audit_events (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL DEFAULT 'admin',
  actor_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL DEFAULT '',
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  raw_json TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_welfare_audit_events_target
  ON welfare_audit_events(target_type, target_id, created_at);
