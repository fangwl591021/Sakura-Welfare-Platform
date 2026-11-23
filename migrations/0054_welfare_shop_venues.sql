CREATE TABLE welfare_shop_venues (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  director_name TEXT NOT NULL,
  email TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);

ALTER TABLE welfare_shop_products ADD COLUMN venue_id TEXT REFERENCES welfare_shop_venues(id);
ALTER TABLE welfare_shop_products ADD COLUMN venue_assigned_by TEXT;

CREATE TABLE welfare_shop_director_email (
  request_id TEXT PRIMARY KEY REFERENCES welfare_shop_requests(id),
  venue_id TEXT NOT NULL REFERENCES welfare_shop_venues(id),
  venue_name TEXT NOT NULL,
  recipient TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','accepted','failed','unknown','disabled','cancelled','recipient_changed')),
  updated_at INTEGER NOT NULL,
  provider_status INTEGER
);

CREATE INDEX idx_welfare_shop_director_email_due ON welfare_shop_director_email(status,updated_at);
