CREATE TABLE IF NOT EXISTS rich_menu_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  chat_bar_text TEXT DEFAULT '選單',
  config_json TEXT NOT NULL DEFAULT '{}',
  image_url TEXT DEFAULT '',
  image_key TEXT DEFAULT '',
  image_mime_type TEXT DEFAULT '',
  owner_uid TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  deployed_rich_menu_id TEXT DEFAULT '',
  deployed_at TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_rich_menu_projects_updated
  ON rich_menu_projects(updated_at DESC);
