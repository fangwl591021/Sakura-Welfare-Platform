CREATE TABLE IF NOT EXISTS welfare_flex_templates (
  id TEXT PRIMARY KEY,
  keyword TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  reply_type TEXT NOT NULL DEFAULT 'FLEX'
    CHECK (reply_type IN ('FLEX', 'TEXT')),
  active INTEGER NOT NULL DEFAULT 1,
  category TEXT NOT NULL DEFAULT 'general',
  payload_json TEXT NOT NULL DEFAULT '{}',
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_pushed_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_welfare_flex_templates_keyword
  ON welfare_flex_templates(keyword);

CREATE INDEX IF NOT EXISTS idx_welfare_flex_templates_category
  ON welfare_flex_templates(category);
