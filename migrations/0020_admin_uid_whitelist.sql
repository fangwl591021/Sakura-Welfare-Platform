CREATE TABLE IF NOT EXISTS admin_uid_whitelist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_user_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'operator',
  allowed_modules TEXT NOT NULL DEFAULT '*',
  active INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_uid_whitelist_uid_active
ON admin_uid_whitelist(line_user_id, active);

INSERT OR IGNORE INTO admin_uid_whitelist
  (line_user_id, display_name, role, allowed_modules, active, note)
VALUES
  ('U35b26d3c1642af71a3f2fce76b745ea7', 'Tonyfang', 'admin', '*', 1, '初始管理 UID，請依實際管理員調整');

