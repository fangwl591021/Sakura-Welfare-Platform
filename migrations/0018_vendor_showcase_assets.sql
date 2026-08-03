CREATE TABLE IF NOT EXISTS welfare_vendor_showcase_assets (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  asset_type TEXT NOT NULL DEFAULT 'menu_dm',
  title TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  storage_key TEXT NOT NULL DEFAULT '',
  extracted_text TEXT NOT NULL DEFAULT '',
  generated_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_review', 'approved', 'archived')),
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_welfare_vendor_showcase_vendor
  ON welfare_vendor_showcase_assets(vendor_id, created_at);

CREATE INDEX IF NOT EXISTS idx_welfare_vendor_showcase_status
  ON welfare_vendor_showcase_assets(status, updated_at);
