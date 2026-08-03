CREATE TABLE IF NOT EXISTS line_webhook_intake_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route TEXT,
  event_count INTEGER NOT NULL DEFAULT 0,
  first_event_type TEXT,
  first_source_type TEXT,
  first_line_user_id TEXT,
  first_message_type TEXT,
  first_message_text TEXT,
  signature_present INTEGER,
  signature_valid INTEGER,
  stage TEXT,
  note TEXT,
  error TEXT,
  raw_payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_line_webhook_intake_logs_created
ON line_webhook_intake_logs(created_at);
