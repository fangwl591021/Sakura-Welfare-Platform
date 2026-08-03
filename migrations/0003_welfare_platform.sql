CREATE TABLE IF NOT EXISTS line_webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT,
  event_type TEXT,
  source_type TEXT,
  line_user_id TEXT,
  message_type TEXT,
  message_text TEXT,
  raw_payload TEXT NOT NULL,
  sentiment_type TEXT,
  priority TEXT,
  tags_json TEXT,
  suggested_action TEXT,
  process_status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_line_webhook_events_user
ON line_webhook_events(line_user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_line_webhook_events_status
ON line_webhook_events(process_status, priority, created_at);

CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_name TEXT NOT NULL,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  line_user_id TEXT,
  category TEXT,
  region TEXT,
  city TEXT,
  district TEXT,
  address TEXT,
  google_maps_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vendors_status
ON vendors(status, category, city);

CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER,
  title TEXT NOT NULL,
  category TEXT,
  original_price REAL,
  employee_price REAL,
  visitor_price REAL,
  discount_rule TEXT,
  content_zh TEXT,
  content_id TEXT,
  content_th TEXT,
  image_url TEXT,
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);

CREATE INDEX IF NOT EXISTS idx_offers_vendor_status
ON offers(vendor_id, status, category);

CREATE TABLE IF NOT EXISTS redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id INTEGER,
  vendor_id INTEGER,
  line_user_id TEXT,
  identity_type TEXT NOT NULL,
  original_price REAL NOT NULL DEFAULT 0,
  discount_rate REAL,
  discount_amount REAL NOT NULL DEFAULT 0,
  paid_amount REAL NOT NULL DEFAULT 0,
  point_type TEXT,
  point_change REAL,
  mother_api_status TEXT,
  mother_api_response TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (offer_id) REFERENCES offers(id),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);

CREATE INDEX IF NOT EXISTS idx_redemptions_vendor_date
ON redemptions(vendor_id, created_at);

CREATE INDEX IF NOT EXISTS idx_redemptions_user_date
ON redemptions(line_user_id, created_at);

CREATE TABLE IF NOT EXISTS ai_ocr_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER,
  source_file_url TEXT,
  source_type TEXT,
  ocr_status TEXT NOT NULL DEFAULT 'pending',
  extracted_json TEXT,
  created_offer_ids_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);

CREATE INDEX IF NOT EXISTS idx_ai_ocr_jobs_vendor_status
ON ai_ocr_jobs(vendor_id, ocr_status);

CREATE TABLE IF NOT EXISTS admin_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  source_table TEXT,
  source_id INTEGER,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open',
  assignee TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_tasks_status
ON admin_tasks(status, priority, created_at);
