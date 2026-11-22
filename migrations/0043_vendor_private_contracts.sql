-- Private application contracts. No public URL, identity grant or approval mutation.
CREATE TABLE IF NOT EXISTS welfare_vendor_private_contracts (
  id TEXT PRIMARY KEY NOT NULL,
  vendor_id TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK(file_size > 0 AND file_size <= 10485760),
  sha256 TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  previous_document_id TEXT NOT NULL DEFAULT '',
  supplement_revision INTEGER NOT NULL DEFAULT 0,
  supplement_event_id TEXT NOT NULL DEFAULT '',
  request_id TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('vendor','admin')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(vendor_id, revision)
);
CREATE INDEX IF NOT EXISTS idx_vendor_private_contract_vendor
  ON welfare_vendor_private_contracts(vendor_id, revision DESC);
