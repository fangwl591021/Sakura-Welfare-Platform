CREATE TABLE IF NOT EXISTS welfare_activity_story_grants (
 line_user_id TEXT NOT NULL, unit_id TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 PRIMARY KEY(line_user_id,unit_id)
);
CREATE TABLE IF NOT EXISTS welfare_activity_stories (
 id TEXT PRIMARY KEY, unit_id TEXT NOT NULL, content_json TEXT NOT NULL CHECK(json_valid(content_json)), revision INTEGER NOT NULL DEFAULT 1,
 last_request_id TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_stories_unit ON welfare_activity_stories(unit_id,updated_at);
CREATE TABLE IF NOT EXISTS welfare_activity_story_media (
 id TEXT PRIMARY KEY, unit_id TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE, mime_type TEXT NOT NULL,
 original_name TEXT NOT NULL, file_size INTEGER NOT NULL, actor TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS welfare_activity_story_actions (
 request_id TEXT PRIMARY KEY, actor TEXT NOT NULL, fingerprint TEXT NOT NULL, kind TEXT NOT NULL,
 entity_id TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
