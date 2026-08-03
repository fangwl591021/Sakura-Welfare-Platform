CREATE TABLE IF NOT EXISTS welfare_usage_events (
  id TEXT PRIMARY KEY,
  line_user_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL DEFAULT '',
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  vendor_id TEXT NOT NULL DEFAULT '',
  offer_id TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_welfare_usage_events_type_time
  ON welfare_usage_events(event_type, created_at);

CREATE INDEX IF NOT EXISTS idx_welfare_usage_events_offer_time
  ON welfare_usage_events(offer_id, created_at);

CREATE INDEX IF NOT EXISTS idx_welfare_usage_events_vendor_time
  ON welfare_usage_events(vendor_id, created_at);

CREATE TABLE IF NOT EXISTS welfare_report_snapshots (
  id TEXT PRIMARY KEY,
  report_type TEXT NOT NULL DEFAULT 'management',
  filters_json TEXT NOT NULL DEFAULT '{}',
  summary_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_welfare_report_snapshots_type_time
  ON welfare_report_snapshots(report_type, created_at);
