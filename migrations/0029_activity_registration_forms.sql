-- Append-only form revisions preserve actor, changes and participant snapshots.
-- Tony approved replacing the legacy registration test data on 2026-09-14.
-- Back up remote D1 first. Apply once through the migration ledger, never as a
-- recurring setup script: only the legacy registration table is reset.
DROP TABLE IF EXISTS welfare_activity_registrations;

CREATE TABLE IF NOT EXISTS welfare_activity_forms (
  event_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  schema_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_id, revision)
);

CREATE TABLE IF NOT EXISTS welfare_activity_registrations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  line_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  form_revision INTEGER NOT NULL,
  schema_json TEXT NOT NULL,
  answers_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(event_id, line_user_id)
);
CREATE INDEX IF NOT EXISTS idx_activity_registration_event
ON welfare_activity_registrations(event_id, created_at);
