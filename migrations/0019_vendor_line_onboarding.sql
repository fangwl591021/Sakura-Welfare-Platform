CREATE TABLE IF NOT EXISTS welfare_vendor_line_sessions (
  line_user_id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL DEFAULT '',
  current_step TEXT NOT NULL DEFAULT 'started',
  last_intent TEXT NOT NULL DEFAULT '',
  last_document_type TEXT NOT NULL DEFAULT '',
  last_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_welfare_vendor_line_sessions_vendor
  ON welfare_vendor_line_sessions(vendor_id);

CREATE TABLE IF NOT EXISTS welfare_vendor_documents (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL DEFAULT '',
  line_user_id TEXT NOT NULL DEFAULT '',
  document_type TEXT NOT NULL DEFAULT '',
  file_url TEXT NOT NULL DEFAULT '',
  storage_key TEXT NOT NULL DEFAULT '',
  original_filename TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT '',
  file_size INTEGER NOT NULL DEFAULT 0,
  ocr_text TEXT NOT NULL DEFAULT '',
  ai_extracted_json TEXT NOT NULL DEFAULT '',
  review_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_welfare_vendor_documents_vendor
  ON welfare_vendor_documents(vendor_id, document_type);

CREATE INDEX IF NOT EXISTS idx_welfare_vendor_documents_line_user
  ON welfare_vendor_documents(line_user_id, created_at);
