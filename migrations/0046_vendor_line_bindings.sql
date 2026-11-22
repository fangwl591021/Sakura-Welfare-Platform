CREATE TABLE IF NOT EXISTS welfare_vendor_line_bindings (
  vendor_id TEXT NOT NULL,
  line_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','revoked')),
  source TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(vendor_id,line_user_id)
);
CREATE INDEX IF NOT EXISTS idx_vendor_line_bindings_uid ON welfare_vendor_line_bindings(line_user_id,status);
CREATE TABLE IF NOT EXISTS welfare_vendor_line_codes (
  code_hash TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_line_codes_active ON welfare_vendor_line_codes(vendor_id) WHERE active=1;
CREATE TABLE IF NOT EXISTS welfare_vendor_line_event_claims (
  event_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS welfare_vendor_line_code_attempts (
  line_user_id TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  PRIMARY KEY(line_user_id,bucket)
);
