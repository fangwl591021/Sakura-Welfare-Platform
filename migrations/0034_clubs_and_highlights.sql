CREATE TABLE IF NOT EXISTS welfare_clubs (
  id TEXT PRIMARY KEY, content_json TEXT NOT NULL CHECK(json_valid(content_json)),
  revision INTEGER NOT NULL DEFAULT 1, last_request_id TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours'))
);
CREATE TABLE IF NOT EXISTS welfare_club_galleries (
  id TEXT PRIMARY KEY, club_id TEXT NOT NULL REFERENCES welfare_clubs(id),
  content_json TEXT NOT NULL CHECK(json_valid(content_json)), revision INTEGER NOT NULL DEFAULT 1,
  last_request_id TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours'))
);
CREATE INDEX IF NOT EXISTS idx_club_galleries_club ON welfare_club_galleries(club_id,updated_at);
CREATE TABLE IF NOT EXISTS welfare_activity_club_links (
  id TEXT PRIMARY KEY REFERENCES welfare_activity_events(id),
  club_id TEXT NOT NULL REFERENCES welfare_clubs(id),
  content_json TEXT NOT NULL CHECK(json_valid(content_json)), revision INTEGER NOT NULL DEFAULT 1,
  last_request_id TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours'))
);
CREATE INDEX IF NOT EXISTS idx_activity_club_links_club ON welfare_activity_club_links(club_id);
CREATE TABLE IF NOT EXISTS welfare_club_media (
  id TEXT PRIMARY KEY, club_id TEXT NOT NULL REFERENCES welfare_clubs(id),
  object_key TEXT NOT NULL UNIQUE, mime_type TEXT NOT NULL, original_name TEXT NOT NULL,
  file_size INTEGER NOT NULL, actor TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours'))
);
CREATE TABLE IF NOT EXISTS welfare_club_actions (
  request_id TEXT PRIMARY KEY, actor TEXT NOT NULL, fingerprint TEXT NOT NULL,
  kind TEXT NOT NULL, entity_id TEXT NOT NULL, revision INTEGER NOT NULL,
  before_json TEXT NOT NULL, after_json TEXT NOT NULL,
  source_route TEXT NOT NULL DEFAULT '/admin-api/clubs',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours'))
);
INSERT OR IGNORE INTO welfare_clubs(id,content_json) VALUES
 ('club-yoga','{"title":"瑜珈社","status":"active","published":true,"description":"","contact":"","join_rules":"","translations":{"id":{"title":"Klub Yoga"},"th":{"title":"ชมรมโยคะ"}}}'),
 ('club-badminton','{"title":"羽球社","status":"active","published":true,"description":"","contact":"","join_rules":"","translations":{"id":{"title":"Klub Bulu Tangkis"},"th":{"title":"ชมรมแบดมินตัน"}}}'),
 ('club-running','{"title":"路跑社","status":"preparing","published":true,"description":"","contact":"","join_rules":"","translations":{"id":{"title":"Klub Lari"},"th":{"title":"ชมรมวิ่ง"}}}');
