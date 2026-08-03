CREATE TABLE IF NOT EXISTS welfare_push_campaigns (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  message_mode TEXT NOT NULL DEFAULT '',
  filters_json TEXT NOT NULL DEFAULT '{}',
  message_json TEXT NOT NULL DEFAULT '[]',
  recipient_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS welfare_push_deliveries (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  line_user_id TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  response_status INTEGER NOT NULL DEFAULT 0,
  response_body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_welfare_push_campaigns_created
  ON welfare_push_campaigns(created_at);

CREATE INDEX IF NOT EXISTS idx_welfare_push_deliveries_campaign
  ON welfare_push_deliveries(campaign_id);

CREATE INDEX IF NOT EXISTS idx_welfare_push_deliveries_line_user
  ON welfare_push_deliveries(line_user_id);
