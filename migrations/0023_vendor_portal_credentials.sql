ALTER TABLE welfare_vendors ADD COLUMN vendor_portal_username TEXT NOT NULL DEFAULT '';
ALTER TABLE welfare_vendors ADD COLUMN vendor_portal_password TEXT NOT NULL DEFAULT '';
ALTER TABLE welfare_vendors ADD COLUMN vendor_portal_password_updated_at TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_welfare_vendors_portal_username
  ON welfare_vendors(vendor_portal_username);
