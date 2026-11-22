CREATE TABLE IF NOT EXISTS welfare_vendor_carousel_items (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  image_url TEXT NOT NULL DEFAULT '',
  storage_key TEXT NOT NULL DEFAULT '',
  original_filename TEXT NOT NULL DEFAULT '',
  request_id TEXT NOT NULL DEFAULT '',
  actor_username TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (vendor_id) REFERENCES welfare_vendors(id)
);

CREATE INDEX IF NOT EXISTS idx_welfare_vendor_carousel_order
ON welfare_vendor_carousel_items(vendor_id, status, display_order, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_welfare_vendor_carousel_request
ON welfare_vendor_carousel_items(vendor_id, request_id)
WHERE request_id <> '';
