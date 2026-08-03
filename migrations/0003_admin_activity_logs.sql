CREATE TABLE IF NOT EXISTS admin_activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT,
  display_name TEXT,
  role TEXT,
  action TEXT NOT NULL,
  target_app_id TEXT,
  target_row_id INTEGER,
  detail TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_created_at
ON admin_activity_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_username
ON admin_activity_logs(username, created_at);

CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_action
ON admin_activity_logs(action, created_at);
