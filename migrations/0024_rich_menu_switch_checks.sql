CREATE TABLE IF NOT EXISTS rich_menu_switch_checks (
  id TEXT PRIMARY KEY,
  check_group_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT '',
  line_user_id TEXT NOT NULL DEFAULT '',
  event_id TEXT NOT NULL DEFAULT '',
  source_data TEXT NOT NULL DEFAULT '',
  source_alias_id TEXT NOT NULL DEFAULT '',
  target_alias_id TEXT NOT NULL DEFAULT '',
  project_id TEXT NOT NULL DEFAULT '',
  project_name TEXT NOT NULL DEFAULT '',
  d1_rich_menu_id TEXT NOT NULL DEFAULT '',
  line_rich_menu_id TEXT NOT NULL DEFAULT '',
  line_status INTEGER NOT NULL DEFAULT 0,
  switch_status TEXT NOT NULL DEFAULT '',
  latency_ms INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  line_event_at TEXT NOT NULL DEFAULT '',
  checked_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  raw_payload TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_rich_menu_switch_checks_checked
ON rich_menu_switch_checks(checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_rich_menu_switch_checks_alias
ON rich_menu_switch_checks(target_alias_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_rich_menu_switch_checks_user
ON rich_menu_switch_checks(line_user_id, checked_at DESC);
