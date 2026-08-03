CREATE TABLE IF NOT EXISTS line_user_profiles (
  line_user_id TEXT PRIMARY KEY,
  display_name TEXT,
  picture_url TEXT,
  status_message TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
