CREATE TABLE IF NOT EXISTS welfare_push_schedules (
  id TEXT PRIMARY KEY,
  preview_id TEXT NOT NULL UNIQUE,
  actor TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  preview_revision TEXT NOT NULL,
  scheduled_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  claimed_at INTEGER,
  last_error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_welfare_push_schedules_due ON welfare_push_schedules(status,scheduled_at);
CREATE INDEX IF NOT EXISTS idx_welfare_push_schedules_actor ON welfare_push_schedules(actor,created_at);

-- A scheduled preview binds the chosen UTC minute to the reviewed message and recipients.
CREATE TABLE IF NOT EXISTS welfare_push_schedule_intents (
  preview_id TEXT PRIMARY KEY,
  delivery_mode TEXT NOT NULL CHECK (delivery_mode='scheduled'),
  scheduled_at INTEGER NOT NULL
);
