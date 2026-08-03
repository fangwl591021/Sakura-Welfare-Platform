CREATE TABLE IF NOT EXISTS rich_menu_bindings (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL DEFAULT 'visitor',
  language TEXT NOT NULL DEFAULT '',
  bind_status TEXT NOT NULL DEFAULT '',
  vendor_status TEXT NOT NULL DEFAULT '',
  admin_role TEXT NOT NULL DEFAULT '',
  rich_menu_alias_id TEXT NOT NULL DEFAULT '',
  rich_menu_id TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1,
  description TEXT NOT NULL DEFAULT '',
  apply_timing TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rich_menu_bindings_order
  ON rich_menu_bindings(active, priority, target_type);

CREATE INDEX IF NOT EXISTS idx_rich_menu_bindings_target
  ON rich_menu_bindings(target_type, language, bind_status, vendor_status);
