-- Additive only: existing activities retain their original registration behavior.
ALTER TABLE welfare_activity_events ADD COLUMN registration_start_at TEXT NOT NULL DEFAULT '';
ALTER TABLE welfare_activity_events ADD COLUMN registration_end_at TEXT NOT NULL DEFAULT '';
