-- Additive preview snapshots. Existing campaigns, deliveries and members remain intact.
CREATE TABLE IF NOT EXISTS welfare_push_previews (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  revision TEXT NOT NULL,
  title TEXT NOT NULL,
  message_mode TEXT NOT NULL,
  filters_json TEXT NOT NULL,
  message_json TEXT NOT NULL,
  recipients_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_welfare_push_previews_actor ON welfare_push_previews(actor,created_at);
