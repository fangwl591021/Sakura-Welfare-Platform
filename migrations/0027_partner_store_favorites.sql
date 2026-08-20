CREATE TABLE IF NOT EXISTS welfare_store_favorites (
  line_user_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (line_user_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_welfare_store_favorites_user_created
  ON welfare_store_favorites(line_user_id, created_at DESC);
