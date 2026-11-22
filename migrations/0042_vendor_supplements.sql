-- Additive review state: keep welfare_vendors and its existing CHECK/FKs intact.
CREATE TABLE IF NOT EXISTS welfare_vendor_supplements (
  vendor_id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK(state IN ('needs_supplement','pending','closed')),
  items_json TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  reviewed_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  last_event_id TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS welfare_vendor_notification_identities (
  vendor_id TEXT PRIMARY KEY,
  line_user_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('line_verified_application','line_verified_portal_login','admin_verified')),
  verified_by TEXT NOT NULL DEFAULT '',
  verified_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS welfare_vendor_review_events (
  request_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  vendor_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  previous_status TEXT NOT NULL,
  next_status TEXT NOT NULL,
  items_json TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  expected_updated_at TEXT NOT NULL,
  recipient_uid TEXT NOT NULL DEFAULT '',
  recipient_source TEXT NOT NULL DEFAULT '',
  notification_state TEXT NOT NULL DEFAULT 'not_requested',
  retry_key TEXT NOT NULL UNIQUE,
  response_status INTEGER NOT NULL DEFAULT 0,
  provider_request_id TEXT NOT NULL DEFAULT '',
  provider_accepted_request_id TEXT NOT NULL DEFAULT '',
  notification_detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vendor_review_events_vendor ON welfare_vendor_review_events(vendor_id,created_at);
