CREATE TABLE IF NOT EXISTS welfare_task_actions (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  owner TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  snoozed_until TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_welfare_task_actions_source
  ON welfare_task_actions(source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_welfare_task_actions_status
  ON welfare_task_actions(status, updated_at);
