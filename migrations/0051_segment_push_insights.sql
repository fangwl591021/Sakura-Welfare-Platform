CREATE TABLE IF NOT EXISTS welfare_push_insights (
  campaign_id TEXT PRIMARY KEY REFERENCES welfare_push_campaigns(id),
  unit_name TEXT NOT NULL UNIQUE,
  started_at INTEGER NOT NULL,
  next_sync_at INTEGER,
  synced_at INTEGER,
  sync_failed INTEGER NOT NULL DEFAULT 0,
  unique_opens INTEGER,
  unique_clickers INTEGER,
  links_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_welfare_push_insights_due ON welfare_push_insights(next_sync_at);
