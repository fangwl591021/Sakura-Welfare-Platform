-- Private, resumable paid-push drafts; no campaign or delivery writes.
CREATE TABLE IF NOT EXISTS welfare_segment_push_drafts (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  title TEXT NOT NULL,
  filters_json TEXT NOT NULL,
  content_json TEXT NOT NULL,
  selected_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_segment_push_drafts_actor_updated
  ON welfare_segment_push_drafts(actor, updated_at DESC);
