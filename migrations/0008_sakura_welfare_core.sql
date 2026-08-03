PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS welfare_vendors (
  id TEXT PRIMARY KEY,
  vendor_code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  contact_name TEXT NOT NULL DEFAULT '',
  contact_line_user_id TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  vendor_portal_username TEXT NOT NULL DEFAULT '',
  vendor_portal_password TEXT NOT NULL DEFAULT '',
  vendor_portal_password_updated_at TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'suspended', 'rejected')),
  discount_policy TEXT NOT NULL DEFAULT '',
  ai_review_summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_welfare_vendors_status
  ON welfare_vendors(status);
CREATE INDEX IF NOT EXISTS idx_welfare_vendors_category
  ON welfare_vendors(category);

CREATE TABLE IF NOT EXISTS welfare_vendor_locations (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  branch_name TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  district TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  google_maps_url TEXT NOT NULL DEFAULT '',
  latitude REAL,
  longitude REAL,
  service_area TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (vendor_id) REFERENCES welfare_vendors(id)
);

CREATE INDEX IF NOT EXISTS idx_welfare_vendor_locations_city
  ON welfare_vendor_locations(city);
CREATE INDEX IF NOT EXISTS idx_welfare_vendor_locations_vendor
  ON welfare_vendor_locations(vendor_id);

CREATE TABLE IF NOT EXISTS welfare_offers (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  original_price REAL NOT NULL DEFAULT 0,
  employee_price REAL NOT NULL DEFAULT 0,
  visitor_price REAL NOT NULL DEFAULT 0,
  discount_type TEXT NOT NULL DEFAULT 'fixed_price'
    CHECK (discount_type IN ('fixed_price', 'percent_off', 'amount_off', 'gift')),
  discount_value REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_review', 'approved', 'rejected', 'archived')),
  review_note TEXT NOT NULL DEFAULT '',
  starts_at TEXT NOT NULL DEFAULT '',
  ends_at TEXT NOT NULL DEFAULT '',
  source_image_url TEXT NOT NULL DEFAULT '',
  ai_ocr_json TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (vendor_id) REFERENCES welfare_vendors(id)
);

CREATE INDEX IF NOT EXISTS idx_welfare_offers_vendor
  ON welfare_offers(vendor_id);
CREATE INDEX IF NOT EXISTS idx_welfare_offers_status
  ON welfare_offers(status);
CREATE INDEX IF NOT EXISTS idx_welfare_offers_category
  ON welfare_offers(category);

CREATE TABLE IF NOT EXISTS welfare_members (
  id TEXT PRIMARY KEY,
  line_user_id TEXT NOT NULL UNIQUE,
  member_type TEXT NOT NULL DEFAULT 'visitor'
    CHECK (member_type IN ('employee', 'vendor', 'committee', 'visitor')),
  employee_no TEXT NOT NULL DEFAULT '',
  birthday_mmdd_hash TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  picture_url TEXT NOT NULL DEFAULT '',
  verified_at TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'blocked')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_welfare_members_type
  ON welfare_members(member_type);
CREATE INDEX IF NOT EXISTS idx_welfare_members_employee_no
  ON welfare_members(employee_no);

CREATE TABLE IF NOT EXISTS welfare_redemptions (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  line_user_id TEXT NOT NULL DEFAULT '',
  member_type TEXT NOT NULL DEFAULT 'visitor',
  original_price REAL NOT NULL DEFAULT 0,
  payable_price REAL NOT NULL DEFAULT 0,
  discount_amount REAL NOT NULL DEFAULT 0,
  qr_token TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('pending', 'confirmed', 'voided')),
  redeemed_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (offer_id) REFERENCES welfare_offers(id),
  FOREIGN KEY (vendor_id) REFERENCES welfare_vendors(id),
  FOREIGN KEY (member_id) REFERENCES welfare_members(id)
);

CREATE INDEX IF NOT EXISTS idx_welfare_redemptions_vendor_time
  ON welfare_redemptions(vendor_id, redeemed_at);
CREATE INDEX IF NOT EXISTS idx_welfare_redemptions_member_time
  ON welfare_redemptions(member_id, redeemed_at);

CREATE TABLE IF NOT EXISTS welfare_knowledge_assets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  asset_type TEXT NOT NULL DEFAULT 'file'
    CHECK (asset_type IN ('file', 'url', 'text')),
  source_url TEXT NOT NULL DEFAULT '',
  storage_key TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'zh-TW',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  ai_summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

