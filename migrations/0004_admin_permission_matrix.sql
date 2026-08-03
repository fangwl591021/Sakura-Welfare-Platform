ALTER TABLE admin_users ADD COLUMN login_method TEXT NOT NULL DEFAULT 'password';
ALTER TABLE admin_users ADD COLUMN line_user_id TEXT;

CREATE TABLE IF NOT EXISTS admin_user_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  business_unit TEXT NOT NULL,
  review_stage TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES admin_users(id),
  UNIQUE(user_id, business_unit, review_stage)
);

CREATE INDEX IF NOT EXISTS idx_admin_user_permissions_user
ON admin_user_permissions(user_id, active);

CREATE INDEX IF NOT EXISTS idx_admin_user_permissions_unit_stage
ON admin_user_permissions(business_unit, review_stage, active);

INSERT OR IGNORE INTO admin_user_permissions (user_id, business_unit, review_stage)
SELECT id, business_units, 'prelim'
FROM admin_users
WHERE role = 'prelim' AND business_units <> '';

INSERT OR IGNORE INTO admin_user_permissions (user_id, business_unit, review_stage)
SELECT id, business_units, 'final'
FROM admin_users
WHERE role = 'final' AND business_units <> '';
