CREATE TABLE welfare_vendor_public_documents (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'hidden' CHECK(status IN ('hidden','published','archived')),
  display_order INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1,
  last_request_id TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_vendor_public_documents ON welfare_vendor_public_documents(vendor_id,status,display_order);
CREATE TABLE welfare_vendor_public_document_actions (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  action TEXT NOT NULL,
  request_data TEXT NOT NULL,
  previous_data TEXT NOT NULL,
  current_data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(vendor_id,id)
);
