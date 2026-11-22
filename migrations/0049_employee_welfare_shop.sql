CREATE TABLE IF NOT EXISTS welfare_shop_products (
  id TEXT PRIMARY KEY,
  source_key TEXT UNIQUE,
  category TEXT NOT NULL,
  series TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  condition_note TEXT NOT NULL,
  pickup_note TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  stock INTEGER NOT NULL CHECK (stock >= 0),
  employee_limit INTEGER NOT NULL CHECK (employee_limit > 0),
  status TEXT NOT NULL CHECK (status IN ('draft','published','hidden')),
  photo_key TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS welfare_shop_requests (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES welfare_shop_products(id),
  employee_uid TEXT NOT NULL,
  product_name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  contact TEXT NOT NULL,
  comment TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','completed','cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  managed_by TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_welfare_shop_request_stock ON welfare_shop_requests(product_id,status);
CREATE INDEX IF NOT EXISTS idx_welfare_shop_request_employee ON welfare_shop_requests(employee_uid,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_welfare_shop_request_employee_product
  ON welfare_shop_requests(employee_uid,product_id) WHERE status <> 'cancelled';
